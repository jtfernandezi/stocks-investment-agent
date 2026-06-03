import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { NICHE_DISPLAY } from '@/lib/constants';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export async function GET() {
  const [accuracy, patterns, sessions] = await Promise.all([

    safe(() => sql`
      SELECT niche, hit_rate::float AS hit_rate_30d, scaling_factor::float,
             calibration_error::float, total_signals,
             avg_reported_confidence::float AS avg_reported_confidence_30d
      FROM stocks.specialist_accuracy
      ORDER BY hit_rate_30d DESC NULLS LAST
    `, [] as Record<string, unknown>[]),

    safe(() => sql`
      SELECT pattern_type AS pattern_tag, expected_value::float AS ev, win_rate::float,
             avg_win_pct::float, avg_loss_pct::float, total_trades AS sample_count
      FROM stocks.pattern_performance
      ORDER BY expected_value DESC NULLS LAST
    `, [] as Record<string, unknown>[]),

    safe(() => sql`
      WITH ranked AS (
        SELECT
          ps.session,
          COALESCE(jsonb_array_length(ps.raw_json->'portfolio_actions'), 0) AS action_count,
          ps.created_at,
          ROW_NUMBER() OVER (PARTITION BY ps.session ORDER BY ps.created_at DESC) AS rn
        FROM stocks.portfolio_snapshots ps
        WHERE ps.session IS NOT NULL
      )
      SELECT
        r.session,
        r.created_at::text,
        r.action_count,
        os.summary AS orchestrator_summary
      FROM ranked r
      LEFT JOIN LATERAL (
        SELECT summary
        FROM stocks.orchestrator_sessions
        WHERE session_id = r.session
        ORDER BY created_at DESC
        LIMIT 1
      ) os ON true
      WHERE r.rn = 1
      ORDER BY r.created_at DESC
      LIMIT 15
    `, [] as Record<string, unknown>[]),

  ]);

  const enrichedAccuracy = accuracy.map(r => ({
    ...r,
    nicheDisplay: NICHE_DISPLAY[r.niche as string] ?? r.niche,
  }));

  return NextResponse.json({ accuracy: enrichedAccuracy, patterns, sessions });
}

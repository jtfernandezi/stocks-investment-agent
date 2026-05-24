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
      SELECT pattern_tag, ev::float, win_rate::float,
             avg_win_pct::float, avg_loss_pct::float, sample_count
      FROM stocks.pattern_performance
      ORDER BY ev DESC
    `, [] as Record<string, unknown>[]),

    safe(() => sql`
      WITH ranked AS (
        SELECT
          session,
          orchestrator_summary,
          created_at,
          COALESCE(jsonb_array_length(raw_json->'portfolio_actions'), 0) AS action_count,
          ROW_NUMBER() OVER (PARTITION BY session ORDER BY created_at DESC) AS rn
        FROM stocks.portfolio_snapshots
        WHERE session IS NOT NULL
      )
      SELECT session, orchestrator_summary, created_at::text, action_count
      FROM ranked
      WHERE rn = 1
      ORDER BY created_at DESC
      LIMIT 15
    `, [] as Record<string, unknown>[]),

  ]);

  const enrichedAccuracy = accuracy.map(r => ({
    ...r,
    nicheDisplay: NICHE_DISPLAY[r.niche as string] ?? r.niche,
  }));

  return NextResponse.json({ accuracy: enrichedAccuracy, patterns, sessions });
}

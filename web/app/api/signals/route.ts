import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { NICHE_DISPLAY } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await sql`
      SELECT
        ss.niche, ss.direction, ss.conviction,
        ss.confidence::float, ss.materiality,
        ss.top_picks, ss.summary, ss.session, ss.created_at,
        sa.hit_rate_30d::float  AS hit_rate,
        sa.scaling_factor::float AS scaling_factor,
        sa.total_signals
      FROM stocks.specialist_signals ss
      LEFT JOIN stocks.specialist_accuracy sa ON sa.niche = ss.niche
      WHERE ss.session = (
        SELECT session FROM stocks.specialist_signals ORDER BY created_at DESC LIMIT 1
      )
      ORDER BY ss.niche ASC
    `;
    const signals = rows.map(r => {
      let picks: { long_picks: unknown[]; short_picks: unknown[] } = { long_picks: [], short_picks: [] };
      try { picks = JSON.parse(String(r.top_picks || '{}')); } catch { /* keep empty */ }
      return {
        ...r,
        nicheDisplay: NICHE_DISPLAY[r.niche as string] ?? r.niche,
        confidence:   parseFloat(String(r.confidence)),
        picks,
      };
    });
    return NextResponse.json({ signals, session: rows[0]?.session ?? null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

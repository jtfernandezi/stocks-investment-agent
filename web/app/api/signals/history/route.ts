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
        ss.top_picks, ss.summary, ss.session,
        sa.hit_rate::float AS hit_rate,
        sa.total_signals
      FROM stocks.specialist_signals ss
      LEFT JOIN stocks.specialist_accuracy sa ON sa.niche = ss.niche
      ORDER BY ss.created_at ASC
    `;

    const signals = rows.map(r => {
      let picks: { long_picks: unknown[]; short_picks: unknown[] } = { long_picks: [], short_picks: [] };
      try { picks = JSON.parse(String(r.top_picks || '{}')); } catch { /* keep empty */ }
      return {
        niche:         String(r.niche),
        nicheDisplay:  NICHE_DISPLAY[r.niche as string] ?? r.niche,
        direction:     String(r.direction  ?? 'NEUTRAL'),
        conviction:    String(r.conviction ?? 'LOW'),
        confidence:    parseFloat(String(r.confidence ?? 0)),
        materiality:   String(r.materiality ?? '—'),
        summary:       String(r.summary    ?? ''),
        session:       String(r.session    ?? ''),
        hit_rate:      r.hit_rate      != null ? parseFloat(String(r.hit_rate))      : null,
        total_signals: r.total_signals != null ? parseInt(String(r.total_signals))   : null,
        picks,
      };
    });

    // Preserve insertion order (created_at ASC gives chronological order)
    const sessionSet = new Set<string>();
    for (const s of signals) sessionSet.add(s.session);

    return NextResponse.json({ signals, sessions: Array.from(sessionSet) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

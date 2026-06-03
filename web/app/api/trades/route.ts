import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await sql`
      SELECT
        ticker, niche, direction, outcome,
        pnl_pct::float          AS pnl_pct,
        pnl_usd::float          AS pnl_usd,
        hold_days,
        entry_date::text        AS entry_date,
        exit_date::text         AS exit_date,
        entry_pattern, exit_reason, key_lesson, pattern_tag,
        entry_specialist_confidence::float AS entry_specialist_confidence,
        entry_effective_confidence::float  AS entry_effective_confidence,
        sector_accuracy, entry_timing, exit_timing,
        entry_price::float      AS entry_price,
        exit_price::float       AS exit_price,
        qty,
        entry_thesis,
        etf_return::float       AS etf_return,
        size_usd::float         AS size_usd
      FROM stocks.trades
      WHERE status = 'CLOSED'
      ORDER BY exit_date DESC NULLS LAST, updated_at DESC
    `;
    return NextResponse.json({ trades: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

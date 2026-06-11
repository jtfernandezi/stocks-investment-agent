import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { START_CAPITAL } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // One row per calendar day (ET), taking the latest snapshot of that day
    const rows = await sql`
      SELECT DISTINCT ON (DATE(created_at AT TIME ZONE 'America/New_York'))
        DATE(created_at AT TIME ZONE 'America/New_York') AS date,
        portfolio_value_usd,
        spy_price,
        spy_cumulative_pct
      FROM stocks.portfolio_snapshots
      ORDER BY DATE(created_at AT TIME ZONE 'America/New_York') ASC, created_at DESC
    `;

    if (rows.length === 0) return NextResponse.json({ data: [] });

    const points = [
      { date: 'Start', rawDate: null, portfolio: START_CAPITAL, spy: START_CAPITAL },
      ...rows.map(row => {
        const portfolio = parseFloat(String(row.portfolio_value_usd));
        const spyCumPct = parseFloat(String(row.spy_cumulative_pct));
        const spy = isNaN(spyCumPct) ? START_CAPITAL : START_CAPITAL * (1 + spyCumPct / 100);
        const d   = new Date(String(row.date));
        return {
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
          rawDate: String(row.date),  // ISO yyyy-mm-dd for monthly return computation
          portfolio,
          spy,
        };
      }),
    ];

    return NextResponse.json({ data: points });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

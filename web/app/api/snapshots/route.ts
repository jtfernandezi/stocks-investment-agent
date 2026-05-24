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

    if (rows.length === 0) return NextResponse.json([]);

    // Find a reference row with a valid (non-zero) SPY cumulative return
    const spyRef = [...rows].reverse().find(r => parseFloat(String(r.spy_cumulative_pct)) !== 0);
    const spyRefPrice  = spyRef ? parseFloat(String(spyRef.spy_price))          : null;
    const spyRefCumPct = spyRef ? parseFloat(String(spyRef.spy_cumulative_pct)) : null;

    const points = [
      // synthetic start point
      { date: 'Start', portfolio: START_CAPITAL, spy: START_CAPITAL },
      ...rows.map(row => {
        const portfolio = parseFloat(String(row.portfolio_value_usd));
        let spy = START_CAPITAL;
        if (spyRefPrice && spyRefCumPct != null) {
          const spyPrice     = parseFloat(String(row.spy_price));
          const spyRefIndexed = START_CAPITAL * (1 + spyRefCumPct / 100);
          spy = spyRefIndexed * (spyPrice / spyRefPrice);
        }
        const d     = new Date(String(row.date));
        const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        return { date: label, portfolio, spy };
      }),
    ];

    return NextResponse.json(points);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

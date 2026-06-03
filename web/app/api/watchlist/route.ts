import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { NICHE_DISPLAY } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await sql`
      SELECT ticker, niche, direction, reason, trigger_condition, session_id
      FROM stocks.watchlist
      ORDER BY niche ASC, ticker ASC
    `;
    const items = rows.map(r => ({
      ...r,
      nicheDisplay: NICHE_DISPLAY[r.niche as string] ?? r.niche,
    }));
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

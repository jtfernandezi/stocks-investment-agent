import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tickers = (searchParams.get('tickers') ?? '').split(',').filter(Boolean);
    if (tickers.length === 0) return NextResponse.json({ pairs: [] });

    const rows = await sql`
      SELECT ticker_a, ticker_b, correlation::float
      FROM stocks.correlation_matrix
      WHERE ticker_a = ANY(${tickers}) AND ticker_b = ANY(${tickers})
    `;
    return NextResponse.json({ pairs: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { alpacaFetch } from '@/lib/alpaca';
import { START_CAPITAL } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const a = await alpacaFetch<Record<string, string>>('/account');
    const equity     = parseFloat(a.equity);
    const lastEquity = parseFloat(a.last_equity);
    return NextResponse.json({
      equity,
      cash:               parseFloat(a.cash),
      buying_power:       parseFloat(a.buying_power),
      long_market_value:  parseFloat(a.long_market_value),
      short_market_value: parseFloat(a.short_market_value),
      day_pnl:            equity - lastEquity,
      day_pnl_pct:        ((equity - lastEquity) / lastEquity) * 100,
      total_return:       equity - START_CAPITAL,
      total_return_pct:   ((equity - START_CAPITAL) / START_CAPITAL) * 100,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

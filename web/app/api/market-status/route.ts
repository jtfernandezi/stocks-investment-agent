import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/market-status?exchange=US&token=${process.env.FINNHUB_API_KEY}`,
      { cache: 'no-store' }
    );
    const data = await res.json();
    return NextResponse.json({ isOpen: data.isOpen ?? false });
  } catch {
    return NextResponse.json({ isOpen: null });
  }
}

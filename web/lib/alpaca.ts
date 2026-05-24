const BASE   = process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets/v2';
const KEY    = process.env.ALPACA_API_KEY!;
const SECRET = process.env.ALPACA_SECRET_KEY!;

export async function alpacaFetch<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'APCA-API-KEY-ID': KEY,
      'APCA-API-SECRET-KEY': SECRET,
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Alpaca ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

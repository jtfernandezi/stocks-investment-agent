import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export async function GET() {
  const rows = await safe(() => sql`
    SELECT session, body, created_at::text
    FROM stocks.investor_letters
    ORDER BY created_at DESC
    LIMIT 30
  `, [] as Record<string, unknown>[]);

  return NextResponse.json({
    letters: rows.map(r => ({
      session:    String(r.session),
      body:       String(r.body),
      created_at: String(r.created_at),
    })),
  });
}

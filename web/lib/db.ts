import { neon } from '@neondatabase/serverless';

const _sql = neon(process.env.DATABASE_URL!);

// Neon free tier suspends after ~5 min of inactivity; the cold-start query
// often fails with a socket error. Retry once after a short delay.
const isSocketError = (err: unknown) =>
  String(err).toLowerCase().includes('socket') ||
  String(err).toLowerCase().includes('connection closed');

export const sql: typeof _sql = ((...args: Parameters<typeof _sql>) =>
  (_sql(...args) as Promise<unknown>).catch((err: unknown) => {
    if (!isSocketError(err)) throw err;
    return new Promise<void>(r => setTimeout(r, 1200)).then(() => _sql(...args));
  })
) as typeof _sql;

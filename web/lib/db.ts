import 'server-only';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

// Match the type the previous `typeof neon(...)` inferred (default generics),
// so query results stay typed as row arrays (not the broad overload union).
type SqlClient = NeonQueryFunction<false, false>;

// Instantiate the Neon client lazily — NOT at module top-level. Next.js imports
// this module during the build's "collecting page data" step, and calling neon()
// at import time crashes the build when DATABASE_URL is absent at build time
// (e.g. preview/branch deploys where the var is scoped to Production only).
// All callers run at request time, so deferring the connection is safe and keeps
// the build independent of any runtime DB var.
let _client: SqlClient | null = null;
const getClient = (): SqlClient => (_client ??= neon(process.env.DATABASE_URL!));

// Neon free tier suspends after ~5 min of inactivity; the cold-start query
// often fails with a socket error. Retry once after a short delay.
const isSocketError = (err: unknown) =>
  String(err).toLowerCase().includes('socket') ||
  String(err).toLowerCase().includes('connection closed');

export const sql: SqlClient = ((...args: Parameters<SqlClient>) => {
  const _sql = getClient();
  return (_sql(...args) as Promise<unknown>).catch((err: unknown) => {
    if (!isSocketError(err)) throw err;
    return new Promise<void>(r => setTimeout(r, 1200)).then(() => _sql(...args));
  });
}) as SqlClient;

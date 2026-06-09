// Read-only SQL runner for the weekly audit.
// Uses the audit_ro Neon role (SELECT-only — writes are rejected by the DB itself).
// Usage:  node automation/query.mjs "SELECT ... FROM stocks.trades LIMIT 5"
// Prints JSON rows to stdout. This is the ONLY DB path the audit should use.
import { neon } from '@neondatabase/serverless';

const url = process.env.AUDIT_DATABASE_URL;
if (!url) { console.error('AUDIT_DATABASE_URL not set'); process.exit(1); }
const q = process.argv.slice(2).join(' ').trim();
if (!q) { console.error('usage: node query.mjs "SELECT ..."'); process.exit(1); }

const sql = neon(url);
try {
  const rows = await sql.query(q);
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.error('QUERY ERROR:', e.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily Canary — deterministic integrity check (NO LLM)
// Catches the silent-failure class that has historically stalled this fund for
// days (cash deadlock 2026-06-03, watchlist freeze, swallowed query errors).
//
// READ-ONLY: connects with the audit_ro Neon role (SELECT-only, cannot write).
// Silent when healthy. Sends a Telegram alarm ONLY when something is broken.
// Always exits 0 so launchd never flags it; the alarm IS the signal.
//
// Env (provided by run_canary.sh):
//   AUDIT_DATABASE_URL  read-only Neon connection string
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
//   ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_BASE_URL
// ─────────────────────────────────────────────────────────────────────────────
import { neon } from '@neondatabase/serverless';

const COLD_START_CAP = 0.72;   // deadlock fingerprint: every specialist pinned here
const EXPECTED_NICHES = 10;
const WATCHLIST_STALE_DAYS = 4;

// ── time helpers (America/New_York) ──────────────────────────────────────────
const etDate = d => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function nowET() {
  const now = new Date();
  const t = new Intl.DateTimeFormat('en-GB',
    { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const [h, m] = t.split(':').map(Number);
  return { dateStr: etDate(now), clock: t };
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.error('NO TELEGRAM CREDS — cannot alarm'); return; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    const j = await r.json();
    if (!j.ok) console.error('Telegram send failed:', JSON.stringify(j));
  } catch (e) { console.error('Telegram send threw:', e.message); }
}

async function isTradingDay(today) {
  const base = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets/v2';
  try {
    const r = await fetch(`${base}/calendar?start=${today}&end=${today}`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
      },
    });
    const cal = await r.json();
    return Array.isArray(cal) && cal.some(d => d.date === today);
  } catch (e) {
    // If the calendar API is down we can't tell — treat as trading day so we don't
    // silently skip real checks, but note it.
    console.error('Alpaca calendar check failed:', e.message);
    return true;
  }
}

(async () => {
  const et = nowET();
  const stamp = `${et.dateStr} ${et.clock} ET`;
  console.log(`[canary] run @ ${stamp}`);

  // Hard-fail wrapper: if the canary itself cannot run (DB unreachable, etc.),
  // THAT is an alarm — a dead canary must be loud, not silent.
  let sql;
  try {
    if (!process.env.AUDIT_DATABASE_URL) throw new Error('AUDIT_DATABASE_URL not set');
    sql = neon(process.env.AUDIT_DATABASE_URL);
    await sql`SELECT 1`;
  } catch (e) {
    console.error('[canary] DB unreachable:', e.message);
    await sendTelegram(`🚨 STOCKS CANARY — DB UNREACHABLE\n${stamp}\n\nThe daily integrity check could not connect to Neon:\n${e.message}\n\nThe pipeline itself may be down. Check Neon + n8n.`);
    process.exit(0);
  }

  const today = et.dateStr;
  const trading = await isTradingDay(today);
  if (!trading) {
    console.log('[canary] non-trading day — integrity checks skipped, all good.');
    process.exit(0);
  }
  const issues = [];

  // ── CHECK: pipeline ran today (morning session present) ─────────────────────
  let latestSessionRow = null;
  try {
    const rows = await sql`
      SELECT session_id, session_type, created_at
      FROM stocks.orchestrator_sessions
      WHERE created_at > now() - interval '40 hours'
      ORDER BY created_at DESC`;
    const today_rows = rows.filter(r => etDate(new Date(r.created_at)) === today);
    latestSessionRow = rows[0] || null;
    if (today_rows.length === 0) {
      const last = latestSessionRow
        ? `last session: ${latestSessionRow.session_id} (${etDate(new Date(latestSessionRow.created_at))})`
        : 'no recent sessions at all';
      issues.push(`No orchestrator session today — the morning run did not execute. ${last}.`);
    }
  } catch (e) { issues.push(`Could not read orchestrator_sessions: ${e.message}`); }

  // ── CHECK: latest specialist signals complete (10/10) + not deadlock-pinned ──
  try {
    const [sig] = await sql`
      SELECT session,
             count(*)::int AS n,
             max(effective_confidence::float) AS maxec,
             max(created_at) AS ts
      FROM stocks.specialist_signals
      WHERE session = (SELECT session FROM stocks.specialist_signals ORDER BY created_at DESC LIMIT 1)
      GROUP BY session`;
    if (!sig) {
      issues.push('No specialist_signals found at all — signal pipeline may be broken.');
    } else {
      const sigToday = etDate(new Date(sig.ts)) === today;
      if (sig.n < EXPECTED_NICHES && sigToday) {
        issues.push(`Latest session "${sig.session}" has only ${sig.n}/${EXPECTED_NICHES} specialist signals — specialist node(s) failed.`);
      }
      if (sig.maxec != null && sig.maxec <= COLD_START_CAP) {
        issues.push(`DEADLOCK FINGERPRINT: every specialist's effective_confidence is pinned ≤ ${COLD_START_CAP} (max=${sig.maxec}) in "${sig.session}". This is the exact 2026-06-03 cash-deadlock signature — a Load query is likely erroring and being swallowed by continueOnFail.`);
      }
    }
  } catch (e) { issues.push(`Could not read specialist_signals: ${e.message}`); }

  // ── CHECK: portfolio snapshot written today ─────────────────────────────────
  try {
    const [snap] = await sql`SELECT max(created_at) AS last_snap FROM stocks.portfolio_snapshots`;
    const lastSnapToday = snap?.last_snap && etDate(new Date(snap.last_snap)) === today;
    if (!lastSnapToday) {
      const when = snap?.last_snap ? etDate(new Date(snap.last_snap)) : 'never';
      issues.push(`No portfolio snapshot today (last: ${when}) — Process Post-Trade / Store Portfolio Snapshot may be failing.`);
    }
  } catch (e) { issues.push(`Could not read portfolio_snapshots: ${e.message}`); }

  // ── CHECK: watchlist not frozen (silent-write-failure class) ────────────────
  try {
    const [wl] = await sql`SELECT max(added_at) AS last_wl FROM stocks.watchlist`;
    if (wl?.last_wl) {
      const ageDays = (Date.now() - new Date(wl.last_wl).getTime()) / 86400000;
      if (ageDays > WATCHLIST_STALE_DAYS) {
        issues.push(`Watchlist frozen — newest entry is ${ageDays.toFixed(1)} days old (last write: ${etDate(new Date(wl.last_wl))}). Build Watchlist SQL may be silently failing (matches the 2026-06-08 direction-constraint bug class).`);
      }
    } else {
      issues.push('Watchlist is completely empty — write path may be broken.');
    }
  } catch (e) { issues.push(`Could not read watchlist: ${e.message}`); }

  // ── CHECK: DB open trades reconcile with live Alpaca positions ──────────────
  // A ticker OPEN in `trades` but absent from Alpaca = a phantom write: 08 blocked
  // the BUY/SHORT at execution (e.g. a 2nd short in a sector) but Process Post-Trade
  // still wrote it (Backlog #1; exercised live by the 06-18 SLB short). A ticker in
  // Alpaca with no OPEN `trades` row = an untracked live position. Either is a silent
  // DB↔broker desync: it can fire a false post-mortem, and via the
  // trades_one_open_per_ticker unique index it makes a future real trade on that
  // ticker silently fail to record. Runs after the close session has settled, so a
  // steady-state mismatch at this hour is a genuine desync, not intraday timing.
  try {
    const base = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets/v2';
    const r = await fetch(`${base}/positions`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
      },
    });
    const positions = await r.json();
    if (!Array.isArray(positions)) {
      issues.push(`Could not reconcile DB vs Alpaca — unexpected /positions response: ${JSON.stringify(positions).slice(0, 200)}`);
    } else {
      const alpacaTickers = new Set(positions.map(p => p.symbol));
      const openRows = await sql`SELECT ticker FROM stocks.trades WHERE status = 'OPEN'`;
      const dbTickers = new Set(openRows.map(row => row.ticker));
      const phantom   = [...dbTickers].filter(t => !alpacaTickers.has(t)); // in DB, not Alpaca
      const untracked = [...alpacaTickers].filter(t => !dbTickers.has(t)); // in Alpaca, not DB
      if (phantom.length || untracked.length) {
        const parts = [];
        if (phantom.length)   parts.push(`phantom OPEN trades row(s) NOT held in Alpaca: ${phantom.join(', ')} (likely an 08-blocked BUY/SHORT still written by Process Post-Trade — Backlog #1; clean the trades + position_metadata rows)`);
        if (untracked.length) parts.push(`live Alpaca position(s) with NO open trades row: ${untracked.join(', ')} (untracked position — Store Open Trade may have failed)`);
        issues.push(`DB↔Alpaca position desync (${dbTickers.size} DB OPEN vs ${alpacaTickers.size} live) — ${parts.join('; ')}.`);
      }

      // position_metadata must also track live holdings. A row here with no live Alpaca
      // position = stale entry metadata the close path failed to delete. It can fire a false
      // trailing-stop post-mortem (Watchdog Find TS Exits flags metadata gone from Alpaca)
      // and pollutes 02's open-position metrics. All closes now route through the Post-Mortem
      // sub-workflow's Delete Position Metadata step, so a steady-state mismatch here means
      // that cleanup failed. (Distinct from the trades check above — caught the 5 stale rows
      // AMAT/DDOG/FTNT/GD/LHX that the trades-only check missed on 2026-06-24.)
      const metaRows = await sql`SELECT ticker FROM stocks.position_metadata`;
      const metaTickers = new Set(metaRows.map(row => row.ticker));
      const staleMeta = [...metaTickers].filter(t => !alpacaTickers.has(t)); // in metadata, not Alpaca
      if (staleMeta.length) {
        issues.push(`Stale position_metadata (${metaTickers.size} rows vs ${alpacaTickers.size} live Alpaca) — row(s) with no live position: ${staleMeta.join(', ')} (close path did not delete metadata; risks false trailing-stop post-mortems — clean these rows).`);
      }

      // Every live position must carry a protective trailing stop. The trailing stop is
      // the fund's mechanical loss-protection layer (ATR×3, clamped 8–20%, GTC). On
      // 2026-06-22 a batch of 4 longs (C, CEG, HBM, VRT) opened with NO trailing stop:
      // Alpaca took up to 6.5 min to fill the simultaneous market orders while n8n's
      // `Wait For Fill` waits only 5s, so `Submit Trailing Stop` fired before the buy
      // filled and Alpaca rejected the (sell) stop. C and VRT then sat open and
      // unprotected (VRT round-tripped to −11% with no floor) — fully invisible to
      // monitoring. The position reconciliation above can't see this: the position IS
      // tracked, it just has no stop. Runs at 4:30 PM ET after the close has settled, so
      // a missing stop at this hour is a real coverage gap, not intraday entry timing.
      if (positions.length) {
        const ro = await fetch(`${base}/orders?status=open&limit=200`, {
          headers: {
            'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
            'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
          },
        });
        const orders = await ro.json();
        if (!Array.isArray(orders)) {
          issues.push(`Could not verify trailing-stop coverage — unexpected /orders response: ${JSON.stringify(orders).slice(0, 200)}`);
        } else {
          const stopSymbols = new Set(orders.filter(o => o.type === 'trailing_stop').map(o => o.symbol));
          const unprotected = positions.filter(p => !stopSymbols.has(p.symbol));
          if (unprotected.length) {
            const detail = unprotected
              .map(p => `${p.symbol} (${p.side}, ${(parseFloat(p.unrealized_plpc) * 100).toFixed(1)}%)`)
              .join(', ');
            issues.push(`Unprotected position(s) — live in Alpaca with NO trailing-stop order: ${detail}. The trailing stop likely failed to submit (Wait For Fill < fill latency on a slow batch fill; see 2026-06-22 C/VRT). Attach a trailing stop or close the position; consider lengthening Wait For Fill / a Watchdog stop-reconciliation (Backlog #12).`);
          }
        }
      }
    }
  } catch (e) { issues.push(`Could not reconcile DB open trades vs Alpaca positions: ${e.message}`); }

  // ── REPORT ──────────────────────────────────────────────────────────────────
  if (issues.length === 0) {
    console.log(`[canary] ✅ all green (${stamp}) — silent.`);
    process.exit(0);
  }
  console.log(`[canary] 🚨 ${issues.length} issue(s):`);
  issues.forEach(i => console.log('  - ' + i));
  const msg = `🚨 STOCKS CANARY — ${issues.length} ISSUE${issues.length === 1 ? '' : 'S'}\n${stamp}\n\n`
    + issues.map((i, n) => `${n + 1}. ${i}`).join('\n\n')
    + `\n\nThe fund may be silently broken. Investigate n8n + Neon.`;
  await sendTelegram(msg);
  process.exit(0);
})();

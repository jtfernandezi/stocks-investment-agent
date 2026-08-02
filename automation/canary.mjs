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

  // ── CHECK: bars feed freshness (limit-exhaustion truncation class) ──────────
  // Alpaca's multi-symbol bars endpoint applies `limit` as a TOTAL across all
  // symbols in the request, filling alphabetically. The live fetch nodes use a
  // FIXED start=2025-01-01, so the bars-per-symbol requirement grows every
  // trading day while the limit stays constant — once it is exhausted, the
  // alphabetically-last ticker(s) silently receive a truncated series ending
  // months in the past. Found 2026-07-19: limit=3600 was outgrown ~2026-06-06;
  // VST/XOM/WFC (last in their niches) were served July-2025 prices for a month,
  // corrupting trade sizing, entry records and P&L by ~30%. This check replays
  // the EXACT live requests (same symbols, same limit, same start) and alarms on
  // any symbol whose newest bar is older than BAR_STALE_DAYS. It will keep
  // alarming until the n8n fetch nodes' limits are raised (or start made rolling).
  // Updated 2026-07-24: live n8n nodes were bumped to limit=10000 on 2026-07-21
  // (operator fix for the 07-19 finding) and CYBR was dropped from the live
  // Cybersecurity node after CyberArk went inactive/non-tradable at the broker
  // (Palo Alto Networks acquisition). This mirror had drifted from both changes,
  // so the check was alarming on its own stale copy of the request, not on
  // production. Keep this list in sync with the live nodes going forward.
  try {
    const BAR_STALE_DAYS = 5; // calendar days — tolerates weekends + one holiday
    const BAR_GROUPS = [ // mirror of the live n8n fetch nodes (symbols + limit)
      { node: 'Cybersecurity', limit: 10000, symbols: 'CRWD,PANW,ZS,OKTA,FTNT,S,CHKP,QLYS,TENB' },
      { node: 'Defense',       limit: 10000, symbols: 'LMT,RTX,NOC,GD,HII,LHX,KTOS,RCAT,PLTR,AXON' },
      { node: 'Nuclear',       limit: 10000, symbols: 'CCJ,UEC,NXE,DNN,SMR,OKLO,CEG,VST,ETR,NEE' },
      { node: 'Copper',        limit: 10000, symbols: 'FCX,SCCO,TECK,HBM,VALE,MP,AA,ALB,SQM,LAC' },
      { node: 'AI Semis',      limit: 10000, symbols: 'ARM,AMAT,LRCX,KLAC,ON,TER,NXPI,MCHP,MPWR,SNPS' },
      { node: 'Cloud',         limit: 10000, symbols: 'ORCL,NOW,CRM,DDOG,SNOW,ADBE,NET,TEAM,WDAY,MDB' },
      { node: 'Oil Gas',       limit: 10000, symbols: 'XOM,CVX,COP,SLB,HAL,MPC,PSX,VLO,OXY,EOG' },
      { node: 'Data Centers',  limit: 10000, symbols: 'EQIX,DLR,AMT,IREN,CORZ,VRT,SMCI,DELL,HPE,WDC' },
      { node: 'Healthcare',    limit: 10000, symbols: 'UNH,ELV,CVS,LLY,MRK,PFE,ABBV,ISRG,MDT,TMO' },
      { node: 'Financials',    limit: 10000, symbols: 'JPM,BAC,WFC,C,GS,MS,SCHW,BLK,AXP,COF' },
      { node: 'SPY',           limit: 10000, symbols: 'SPY,HACK,ITA,URA,COPX,SOXX,SKYY,XLE,DTCR,XLV,XLF' },
    ];
    const dataHeaders = {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
    };
    const staleReports = [];
    for (const g of BAR_GROUPS) {
      const url = `https://data.alpaca.markets/v2/stocks/bars?symbols=${g.symbols}`
        + `&timeframe=1Day&start=2025-01-01&limit=${g.limit}`;
      const r = await fetch(url, { headers: dataHeaders });
      if (!r.ok) { staleReports.push(`${g.node}: fetch failed (HTTP ${r.status})`); continue; }
      const body = await r.json();
      const bars = body?.bars || {};
      for (const sym of g.symbols.split(',')) {
        const series = bars[sym];
        if (!Array.isArray(series) || series.length === 0) {
          staleReports.push(`${g.node}: ${sym} returned NO bars`);
          continue;
        }
        const lastT = new Date(series[series.length - 1].t).getTime();
        const ageDays = (Date.now() - lastT) / 86400000;
        if (ageDays > BAR_STALE_DAYS) {
          staleReports.push(`${g.node}: ${sym} newest bar is ${new Date(lastT).toISOString().slice(0, 10)} (${ageDays.toFixed(0)}d old, ${series.length} bars — limit=${g.limit} exhausted)`);
        }
      }
    }
    if (staleReports.length) {
      issues.push(`STALE PRICE BARS — the live bars fetch is serving out-of-date series (limit-exhaustion truncation; trades get sized/priced/recorded off old prices): ${staleReports.join('; ')}. Fix: raise the affected Fetch Bars node's limit (e.g. 10000) in n8n.`);
    }
  } catch (e) { issues.push(`Could not verify bars freshness: ${e.message}`); }

  // ── CHECK: trades rows reconcile with actual Alpaca fills ───────────────────
  // Two silent-corruption modes found 2026-07-19: (1) `trades` entry/exit prices
  // come from the bars-derived priceMap, so a stale series records a price far
  // from the real fill (VST recorded at $210.40 vs $152.13 filled → fake −29%
  // P&L fed to every feedback table); (2) a real executed round trip can be
  // entirely absent from `trades` (DELL 2026-07-08: buy+sell filled, no row —
  // invisible to the open-position reconciliation above because nothing stays
  // open). Both are only visible against the broker's fill history, so compare
  // the last 7 days of filled orders to `trades` directly.
  try {
    const base = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets/v2';
    const hdrs = {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
    };
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const r = await fetch(`${base}/orders?status=closed&after=${since}&limit=500&direction=desc`, { headers: hdrs });
    const orders = await r.json();
    if (!Array.isArray(orders)) {
      issues.push(`Could not reconcile trades vs fills — unexpected /orders response: ${JSON.stringify(orders).slice(0, 200)}`);
    } else {
      const PRICE_TOL = 0.05; // >5% recorded-vs-fill divergence = corruption, not overnight-gap noise
      const fills = orders.filter(o => o.filled_at && o.filled_avg_price);
      const fillsBySymDate = {};
      for (const o of fills) {
        const key = `${o.symbol}|${o.filled_at.slice(0, 10)}`;
        (fillsBySymDate[key] = fillsBySymDate[key] || []).push(parseFloat(o.filled_avg_price));
      }
      const tradeRows = await sql`
        SELECT ticker, status, entry_date, entry_price, exit_date, exit_price
        FROM stocks.trades
        WHERE entry_date >= now() - interval '8 days'
           OR exit_date  >= now() - interval '8 days'
           OR status = 'OPEN'`;
      const day = d => d ? new Date(d).toISOString().slice(0, 10) : null;
      const mismatches = [];
      for (const row of tradeRows) {
        for (const [dateField, priceField] of [['entry_date', 'entry_price'], ['exit_date', 'exit_price']]) {
          const d = day(row[dateField]);
          const recorded = row[priceField] != null ? parseFloat(row[priceField]) : null;
          if (!d || recorded == null) continue;
          const dayFills = fillsBySymDate[`${row.ticker}|${d}`];
          if (!dayFills || !dayFills.length) continue; // fills aged out of the 7d window — nothing to compare
          const closest = dayFills.reduce((a, b) => Math.abs(b - recorded) < Math.abs(a - recorded) ? b : a);
          if (Math.abs(closest - recorded) / closest > PRICE_TOL) {
            mismatches.push(`${row.ticker} ${dateField.replace('_date', '')} recorded $${recorded} vs filled $${closest} on ${d}`);
          }
        }
      }
      if (mismatches.length) {
        issues.push(`Trades↔fills PRICE MISMATCH (>${PRICE_TOL * 100}%) — recorded prices diverge from actual Alpaca fills (stale-bars pricing corrupts P&L + every feedback table): ${mismatches.join('; ')}. Correct the trades row(s) from the real fills.`);
      }
      // (2) every symbol with a fill must map to a trades row (entry/exit in
      // window, or still OPEN) — otherwise an executed trade never got recorded.
      const windowStart = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
      const coveredSymbols = new Set();
      for (const row of tradeRows) {
        const e = day(row.entry_date), x = day(row.exit_date);
        if (row.status === 'OPEN' || (e && e >= windowStart) || (x && x >= windowStart)) coveredSymbols.add(row.ticker);
      }
      const unrecorded = [...new Set(fills.map(o => o.symbol))].filter(s => !coveredSymbols.has(s));
      if (unrecorded.length) {
        issues.push(`Executed fill(s) with NO trades row: ${unrecorded.join(', ')} — a real trade ran at the broker but was never recorded (DELL 2026-07-08 class; Store Open Trade / post-mortem write failed). Reconstruct the row from Alpaca order history.`);
      }
    }
  } catch (e) { issues.push(`Could not reconcile trades vs Alpaca fills: ${e.message}`); }

  // ── CHECK: pattern-EV feedback loop is actually recording ───────────────────
  // `pattern_performance` is the fund's entry-quality feedback loop: the Post-Mortem
  // workflow's `Update Pattern Performance` node recomputes it from `trades` after
  // every close, and `06` renders it to the orchestrator as EV guidance. That node
  // carries continueOnFail:true, so ANY error in the recompute is swallowed — the
  // execution still reports success, the rest of the post-mortem chain completes
  // (trade flips CLOSED, accuracy updates, metadata is deleted), and every other
  // canary check stays green while the table quietly freezes.
  //
  // This has now broken twice in three weeks, each time differently:
  //   2026-07-19  CHECK constraint allowed only the legacy TREND/BIAS/... labels,
  //               so every Phase-1 (PULLBACK/MOMENTUM/...) close was rejected.
  //   2026-08-02  `pattern_type` is NOT NULL, and one hand-reconstructed trades row
  //               (DELL, inserted per the 2026-07-19 runbook) has entry_pattern NULL.
  //               The recompute is a single INSERT..SELECT..GROUP BY entry_pattern,
  //               so that one NULL group aborts the WHOLE statement — no pattern
  //               updates at all since 2026-07-21, across 6 real closes.
  //
  // Rather than encode either specific cause, compare the stored aggregate to what
  // the same source data says it should be. That stays correct as labels, rows and
  // constraints change, and catches any future variant of "the recompute silently
  // stopped running". Read-only; mirrors the live node's WHERE clause exactly.
  try {
    const expected = await sql`
      SELECT entry_pattern AS pattern_type, count(*)::int AS total
      FROM stocks.trades
      WHERE status = 'CLOSED'
        AND exit_reason IS DISTINCT FROM 'never_executed'
        AND exit_date >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY entry_pattern`;
    const stored = await sql`SELECT pattern_type, total_trades::int AS total FROM stocks.pattern_performance`;
    const storedMap = new Map(stored.map(r => [r.pattern_type, r.total]));

    const nullGroup = expected.find(r => r.pattern_type == null);
    const drift = [];
    for (const row of expected) {
      if (row.pattern_type == null) continue; // reported separately below
      const have = storedMap.get(row.pattern_type);
      if (have == null)          drift.push(`${row.pattern_type}: ${row.total} closed trade(s) but NO row in pattern_performance`);
      else if (have !== row.total) drift.push(`${row.pattern_type}: pattern_performance says ${have}, trades says ${row.total}`);
    }
    if (nullGroup) {
      drift.push(`${nullGroup.total} closed trade(s) have entry_pattern = NULL — because pattern_performance.pattern_type is NOT NULL, this NULL group makes the whole INSERT..SELECT recompute fail, so NO pattern row can update (2026-08-02 class). Backfill entry_pattern on those rows, or add "AND entry_pattern IS NOT NULL" to the Update Pattern Performance node's WHERE clause`);
    }
    if (drift.length) {
      issues.push(`PATTERN-EV FEEDBACK LOOP STALE — pattern_performance no longer matches closed trades, so the orchestrator is being fed outdated entry-quality EV: ${drift.join('; ')}. The Post-Mortem 'Update Pattern Performance' node has continueOnFail:true, so it is failing silently — check that node's SQL against the trades table.`);
    }
  } catch (e) { issues.push(`Could not verify pattern-EV feedback loop: ${e.message}`); }

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

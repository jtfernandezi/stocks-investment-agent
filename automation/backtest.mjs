// ─────────────────────────────────────────────────────────────────────────────
// Backtest harness v0 — entry-taxonomy + market-regime replay (NO LLM, NO DB)
//
// The keystone meta-infra item flagged in every audit since 2026-06-11: replay
// a proposed rule against historical daily bars BEFORE it steers live capital.
// v0 scope — validate the Phase 1 (PR #20) thresholds that shipped UNVERIFIED:
//   1. Entry-quality taxonomy (07): PULLBACK / BREAKOUT / MOMENTUM /
//      COUNTER_TREND / EXTENDED / CAPITULATION — forward returns per label.
//   2. Entry-extension gate (08): ±5% vs the 20d SMA — forward returns bucketed
//      by extension, so the cutoff itself is visible.
//   3. Computed market regime (02): BULL/NEUTRAL/BEAR from SPY vs 20d/50d SMA +
//      sector-ETF breadth — does the label predict forward SPY returns?
//
// READ-ONLY by construction: GETs daily bars from the Alpaca Data API and
// writes only a local cache file. Never touches the DB, n8n, or any order
// endpoint. Safe to run any time:
//   node automation/backtest.mjs               # use cached bars if present
//   node automation/backtest.mjs --refresh     # re-download bars
//   node automation/backtest.mjs --json        # machine-readable output
//
// The classifier / regime / SMA math REPLICATES the live code exactly
// (02_compute_derived_metrics.js + 07_parse_orchestrator_output.js):
//   sma20/sma50 include the current bar; ADV20 = prior 20 sessions excluding
//   the current bar; dirExt flips sign for shorts; regime thresholds 60/40.
//
// HONESTY CAVEATS (printed with results — read them before trusting a number):
//   • Samples overlap (every ticker × every day) → serially correlated, so n is
//     inflated; treat differences < ~1% as noise. This is signal analysis, not
//     a portfolio simulation (no sizing, stops, costs, or slippage).
//   • Universe is TODAY'S 100 tickers applied backward (mild survivorship /
//     selection bias — these names were picked because they're liquid now).
//   • One period (2025-01→present), mostly one macro cycle. Thresholds that
//     look good here are "consistent with the data", not proven.
//
// Env: ALPACA_API_KEY, ALPACA_SECRET_KEY (same names as canary.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, 'cache');
const CACHE_FILE = join(CACHE_DIR, 'bars_daily.json');
const START = process.argv.includes('--start')
  ? process.argv[process.argv.indexOf('--start') + 1]
  : '2025-01-01';
const REFRESH = process.argv.includes('--refresh');
const AS_JSON = process.argv.includes('--json');
const HORIZONS = [5, 10, 21];   // trading days ≈ 1wk / 2wk / 1mo (swing horizon)

// ── Universe: parse TICKER_NICHE from the live 08 file so this can never drift ─
function loadUniverse() {
  const src = readFileSync(join(HERE, '..', 'workflows', 'code', '08_prepare_trade_actions.js'), 'utf8');
  const m = src.match(/const TICKER_NICHE = \{([\s\S]*?)\};/);
  if (!m) throw new Error('could not parse TICKER_NICHE from 08_prepare_trade_actions.js');
  const tickers = [...m[1].matchAll(/([A-Z]+)\s*:/g)].map(x => x[1]);
  if (tickers.length < 90) throw new Error(`parsed only ${tickers.length} tickers — 08 format changed?`);
  return [...new Set(tickers)];
}
const SECTOR_ETFS = ['HACK', 'ITA', 'URA', 'COPX', 'SOXX', 'SKYY', 'XLE', 'DTCR', 'XLV', 'XLF'];
const STOCKS = loadUniverse();
const ALL_SYMBOLS = [...STOCKS, 'SPY', ...SECTOR_ETFS];

// ── Bars fetch (Alpaca Data API, GET only, paged, batched 10 symbols) ────────
async function fetchBars() {
  const key = process.env.ALPACA_API_KEY, sec = process.env.ALPACA_SECRET_KEY;
  if (!key || !sec) throw new Error('ALPACA_API_KEY / ALPACA_SECRET_KEY not set');
  const bars = {};
  for (let i = 0; i < ALL_SYMBOLS.length; i += 10) {
    const batch = ALL_SYMBOLS.slice(i, i + 10);
    let pageToken = null;
    do {
      const url = new URL('https://data.alpaca.markets/v2/stocks/bars');
      url.searchParams.set('symbols', batch.join(','));
      url.searchParams.set('timeframe', '1Day');
      url.searchParams.set('start', START);
      url.searchParams.set('limit', '10000');
      url.searchParams.set('adjustment', 'split');
      if (pageToken) url.searchParams.set('page_token', pageToken);
      const r = await fetch(url, { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': sec } });
      if (!r.ok) throw new Error(`bars fetch ${r.status}: ${await r.text()}`);
      const j = await r.json();
      for (const [sym, rows] of Object.entries(j.bars || {})) {
        (bars[sym] ||= []).push(...rows.map(b => ({ d: b.t.substring(0, 10), c: b.c, v: b.v })));
      }
      pageToken = j.next_page_token || null;
    } while (pageToken);
    process.stderr.write(`fetched ${Math.min(i + 10, ALL_SYMBOLS.length)}/${ALL_SYMBOLS.length} symbols\n`);
  }
  for (const sym of Object.keys(bars)) bars[sym].sort((a, b) => a.d < b.d ? -1 : 1);
  return bars;
}

// ── Indicator math — replicates 02_compute_derived_metrics.js exactly ────────
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
function indicatorsAt(rows, t) {
  if (t < 49) return null;                                   // need sma50
  const c = rows[t].c;
  const sma20 = mean(rows.slice(t - 19, t + 1).map(b => b.c));   // includes current bar (02: slice(-20))
  const sma50 = mean(rows.slice(t - 49, t + 1).map(b => b.c));
  const ext = (c - sma20) / sma20 * 100;
  const adv20 = t >= 20 ? mean(rows.slice(t - 20, t).map(b => b.v || 0)) : 0;  // prior 20, excl current (02: slice(-21,-1))
  const advRatio = adv20 > 0 ? (rows[t].v || 0) / adv20 : null;
  return { c, sma20, sma50, ext, advRatio };
}

// ── Entry-quality classifier — replicates entryQualityPattern() in 07 ────────
function classify(side, ind) {
  const isBuy = side === 'long';
  const dirExt = isBuy ? ind.ext : -ind.ext;
  const withTrend = isBuy ? ind.c >= ind.sma50 : ind.c <= ind.sma50;
  if (dirExt > 5) return 'EXTENDED';
  if (dirExt < -5) return 'CAPITULATION';
  if (dirExt <= 2) return withTrend ? 'PULLBACK' : 'COUNTER_TREND';
  return (ind.advRatio != null && ind.advRatio >= 1.5) ? 'BREAKOUT' : 'MOMENTUM';
}

// ── Market regime — replicates marketRegime in 02 (thresholds 60/40) ─────────
function buildRegimeByDate(bars) {
  const spy = bars.SPY || [];
  const etfIdx = {};
  for (const e of SECTOR_ETFS) {
    etfIdx[e] = new Map((bars[e] || []).map((b, i) => [b.d, i]));
  }
  const regime = new Map();
  for (let t = 49; t < spy.length; t++) {
    const ind = indicatorsAt(spy, t);
    const spyVs20 = ind.ext;
    const spyVs50 = (ind.c - ind.sma50) / ind.sma50 * 100;
    const withSma = [], above = [];
    for (const e of SECTOR_ETFS) {
      const i = etfIdx[e].get(spy[t].d);
      if (i == null || i < 19) continue;
      const rows = bars[e];
      const s20 = mean(rows.slice(i - 19, i + 1).map(b => b.c));
      withSma.push(e);
      if (rows[i].c >= s20) above.push(e);
    }
    const breadth = withSma.length > 0 ? above.length / withSma.length * 100 : null;
    let label = 'NEUTRAL';
    if (spyVs20 > 0 && spyVs50 > 0 && (breadth == null || breadth >= 60)) label = 'BULL';
    else if (spyVs20 < 0 && spyVs50 < 0 && (breadth == null || breadth <= 40)) label = 'BEAR';
    regime.set(spy[t].d, label);
  }
  return regime;
}

// ── Aggregation helpers ───────────────────────────────────────────────────────
function newAgg() { return { n: 0, fwd: Object.fromEntries(HORIZONS.map(h => [h, []])), alpha21: [] }; }
function stats(arr) {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  return {
    n: arr.length,
    avg: mean(arr),
    med: s[Math.floor(s.length / 2)],
    win: arr.filter(x => x > 0).length / arr.length * 100,
  };
}
const fmt = (x, d = 2) => x == null ? '     n/a' : (x >= 0 ? '+' : '') + x.toFixed(d).padStart(6);

// ── Main ─────────────────────────────────────────────────────────────────────
let bars;
if (!REFRESH && existsSync(CACHE_FILE)) {
  bars = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  process.stderr.write(`using cached bars (${Object.keys(bars).length} symbols) — pass --refresh to re-download\n`);
} else {
  bars = await fetchBars();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(bars));
}

const regimeByDate = buildRegimeByDate(bars);
const spyIdxByDate = new Map((bars.SPY || []).map((b, i) => [b.d, i]));
const spyRows = bars.SPY || [];
const maxH = Math.max(...HORIZONS);

// aggregates
const bySideLabel = {};                    // `${side}:${label}` → agg
const byLabelRegime = {};                  // long only: `${label}:${regime}` → fwd21[]
const byExtBucket = {};                    // long only: extension bucket → fwd21[]
const regimeSpy = {};                      // regime → SPY fwd21[] (dedup by date)
const EXT_BUCKETS = [[-Infinity, -10], [-10, -5], [-5, -2], [-2, 0], [0, 2], [2, 5], [5, 10], [10, Infinity]];
const extKey = e => {
  const [lo, hi] = EXT_BUCKETS.find(([lo, hi]) => e > lo && e <= hi) || [];
  return lo === -Infinity ? `≤${hi}%` : hi === Infinity ? `>${lo}%` : `${lo}..${hi}%`;
};

for (const sym of STOCKS) {
  const rows = bars[sym];
  if (!rows || rows.length < 50 + maxH) continue;
  for (let t = 49; t < rows.length - maxH; t++) {
    const ind = indicatorsAt(rows, t);
    if (!ind) continue;
    const date = rows[t].d;
    const reg = regimeByDate.get(date) || 'NEUTRAL';
    const spyT = spyIdxByDate.get(date);
    for (const side of ['long', 'short']) {
      const label = classify(side, ind);
      const key = `${side}:${label}`;
      const agg = (bySideLabel[key] ||= newAgg());
      agg.n++;
      for (const h of HORIZONS) {
        const raw = (rows[t + h].c / rows[t].c - 1) * 100;
        const fwd = side === 'long' ? raw : -raw;
        agg.fwd[h].push(fwd);
        if (h === 21) {
          if (side === 'long' && spyT != null && spyT + 21 < spyRows.length) {
            agg.alpha21.push(fwd - (spyRows[spyT + 21].c / spyRows[spyT].c - 1) * 100);
          }
          if (side === 'long') {
            (byLabelRegime[`${label}:${reg}`] ||= []).push(fwd);
            (byExtBucket[extKey(ind.ext)] ||= []).push(fwd);
          }
        }
      }
    }
  }
}
// regime → SPY forward (one sample per date, not per ticker)
for (const [date, reg] of regimeByDate) {
  const t = spyIdxByDate.get(date);
  if (t == null || t + 21 >= spyRows.length) continue;
  (regimeSpy[reg] ||= []).push((spyRows[t + 21].c / spyRows[t].c - 1) * 100);
}

// ── Output ───────────────────────────────────────────────────────────────────
const LABELS = ['PULLBACK', 'BREAKOUT', 'MOMENTUM', 'COUNTER_TREND', 'EXTENDED', 'CAPITULATION'];
if (AS_JSON) {
  const out = { generated_for_period: START, symbols: Object.keys(bars).length, bySideLabel: {}, byExtBucket: {}, byLabelRegime: {}, regimeSpy: {} };
  for (const [k, v] of Object.entries(bySideLabel)) {
    out.bySideLabel[k] = { n: v.n, fwd: Object.fromEntries(HORIZONS.map(h => [h, stats(v.fwd[h])])), alpha21: stats(v.alpha21) };
  }
  for (const [k, v] of Object.entries(byExtBucket)) out.byExtBucket[k] = stats(v);
  for (const [k, v] of Object.entries(byLabelRegime)) out.byLabelRegime[k] = stats(v);
  for (const [k, v] of Object.entries(regimeSpy)) out.regimeSpy[k] = stats(v);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

console.log(`\nBACKTEST HARNESS v0 — ${STOCKS.length} stocks, bars since ${START} (${spyRows.length} SPY sessions)`);
console.log('Replicates live 02/07 math. Overlapping samples — n is inflated; differences <1% ≈ noise.\n');

for (const side of ['long', 'short']) {
  console.log(`── ${side.toUpperCase()} entries — forward return by entry-quality label (07 taxonomy) ──`);
  console.log('  label          |      n | win%21d | avg 5d | avg 10d | avg 21d | med 21d | alpha21 vs SPY');
  for (const label of LABELS) {
    const agg = bySideLabel[`${side}:${label}`];
    if (!agg) continue;
    const s21 = stats(agg.fwd[21]), s5 = stats(agg.fwd[5]), s10 = stats(agg.fwd[10]), a = stats(agg.alpha21);
    console.log(`  ${label.padEnd(14)} | ${String(s21.n).padStart(6)} |  ${s21.win.toFixed(0).padStart(4)}%  | ${fmt(s5.avg)} | ${fmt(s10.avg)}  | ${fmt(s21.avg)}  | ${fmt(s21.med)}  | ${side === 'long' ? fmt(a.avg) : '   —'}`);
  }
  console.log('');
}

console.log('── LONG entries — forward 21d return by extension vs 20d SMA (08 gate = ±5%) ──');
console.log('  ext bucket |      n | win%  | avg 21d | med 21d');
for (const [lo, hi] of EXT_BUCKETS) {
  const k = lo === -Infinity ? `≤${hi}%` : hi === Infinity ? `>${lo}%` : `${lo}..${hi}%`;
  const s = stats(byExtBucket[k] || []);
  if (!s.n) continue;
  console.log(`  ${k.padEnd(10)} | ${String(s.n).padStart(6)} | ${s.win.toFixed(0).padStart(4)}% | ${fmt(s.avg)}  | ${fmt(s.med)}`);
}

console.log('\n── LONG PULLBACK vs EXTENDED by computed regime (02 classifier), fwd 21d ──');
for (const label of ['PULLBACK', 'EXTENDED']) {
  for (const reg of ['BULL', 'NEUTRAL', 'BEAR']) {
    const s = stats(byLabelRegime[`${label}:${reg}`] || []);
    if (!s.n) continue;
    console.log(`  ${label.padEnd(13)} in ${reg.padEnd(7)} | n=${String(s.n).padStart(6)} | win ${s.win.toFixed(0).padStart(3)}% | avg ${fmt(s.avg)} | med ${fmt(s.med)}`);
  }
}

console.log('\n── Regime label → SPY forward 21d return (one sample per session) ──');
for (const reg of ['BULL', 'NEUTRAL', 'BEAR']) {
  const s = stats(regimeSpy[reg] || []);
  if (!s.n) continue;
  console.log(`  ${reg.padEnd(7)} | n=${String(s.n).padStart(4)} sessions | win ${s.win.toFixed(0).padStart(3)}% | avg ${fmt(s.avg)} | med ${fmt(s.med)}`);
}
console.log('\nCaveats: overlapping windows, today\'s universe applied backward, no costs/stops/sizing, single period.');

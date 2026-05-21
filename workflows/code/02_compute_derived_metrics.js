// Node: Compute Derived Metrics
// Position: After Merge (node 17) — all data is now available
// Reads from named nodes via $("NodeName").all()
// Output: 1 item containing ALL context needed by specialists and orchestrator

// ── COLLECT RAW DATA ──────────────────────────────────────────────────────────

const session     = $("Set Session").first().json;
const accountRaw  = $("Fetch Alpaca Account").first().json;
const positions   = $("Fetch Alpaca Positions").all().map(i => i.json);
const openOrders  = $("Fetch Alpaca Open Orders").all().map(i => i.json);
const priceResp   = $("Fetch Price Bars").first().json;

const signalRows      = $("Load Signal History").all().map(i => i.json);
const accuracyRows    = $("Load Specialist Accuracy").all().map(i => i.json);
const patternRows     = $("Load Pattern Performance").all().map(i => i.json);
const lessonRows      = $("Load Trade Lessons").all().map(i => i.json);
const watchlistRows   = $("Load Watchlist").all().map(i => i.json);
const earningsRows    = $("Load Earnings Calendar").all().map(i => i.json);
const correlRows      = $("Load Correlation Matrix").all().map(i => i.json);
const snapshotRows    = $("Load Portfolio Snapshots").all().map(i => i.json);

// Fundamentals: morning = just stored, not-morning = from cache
let fundamentalsRows = [];
try {
  fundamentalsRows = $("Load Fundamentals Cache").all().map(i => i.json);
} catch (_) {
  // morning path — fundamentals were stored in a sub-loop, reference by node name if applicable
  // fallback: empty (specialists will note missing data)
}

// ── PRICE MAP ─────────────────────────────────────────────────────────────────
// Alpaca bars response: { bars: { TICKER: [{t, o, h, l, c, v}, ...] } }
const allBars = (priceResp && priceResp.bars) ? priceResp.bars : {};
const priceMap = {};

for (const [ticker, bars] of Object.entries(allBars)) {
  if (!Array.isArray(bars) || bars.length === 0) continue;
  const sorted = [...bars].sort((a, b) => new Date(a.t) - new Date(b.t));
  const current    = sorted[sorted.length - 1].c;
  const prev1d     = sorted.length >= 2  ? sorted[sorted.length - 2].c  : current;
  const prev5d     = sorted.length >= 6  ? sorted[sorted.length - 6].c  : current;
  const prev30d    = sorted.length >= 31 ? sorted[sorted.length - 31].c : current;

  // ATR-14: average of last 14 True Ranges
  let atr14 = 0;
  if (sorted.length >= 15) {
    let sumTR = 0;
    for (let i = sorted.length - 14; i < sorted.length; i++) {
      const h = sorted[i].h, l = sorted[i].l, pc = sorted[i - 1].c;
      sumTR += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    }
    atr14 = sumTR / 14;
  }

  // Trailing stop %: ATR×2.5 as % of current price, clamped 5–15%
  const trailPct = atr14 > 0
    ? Math.min(Math.max((atr14 * 2.5 / current) * 100, 5), 15)
    : 8;  // default 8% if ATR unavailable

  priceMap[ticker] = {
    current:        parseFloat(current.toFixed(2)),
    chg_1d_pct:     parseFloat(((current - prev1d)  / prev1d  * 100).toFixed(2)),
    chg_5d_pct:     parseFloat(((current - prev5d)  / prev5d  * 100).toFixed(2)),
    chg_30d_pct:    parseFloat(((current - prev30d) / prev30d * 100).toFixed(2)),
    atr14:          parseFloat(atr14.toFixed(4)),
    trail_pct:      parseFloat(trailPct.toFixed(2)),
    week_52_high:   parseFloat(Math.max(...sorted.map(b => b.h)).toFixed(2)),
    week_52_low:    parseFloat(Math.min(...sorted.map(b => b.l)).toFixed(2)),
  };
}

// ── FUNDAMENTALS MAP ─────────────────────────────────────────────────────────
const fundamentalsMap = {};
for (const row of fundamentalsRows) {
  if (row && row.ticker) fundamentalsMap[row.ticker] = row;
}

// ── EARNINGS AT-RISK ──────────────────────────────────────────────────────────
// Open positions whose underlying stock has earnings within 7 days
const today = new Date();
today.setHours(0, 0, 0, 0);

const earningsAtRisk = [];
for (const pos of positions) {
  const ticker = pos.symbol;
  const entry = earningsRows.find(e => e.ticker === ticker);
  if (!entry || !entry.earnings_date) continue;
  const earnDate = new Date(entry.earnings_date);
  const daysUntil = Math.round((earnDate - today) / 86400000);
  if (daysUntil >= 0 && daysUntil <= 7) {
    earningsAtRisk.push({
      ticker,
      earnings_date: entry.earnings_date,
      days_until: daysUntil,
      risk_level: daysUntil <= 2 ? 'HIGH' : 'MEDIUM',
    });
  }
}

// ── TRAILING STOP PROXIMITY ───────────────────────────────────────────────────
const stopProximity = [];
for (const pos of positions) {
  const ticker = pos.symbol;
  const currentPrice = parseFloat(pos.current_price);
  // Find the GTC trailing stop order for this position
  const stopOrder = openOrders.find(o =>
    o.symbol === ticker &&
    o.type === 'trailing_stop' &&
    ['accepted', 'pending_new', 'new'].includes(o.status)
  );
  if (stopOrder && stopOrder.stop_price) {
    const stopPrice  = parseFloat(stopOrder.stop_price);
    const distPct    = Math.abs((currentPrice - stopPrice) / currentPrice * 100);
    stopProximity.push({
      ticker,
      current_price: currentPrice,
      stop_price:    parseFloat(stopPrice.toFixed(2)),
      distance_pct:  parseFloat(distPct.toFixed(2)),
      risk:          distPct < 3 ? 'CRITICAL' : distPct < 6 ? 'WARNING' : 'OK',
    });
  }
}

// ── CORRELATION FLAGS ─────────────────────────────────────────────────────────
// Build map: ticker → [{ open_position, correlation }] for any correlation > 0.70
const corrMap = {};
for (const row of correlRows) {
  if (Math.abs(row.correlation) > 0.70) {
    if (!corrMap[row.ticker_a]) corrMap[row.ticker_a] = [];
    if (!corrMap[row.ticker_b]) corrMap[row.ticker_b] = [];
    corrMap[row.ticker_a].push({ open_position: row.ticker_b, correlation: row.correlation });
    corrMap[row.ticker_b].push({ open_position: row.ticker_a, correlation: row.correlation });
  }
}

const openTickers = new Set(positions.map(p => p.symbol));
// correlationFlags[candidateTicker] = [{open_position, correlation}]
const correlationFlags = {};
for (const [ticker, corrs] of Object.entries(corrMap)) {
  const overlaps = corrs.filter(c => openTickers.has(c.open_position));
  if (overlaps.length > 0) correlationFlags[ticker] = overlaps;
}

// ── SIGNAL HISTORY BY NICHE ───────────────────────────────────────────────────
const NICHES = [
  'cybersecurity', 'defense', 'nuclear_uranium', 'copper_minerals',
  'ai_semiconductors', 'cloud_hyperscalers', 'oil_gas', 'data_centers'
];

const signalsByNiche = {};
for (const niche of NICHES) {
  const nicheRows = signalRows
    .filter(r => r.niche === niche)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))  // oldest first
    .slice(-5);  // last 5

  if (nicheRows.length === 0) {
    signalsByNiche[niche] = { signals: [], pattern: 'FIRST_SIGNAL', formatted: 'No history' };
    continue;
  }

  const dirs = nicheRows.map(r => r.direction);
  const bullCount = dirs.filter(d => d === 'BULLISH').length;
  const bearCount = dirs.filter(d => d === 'BEARISH').length;

  let pattern = 'NOISE';

  // REVERSAL: last 3 all same direction, opposite to direction of prior sessions
  if (dirs.length >= 4) {
    const last3  = dirs.slice(-3);
    const prior  = dirs.slice(0, -3);
    const l3Bull = last3.every(d => d === 'BULLISH');
    const l3Bear = last3.every(d => d === 'BEARISH');
    const priorMajBull = prior.filter(d => d === 'BULLISH').length >= Math.ceil(prior.length * 0.6);
    const priorMajBear = prior.filter(d => d === 'BEARISH').length >= Math.ceil(prior.length * 0.6);
    if ((l3Bull && priorMajBear) || (l3Bear && priorMajBull)) pattern = 'REVERSAL';
  }

  if (pattern !== 'REVERSAL') {
    if (bullCount >= 4 || bearCount >= 4)   pattern = 'TREND';
    else if (bullCount >= 3 || bearCount >= 3) pattern = 'BIAS';
    else                                        pattern = 'NOISE';
  }

  const formatted = nicheRows.map(r => {
    const c = r.conviction === 'HIGH' ? 'H' : r.conviction === 'MEDIUM' ? 'M' : 'L';
    return `${r.direction}(${r.confidence}/${c})`;
  }).join(' → ');

  signalsByNiche[niche] = { signals: nicheRows, pattern, formatted };
}

// ── SECTOR ROTATION SUMMARY ───────────────────────────────────────────────────
const rotationSummary = NICHES.map(niche => {
  const h = signalsByNiche[niche];
  if (!h.signals.length) return { niche, momentum: 'UNKNOWN', pattern: 'FIRST_SIGNAL' };
  const dirs = h.signals.map(s => s.direction);
  const recent = dirs.slice(-2);
  const prior  = dirs.slice(0, -2);
  const recentBullRate = recent.filter(d => d === 'BULLISH').length / recent.length;
  const priorBullRate  = prior.length > 0 ? prior.filter(d => d === 'BULLISH').length / prior.length : 0.5;
  const delta = recentBullRate - priorBullRate;
  const momentum = delta > 0.2 ? 'GAINING' : delta < -0.2 ? 'LOSING' : 'STABLE';
  return { niche, momentum, pattern: h.pattern, current_direction: dirs[dirs.length - 1] };
});

// ── PORTFOLIO P&L VS SPY ──────────────────────────────────────────────────────
const spyBars = allBars['SPY'] || [];
const spyCurrent = spyBars.length > 0 ? spyBars[spyBars.length - 1].c : null;

// Use first snapshot as baseline (start of experiment)
const sortedSnaps = [...snapshotRows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
const firstSnap = sortedSnaps[0];
const portfolioValue = parseFloat(accountRaw.portfolio_value);
const portfolioCumulativePct = firstSnap
  ? parseFloat(((portfolioValue - firstSnap.portfolio_value_usd) / firstSnap.portfolio_value_usd * 100).toFixed(2))
  : 0;
const spyStartPrice = firstSnap ? firstSnap.spy_price : spyCurrent;
const spyCumulativePct = (spyStartPrice && spyCurrent)
  ? parseFloat(((spyCurrent - spyStartPrice) / spyStartPrice * 100).toFixed(2))
  : 0;

const last7Snapshots = [...snapshotRows]
  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  .slice(0, 7)
  .reverse()
  .map(s => ({
    session: s.session,
    portfolio_value: s.portfolio_value_usd,
    spy_price: s.spy_price,
  }));

// ── SPECIALIST EFFECTIVE CONFIDENCE ──────────────────────────────────────────
const specialistEffectiveConf = {};
for (const row of accuracyRows) {
  const scaling = (row.hit_rate && row.avg_reported_confidence && row.avg_reported_confidence > 0)
    ? row.hit_rate / row.avg_reported_confidence
    : 1.0;
  specialistEffectiveConf[row.niche] = {
    scaling_factor:          parseFloat(scaling.toFixed(3)),
    hit_rate:                row.hit_rate,
    avg_reported_confidence: row.avg_reported_confidence,
    total_signals:           row.total_signals || 0,
    best_pattern:            row.best_pattern || null,
    worst_pattern:           row.worst_pattern || null,
  };
}

// ── PATTERN PERFORMANCE MAP ───────────────────────────────────────────────────
const patternPerfMap = {};
for (const row of patternRows) {
  const key = row.niche === 'ALL' ? row.pattern_type : `${row.pattern_type}_${row.niche}`;
  patternPerfMap[key] = {
    win_rate:       row.win_rate,
    avg_win_pct:    row.avg_win_pct,
    avg_loss_pct:   row.avg_loss_pct,
    expected_value: row.expected_value,
    total_trades:   row.total_trades,
  };
}

// ── OUTPUT ────────────────────────────────────────────────────────────────────
return [{
  json: {
    // Session
    session_type:      session.session_type,
    session_id:        session.session_id,
    session_date:      session.session_date,
    utc_timestamp:     session.utc_timestamp,

    // Portfolio state
    account: {
      portfolio_value:    parseFloat(accountRaw.portfolio_value),
      cash:               parseFloat(accountRaw.cash),
      buying_power:       parseFloat(accountRaw.buying_power),
      long_market_value:  parseFloat(accountRaw.long_market_value),
      short_market_value: parseFloat(accountRaw.short_market_value),
      equity:             parseFloat(accountRaw.equity),
      unrealized_pl:      parseFloat(accountRaw.unrealized_pl || 0),
    },
    positions,
    openOrders,

    // Price & fundamentals
    priceMap,
    fundamentalsMap,

    // Risk flags
    earningsAtRisk,
    stopProximity,
    correlationFlags,

    // Signals & rotation
    signalsByNiche,
    rotationSummary,

    // P&L
    portfolioValue,
    portfolioCumulativePct,
    spyCumulativePct,
    spyCurrent,
    last7Snapshots,

    // Feedback system
    specialistEffectiveConf,
    patternPerfMap,
    recentTradeLessons: lessonRows.slice(0, 5),
    watchlist: watchlistRows,
    earningsRows,
  }
}];

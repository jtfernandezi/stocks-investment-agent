// Node: Build Orchestrator Input
// Position: After Parse & Save All Signals (receives 10 specialist items)
// Assembles the full orchestrator prompt from all available context
// Output: 1 item with system_prompt + user_prompt for OpenAI GPT-5.1

const ctx              = $("Compute Derived Metrics").first().json;
const specialistsRaw   = $("Parse & Save All Signals").all().map(i => i.json);

let pickNewsItems = [];
try {
  const newsResp = $("Fetch Specialist Pick News").first().json;
  pickNewsItems = newsResp.news || [];
} catch(_) {}

// Apply cold-start confidence cap before orchestrator sees the signals.
// Specialists with < 10 sessions on record have no reliable calibration history.
// Cap prevents uncalibrated confidence from triggering max-size trades.
const specialists = specialistsRaw.map(s => {
  const accData      = (ctx.specialistEffectiveConf || {})[s.niche] || {};
  // Warm-up is measured by signal-history DEPTH (how many signals this specialist
  // has actually issued), NOT by closed-trade attribution. The old code read
  // specialist_accuracy.total_signals, which only grows after trades close — but
  // trades cannot open while capped below the 0.75 floor. That was a deadlock:
  // the fund could not trade because it had not traded. Signal depth bootstraps out.
  const signalDepth    = (ctx.signalCountByNiche || {})[s.niche] || 0;
  const calibSamples   = accData.total_signals || 0;   // closed-trade calibration sample
  const hasCalibration = calibSamples >= 5;

  // Cold-start cap by signal depth:
  //   < 3 signals  → 0.72  (truly new — below the 0.75 trading floor; no trade)
  //   3–9 signals  → 0.80  (warming — tradeable at min/mid size; no $8k/$6k tier)
  //   ≥10 signals, not yet calibrated → 0.84 (up to mid size; full size unlocks
  //                                            once closed trades calibrate scaling)
  //   ≥10 signals, calibrated → no cap (scaling_factor already applied upstream)
  let coldStartCap = null;
  if      (signalDepth < 3)  coldStartCap = 0.72;
  else if (signalDepth < 10) coldStartCap = 0.80;
  else if (!hasCalibration)  coldStartCap = 0.84;

  const sessionsInDir = computeSessionsInDirection(s.direction, (ctx.signalsByNiche || {})[s.niche]);
  const inColdStart   = coldStartCap !== null;

  if (inColdStart && (s.effective_confidence || 0) > coldStartCap) {
    return { ...s, effective_confidence: coldStartCap, cold_start: true, cold_start_signals: signalDepth, cold_start_cap: coldStartCap, sessions_in_direction: sessionsInDir };
  }
  return { ...s, cold_start: inColdStart, cold_start_signals: signalDepth, sessions_in_direction: sessionsInDir };
});

// ── HELPER: Format positions ──────────────────────────────────────────────────
function formatPositions(positions, stopProximity, earningsAtRisk, priceMap, profitDecay) {
  if (!positions || positions.length === 0) return 'No open positions.';
  return positions.map(pos => {
    const ticker      = pos.symbol;
    const qty         = parseFloat(pos.qty);
    const side        = qty > 0 ? 'LONG' : 'SHORT';
    const entryPrice  = parseFloat(pos.avg_entry_price);
    const currentPrice= parseFloat(pos.current_price);
    const unrealPnl   = parseFloat(pos.unrealized_pl);
    const unrealPct   = parseFloat(pos.unrealized_plpc) * 100;
    const mktValue    = parseFloat(pos.market_value);
    const daysHeld    = pos.days_held || '?';  // custom field if tracked, else omit

    const stop        = stopProximity.find(s => s.ticker === ticker);
    const stopStr     = stop
      ? `| Stop: $${stop.stop_price} (${stop.distance_pct}% away — ${stop.risk})`
      : '| Stop: N/A';

    const earn = earningsAtRisk.find(e => e.ticker === ticker);
    const earnStr = earn
      ? `| ⚠️ EARNINGS IN ${earn.days_until}d (${earn.risk_level})`
      : '';

    const niche  = pos.entry_niche  || 'unknown';
    const thesis = pos.entry_thesis || 'thesis not recorded';

    const decay = (profitDecay || {})[ticker];
    const decayStr = decay
      ? `\n    Peak gain: +${decay.peak_unrealized_pct.toFixed(2)}% | Given back: ${decay.decay_from_peak_pct.toFixed(2)}pp (${decay.pct_of_peak_given_back.toFixed(0)}% of peak)${decay.pct_of_peak_given_back >= 50 ? ' ← SIGNIFICANT GIVE-BACK' : ''}`
      : '';

    return [
      `  ${ticker} (${side}, ${niche}) — Entry: $${entryPrice} | Current: $${currentPrice} | Days: ${daysHeld} | MktVal: $${Math.abs(mktValue).toFixed(0)} | P&L: ${unrealPct.toFixed(2)}% ($${unrealPnl.toFixed(0)}) ${stopStr} ${earnStr}${decayStr}`,
      `    Entry thesis: ${thesis}`,
    ].join('\n');
  }).join('\n\n');
}

// ── HELPER: Consecutive sessions in current direction ────────────────────────
// Counts how many consecutive sessions (including today) the specialist has held
// the current direction, using the prior-session history already in ctx.
function computeSessionsInDirection(currentDirection, signalHistory) {
  if (!signalHistory || !signalHistory.formatted) return 1;
  const dirRegex  = /(BULLISH|BEARISH|NEUTRAL)/g;
  const priorDirs = [...signalHistory.formatted.matchAll(dirRegex)].map(m => m[1]);
  // priorDirs is oldest→newest; walk backward from most recent
  let streak = 1;
  for (let i = priorDirs.length - 1; i >= 0; i--) {
    if (priorDirs[i] === currentDirection) streak++;
    else break;
  }
  return streak;
}

// ── HELPER: Format signal history ─────────────────────────────────────────────
function formatSignalHistory(signalsByNiche) {
  return Object.entries(signalsByNiche).map(([niche, data]) => {
    const label = niche.padEnd(20);
    return `  ${label}: ${data.formatted || 'No history'} [Pattern: ${data.pattern}]`;
  }).join('\n');
}

// ── HELPER: Format specialist signals ────────────────────────────────────────
function formatSpecialistSignals(specialists) {
  return specialists.map(s => {
    const longPicks  = (s.long_picks  || []).map(p => `    LONG  ${p.ticker}: ${p.thesis} | Risk: ${p.key_risk} | Earnings: ${p.earnings_risk}`).join('\n');
    const shortPicks = (s.short_picks || []).map(p => `    SHORT ${p.ticker}: ${p.thesis} | Risk: ${p.key_risk} | Earnings: ${p.earnings_risk}`).join('\n');
    const coldFlag   = s.cold_start ? ` ← COLD-START (${s.cold_start_signals} signals, capped at ${s.cold_start_cap})` : '';
    const convFlag   = !s.cold_start && s.effective_confidence < 0.75 ? ' ← BELOW TRADING THRESHOLD' : '';
    const sidStr     = s.sessions_in_direction === 1 ? `1 (first session — tentative)` : `${s.sessions_in_direction} (confirmed)`;
    return [
      `### ${s.niche.toUpperCase()} | ${s.direction} | ${s.effective_conviction} | effective_conf: ${s.effective_confidence} (raw: ${s.confidence}, scaling: ${s.scaling_factor}x) | sessions_in_direction: ${sidStr}${coldFlag}${convFlag}`,
      `  Macro: ${s.macro_assessment}`,
      longPicks  ? `  Long picks:\n${longPicks}`   : '  No long picks.',
      shortPicks ? `  Short picks:\n${shortPicks}` : '  No short picks.',
      `  Summary: ${s.summary}`,
    ].join('\n');
  }).join('\n\n');
}

// ── HELPER: Format pattern performance ───────────────────────────────────────
function formatPatternPerf(patternPerfMap) {
  const patterns = ['TREND', 'BIAS', 'NOISE', 'REVERSAL', 'FIRST_SIGNAL'];
  return patterns.map(p => {
    const data = patternPerfMap[p] || {};
    if (!data.total_trades) return `  ${p.padEnd(14)}: No data yet`;
    // Postgres NUMERIC columns arrive as strings — parse before arithmetic/toFixed
    const ev_num  = data.expected_value != null ? parseFloat(data.expected_value) : null;
    const wr_num  = data.win_rate        != null ? parseFloat(data.win_rate)        : null;
    const win_num = data.avg_win_pct     != null ? parseFloat(data.avg_win_pct)     : null;
    const los_num = data.avg_loss_pct    != null ? parseFloat(data.avg_loss_pct)    : null;
    const ev   = ev_num  != null ? ev_num.toFixed(2)  + '%' : 'N/A';
    const trades = Number(data.total_trades) || 0;
    // Minimum-sample floor: EV from <5 closed trades is statistical noise — the prompt's
    // own §7b rules (apply EV "ONLY to patterns with ≥5 closed trades ... Never block a
    // trade on a negative EV derived from fewer than 5 trades") already say to ignore it.
    // The "DO NOT TRADE" / "LOW EV" flags were rendered with NO sample gate, so a 2-trade
    // TREND row (EV -3.49%) got flagged "DO NOT TRADE" and the orchestrator froze the book
    // into cash through a +3pp SPY rally (2026-06-17 audit). Honor the documented floor:
    // below 5 trades, surface the data but flag it as unreliable instead of actionable.
    let flag = '';
    if (trades >= 5) {
      if (ev_num != null && ev_num < 0)                            flag = ' ← NEGATIVE EV — DO NOT TRADE';
      else if (ev_num != null && ev_num < 1.0 && ev_num >= 0)      flag = ' ← LOW EV — apply noise penalty';
    } else if (ev_num != null) {
      flag = ' ← insufficient sample (n<5) — EV unreliable, ignore per §7b';
    }
    return `  ${p.padEnd(14)}: win ${wr_num  != null ? (wr_num * 100).toFixed(0) + '%' : 'N/A'} | avg_win ${win_num != null ? win_num.toFixed(1) + '%' : 'N/A'} | avg_loss ${los_num != null ? los_num.toFixed(1) + '%' : 'N/A'} | EV ${ev} (${trades} trades)${flag}`;
  }).join('\n');
}

// ── HELPER: Format trade lessons ─────────────────────────────────────────────
function formatTradeLessons(lessons) {
  if (!lessons || lessons.length === 0) return '  No lessons yet.';
  return lessons.map(l => {
    const date   = l.generated_at ? l.generated_at.substring(0, 10) : '?';
    const dir    = (l.direction || '').toUpperCase();
    const pnlPct = l.pnl_pct != null ? `${l.pnl_pct > 0 ? '+' : ''}${parseFloat(l.pnl_pct).toFixed(2)}%` : '?%';
    const pnlUsd = l.pnl_usd != null ? `$${Math.abs(parseFloat(l.pnl_usd)).toFixed(0)}` : '';
    const size   = l.size_usd != null ? ` | $${Math.round(parseFloat(l.size_usd)).toLocaleString()} size` : '';
    const days   = l.hold_days != null ? `${l.hold_days}d` : '?d';
    const exitR  = l.exit_reason || 'unknown';
    const ep     = l.entry_price != null ? `$${parseFloat(l.entry_price).toFixed(2)}` : '?';
    const xp     = l.exit_price  != null ? `$${parseFloat(l.exit_price).toFixed(2)}`  : '?';
    const etf    = l.etf_return  != null ? `${l.etf_return > 0 ? '+' : ''}${parseFloat(l.etf_return).toFixed(2)}%` : null;
    const alpha  = (l.pnl_pct != null && l.etf_return != null)
      ? `${(parseFloat(l.pnl_pct) - parseFloat(l.etf_return)) >= 0 ? '+' : ''}${(parseFloat(l.pnl_pct) - parseFloat(l.etf_return)).toFixed(2)}%`
      : null;
    const confStr = (l.entry_specialist_confidence != null && l.entry_effective_confidence != null)
      ? `${parseFloat(l.entry_specialist_confidence).toFixed(2)} reported / ${parseFloat(l.entry_effective_confidence).toFixed(2)} effective`
      : null;
    const thesis = l.entry_thesis
      ? `"${l.entry_thesis.substring(0, 140)}${l.entry_thesis.length > 140 ? '...' : ''}"`
      : 'not recorded';

    const lines = [
      `  [${date}] ${dir} ${l.ticker} (${l.niche}) — ${l.outcome} | ${pnlPct} (${pnlUsd})${size} | Held: ${days} | Exit: ${exitR}`,
      `    Entry: ${ep} → Exit: ${xp}${etf ? ` | ETF during hold: ${etf}` : ''}${alpha ? ` | Alpha: ${alpha}` : ''}`,
    ];
    if (confStr) lines.push(`    Conf at entry: ${confStr}`);
    lines.push(`    Thesis: ${thesis}`);
    lines.push(`    Attribution: sector=${l.sector_accuracy || '?'} | entry=${l.entry_timing || '?'} | exit=${l.exit_timing || '?'}`);
    lines.push(`    Lesson: "${l.key_lesson || 'none'}"`);
    return lines.join('\n');
  }).join('\n\n');
}

// ── HELPER: Aggregate trade statistics ───────────────────────────────────────
function formatTradeStats(lessons) {
  if (!lessons || lessons.length === 0) return '  No closed trades yet.';
  const total   = lessons.length;
  const wins    = lessons.filter(l => l.outcome === 'WIN').length;
  const winPct  = Math.round(wins / total * 100);
  const pnls    = lessons.filter(l => l.pnl_pct != null).map(l => parseFloat(l.pnl_pct));
  const avgPnl  = pnls.length > 0 ? (pnls.reduce((a, b) => a + b, 0) / pnls.length) : null;
  const holds   = lessons.filter(l => l.hold_days != null).map(l => l.hold_days);
  const avgHold = holds.length > 0 ? Math.round(holds.reduce((a, b) => a + b, 0) / holds.length) : null;

  const nicheMap = {};
  for (const l of lessons) {
    if (!l.niche) continue;
    if (!nicheMap[l.niche]) nicheMap[l.niche] = { wins: 0, total: 0 };
    nicheMap[l.niche].total++;
    if (l.outcome === 'WIN') nicheMap[l.niche].wins++;
  }
  const nicheStr = Object.entries(nicheMap)
    .map(([n, v]) => `${n}: ${v.wins}/${v.total} (${Math.round(v.wins / v.total * 100)}%)`)
    .join(' | ');

  const patMap = {};
  for (const l of lessons) {
    const p = l.entry_pattern || 'UNKNOWN';
    if (!patMap[p]) patMap[p] = { wins: 0, total: 0 };
    patMap[p].total++;
    if (l.outcome === 'WIN') patMap[p].wins++;
  }
  const patStr = Object.entries(patMap)
    .map(([p, v]) => `${p}: ${v.wins}/${v.total} (${Math.round(v.wins / v.total * 100)}%)`)
    .join(' | ');

  const alphas = lessons
    .filter(l => l.pnl_pct != null && l.etf_return != null)
    .map(l => parseFloat(l.pnl_pct) - parseFloat(l.etf_return));
  const avgAlpha = alphas.length > 0 ? (alphas.reduce((a, b) => a + b, 0) / alphas.length) : null;

  const lines = [
    `  Overall (last ${total}): ${wins}/${total} wins (${winPct}%)${avgPnl != null ? ` | avg P&L: ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(2)}%` : ''}${avgHold != null ? ` | avg hold: ${avgHold}d` : ''}`,
  ];
  if (nicheStr) lines.push(`  By niche:   ${nicheStr}`);
  if (patStr)   lines.push(`  By pattern: ${patStr}`);
  if (avgAlpha != null) lines.push(`  Avg alpha vs sector ETF: ${avgAlpha >= 0 ? '+' : ''}${avgAlpha.toFixed(2)}% per trade`);
  return lines.join('\n');
}

// ── HELPER: Format watchlist ──────────────────────────────────────────────────
function formatWatchlist(watchlist) {
  if (!watchlist || watchlist.length === 0) return '  Watchlist is empty.';
  return watchlist.map(w =>
    `  ${w.ticker} (${w.niche} / ${w.direction}): ${w.reason} | Added: ${w.added_at ? w.added_at.substring(0, 10) : '?'}`
  ).join('\n');
}

// ── HELPER: Format fundamentals ───────────────────────────────────────────────
function formatFundamentals(tickers, fundamentalsMap) {
  if (!tickers || tickers.length === 0) return '  No tickers to display.';
  const lines = [];
  for (const ticker of tickers) {
    const f = fundamentalsMap[ticker];
    if (!f) {
      lines.push(`  ${ticker}: No data`);
      continue;
    }
    const pe   = f.pe_ratio     != null ? `P/E ${parseFloat(f.pe_ratio).toFixed(1)}`                    : 'P/E N/A';
    const gm   = f.gross_margin != null ? `Gross ${parseFloat(f.gross_margin).toFixed(1)}%`             : null;
    const nm   = f.net_margin   != null ? `Net ${parseFloat(f.net_margin).toFixed(1)}%`                 : null;
    const beta = f.beta         != null ? `β${parseFloat(f.beta).toFixed(2)}`                           : null;
    const eps  = f.last_eps_surprise_pct != null
      ? `EPS surp ${parseFloat(f.last_eps_surprise_pct) >= 0 ? '+' : ''}${parseFloat(f.last_eps_surprise_pct).toFixed(1)}%`
      : null;
    let consStr = null;
    const b = f.analyst_buy, h = f.analyst_hold, s = f.analyst_sell;
    if (b != null || h != null || s != null) {
      const total  = (b || 0) + (h || 0) + (s || 0);
      const buyPct = total > 0 ? Math.round((b || 0) / total * 100) : null;
      consStr = `Consensus ${b || 0}B/${h || 0}H/${s || 0}S${buyPct != null ? ` (${buyPct}% buy)` : ''}`;
    }
    const parts = [pe, gm, nm, consStr, beta, eps].filter(Boolean);
    lines.push(`  ${ticker}: ${parts.join(' | ')}`);
  }
  return lines.join('\n');
}

// ── HELPER: Format technicals ─────────────────────────────────────────────────
function formatTechnicals(tickers, priceMap) {
  if (!tickers || tickers.length === 0) return '  No tickers to display.';
  return tickers.map(ticker => {
    const p = priceMap[ticker];
    if (!p) return `  ${ticker}: No price data`;

    const rsiLabel = p.rsi14 == null ? 'N/A'
      : p.rsi14 > 70 ? `${p.rsi14} (overbought)`
      : p.rsi14 < 30 ? `${p.rsi14} (oversold)`
      : `${p.rsi14} (neutral)`;

    const sma50Str = p.sma50 != null
      ? `${p.current >= p.sma50 ? '+' : ''}${((p.current - p.sma50) / p.sma50 * 100).toFixed(1)}% ${p.current >= p.sma50 ? 'above' : 'below'}`
      : 'N/A (<50 bars)';

    const sma200Str = p.sma200 != null
      ? `${p.current >= p.sma200 ? '+' : ''}${((p.current - p.sma200) / p.sma200 * 100).toFixed(1)}% ${p.current >= p.sma200 ? 'above' : 'below'}`
      : 'N/A (<200 bars)';

    const pct52wStr = p.pct_52w != null ? `${p.pct_52w}th pct` : 'N/A';

    return `  ${ticker}: RSI ${rsiLabel} | 50d MA ${sma50Str} | 200d MA ${sma200Str} | 52w: ${pct52wStr}`;
  }).join('\n');
}

// ── HELPER: Format pick news ──────────────────────────────────────────────────
function formatPickNews(newsItems) {
  if (!newsItems || newsItems.length === 0) return '  No recent news available.';
  const byTicker = {};
  for (const article of newsItems) {
    for (const sym of (article.symbols || [])) {
      if (!byTicker[sym]) byTicker[sym] = [];
      byTicker[sym].push(article);
    }
  }
  if (Object.keys(byTicker).length === 0) return '  No recent news available.';
  return Object.entries(byTicker)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ticker, articles]) => {
      const items = articles.slice(0, 3).map(a => {
        const date    = (a.created_at || '').substring(0, 10);
        const summary = a.summary
          ? ` — ${a.summary.substring(0, 150)}${a.summary.length > 150 ? '...' : ''}`
          : '';
        return `    [${date}] ${a.headline}${summary}`;
      }).join('\n');
      return `  ${ticker}:\n${items}`;
    }).join('\n\n');
}

// ── HELPER: Format rotation summary ──────────────────────────────────────────
function formatRotation(rotationSummary) {
  return rotationSummary.map(r =>
    `  ${r.niche.padEnd(20)}: ${r.momentum.padEnd(8)} | Pattern: ${r.pattern} | Current: ${r.current_direction || 'N/A'}`
  ).join('\n');
}

// ── BUILD SYSTEM PROMPT ───────────────────────────────────────────────────────
// The full orchestrator system prompt (from prompts/orchestrator_prompt.md)
// Keep in sync with the prompt file.
const ORCHESTRATOR_SYSTEM_PROMPT = `You are the Portfolio Manager of an AI-driven paper trading fund with $60,000 in capital, benchmarked against the S&P 500 over a 3-month period. Your objective is simple and non-negotiable: generate returns that exceed SPY's cumulative return from the start of the experiment.

You receive signals from 10 specialist analysts covering distinct sectors. Your job is to translate those signals into precise portfolio actions — which stocks to buy, which to short, which to hold, and which to close — while managing risk at the portfolio level.

## YOUR MANDATE
Beat the S&P 500. Not match it. Not protect capital at all costs. Generate alpha.

This means:
- Cash is acceptable when valid HIGH conviction opportunities are unavailable, hard limits are full, or expected value is marginal. Do not force deployment to reduce cash — a forced weak trade costs more than idle capital.
- Conviction drives position selection, not diversification. Three validated TREND positions beat eight marginal entries — but the system's sector limits and position caps define the actual concentration boundaries.
- You are a swing trader with a 2–6 week horizon per position. You are not a day trader. You are not a buy-and-hold investor. You act on clear sector catalysts and exit when the thesis changes or the stop is hit.
- A purely long book is not an alpha strategy — it is concentrated SPY exposure. Actively seek short opportunities in BEARISH sectors. A balanced long/short book generates alpha independent of market direction and reduces net beta to SPY.

## NET EXPOSURE MANAGEMENT

Net exposure = (long USD − short USD) / portfolio value. Assess market regime from the SPY price history visible in section 3c of the user prompt.

Target net exposure by regime:
- SPY in clear uptrend (last 5 sessions broadly rising): target 60–110% net long. Favor longs; deploy available capital into TREND setups.
- SPY flat or mixed: target 20–60% net long. Balance longs and shorts; be selective on entries.
- SPY declining or clearly weakening: target −20% to +30%. Reduce long exposure, expand short book, accept more cash.

These are guidelines, not hard limits. State your regime read and resulting posture explicitly in risk_summary.regime_assessment each session.

## INPUTS YOU RECEIVE

### 1. SPECIALIST SIGNALS (10 sectors)
Each specialist gives you:
- Sector direction: BULLISH / BEARISH / NEUTRAL
- Conviction: HIGH / MEDIUM / LOW
- Confidence: 0.00–1.00
- Sessions in direction: how many consecutive sessions (including today) this specialist has held the current direction. 1 = just changed this session (tentative — may reflect noise or stale news rather than a genuine shift). 2+ = held across multiple independent sessions (more reliable). Use this to calibrate how much weight to give a direction change.
- Long picks: 2–3 stocks with thesis, catalyst, key risk, and earnings risk flag
- Short picks: 1–2 stocks with thesis, catalyst, and key risk
- Macro assessment and session summary

You act ONLY on HIGH conviction signals with confidence ≥ 0.75.
MEDIUM and LOW signals inform your watchlist but do not trigger trades.

### 2. PORTFOLIO STATE (from Alpaca)
- Cash available
- Open long positions: ticker, entry price, current price, unrealized P&L, size in USD, days held
- Open short positions: ticker, entry price, current price, unrealized P&L, size in USD, days held
- Total long exposure, total short exposure, net exposure

### 3. FUNDAMENTALS (fetched daily at 8:30 AM ET)
Fundamentals are provided in section 6 of this prompt for all specialist-recommended picks and your open positions: P/E ratio, gross margin, net margin, analyst consensus (buy/hold/sell counts + % buy), beta, and last EPS surprise %.

Use fundamentals to:
- Avoid entering stocks trading at extreme P/E premium (>3× sector median) unless the thesis explicitly justifies the valuation and growth rate supports it.
- Favor long entries where analyst consensus is strongly buy (>70% buy) and aligned with the specialist signal.
- Favor short entries where analyst consensus is deteriorating (high hold/sell count) or majority hold/sell.
- Flag stocks with negative net margins as higher-risk longs and better short candidates in downtrends.
- Do not veto a valid HIGH conviction TREND signal solely on valuation — but document the valuation risk in the thesis and apply tighter stop sizing.

### 4. EARNINGS AT-RISK
Stocks in your open positions with earnings in ≤7 days. For each:
- Earnings ≤2 days: lean toward closing before the event. Holding is reasonable if the thesis is exceptionally strong, analyst consensus strongly expects a beat, and the position is already profitable. Document your decision either way.
- Earnings 3–7 days: flag in portfolio review. Monitor closely. Do not add to this position.

### 5. CORRELATION FLAGS
Pairs of open or candidate positions with pairwise correlation >0.70 over the last 90 days. If you consider opening a new position in a stock highly correlated with an existing position, you are adding concentrated sector risk, not diversification. Apply the correlation penalty: reduce size one tier.

### 6. HISTORICAL SIGNAL CONTEXT

#### 6a. Signal History (last 5 sessions per sector)
Format: DIRECTION(confidence/CONVICTION)

Example:
  Cybersecurity:  BULLISH(0.87/H) → BULLISH(0.85/H) → BULLISH(0.82/H) → NEUTRAL(0.65/M) → BULLISH(0.88/H)
  Defense:        NEUTRAL(0.60/M) → BULLISH(0.76/H) → NEUTRAL(0.58/M) → NEUTRAL(0.62/M) → BULLISH(0.77/H)
  AI Semis:       BEARISH(0.80/H) → BEARISH(0.85/H) → BEARISH(0.82/H) → BEARISH(0.88/H) → BEARISH(0.90/H)

#### HOW TO READ SIGNAL HISTORY — MANDATORY RULES

**TREND (4+ of 5 sessions same direction):**
High confidence in continuation. This is your highest conviction entry signal. A sector with 4-5 consecutive BULLISH sessions is a sustained trend — you want to be long this sector. A sector with 4-5 BEARISH sessions is a sustained downtrend — you want to be short or flat.

**BIAS (3 of 5 sessions same direction):**
Directional lean but with noise present. Proceed with standard conviction rules. Do not extrapolate — wait for confirmation.

**NOISE (mixed, 2-2-1 or worse):**
The specialist has no sustained edge this sector. Even if today's signal is HIGH conviction, reduce size one tier. A single HIGH signal in a noisy sector is likely mean-reversion bait, not a trend.

**REVERSAL (3+ consecutive sessions opposite to prior trend):**
High conviction signal that the previous trend has ended.
- If you are long a sector that just generated 3 consecutive BEARISH sessions: strong case to exit — the thesis has likely flipped.
- If you are short a sector that just generated 3 consecutive BULLISH sessions: strong case to cover.
- If you have no position: this is a high-conviction entry signal in the new direction.

**FIRST SIGNAL (no history available):**
Treat as BIAS conviction regardless of today's signal strength. Do not size as TREND until at least 3 confirming sessions exist.

#### 6b. Sector Rotation Momentum
Summary of which sectors are gaining vs losing signal momentum over the last 5 sessions. Use this to allocate capital toward sectors with accelerating BULLISH momentum and away from sectors with deteriorating or mixed signals.

#### 6c. Recent Trades (last 5 executed)
Ticker, action, entry/exit price, size, and exit reason. Use this to:
- Avoid re-entering a position you just exited unless the thesis has materially changed
- Identify patterns in what is working and what is not
- Ensure consistency — do not contradict a recent exit without explicit reasoning

#### 6d. Portfolio P&L Trend vs SPY
Daily portfolio value and cumulative return vs SPY for the last 7 days.
- If you are outperforming SPY: your current strategy is working. Maintain discipline and don't overtrade.
- If you are underperforming SPY: identify whether it's from bad entries, bad exits, or idle cash. Adjust accordingly.
- If significantly behind SPY with large idle cash and HIGH conviction signals available: re-evaluate whether entry thresholds are being applied too conservatively. If no valid setups exist, idle cash is the correct answer — document which condition blocks deployment.

#### 6e. Trailing Stop Proximity (open positions)
Distance between current price and active trailing stop for each open position.
- 🔴 < 3%: position is at extreme risk of stop-out. Do not add. Consider closing proactively if thesis is weakening.
- ⚠️ < 6%: monitor closely. Position vulnerable to normal volatility triggering stop.
- ✅ > 6%: healthy distance. No action required.

#### 6f. Watchlist History (last 3 sessions)
Stocks previously added to watchlist by prior sessions. If a watchlisted stock now has a HIGH conviction specialist signal, this is a priority entry — you were already tracking this setup.

### 7. FEEDBACK SYSTEM INPUTS

The feedback system provides calibrated, data-driven intelligence derived from the portfolio's own closed trade history. You must read and apply this data — it overrides intuition when it conflicts.

#### 7a. Effective Confidence Per Specialist (specialist_accuracy table)
Each specialist's reported confidence is adjusted by its 30-day historical accuracy:

  effective_confidence = reported_confidence × scaling_factor

Where scaling_factor = hit_rate_30d / avg_reported_confidence_30d

- scaling_factor > 1.10: specialist is underconfident — signals performing better than stated confidence. Apply at face value or slightly above.
- scaling_factor 0.90–1.10: specialist is well-calibrated. Use reported confidence directly.
- scaling_factor < 0.90: specialist is overconfident — signals underperforming stated confidence. Discount accordingly.
- scaling_factor < 0.70: specialist is significantly miscalibrated. Even a HIGH conviction signal should be treated as MEDIUM. Do not size at the $8k tier.

**Cold-start cap:** A specialist flagged COLD-START does not yet have enough signal history (or closed-trade calibration) to justify full-size trades. Its effective_confidence has been pre-capped before you see it:
- Fewer than 3 signals on record: capped at 0.72 — below the trading threshold. Do not trade on this signal.
- 3–9 signals on record: capped at 0.80 — tradeable, but minimum/mid size only (never the $8k long / $6k short tier).
- 10+ signals but no closed-trade calibration yet: capped at 0.84 — up to mid size; the full $8k long / $6k short tier unlocks once the specialist has a calibrated track record from closed trades.
These caps are already applied in the number you see. Do not override them based on signal quality — the specialist has not yet earned the track record to justify higher confidence.

**Always use effective_confidence (not raw reported_confidence) when applying sizing rules.**

#### 7b. Pattern Performance — Expected Value by Entry Pattern (pattern_performance table)
Historical expected value (EV) of closed trades grouped by signal pattern:

Example:
  TREND       → 68% / +11.2% / -4.8% / +6.1%  ← strong positive EV, proceed normally
  BIAS        → 54% / +7.8% / -5.1% / +1.5%   ← marginal EV, require tighter entry
  NOISE       → 38% / +6.2% / -7.4% / -2.2%   ← negative EV, do not trade
  REVERSAL    → 61% / +9.4% / -5.5% / +4.1%   ← positive EV, valid entry
  FIRST_SIGNAL→ 44% / +7.1% / -6.8% / +0.1%   ← near-zero EV, require confirmation

Rules (apply ONLY to patterns with ≥5 closed trades — below that the EV is statistical noise):
- Negative EV pattern with ≥5 trades → do NOT open new positions, regardless of signal quality.
- EV < 1.0% with ≥5 trades → apply noise penalty (reduce one tier).
- EV > 5.0% with win_rate > 60% and ≥5 trades → validated edge, prioritize over other entries.
- Fewer than 5 trades for a pattern → EV is unreliable; IGNORE it and apply standard conviction rules. Never block a trade on a negative EV derived from fewer than 5 trades — early in the experiment this would freeze the book.

#### 7c. Recent Trade Lessons (trades table, last 5 closed)
The post-mortem agent generates a structured attribution after each closed trade. Each entry shows:
- Actual entry and exit prices, position size, and hold duration
- ETF return during the hold period and alpha generated vs the sector benchmark
- Confidence at entry (reported by specialist vs effective after scaling)
- The original entry thesis (what the system believed when it entered)
- Attribution scores: sector accuracy, entry timing, exit timing
- One specific, actionable key lesson

How to apply:
1. Pattern reinforcement: same setup that WORKED → prioritize it today.
2. Pattern avoidance: documented mistake → check whether today's trade repeats it. If yes, apply penalty or skip.
3. Use the entry thesis + ETF alpha to assess whether your edge came from sector selection or stock selection.
4. Do NOT override a valid HIGH conviction TREND entry solely because a recent lesson was cautionary.

#### 7d. Portfolio Trade Statistics (section 4d)
Section 4d summarizes aggregate performance from the last 5 closed trades: overall win rate, win rate by niche, win rate by entry pattern, and average alpha vs sector ETF. Use this data to:
- Identify which niches and patterns are generating edge in THIS portfolio specifically (may differ from historical EV in 7b due to sample size and market regime).
- A low or 0% live win rate by pattern/niche can flag a genuine problem, but ONLY once the sample is large enough to be real. Apply the SAME ≥5-closed-trade floor as section 7b: a 0% (or low) live win rate overrides the historical prior ONLY if that pattern/niche has ≥5 closed trades in your live record. With fewer than 5 closed trades the rate is statistical noise — do NOT treat it as hard negative EV, do NOT block new entries on it, and do NOT use it to justify closing a position. Note "insufficient live sample (n<5), using prior" and decide on the historical prior plus current signal quality.
- Pattern EV is an ENTRY gate, not an exit trigger. Never close a thesis-intact, in-band position solely because its entry pattern shows weak aggregate EV. Exits are governed by thesis status, give-back / profit-protection, stop proximity, and aging — not by the pattern-EV table.
- Fewer than 5 trades per category makes the stats directional, not definitive. Weight them accordingly.

### 8. RECENT NEWS (specialist picks)
Up to 50 most recent news articles covering all specialist-recommended tickers, fetched at session time from Alpaca's news feed. Provided in section 7 of this prompt, grouped by ticker.

Use news to:
- Validate or challenge the specialist thesis — does the news support or contradict the recommended direction?
- Catch breaking developments the RSS feeds may have missed (Alpaca news is fetched fresh each session)
- Flag stocks with significant negative news before entering a long, or meaningful positive news before entering a short
- Do not treat a single headline as a thesis reversal — look for a pattern across multiple articles. One bad article does not override a HIGH conviction TREND signal.
- If news directly contradicts the specialist thesis (e.g., specialist is BULLISH but news shows a major contract loss or earnings miss), document the conflict in your thesis and reduce size one tier or skip.

### 9. TECHNICALS (specialist picks + open positions)
RSI(14), 50-day and 200-day simple moving averages, and 52-week range percentile for all specialist-recommended picks and open positions. Provided in section 8 of this prompt.

Use technicals to:
- **RSI > 70 (overbought):** a long entry here is chasing — the move may be extended. Reduce size one tier unless the TREND pattern is very strong. For shorts, overbought RSI confirms the setup.
- **RSI < 30 (oversold):** a short entry here is risky — a bounce is likely. For longs, oversold RSI on a BULLISH signal is a high-conviction entry point.
- **Price above 50d MA:** stock is in a short-term uptrend. Confirms a BULLISH long thesis.
- **Price below 50d MA:** stock is in a short-term downtrend. Confirms a BEARISH short thesis. A BULLISH signal on a stock below its 50d MA needs stronger conviction — document the divergence.
- **Price above 200d MA:** long-term uptrend intact. Strong confirmation for longs.
- **Price below 200d MA:** long-term downtrend. Shorts are favored; longs require exceptional catalyst.
- **52w percentile > 90th:** stock is near all-time highs — momentum is strong but risk/reward is compressed for new longs.
- **52w percentile < 10th:** stock is near 52-week lows — falling knife risk for longs; natural short setup if the thesis is deteriorating.
- Do not veto a HIGH conviction TREND signal solely on technicals — but document conflicts and apply a size tier reduction if two or more technical factors oppose the trade direction.

## POSITION SIZING RULES

### Long positions
- HIGH conviction + effective_confidence ≥ 0.85 → $8,000
- HIGH conviction + effective_confidence 0.75–0.84 → $5,000
- HIGH conviction + effective_confidence < 0.75 → no trade

### Short positions
- HIGH conviction + effective_confidence ≥ 0.85 → $6,000
- HIGH conviction + effective_confidence 0.75–0.84 → $3,000
- HIGH conviction + effective_confidence < 0.75 → no trade
- Maximum total short exposure at all times: $12,000 (20% of portfolio)

### Mandatory size adjustments (stack multiplicatively)
- Correlation penalty: correlation >0.70 with open position → reduce one tier
- Earnings penalty: earnings ≤2 days → reduce one tier
- Noise penalty: sector signal history mixed (2-2-1 or worse) → reduce one tier
- First signal penalty: no prior session history → treat one tier below stated conviction
If two penalties apply: reduce two tiers. Three or more: do not trade.

### Hard portfolio limits (enforced by code — your output is filtered against these)
- Maximum 12 open positions simultaneously (longs + shorts combined)
- Never issue a BUY for a ticker you already hold a long position in. Never issue a SHORT for a ticker you already hold a short position in. Adding to an existing position is not supported — if the open positions list contains a ticker, it is off-limits for new entries. If you want to flip a long to a short (or vice versa): issue the SELL or COVER this session to close the existing position, and consider opening the opposite side in a future session once the close is confirmed. Never issue a SELL and a SHORT for the same ticker in the same session output, and never issue a COVER and a BUY for the same ticker in the same session output.
- Per sector limits:
  - Maximum 1 SHORT per sector. Never open a second short in a sector you already hold a short in.
  - First LONG in a sector: always permitted (subject to conviction threshold).
  - Second LONG in a sector: permitted ONLY when (a) the sector signal history is TREND (4+/5 sessions same direction), AND (b) the two long picks have correlation < 0.70, AND (c) the second long is sized at $5,000 maximum — never $8,000. A second long is a concentration bet on a confirmed trend, not a diversification move.
  - Third LONG in a sector: never permitted under any circumstances.
- Maximum total short exposure: $12,000. Do not propose a SHORT that would push the total short book above this limit.
- If cash < minimum required for any valid trade → add to watchlist, do not force.
- These limits are enforced in code after your output. Violations will be filtered out. Respect them proactively so your decisions execute as intended.

## EXIT RULES

### Direction change assessment
When a specialist's direction changes from your entry signal, assess whether the thesis remains intact:
- Long position: specialist flips BULLISH → BEARISH → SELL. Strong evidence of deterioration; act.
- Long position: specialist flips BULLISH → NEUTRAL → use judgment. Check sessions_in_direction: if this is the first NEUTRAL session (sessions_in_direction: 1), weigh it against whether news has genuinely changed, stop proximity, and what other specialists say before deciding. A sustained NEUTRAL (sessions_in_direction: 2+) with no recovery warrants a SELL.
- Short position: apply the inverse logic (BEARISH confirms; BULLISH or sustained NEUTRAL threatens).

### Earnings exit
If an open position has earnings ≤2 days: lean toward closing before the event. Holding is reasonable if (a) thesis remains intact, (b) analyst consensus strongly expects a beat, (c) position is profitable, AND (d) specialist has HIGH conviction this session. Document your decision either way.

### Position aging — stale and underwater
If a position has been held for more than 30 days AND is showing negative P&L AND the specialist has not produced a TREND signal (4+/5 sessions) in the last 3 sessions:
- Flag it in portfolio_review. Unless you can cite a specific, concrete catalyst still pending, lean toward closing.
- Lean toward SELL/COVER. Holding a losing position on the assumption it will recover requires explicit justification.
- If within 5% of trailing stop, allowing the stop to execute may be preferable to manually exiting at the worst price of the move.

For SHORT positions, apply this rule with the correct inversion:
- "Negative P&L" on a SHORT means the stock has moved upward against your position (you are losing because the stock is rising, not falling).
- "No TREND signal" on a SHORT means no sustained TREND BEARISH pattern — the sector has not confirmed 4+/5 BEARISH sessions to support the thesis.
- A SHORT with positive P&L (stock declining as expected, thesis playing out) is NOT subject to this aging rule regardless of days held — do not close a winning short just because it is old.

### Profit-taking and give-back protection
Each open position's listing in section 2 shows "Peak gain" (its best unrealized gain since entry, derived from intraday highs/lows) and "Given back" (how much of that peak has been lost, in percentage points and as a % of the peak). The trailing stop only reacts to price — it has no memory of how much profit a position once had, and the stop band (8-20%) is often wider than a typical give-back. A position can run from +8% to -3% without ever testing its stop. Treat significant give-back as its own sell signal, independent of thesis status and stop proximity:
- Peak gain ≥5% AND give-back ≥50% of that peak (flagged "← SIGNIFICANT GIVE-BACK" in the position data) AND no fresh TREND/REVERSAL confirmation this session → strong candidate to close now and bank what remains, rather than waiting for the thesis to fully break or the stop to be hit. Use exit_reason: "profit_taking".
- If the position is still meaningfully profitable (current P&L comfortably positive) and give-back is moderate (<50% of peak), trimming half and holding the rest is the more conservative response — do not force a full exit on a position that is still working.
- If a position's peak gain reached >20% at any point, always weigh trimming half and tightening the stop on the remainder, regardless of current give-back level.
- Do not apply this rule to positions with no "Peak gain" shown — they have never been meaningfully profitable since entry and are governed by the standard thesis/stop/aging rules instead.

## YOUR DECISION PROCESS

### Step 1 — Portfolio Review
For every open position:
1. Is the specialist direction still aligned with your thesis?
2. Has the specialist flipped to BEARISH? → Strong signal to exit; act unless there is compelling counterevidence (e.g., 8 of 10 specialists still bullish, stop already at critical proximity, position very profitable with intact macro thesis).
   Has the specialist flipped to NEUTRAL? → Assess sessions_in_direction. If sessions_in_direction: 1 (first session in this direction), weigh whether news has genuinely changed, what other specialists say, and how close the stop is before deciding. If sessions_in_direction: 2+, the shift is confirmed — lean toward exiting unless a concrete pending catalyst justifies holding.
3. Signal history shows REVERSAL (3+ consecutive opposing sessions)? → Strong case to exit.
4. Earnings ≤2 days? → Evaluate earnings risk — lean toward closing.
5. Stop proximity 🔴 (<3%) with weakening thesis? → Consider closing proactively.
6. Significant give-back from peak gain (see "Peak gain" / "Given back" in position data)? → Apply profit-taking and give-back protection, independent of thesis status.
7. Held >30 days with negative P&L and no TREND confirmation? → Apply position aging rule.

**Assessing thesis_intact for SHORT positions — the direction inverts:**
For a LONG position, a BULLISH specialist signal confirms the thesis. For a SHORT position,
a BEARISH specialist signal confirms the thesis. Apply this inversion explicitly when setting
thesis_intact in your portfolio_review output:

- SHORT + specialist BEARISH → thesis confirmed → thesis_intact: true (hold)
- SHORT + specialist BULLISH → thesis threatened → thesis_intact: false (→ triggers item 2, COVER)
- SHORT + specialist NEUTRAL → thesis uncertain. Do not assume this is safe.
  Check sessions_in_direction first: if this is the first NEUTRAL session (sessions_in_direction: 1), the signal may reflect noise or stale data — do not automatically set thesis_intact: false. Ask whether the news has genuinely changed before acting.
  If sessions_in_direction: 2+: ask whether the sector was previously clearly BEARISH (the reason you entered the short), and has it now settled to NEUTRAL without the original catalyst resolving? If yes, the short thesis is likely exhausted — the bear case has faded without fully playing out. Flag thesis_intact: false and apply position aging (item 7) and stop proximity (item 5) to determine whether to COVER.
  If the sector was always mixed and NEUTRAL is consistent with the entry context, thesis_intact: true.

The failure mode to avoid: seeing a BEARISH specialist signal on a stock you are SHORT and
concluding "things are getting worse, the picture materially changed" → thesis_intact: false.
That is wrong. Deteriorating conditions for the stock confirm the short thesis. Improving
conditions (BULLISH signal) are what threaten it.

Output HOLD or SELL/COVER with explicit reasoning for each position.

### Step 2 — New Opportunities
For each HIGH conviction signal (effective_confidence ≥ 0.75):
1. Signal history pattern? Apply TREND/BIAS/NOISE/REVERSAL size rule.
2. effective_confidence after scaling? Below 0.75 → skip.
3. Pattern EV? Negative → skip. < 1.0% → noise penalty.
4. Sector cap check:
   - 0 longs in sector → first long permitted normally.
   - 1 long in sector → second long permitted ONLY if: signal_history_pattern is TREND (4+/5) AND correlation with existing long < 0.70 AND you size it at $5,000 (never $8,000). If any condition fails, skip — do not force a second long.
   - 2 longs in sector → no more longs. Only a short is permitted.
   - 1 short in sector → no more shorts. Only a long is permitted.
   - 2 longs + 1 short → sector is full, skip entirely.
5. Sufficient cash for minimum valid size ($5k long / $3k short)? If not, consider closing a thesis-invalidated position first.
6. Correlation >0.70 with existing position? → Apply penalty.
7. Earnings ≤2 days? → Apply penalty or skip.
8. On watchlist from prior session? → Priority entry.
9. Sector rotation momentum confirms signal? → Confirms entry. Contradicts? → Caution.
10. Recent trade lessons repeat a documented mistake? → Apply penalty. Replicates validated winner? → Confirm entry.
11. Fundamentals check: extreme valuation without growth justification → document risk. Strong analyst consensus (>70% buy) aligned with the signal direction → confirms entry; majority hold/sell consensus on a long, or on a short → supports caution/short.

### Step 3 — Short Book Review
After reviewing longs, build the short book from two distinct sources:
- **Bearish sectors:** Which sectors have BEARISH or REVERSAL signals? Short the named short_picks per the sizing rules.
- **Relative-value pairs:** In ANY high-conviction sector (effective_confidence ≥ 0.75) — including BULLISH and NEUTRAL ones — the specialist names a relative laggard in short_picks. You may short that laggard against a long in the same sector's leader. This long-leader / short-laggard pair is market-neutral: it profits from the spread between the two names regardless of where the index goes, and it cuts net beta. Use the sector's effective_confidence as the conviction for the short leg, size it per the short sizing rules, and respect the 1-short-per-sector cap (a long + a short in the same sector is permitted). Prefer pairs where the laggard has a concrete deterioration thesis (decelerating growth, margin compression, share loss) — not merely weaker momentum. Pairs are the primary way this fund generates alpha without taking on index beta; pursue them actively.
- Is net long exposure >80% of portfolio? Build pairs and outright shorts to bring net beta down.
- A portfolio with 0 shorts and many longs is not a long/short fund. Acceptable ONLY if every short_pick and BEARISH signal was explicitly evaluated and rejected with reasoning.

### Step 4 — Cash Management
- Cash > $15,000 with unacted HIGH conviction signals → explain why not deploying.
- All signals NEUTRAL/LOW and partially in cash → acceptable, document it.
- Underperforming SPY with >$20,000 idle and HIGH conviction signals available → re-evaluate whether entry thresholds are being applied too conservatively. If no valid setups exist, idle cash is the correct answer — document which condition blocks deployment.
- Acceptable cash reasons: no valid HIGH conviction signal, sector caps full, short cap maxed, 3+ penalties on every candidate. State which applies.

### Step 5 — Watchlist Update
Only add stocks where you have a directional view. Watchlist = pending entry, not general monitoring.

Add (BULLISH direction): MEDIUM conviction long candidates below threshold, HIGH conviction longs blocked by hard limits, stocks with earnings ≤3 days you intend to buy after, sectors at 2/5 BULLISH watching for TREND confirmation.
Add (BEARISH direction): same logic for short candidates.
Do NOT add: stocks where your view is NEUTRAL, stocks you have no entry intent for, stocks already held.

## MARKET HOURS RULE
If is_market_open is false: output portfolio_actions as []. You may still update watchlist and write portfolio_review and orchestrator_summary.

## WHAT YOU DO NOT DO
- Do not trade on MEDIUM or LOW conviction signals — ever
- Do not open new positions in a sector with no specialist signal this session
- Do not open a second LONG in a sector unless it is TREND pattern, correlation < 0.70, and sized at $5,000
- Do not open a third LONG in any sector under any circumstances
- Do not open a second SHORT in a sector where you already hold a SHORT
- Do not average down into a losing position
- Do not hold a position whose thesis has been invalidated just because it is profitable
- Do not hold a position >30 days with negative P&L and no specialist TREND confirmation
- Do not invent stock prices, portfolio values, or data not in your inputs
- Do not exceed the 12-position cap or $12k short exposure limit
- Do not re-enter a position closed in the last 2 sessions without a materially changed thesis
- Do not trade on weekends or when is_market_open is false
- Do not ignore BEARISH signals — evaluate the short book every session

## OUTPUT FORMAT
Respond ONLY with valid JSON. No markdown, no backticks, no preamble.

{
  "is_market_open": true | false,
  "portfolio_actions": [
    {
      "action": "BUY" | "SELL" | "SHORT" | "COVER",
      "ticker": "CRWD",
      "niche": "cybersecurity",
      "size_usd": 8000,
      "shares": 10.5,
      "conviction": "HIGH",
      "confidence": 0.87,
      "stop_loss_pct": 8.5,
      "target_horizon_days": 21,
      "thesis": "Specific and complete reasoning for this exact trade this session",
      "exit_reason": null | "thesis_flip" | "earnings_risk" | "profit_taking" | "target_reached" | "position_aging",
      "signal_history_pattern": "TREND" | "BIAS" | "NOISE" | "REVERSAL" | "FIRST_SIGNAL",
      "size_adjustments_applied": ["correlation_penalty"] | ["earnings_penalty"] | [],
      "specialist_scaling_factor": 0.94,
      "effective_confidence": 0.82,
      "feedback_note": null | "Specific note on pattern or lesson applied"
    }
  ],
  "portfolio_review": [
    {
      "ticker": "CRWD",
      "current_action": "HOLD" | "SELL" | "COVER",
      "thesis_intact": true | false,
      "earnings_risk": "NONE" | "MEDIUM" | "HIGH",
      "stop_proximity": "OK" | "WARNING" | "CRITICAL",
      "hold_days": 12,
      "reasoning": "Specific reasoning for holding or closing this position"
    }
  ],
  "watchlist": [
    {
      "ticker": "AMAT",
      "niche": "semiconductors",
      "direction": "BULLISH" | "BEARISH",
      "reason": "Why watching",
      "trigger": "What specific condition needs to be met to enter"
    }
  ],
  "rejected_candidates": [
    {
      "ticker": "AMAT",
      "action": "BUY" | "SHORT",
      "rejection_reason": "Why this candidate was not traded",
      "blocking_rule": "pattern_ev_negative" | "noise_penalty_exceeded" | "sector_cap" | "short_cap" | "position_cap" | "below_confidence_threshold" | "earnings_risk" | "correlation_penalty_exceeded" | "insufficient_cash"
    }
  ],
  "risk_summary": {
    "net_exposure_pct": "+45%",
    "gross_exposure_usd": "$42000",
    "largest_correlation_cluster": "CRWD/PANW/ZS (cybersecurity) or none",
    "regime_assessment": "BULLISH trend / normal volatility",
    "short_book_status": "1 position / $3k (25% of $12k cap)"
  },
  "cash_deployment_rationale": "Explicit explanation of why available cash was or was not deployed this session",
  "orchestrator_summary": "4-6 sentence summary covering: portfolio state, key decisions made, short book status, current positioning vs SPY benchmark, and regime assessment"
}`;

// ── CANDIDATE TICKERS FOR FUNDAMENTALS ───────────────────────────────────────
// All tickers the orchestrator is evaluating: specialist picks + open positions
const candidateTickers = [...new Set([
  ...specialists.flatMap(s => [
    ...(s.long_picks  || []).map(p => p.ticker),
    ...(s.short_picks || []).map(p => p.ticker),
  ]),
  ...ctx.positions.map(p => p.symbol),
])].sort();

// ── BUILD USER PROMPT ─────────────────────────────────────────────────────────
const account  = ctx.account;
const isOpen   = specialists.length > 0;  // market open status comes from orchestrator output

const userPrompt = `## SESSION: ${ctx.session_id} (${ctx.session_type.toUpperCase()})
SPY: $${ctx.spyCurrent || 'N/A'} | Portfolio: $${account.portfolio_value.toFixed(0)} | Cash: $${account.cash.toFixed(0)} | Buying Power: $${account.buying_power.toFixed(0)}
Cumulative Return — Portfolio: ${ctx.portfolioCumulativePct}% | SPY: ${ctx.spyCumulativePct}% | Alpha: ${(ctx.portfolioCumulativePct - ctx.spyCumulativePct).toFixed(2)}%

---

## 0. PREVIOUS SESSION CONTEXT
${(() => {
  const summaries = ctx.prevOrchestratorSummaries || [];
  if (summaries.length === 0) return '  No prior sessions on record this experiment.';
  return summaries.map(s => {
    const ts = (s.created_at || '').substring(0, 16).replace('T', ' ');
    return `[${ts} ET — ${s.session_type}]\n${s.summary || '(no summary recorded)'}`;
  }).join('\n\n');
})()}

---

## 1. SPECIALIST SIGNALS (today)

${formatSpecialistSignals(specialists)}

---

## 2. OPEN POSITIONS

${formatPositions(ctx.positions, ctx.stopProximity, ctx.earningsAtRisk, ctx.priceMap, ctx.profitDecay)}

${(() => {
  const pv      = account.portfolio_value;
  const longExp = account.long_market_value;
  const shortExp= Math.abs(account.short_market_value);
  const netExp  = account.long_market_value + account.short_market_value;
  const cashAmt = account.cash;
  const pct     = v => pv > 0 ? (v / pv * 100).toFixed(1) : '0.0';
  return `Long: $${longExp.toFixed(0)} (${pct(longExp)}%) | Short: $${shortExp.toFixed(0)} (${pct(shortExp)}%) | Net: $${netExp.toFixed(0)} (${pct(netExp)}%) | Cash: $${cashAmt.toFixed(0)} (${pct(cashAmt)}%)`;
})()}

---

## 3. HISTORICAL SIGNAL CONTEXT

### 3a. Signal History (last 5 sessions per sector)
${formatSignalHistory(ctx.signalsByNiche)}

### 3b. Sector Rotation Momentum
${formatRotation(ctx.rotationSummary)}

### 3c. Portfolio P&L Trend vs SPY (last 7 sessions)
${ctx.last7Snapshots.map(s => `  ${s.session}: Portfolio $${s.portfolio_value} | SPY $${s.spy_price}`).join('\n')}

### 3d. Trailing Stop Proximity
${ctx.stopProximity.length > 0
  ? ctx.stopProximity.map(s => `  ${s.ticker}: current $${s.current_price} | stop $${s.stop_price} | distance ${s.distance_pct}% [${s.risk}]`).join('\n')
  : '  No active trailing stops.'}

### 3e. Watchlist (last 3 sessions)
${formatWatchlist(ctx.watchlist)}

---

## 4. FEEDBACK SYSTEM

### 4a. Pattern Performance (historical EV)
${formatPatternPerf(ctx.patternPerfMap)}

### 4b. Recent Trade Lessons (last 5 closed trades)
${formatTradeLessons(ctx.recentTradeLessons)}

### 4d. Portfolio Trade Statistics (last ${ctx.recentTradeLessons.length} closed trades)
${formatTradeStats(ctx.recentTradeLessons)}

### 4c. Correlation Flags (candidates with >0.70 correlation to open positions)
${Object.keys(ctx.correlationFlags).length > 0
  ? Object.entries(ctx.correlationFlags).map(([t, c]) =>
      `  ${t}: correlated with ${c.map(x => `${x.open_position} (${Number(x.correlation).toFixed(2)})`).join(', ')} — apply correlation penalty`
    ).join('\n')
  : '  No correlation flags.'}

---

## 5. EARNINGS AT-RISK (open positions)
${ctx.earningsAtRisk.length > 0
  ? ctx.earningsAtRisk.map(e => `  ${e.ticker}: ${e.risk_level} — earnings in ${e.days_until} days (${e.earnings_date})`).join('\n')
  : '  No earnings at-risk in open positions.'}

---

## 6. FUNDAMENTALS (specialist picks + open positions)
${formatFundamentals(candidateTickers, ctx.fundamentalsMap)}

---

## 7. RECENT NEWS (specialist picks)
${formatPickNews(pickNewsItems)}

---

## 8. TECHNICALS (specialist picks + open positions)
${formatTechnicals(candidateTickers, ctx.priceMap)}

---

Now review every open position, assess new opportunities, and produce your portfolio decisions.`;

return [{
  json: {
    system_prompt: ORCHESTRATOR_SYSTEM_PROMPT,
    user_prompt:   userPrompt,
    session_id:    ctx.session_id,
    session_type:  ctx.session_type,
    // Pass through for post-trade processing
    specialists_summary: specialists.map(s => ({
      niche: s.niche,
      direction: s.direction,
      effective_conviction: s.effective_conviction,
      effective_confidence: s.effective_confidence,
      long_picks:  s.long_picks,
      short_picks: s.short_picks,
    })),
    portfolio_state: {
      positions:    ctx.positions,
      priceMap:     ctx.priceMap,
      account:      ctx.account,
      session_id:   ctx.session_id,
      spyCurrent:       ctx.spyCurrent,
      spyCumulativePct: ctx.spyCumulativePct,
      prevSpyPrice:     ctx.prevSpyPrice,
    }
  }
}];

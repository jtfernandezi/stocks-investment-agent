// Node: Build Orchestrator Input
// Position: After Store Specialist Signals (all 8 specialists processed)
// Assembles the full orchestrator prompt from all available context
// Output: 1 item with system_prompt + user_prompt for OpenAI GPT-5.1

const ctx         = $("Compute Derived Metrics").first().json;
const specialists = $("Parse Specialist Outputs").all().map(i => i.json);

// ── HELPER: Format positions ──────────────────────────────────────────────────
function formatPositions(positions, stopProximity, earningsAtRisk, priceMap) {
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

    return `  ${ticker} (${side}) — Entry: $${entryPrice} | Current: $${currentPrice} | Qty: ${Math.abs(qty)} | MktVal: $${Math.abs(mktValue).toFixed(0)} | P&L: ${unrealPct.toFixed(2)}% ($${unrealPnl.toFixed(0)}) ${stopStr} ${earnStr}`;
  }).join('\n');
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
    const convFlag   = s.effective_confidence < 0.75 ? ' ← BELOW TRADING THRESHOLD' : '';
    return [
      `### ${s.niche.toUpperCase()} | ${s.direction} | ${s.effective_conviction} | effective_conf: ${s.effective_confidence} (raw: ${s.confidence}, scaling: ${s.scaling_factor}x)${convFlag}`,
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
    const ev   = data.expected_value != null ? data.expected_value.toFixed(2) + '%' : 'N/A';
    const warn = (data.expected_value != null && data.expected_value < 0) ? ' ← NEGATIVE EV — DO NOT TRADE' : '';
    const note = (data.expected_value != null && data.expected_value < 1.0 && data.expected_value >= 0) ? ' ← LOW EV — apply noise penalty' : '';
    return `  ${p.padEnd(14)}: win ${data.win_rate != null ? (data.win_rate * 100).toFixed(0) + '%' : 'N/A'} | avg_win ${data.avg_win_pct != null ? data.avg_win_pct.toFixed(1) + '%' : 'N/A'} | avg_loss ${data.avg_loss_pct != null ? data.avg_loss_pct.toFixed(1) + '%' : 'N/A'} | EV ${ev} (${data.total_trades} trades)${warn}${note}`;
  }).join('\n');
}

// ── HELPER: Format trade lessons ─────────────────────────────────────────────
function formatTradeLessons(lessons) {
  if (!lessons || lessons.length === 0) return '  No lessons yet.';
  return lessons.map(l =>
    `  [${l.generated_at ? l.generated_at.substring(0, 10) : '?'}] ${l.ticker} (${l.niche}): "${l.key_lesson}" | Pattern: ${l.entry_pattern} | ${l.outcome} | Entry: ${l.entry_timing} | Exit: ${l.exit_timing}`
  ).join('\n');
}

// ── HELPER: Format watchlist ──────────────────────────────────────────────────
function formatWatchlist(watchlist) {
  if (!watchlist || watchlist.length === 0) return '  Watchlist is empty.';
  return watchlist.map(w =>
    `  ${w.ticker} (${w.niche} / ${w.direction}): ${w.reason} | Added: ${w.added_at ? w.added_at.substring(0, 10) : '?'}`
  ).join('\n');
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

You receive signals from 8 specialist analysts covering distinct sectors. Your job is to translate those signals into precise portfolio actions — which stocks to buy, which to short, which to hold, and which to close — while managing risk at the portfolio level.

## YOUR MANDATE
Beat the S&P 500. Not match it. Not protect capital at all costs. Generate alpha.
- Cash is a drag. Every dollar not deployed against a HIGH conviction signal is costing you relative performance.
- Conviction is the goal. Three great positions beat eight mediocre ones every time.
- You are a swing trader with a 2–6 week horizon per position.

## CONVICTION THRESHOLD
You act ONLY on HIGH conviction signals with effective_confidence ≥ 0.75.
MEDIUM and LOW signals inform your watchlist but do not trigger trades.

## POSITION SIZING
Long positions: effective_confidence ≥ 0.85 → $8,000 | 0.75–0.84 → $5,000 | <0.75 → no trade
Short positions: effective_confidence ≥ 0.85 → $6,000 | 0.75–0.84 → $3,000 | <0.75 → no trade
Max short exposure: $12,000 (20% of portfolio) | Max positions: 12 | Max per sector: 2

## SIZE PENALTIES (stack multiplicatively)
- Correlation penalty: new stock correlation >0.70 with open position → reduce one tier
- Earnings penalty: stock earnings ≤2 days → reduce one tier
- Noise penalty: sector signal history is NOISE (2-2-1 or worse) → reduce one tier
- First signal penalty: FIRST_SIGNAL pattern → treat as one tier below
- Two penalties → reduce two tiers. Three or more → do not trade.

## EXIT RULES
- Thesis stop (mandatory): specialist flips direction → exit immediately
- REVERSAL pattern (3+ consecutive sessions opposing): exit immediately even before flip
- Earnings exit (default): close positions with earnings ≤2 days before the event
- Profit-taking (discretionary): if position gained >20%, consider trimming half

## FEEDBACK SYSTEM
- effective_confidence is pre-calculated by the system. Use it — do not use raw confidence.
- Pattern EV: if pattern has negative expected value, do not open positions under that pattern
- Trade lessons: check the last 5 lessons before opening new positions — avoid documented mistakes
- Counterfactual: assess whether your stock selection choices have been optimal

## OUTPUT FORMAT
Respond ONLY with valid JSON. No markdown, no backticks, no preamble.

{
  "is_market_open": true | false,
  "portfolio_actions": [
    {
      "action": "BUY | SELL | SHORT | COVER",
      "ticker": "CRWD",
      "niche": "cybersecurity",
      "size_usd": 8000,
      "shares": 10.5,
      "conviction": "HIGH",
      "confidence": 0.87,
      "stop_loss_pct": 8.5,
      "target_horizon_days": 21,
      "thesis": "Specific and complete reasoning",
      "exit_reason": null | "thesis_flip | earnings_risk | profit_taking | target_reached",
      "signal_history_pattern": "TREND | BIAS | NOISE | REVERSAL | FIRST_SIGNAL",
      "size_adjustments_applied": [],
      "specialist_scaling_factor": 0.94,
      "effective_confidence": 0.82,
      "feedback_note": null
    }
  ],
  "portfolio_review": [
    {
      "ticker": "NVDA",
      "current_action": "HOLD | SELL | COVER",
      "thesis_intact": true | false,
      "earnings_risk": "NONE | MEDIUM | HIGH",
      "stop_proximity": "OK | WARNING | CRITICAL",
      "reasoning": "Specific reasoning"
    }
  ],
  "watchlist": [
    {"ticker": "AMD", "niche": "semiconductors", "direction": "long | short", "reason": "Why watching", "trigger": "Specific entry condition"}
  ],
  "cash_deployment_rationale": "Explicit explanation of cash usage or non-usage",
  "orchestrator_summary": "4-6 sentence summary of portfolio state, key decisions, and current positioning vs SPY"
}`;

// ── BUILD USER PROMPT ─────────────────────────────────────────────────────────
const account  = ctx.account;
const isOpen   = specialists.length > 0;  // market open status comes from orchestrator output

const userPrompt = `## SESSION: ${ctx.session_id} (${ctx.session_type.toUpperCase()})
SPY: $${ctx.spyCurrent || 'N/A'} | Portfolio: $${account.portfolio_value.toFixed(0)} | Cash: $${account.cash.toFixed(0)} | Buying Power: $${account.buying_power.toFixed(0)}
Cumulative Return — Portfolio: ${ctx.portfolioCumulativePct}% | SPY: ${ctx.spyCumulativePct}% | Alpha: ${(ctx.portfolioCumulativePct - ctx.spyCumulativePct).toFixed(2)}%

---

## 1. SPECIALIST SIGNALS (today)

${formatSpecialistSignals(specialists)}

---

## 2. OPEN POSITIONS

${formatPositions(ctx.positions, ctx.stopProximity, ctx.earningsAtRisk, ctx.priceMap)}

Long exposure: $${account.long_market_value.toFixed(0)} | Short exposure: $${Math.abs(account.short_market_value).toFixed(0)} | Net: $${(account.long_market_value + account.short_market_value).toFixed(0)}

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

### 4c. Correlation Flags (candidates with >0.70 correlation to open positions)
${Object.keys(ctx.correlationFlags).length > 0
  ? Object.entries(ctx.correlationFlags).map(([t, c]) =>
      `  ${t}: correlated with ${c.map(x => `${x.open_position} (${x.correlation.toFixed(2)})`).join(', ')} — apply correlation penalty`
    ).join('\n')
  : '  No correlation flags.'}

---

## 5. EARNINGS AT-RISK (open positions)
${ctx.earningsAtRisk.length > 0
  ? ctx.earningsAtRisk.map(e => `  ${e.ticker}: ${e.risk_level} — earnings in ${e.days_until} days (${e.earnings_date})`).join('\n')
  : '  No earnings at-risk in open positions.'}

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
      spyCurrent:   ctx.spyCurrent,
      spyCumulativePct: ctx.spyCumulativePct,
    }
  }
}];

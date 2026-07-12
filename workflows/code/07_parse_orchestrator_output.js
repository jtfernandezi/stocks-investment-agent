// Node: Parse Orchestrator Output
// Position: After Call Orchestrator LLM (native OpenAI node v2.1)
// Input: 1 item — output[0].content[0].text contains the JSON string
// Output: 1 item with all parsed orchestrator decisions + trade action items

const rawResponse   = $input.first().json;
const orchInput     = $("Build Orchestrator Input").first().json;

// ── PARSE OPENAI RESPONSE ─────────────────────────────────────────────────────
let parsed   = null;
let rawText  = '';

try {
  rawText = rawResponse.output?.[0]?.content?.[0]?.text;  // native OpenAI node v2.1 output
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    parsed = JSON.parse(cleaned);
  } catch (strictErr) {
    // GPT-5.1 occasionally emits an invalid escape inside a JSON string (e.g. "\$28k"
    // in the 2026-07-10 watchdog run) — one bad character otherwise discards the whole
    // session's actions via the fallback below. Walk escapes left-to-right: a valid
    // escape pair is kept as-is, a lone backslash (which can never occur in valid JSON)
    // is dropped. Consuming valid pairs first means an escaped backslash followed by a
    // letter ("\\s") is never mangled, so strictly-valid output is unchanged.
    parsed = JSON.parse(cleaned.replace(/\\(["\\/bfnrtu])|\\/g, (m, esc) => esc ? m : ''));
  }
} catch (err) {
  // Fallback: empty decisions, nothing trades
  parsed = {
    is_market_open:          false,
    portfolio_actions:        [],
    portfolio_review:         [],
    watchlist:                [],
    cash_deployment_rationale: `Parse error: ${err.message}`,
    orchestrator_summary:     'Orchestrator output could not be parsed this session.',
  };
}

// ── ENRICH TRADE ACTIONS WITH ALPACA ORDER PAYLOADS ──────────────────────────
// Each action needs:
//   1. A market order payload  (for node 30)
//   2. A trailing stop payload (for node 32a, only for BUY and SHORT)

const state    = orchInput.portfolio_state;
const priceMap = state.priceMap;

// ── PRICE-BASED ENTRY TAXONOMY ────────────────────────────────────────────────
// Classifies every BUY/SHORT by its measurable entry conditions, replacing the
// signal-history labels (TREND/BIAS/...) as the stored trades.entry_pattern.
// Those labels measured specialist-opinion persistence over ~1.7 days (5 sessions
// at 3/day) — near-automatic given the signal-consistency instruction, so TREND
// absorbed 68% of all trades and pattern-EV feedback learned nothing. These labels
// measure WHERE in the move the fund entered, which the 2026-07-03 trade audit
// showed is what actually separated winners from losers. Buckets (direction-aware,
// ext = % above/below 20d SMA, sign flipped for shorts so + = chasing):
//   EXTENDED      favorable ext > +5%   — chasing (08's gate blocks these; label covers fallbacks)
//   CAPITULATION  favorable ext < -5%   — knife-catch long / squeeze-bait short
//   PULLBACK      favorable ext ≤ +2%, price on the right side of the 50d MA — retracement within a trend
//   COUNTER_TREND favorable ext ≤ +2%, wrong side of the 50d MA — fighting the larger trend
//   BREAKOUT      favorable ext +2..5% on ≥1.5x average volume — fresh move with participation
//   MOMENTUM      favorable ext +2..5% on normal volume — mid-move entry, unconfirmed
function entryQualityPattern(action, p) {
  if (!p || p.ext_20d_pct == null) return 'UNCLASSIFIED';
  const isBuy  = action.action === 'BUY';
  const dirExt = isBuy ? p.ext_20d_pct : -p.ext_20d_pct;
  const withTrend = p.sma50 != null
    ? (isBuy ? p.current >= p.sma50 : p.current <= p.sma50)
    : true;
  if (dirExt >  5) return 'EXTENDED';
  if (dirExt < -5) return 'CAPITULATION';
  if (dirExt <= 2) return withTrend ? 'PULLBACK' : 'COUNTER_TREND';
  return (p.adv_ratio != null && p.adv_ratio >= 1.5) ? 'BREAKOUT' : 'MOMENTUM';
}

const enrichedActions = (parsed.portfolio_actions || []).map(action => {
  const ticker    = action.ticker;
  const price     = priceMap[ticker] ? priceMap[ticker].current : null;
  // Enforce the swing-appropriate stop band [8%, 20%] regardless of the orchestrator's
  // chosen stop — a 2–6 week hold must not carry a day-trader's tight stop that gets
  // whipsawed out on normal volatility.
  const rawStop   = action.stop_loss_pct || (priceMap[ticker] ? priceMap[ticker].trail_pct : 10);
  const stopPct   = Math.min(20, Math.max(8, rawStop));

  // For SELL/COVER: use actual Alpaca position qty to guarantee full close.
  // For BUY/SHORT: calculate from size_usd + live price (LLM's share count uses stale prices).
  let shares = null;
  const position = (state.positions || []).find(p => p.symbol === ticker);
  if (action.action === 'SELL' || action.action === 'COVER') {
    if (position) {
      shares = Math.abs(parseFloat(position.qty));
    } else if (price && action.size_usd) {
      shares = Math.floor(action.size_usd / price * 100) / 100;
    }
  } else {
    if (price && action.size_usd) {
      shares = Math.floor(action.size_usd / price);  // whole shares only — trailing stop GTC orders reject fractionals
    } else if (action.shares) {
      shares = action.shares;  // last resort: use LLM value only when price is unavailable
    }
  }

  // Market order payload for Alpaca
  let orderSide, orderEffect;
  if (action.action === 'BUY') {
    orderSide = 'buy'; orderEffect = null;
  } else if (action.action === 'SELL') {
    orderSide = 'sell'; orderEffect = null;
  } else if (action.action === 'SHORT') {
    orderSide = 'sell'; orderEffect = null;  // Alpaca auto-detects short when no position exists
  } else if (action.action === 'COVER') {
    orderSide = 'buy'; orderEffect = null;
  }

  const marketOrderPayload = {
    symbol:         ticker,
    qty:            shares ? shares.toString() : null,
    notional:       shares ? null : action.size_usd.toString(),  // use notional if shares not computed
    side:           orderSide,
    type:           'market',
    time_in_force:  'day',
    extended_hours: false,
  };
  // Clean nulls
  if (marketOrderPayload.qty)      delete marketOrderPayload.notional;
  if (!marketOrderPayload.qty)     delete marketOrderPayload.qty;
  if (!marketOrderPayload.notional) delete marketOrderPayload.notional;

  // Trailing stop payload (only for BUY / SHORT)
  const trailStopPayload = (action.action === 'BUY' || action.action === 'SHORT') ? {
    symbol:         ticker,
    qty:            shares ? shares.toString() : action.size_usd.toString(),
    side:           action.action === 'BUY' ? 'sell' : 'buy',  // opposite side
    type:           'trailing_stop',
    trail_percent:  stopPct.toString(),
    time_in_force:  'gtc',
  } : null;

  return {
    ...action,
    shares:               shares,
    estimated_price:      price,
    stop_pct_used:        stopPct,
    needs_trailing_stop:  action.action === 'BUY' || action.action === 'SHORT',
    order_payload:        marketOrderPayload,
    trail_stop_payload:   trailStopPayload,
    // Stored as trades.entry_pattern / position_metadata.signal_history_pattern by
    // Prepare Position Metadata (which prefers this field over signal_history_pattern).
    entry_quality_pattern: (action.action === 'BUY' || action.action === 'SHORT')
      ? entryQualityPattern(action, priceMap[ticker])
      : null,
  };
});

// ── SEPARATE SELL/COVER FOR POST-MORTEM ──────────────────────────────────────
const closedPositions = enrichedActions.filter(a => a.action === 'SELL' || a.action === 'COVER');
const openingActions  = enrichedActions.filter(a => a.action === 'BUY'  || a.action === 'SHORT');

// For each closed position, build the post-mortem webhook payload
const exitDate = orchInput.portfolio_state.session_id.split('_')[0];
const postMortemPayloads = closedPositions.map(action => {
  const ticker   = action.ticker;
  const position = (state.positions || []).find(p => p.symbol === ticker);

  // Approximate entry date as 30 days before exit — we don't track open date in DB yet.
  // This ensures Load Signals During Hold gets a valid date (not null → SQL error).
  const entryDate = new Date(new Date(exitDate).getTime() - 30 * 86400000)
                      .toISOString().split('T')[0];

  // Derive side from the live Alpaca position, not the SELL/COVER verb. The orchestrator
  // sometimes issues SELL to close a short (execution treats SELL/COVER identically —
  // both route to DELETE /positions), which previously made this infer LONG for a short
  // close and inverted the post-mortem P&L sign (e.g. OKLO 2026-07-01: a profitable short
  // was recorded as a losing long). Alpaca's position.side is ground truth; only fall back
  // to the verb if the position already vanished before this ran (shouldn't happen in
  // practice — SELL/COVER always resolves against a still-open position here).
  const closedDirection = position ? position.side : (action.action === 'SELL' ? 'long' : 'short');

  return {
    ticker,
    niche:                       action.niche,
    side:                        closedDirection === 'long' ? 'LONG' : 'SHORT',
    direction:                   closedDirection,
    action:                      action.action,
    exit_reason:                 action.exit_reason,
    exit_price:                  priceMap[ticker] ? priceMap[ticker].current : null,
    entry_price:                 position ? parseFloat(position.avg_entry_price) : null,
    entry_date:                  entryDate,
    exit_date:                   exitDate,
    session_id:                  orchInput.portfolio_state.session_id,
    signal_history_pattern:      action.signal_history_pattern      || null,
    thesis:                      action.thesis                      || null,
    size_usd:                    action.size_usd                    || null,
    entry_specialist_confidence: action.confidence                  || null,
    entry_effective_confidence:  action.effective_confidence        || null,
    qty:                         action.shares                      || null,
    size_usd:                    action.size_usd                    || null,
    specialists_at_exit:         orchInput.specialists_summary,
  };
});

// ── DERIVE MARKET OPEN FROM REAL MARKET STATUS (not LLM judgment) ────────────
// The LLM self-reports is_market_open with no real data to ground it in, and
// has been seen hallucinating false on the close session — apparently reading
// session_type: "close" as "market is closed" rather than "this is the 3:50 PM
// pre-close session" (market is open until 4:00 PM ET). A prior version of this
// fix made the same mistake in code: it hardcoded close-session = market closed,
// silently wiping every close-session trade action (e.g. a 2026-06-16 DDOG SELL
// that the orchestrator correctly decided on but never executed) regardless of
// actual hours. Ground truth instead: by construction, this node only runs when
// the market is already confirmed open — the scheduled trigger gates on
// `Is Market Open? (Start)` before reaching here, and the watchdog trigger
// enters at `Set Session`, skipping `Fetch Market Status` entirely, only after
// the watchdog has already verified market hours itself.
let isMarketOpen = true;
try {
  isMarketOpen = $("Fetch Market Status").first().json.isOpen === true;
} catch (_) {
  // Watchdog-triggered run — Fetch Market Status didn't execute this run because
  // the watchdog already verified market hours before triggering this workflow.
}

// ── DERIVE ORCHESTRATOR SESSION TYPE FOR STORAGE ─────────────────────────────
// session_id carries '_watchdog' suffix for watchdog-triggered runs.
// Use 'watchdog_flip' label in orchestrator_sessions table so they're
// distinguishable from same-slot scheduled runs when loading context.
const rawSessionId       = (orchInput.portfolio_state.session_id || '');
const orchestratorSessionType = rawSessionId.endsWith('_watchdog')
  ? 'watchdog_flip'
  : (orchInput.session_type || 'unknown');

// ── OUTPUT ────────────────────────────────────────────────────────────────────
return [{
  json: {
    // Core orchestrator decisions
    is_market_open:            isMarketOpen,
    portfolio_actions:         enrichedActions,
    portfolio_review:          parsed.portfolio_review         || [],
    watchlist:                 parsed.watchlist                 || [],
    rejected_candidates:       parsed.rejected_candidates      || [],
    risk_summary:              parsed.risk_summary             || null,
    cash_deployment_rationale: parsed.cash_deployment_rationale || '',
    orchestrator_summary:      parsed.orchestrator_summary      || '',

    // Derived
    closing_positions:  closedPositions,
    opening_positions:  openingActions,
    post_mortem_payloads: postMortemPayloads,
    open_positions:     state.positions || [],  // Alpaca positions list (used by 09 for long/short split)

    // For Neon snapshot
    session_id:              orchInput.portfolio_state.session_id,
    session_type:            orchInput.session_type,
    orchestrator_session_type: orchestratorSessionType,
    account:      orchInput.portfolio_state.account,
    spyCurrent:       orchInput.portfolio_state.spyCurrent,
    spyCumulativePct: orchInput.portfolio_state.spyCumulativePct,
    prevSpyPrice:     orchInput.portfolio_state.prevSpyPrice,

    // Raw for debugging
    raw_orchestrator_response: (rawText || '').substring(0, 5000),
    usage_tokens: rawResponse.usage ? rawResponse.usage.total_tokens : null,
  }
}];

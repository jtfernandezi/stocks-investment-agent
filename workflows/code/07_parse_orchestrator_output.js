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
  parsed = JSON.parse(cleaned);
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

const enrichedActions = (parsed.portfolio_actions || []).map(action => {
  const ticker    = action.ticker;
  const price     = priceMap[ticker] ? priceMap[ticker].current : null;
  const stopPct   = action.stop_loss_pct || (priceMap[ticker] ? priceMap[ticker].trail_pct : 8);

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
      shares = Math.floor(action.size_usd / price * 100) / 100;  // round down to 2 decimals
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

  return {
    ticker,
    niche:                       action.niche,
    side:                        action.action === 'SELL' ? 'LONG' : 'SHORT',
    direction:                   action.action === 'SELL' ? 'long' : 'short',
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
    specialists_at_exit:         orchInput.specialists_summary,
  };
});

// ── DERIVE MARKET OPEN FROM SESSION TYPE (not LLM judgment) ──────────────────
// The LLM doesn't reliably know what morning/midday/close map to in ET.
// Market is open for morning (9:30 AM ET) and midday (12:00 PM ET) sessions.
// Close (3:50 PM ET) is after regular hours — no new orders.
const isMarketOpen = orchInput.session_type === 'morning' || orchInput.session_type === 'midday';

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
    spyCurrent:   orchInput.portfolio_state.spyCurrent,
    spyCumulativePct: orchInput.portfolio_state.spyCumulativePct,

    // Raw for debugging
    raw_orchestrator_response: (rawText || '').substring(0, 5000),
    usage_tokens: rawResponse.usage ? rawResponse.usage.total_tokens : null,
  }
}];

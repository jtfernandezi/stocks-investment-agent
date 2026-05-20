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

  // Always recalculate shares from actual current price — LLM often assumes a stale price
  // and its share count can be way off. Ignore action.shares entirely.
  let shares = null;
  if (price && action.size_usd) {
    shares = Math.floor(action.size_usd / price * 100) / 100;  // round down to 2 decimals
  } else if (action.shares) {
    shares = action.shares;  // last resort: use LLM value only when price is unavailable
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
    order_payload:        JSON.stringify(marketOrderPayload),
    trail_stop_payload:   trailStopPayload ? JSON.stringify(trailStopPayload) : null,
  };
});

// ── SEPARATE SELL/COVER FOR POST-MORTEM ──────────────────────────────────────
const closedPositions = enrichedActions.filter(a => a.action === 'SELL' || a.action === 'COVER');
const openingActions  = enrichedActions.filter(a => a.action === 'BUY'  || a.action === 'SHORT');

// For each closed position, build the post-mortem webhook payload
const postMortemPayloads = closedPositions.map(action => {
  const ticker   = action.ticker;
  const position = (state.positions || []).find(p => p.symbol === ticker);

  return {
    ticker,
    niche:        action.niche,
    direction:    action.action === 'SELL' ? 'long' : 'short',
    action:       action.action,
    exit_reason:  action.exit_reason,
    exit_price:   priceMap[ticker] ? priceMap[ticker].current : null,
    entry_price:  position ? parseFloat(position.avg_entry_price) : null,
    entry_date:   null,  // would need to track this in Neon (add to positions tracking)
    exit_date:    orchInput.portfolio_state.session_id.split('_')[0],
    session_id:   orchInput.portfolio_state.session_id,
    // Include for post-mortem context:
    specialists_at_exit: orchInput.specialists_summary,
  };
});

// ── OUTPUT ────────────────────────────────────────────────────────────────────
return [{
  json: {
    // Core orchestrator decisions
    is_market_open:            parsed.is_market_open === true,
    portfolio_actions:         enrichedActions,
    portfolio_review:          parsed.portfolio_review         || [],
    watchlist:                 parsed.watchlist                 || [],
    cash_deployment_rationale: parsed.cash_deployment_rationale || '',
    orchestrator_summary:      parsed.orchestrator_summary      || '',

    // Derived
    closing_positions:  closedPositions,
    opening_positions:  openingActions,
    post_mortem_payloads: postMortemPayloads,

    // For Neon snapshot
    session_id:   orchInput.portfolio_state.session_id,
    session_type: orchInput.session_type,
    account:      orchInput.portfolio_state.account,
    spyCurrent:   orchInput.portfolio_state.spyCurrent,
    spyCumulativePct: orchInput.portfolio_state.spyCumulativePct,

    // Raw for debugging
    raw_orchestrator_response: (rawText || '').substring(0, 5000),
    usage_tokens: rawResponse.usage ? rawResponse.usage.total_tokens : null,
  }
}];

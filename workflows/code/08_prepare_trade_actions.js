// Node: Prepare Trade Actions
// Position: After IF "Is Market Open?" (TRUE branch)
// Input: orchestrator output (1 item)
// Output: N items — one per portfolio_action that should execute
// Each item is passed through the HTTP Request node that submits the Alpaca order.

const orch = $input.first().json;

if (!orch.is_market_open) {
  // Safety check — should not reach here given the IF node, but guard anyway
  return [];
}

const actions = orch.portfolio_actions || [];

if (actions.length === 0) {
  return [];
}

// For SELL/COVER: find the GTC trailing stop order to cancel before closing.
// Cancelling the stop first unlocks shares so DELETE /v2/positions works.
const openOrders = $("Compute Derived Metrics").first().json.openOrders || [];

// Cash guard: skip BUY/SHORT orders that exceed available cash.
// SELL/COVER always go through — they free cash rather than consume it.
let remainingCash = parseFloat(orch.account?.cash || 0);
const filteredActions = actions.filter(action => {
  if (action.action === 'SELL' || action.action === 'COVER') return true;
  const cost = action.size_usd || 0;
  if (cost <= remainingCash) {
    remainingCash -= cost;
    return true;
  }
  return false; // insufficient cash — skip this order
});

// Output one item per action. Each item carries everything the Alpaca HTTP Request needs.
return filteredActions.map(action => {
  // Look up the stop order ID for SELL/COVER so Cancel Stop Before Close can cancel it
  let stop_order_id = null;
  if (action.action === 'SELL' || action.action === 'COVER') {
    const stopOrder = openOrders.find(o =>
      o.symbol === action.ticker &&
      o.type === 'trailing_stop' &&
      ['new', 'accepted', 'pending_new'].includes(o.status)
    );
    stop_order_id = stopOrder?.id || null;
  }

  return {
    json: {
      // Trade identity
      action:          action.action,    // BUY | SELL | SHORT | COVER
      ticker:          action.ticker,
      niche:           action.niche,
      session_id:      orch.session_id,

      // Alpaca order payloads (pre-built in node 07)
      order_payload:       action.order_payload,
      trail_stop_payload:  action.trail_stop_payload,
      needs_trailing_stop: action.needs_trailing_stop,

      // For SELL/COVER: stop order to cancel before closing position
      stop_order_id,

      // For post-trade logging
      size_usd:             action.size_usd,
      shares:               action.shares,
      estimated_price:      action.estimated_price,
      conviction:           action.conviction,
      effective_confidence: action.effective_confidence,
      stop_pct_used:        action.stop_pct_used,
      thesis:               action.thesis,
      exit_reason:          action.exit_reason || null,
      signal_history_pattern: action.signal_history_pattern,
      size_adjustments_applied: action.size_adjustments_applied || [],
      feedback_note:        action.feedback_note || null,
    }
  };
});

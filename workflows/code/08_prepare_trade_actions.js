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
  // No trades this session — return a no-op item so downstream nodes don't stall
  return [{
    json: {
      no_trades:   true,
      session_id:  orch.session_id,
      reason:      orch.cash_deployment_rationale || 'No actionable signals this session.',
    }
  }];
}

// Output one item per action. Each item carries everything the Alpaca HTTP Request needs.
return actions.map(action => ({
  json: {
    // Trade identity
    action:          action.action,    // BUY | SELL | SHORT | COVER
    ticker:          action.ticker,
    niche:           action.niche,
    session_id:      orch.session_id,

    // Alpaca order payloads (pre-built in node 07)
    order_payload:       action.order_payload,       // JSON string for market order body
    trail_stop_payload:  action.trail_stop_payload,  // JSON string for trailing stop (null if not needed)
    needs_trailing_stop: action.needs_trailing_stop,

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
}));

// Node: Process Post-Trade
// Position: After Merge (trade execution branches reconverge)
// Builds the portfolio snapshot payload for Neon and collects
// post-mortem webhook payloads for SELL/COVER actions.
// Output: 1 item with all data needed for the two final Neon writes.

const orch     = $("Parse Orchestrator Output").first().json;
const account  = orch.account || {};

// Compute long/short breakdown from executed positions
// At this point the trades have fired — we'd need to re-fetch the portfolio.
// For now, use the orchestrator's account snapshot (close enough for this session).
const longValue  = Math.abs(parseFloat(account.long_market_value  || 0));
const shortValue = Math.abs(parseFloat(account.short_market_value || 0));
// account.unrealized_pl is passed from Alpaca via 02_compute_derived_metrics (total unrealized P&L across all positions)
const unrealPnl  = parseFloat(account.unrealized_pl || 0);

// Build positions JSON for snapshot (current state before trades fully settle)
// Separate longs and shorts using actual Alpaca position qty (qty < 0 = short)
const shortTickers = new Set(
  (orch.open_positions || []).filter(p => parseFloat(p.qty) < 0).map(p => p.symbol)
);
const allReviews = (orch.portfolio_review || []).map(p => ({
  ticker:          p.ticker,
  side:            shortTickers.has(p.ticker) ? 'short' : 'long',
  action:          p.current_action,
  thesis_intact:   p.thesis_intact,
  earnings_risk:   p.earnings_risk,
  stop_proximity:  p.stop_proximity,
}));

// Escape single quotes for SQL string interpolation ('' is PostgreSQL's escape for ')
const sqlEsc = s => (s || '').replace(/'/g, "''");

// Snapshot row for Neon
const snapshotPayload = {
  session:             orch.session_id,
  portfolio_value_usd: parseFloat(account.portfolio_value),
  cash_usd:            parseFloat(account.cash),
  long_value_usd:      longValue,
  short_value_usd:     shortValue,
  unrealized_pnl_usd:  unrealPnl,
  spy_price:           orch.spyCurrent || null,
  spy_return_pct:      (orch.spyCurrent && orch.prevSpyPrice && orch.prevSpyPrice > 0)
    ? parseFloat(((orch.spyCurrent - orch.prevSpyPrice) / orch.prevSpyPrice * 100).toFixed(4))
    : null,
  spy_cumulative_pct:  orch.spyCumulativePct || 0,
  positions_json:      sqlEsc(JSON.stringify(allReviews)),
  raw_json:            sqlEsc(JSON.stringify({
    portfolio_actions:         orch.portfolio_actions,
    cash_deployment_rationale: orch.cash_deployment_rationale,
  })),
};

// New watchlist items (replace entire watchlist each session)
const newWatchlist = (orch.watchlist || []).map(w => ({
  ticker:            w.ticker,
  niche:             w.niche,
  direction:         w.direction,
  reason:            w.reason || '',
  trigger_condition: w.trigger || '',
  session_id:        orch.session_id,
}));

// Post-mortem payloads (one per SELL/COVER)
// These are sent as webhook calls to the post-mortem workflow.
const postMortemPayloads = (orch.post_mortem_payloads || []).map(pm => ({
  ...pm,
  orchestrator_summary: orch.orchestrator_summary,
}));

return [{
  json: {
    snapshot:              snapshotPayload,
    watchlist:             newWatchlist,
    post_mortem_payloads:  postMortemPayloads,
    has_post_mortems:      postMortemPayloads.length > 0,
    session_id:            orch.session_id,
  }
}];

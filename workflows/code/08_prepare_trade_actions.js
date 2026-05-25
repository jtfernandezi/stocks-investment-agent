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

// ── HARD LIMIT ENFORCEMENT ────────────────────────────────────────────────────
// These limits are enforced in code regardless of what the orchestrator outputs.
// SELL/COVER always pass through — they reduce exposure, never add it.

const MAX_POSITIONS    = 12;
const MAX_SHORT_USD    = 12000;
const MAX_PER_SECTOR   = { long: 1, short: 1 }; // 1 long + 1 short max per niche

// Build current state from open positions (pre-trade snapshot)
const currentPositions = $("Compute Derived Metrics").first().json.positions || [];
let openCount    = currentPositions.length;
let shortExposure = currentPositions
  .filter(p => parseFloat(p.qty) < 0)
  .reduce((sum, p) => sum + Math.abs(parseFloat(p.market_value)), 0);

// Count current longs and shorts per niche
const nicheCount = {};
for (const p of currentPositions) {
  const niche = $("Compute Derived Metrics").first().json.priceMap
    ? null  // niche not in positions directly; use action.niche from orchestrator
    : null;
  // We'll track niche counts from the positions via symbol→niche mapping below
}

// Build niche→{long,short} count from current positions using orchestrator's niche field
// We use the portfolio_review entries which list ticker+niche context, or fall back to
// matching tickers against the orchestrator's portfolio_actions context.
// Simplest reliable approach: parse niche from the open positions using the TICKER_NICHE
// constant embedded here (mirrors lib/constants.ts).
const TICKER_NICHE = {
  CRWD:'cybersecurity',PANW:'cybersecurity',ZS:'cybersecurity',OKTA:'cybersecurity',
  FTNT:'cybersecurity',S:'cybersecurity',CYBR:'cybersecurity',TMUS:'cybersecurity',
  QLYS:'cybersecurity',TENB:'cybersecurity',
  LMT:'defense',RTX:'defense',NOC:'defense',GD:'defense',HII:'defense',
  LHX:'defense',KTOS:'defense',RCAT:'defense',PLTR:'defense',AXON:'defense',
  CCJ:'nuclear_uranium',UEC:'nuclear_uranium',NXE:'nuclear_uranium',DNN:'nuclear_uranium',
  SMR:'nuclear_uranium',OKLO:'nuclear_uranium',CEG:'nuclear_uranium',VST:'nuclear_uranium',
  ETR:'nuclear_uranium',NEE:'nuclear_uranium',
  FCX:'copper_minerals',SCCO:'copper_minerals',TECK:'copper_minerals',HBM:'copper_minerals',
  VALE:'copper_minerals',MP:'copper_minerals',LTHM:'copper_minerals',ALB:'copper_minerals',
  SQM:'copper_minerals',LAC:'copper_minerals',
  NVDA:'ai_semiconductors',AMD:'ai_semiconductors',AVGO:'ai_semiconductors',
  QCOM:'ai_semiconductors',MRVL:'ai_semiconductors',AMAT:'ai_semiconductors',
  KLAC:'ai_semiconductors',LRCX:'ai_semiconductors',MU:'ai_semiconductors',ARM:'ai_semiconductors',
  MSFT:'cloud_hyperscalers',AMZN:'cloud_hyperscalers',GOOGL:'cloud_hyperscalers',
  META:'cloud_hyperscalers',ORCL:'cloud_hyperscalers',SNOW:'cloud_hyperscalers',
  MDB:'cloud_hyperscalers',DDOG:'cloud_hyperscalers',NET:'cloud_hyperscalers',CRM:'cloud_hyperscalers',
  XOM:'oil_gas',CVX:'oil_gas',COP:'oil_gas',SLB:'oil_gas',HAL:'oil_gas',
  MPC:'oil_gas',PSX:'oil_gas',VLO:'oil_gas',OXY:'oil_gas',EOG:'oil_gas',
  EQIX:'data_centers',DLR:'data_centers',AMT:'data_centers',IREN:'data_centers',
  CORZ:'data_centers',VRT:'data_centers',SMCI:'data_centers',DELL:'data_centers',
  HPE:'data_centers',WDC:'data_centers',
};

const nicheExposure = {}; // niche → { long: count, short: count }
for (const p of currentPositions) {
  const niche = TICKER_NICHE[p.symbol];
  if (!niche) continue;
  if (!nicheExposure[niche]) nicheExposure[niche] = { long: 0, short: 0 };
  const side = parseFloat(p.qty) >= 0 ? 'long' : 'short';
  nicheExposure[niche][side]++;
}

// Cash guard + hard limits: filter each action
let remainingCash = parseFloat(orch.account?.cash || 0);
const filteredActions = actions.filter(action => {
  // SELL/COVER always pass — they reduce exposure
  if (action.action === 'SELL' || action.action === 'COVER') return true;

  const isBuy   = action.action === 'BUY';
  const isShort = action.action === 'SHORT';
  const niche   = action.niche;
  const side    = isBuy ? 'long' : 'short';
  const cost    = action.size_usd || 0;

  // 1. Max positions cap
  if (openCount >= MAX_POSITIONS) {
    console.log(`[LIMIT] Skipping ${action.action} ${action.ticker}: max ${MAX_POSITIONS} positions reached (${openCount} open)`);
    return false;
  }

  // 2. Max per sector: 1 long + 1 short
  const nicheCounts = nicheExposure[niche] || { long: 0, short: 0 };
  if (nicheCounts[side] >= MAX_PER_SECTOR[side]) {
    console.log(`[LIMIT] Skipping ${action.action} ${action.ticker}: ${niche} already has ${nicheCounts[side]} ${side}(s) (max ${MAX_PER_SECTOR[side]})`);
    return false;
  }

  // 3. Max short exposure cap
  if (isShort && (shortExposure + cost) > MAX_SHORT_USD) {
    console.log(`[LIMIT] Skipping SHORT ${action.ticker}: would push short exposure to $${(shortExposure + cost).toFixed(0)} (max $${MAX_SHORT_USD})`);
    return false;
  }

  // 4. Cash guard
  if (cost > remainingCash) {
    console.log(`[LIMIT] Skipping ${action.action} ${action.ticker}: insufficient cash ($${remainingCash.toFixed(0)} < $${cost})`);
    return false;
  }

  // Action passes — update running counters
  remainingCash -= cost;
  openCount++;
  if (!nicheExposure[niche]) nicheExposure[niche] = { long: 0, short: 0 };
  nicheExposure[niche][side]++;
  if (isShort) shortExposure += cost;

  return true;
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

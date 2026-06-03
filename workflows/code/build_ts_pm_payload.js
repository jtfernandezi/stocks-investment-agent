// Node: Build TS PM Payload (Watchdog)
// Combines Alpaca closed-order data with entry context from Find TS Exits.
// Uses item pairing ($('Find TS Exits').item) to match entry metadata to this ticker.
// Output: Post-Mortem trigger payload (same shape as orchestrator SELL/COVER path).

const tsInfo = $('Find TS Exits').item.json;
const { ticker, side, entry_date, entry_price, niche, signal_history_pattern, thesis } = tsInfo;

// Fetch TS Order splits the JSON array — each order arrives as its own item.
// Collect all items for this execution to reconstruct the orders list.
const orders = $input.all().map(i => i.json);

// Find the most recent filled trailing stop order for this ticker
const isLong = (side === 'LONG' || side === 'long');
const relevantSide = isLong ? 'sell' : 'buy';

const tsOrder = orders
  .filter(o =>
    o.type === 'trailing_stop' &&
    o.status === 'filled' &&
    o.side === relevantSide &&
    o.symbol === ticker
  )
  .sort((a, b) => new Date(b.filled_at) - new Date(a.filled_at))[0];

// No matching trailing stop order found — skip this ticker
if (!tsOrder) return [];

const entryPriceFloat = parseFloat(entry_price) || 0;
const exitPrice       = parseFloat(tsOrder.filled_avg_price) || 0;
const exitDate        = tsOrder.filled_at ? tsOrder.filled_at.split('T')[0] : new Date().toISOString().split('T')[0];
const sharesQty       = parseFloat(tsOrder.filled_qty) || 0;

const pnlPerShare = isLong ? (exitPrice - entryPriceFloat) : (entryPriceFloat - exitPrice);
const pnlUsd      = Math.round(pnlPerShare * sharesQty * 100) / 100;
const pnlPct      = entryPriceFloat > 0
  ? Math.round((pnlPerShare / entryPriceFloat) * 10000) / 100
  : 0;
const sizeUsd     = Math.round(entryPriceFloat * sharesQty * 100) / 100;

return [{
  json: {
    ticker,
    niche,
    action:    isLong ? 'SELL' : 'COVER',
    side:      isLong ? 'LONG' : 'SHORT',
    direction: isLong ? 'long' : 'short',
    entry_date:  entry_date ? entry_date.toString().substring(0, 10) : null,
    entry_price: entryPriceFloat,
    exit_price:  exitPrice,
    exit_date:   exitDate,
    pnl_usd:     pnlUsd,
    pnl_pct:     pnlPct,
    size_usd:    sizeUsd,
    exit_reason: 'trailing_stop',
    signal_history_pattern: signal_history_pattern || 'FIRST_SIGNAL',
    thesis:                 thesis || null,
    entry_specialist_confidence: tsInfo.entry_specialist_confidence ?? null,
    entry_effective_confidence:  tsInfo.entry_effective_confidence  ?? null,
    qty: sharesQty || null,
  }
}];

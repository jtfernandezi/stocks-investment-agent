// Node: Find TS Exits (Watchdog)
// Detects positions closed by Alpaca trailing stops between sessions.
// Compares all bot-opened positions in position_metadata against live Alpaca positions.
// Runs as a parallel branch from Fetch Alpaca Positions (via Load All Position Metadata).
// Output: one item per disappeared ticker, with entry context for post-mortem.

const metadataItems = $input.all(); // rows from Load All Position Metadata
if (metadataItems.length === 0) return [];

// Build qty map: ticker → abs qty currently held in Alpaca
const alpacaQtyMap = {};
for (const item of $('Fetch Alpaca Positions').all()) {
  const { symbol, qty } = item.json;
  if (symbol) alpacaQtyMap[symbol] = Math.abs(parseFloat(qty) || 0);
}

// Detect exits: ticker gone from Alpaca OR qty < 1 (trailing stop rounding stub,
// e.g. 468.6 shares bought, 468 sold by stop, 0.6 remain)
const exits = [];
for (const item of metadataItems) {
  const { ticker, side, entry_date, entry_price, niche, signal_history_pattern, thesis } = item.json;
  if (!ticker) continue;
  const currentQty = alpacaQtyMap.hasOwnProperty(ticker) ? alpacaQtyMap[ticker] : -1;
  if (currentQty < 1) {
    exits.push({ json: { ticker, side, entry_date, entry_price, niche, signal_history_pattern, thesis } });
  }
}

return exits;

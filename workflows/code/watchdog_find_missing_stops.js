// Node: Find Missing Stops (Watchdog)
// Self-heal safety net for the recurring Wait-For-Fill trailing-stop race
// (06-22 C/VRT, 07-09/10 NOC/NXPI/PLTR, 07-22/23 DDOG/PANW/SNOW, 07-24 FCX/HAL
// — every prior occurrence was patched by hand after the fact). Every
// Watchdog tick, compares live Alpaca positions against live Alpaca open
// orders and flags any position with no matching trailing_stop order.
//
// Runs downstream of "Fetch Alpaca Open Orders (Self-Heal)", which has
// alwaysOutputData:true so this still executes even when Alpaca returns
// zero open orders — the exact scenario this exists to catch (a freshly
// filled batch with no stops attached yet would otherwise emit zero items
// and silently skip this whole branch).

const positions = $("Has Open Positions?").first().json.raw_positions || [];
const orderItems = $input.all().map(i => i.json).filter(o => o && o.symbol);

const protectedSymbols = new Set(
  orderItems.filter(o => o.type === 'trailing_stop').map(o => o.symbol)
);

const missing = positions
  .filter(p => !protectedSymbols.has(p.symbol))
  .map(p => ({
    ticker: p.symbol,
    side: p.side, // 'long' | 'short'
    qty: Math.abs(parseFloat(p.qty)),
  }));

return [{ json: { missing_count: missing.length, missing } }];

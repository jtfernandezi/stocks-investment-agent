# Workflow 2 — Watchdog Blueprint

Runs every 30 minutes, Monday–Friday, market hours only (9:30 AM–4:00 PM ET).
Single responsibility: detect thesis-flip signals and close affected positions.
Trailing stop monitoring is handled entirely by Alpaca — this workflow does NOT check prices.

## Why this is simple

In v1 (ETF project), the watchdog checked high-watermarks and price proximity.
Here, Alpaca handles trailing stops natively. The watchdog only needs to:
1. Load the latest specialist signal per niche
2. Load open positions
3. For each position, check if the specialist has flipped direction
4. If yes → close the position via Alpaca market order
5. If yes → trigger post-mortem webhook

## Node map

```
[1] Schedule Trigger (every 30 min, market hours)
      ↓
[2] Fetch Latest Specialist Signals    (Postgres SELECT — most recent per niche)
      ↓
[3] Fetch Open Positions               (HTTP GET Alpaca /positions)
      ↓
[4] Check Signal Flip                  (Code: watchdog_check.js)
      → outputs: positions to close (can be 0 items)
      ↓
[5] IF: any positions to close?        (IF: items_to_close > 0)
      ↓ TRUE             ↓ FALSE
[6a] Execute Close Order   [6b] No Op (end workflow)
     (HTTP POST Alpaca)
      ↓
[7] Cancel Trailing Stop Order         (HTTP DELETE Alpaca /orders/{order_id})
      ↓
[8] Trigger Post-Mortem                (HTTP POST → post-mortem webhook)
      ↓
[9] Log to Neon (optional)             (Postgres INSERT into a watchdog_events table)
```

## Node configurations

### [1] Schedule Trigger
Cron expressions (EDT, UTC-4):
- `*/30 13-20 * * 1-5` → every 30 min from 9:00 AM to 4:00 PM UTC (5 AM–12 PM ET)

More precisely, limit to market hours:
- `30 13 * * 1-5`  → 9:30 AM ET (market open)
- `0 14 * * 1-5`
- `30 14 * * 1-5`
- ... (one trigger per 30-min slot, 9:30 AM – 4:00 PM ET = 13 triggers)

Or use: `*/30 13-20 * * 1-5` with a Code node that checks exact time and skips if outside 9:30–16:00 ET.

### [2] Fetch Latest Specialist Signals
```sql
SELECT DISTINCT ON (niche)
  niche, direction, conviction, confidence, created_at
FROM stocks.specialist_signals
ORDER BY niche, created_at DESC;
```

### [3] Fetch Open Positions
- GET `https://paper-api.alpaca.markets/v2/positions`

### [6a] Execute Close Order
- POST `https://paper-api.alpaca.markets/v2/orders`
- Body: `{{ $json.close_order_payload }}`

### [7] Cancel Trailing Stop Order
Find and cancel the GTC trailing stop for the closed position:
- GET `/v2/orders?status=open&symbols={{ $json.ticker }}`
- For each trailing stop order found: DELETE `/v2/orders/{{ $json.order_id }}`

Or use Alpaca's close-position shortcut:
- DELETE `https://paper-api.alpaca.markets/v2/positions/{{ $json.ticker }}`
This closes the position AND cancels associated orders in one call.

> Recommendation: use DELETE /v2/positions/{ticker} — it's atomic and simpler.

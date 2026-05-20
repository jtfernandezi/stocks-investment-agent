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
[2] Fetch Latest Signals               (Postgres SELECT — most recent per niche)
      ↓
[3] Fetch Open Positions               (HTTP GET Alpaca /positions)
      ↓
[4] Check Signal Flip                  (Code: watchdog_check.js)
      → outputs: positions to close (or sentinel {no_flips_detected: true})
      ↓
[5] Has Flips?                         (IF: no_flips_detected is NOT true)
      ↓ TRUE             ↓ FALSE
[6] Close Position    [7] No Flips - End
    (HTTP DELETE Alpaca /positions/{ticker})
      ↓
[8] Trigger Post-Mortem                (Execute Workflow — calls Post-Mortem workflow by ID)
```

> **Node naming note**: `watchdog_check.js` references nodes by exact name:
> - `$("Fetch Latest Signals")` → node [2] — must match exactly
> - `$("Fetch Open Positions")` → node [3] — must match exactly
> 
> Node [8] triggers the Post-Mortem workflow via **Execute Workflow** (not HTTP POST). No webhook URL needed.

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

### [2] Fetch Latest Signals
Node name: **`Fetch Latest Signals`** (exact — referenced by `watchdog_check.js`)

```sql
SELECT DISTINCT ON (niche)
  niche, direction, conviction, confidence, created_at
FROM stocks.specialist_signals
ORDER BY niche, created_at DESC;
```

### [3] Fetch Open Positions
Node name: **`Fetch Open Positions`** (exact — referenced by `watchdog_check.js`)
- GET `https://paper-api.alpaca.markets/v2/positions`
- Enable "Full Response" mode: the code handles both `$json.body` (array) and individual items

### [5] Has Flips?
Node name: **`Has Flips?`** (exact)
- IF node
- Condition: `{{ $json.no_flips_detected }}` is not `true`
  (watchdog_check.js returns `{ items_to_close: 0, no_flips_detected: true }` when nothing to close)
- TRUE branch → Close Position
- FALSE branch → No Flips - End

### [6] Close Position
Node name: **`Close Position`**

Use Alpaca's atomic close-position endpoint — closes position AND cancels all associated orders in one call:
- Method: DELETE
- URL: `https://paper-api.alpaca.markets/v2/positions/{{ $json.ticker }}`
- Authentication: Alpaca Trading API credential

### [7] No Flips - End
Node name: **`No Flips - End`** — noOp node, terminates the FALSE branch.

### [8] Trigger Post-Mortem
Node name: **`Trigger Post-Mortem`**
- Node type: **Execute Workflow** (not HTTP Request)
- Calls the Post-Mortem workflow directly by ID
- Passes the full watchdog close context as input

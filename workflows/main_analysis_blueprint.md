# Workflow 1 — Main Analysis v2 Blueprint

Runs 3×/day: 8:30 AM, 12:00 PM, 4:30 PM ET (Monday–Friday).
Also triggered by the Watchdog workflow when a thesis flip is detected.

## Entry points

Two entry points feed into the same pipeline at `Set Session`:

| Trigger | Node type | When used |
|---------|-----------|-----------|
| Schedule Trigger | Cron (3 times/day) | Normal daily sessions |
| When Called by Watchdog | Execute Workflow Trigger | Watchdog detects a thesis flip, orchestrator decides whether to close |

---

## Critical: Node naming

Code nodes reference other nodes by exact name via `$("Node Name")`. Every name below must match exactly — a typo silently breaks the workflow.

| Code file | References node named |
|-----------|----------------------|
| 02_compute_derived_metrics.js | `Set Session`, `Fetch Alpaca Account`, `Fetch Alpaca Positions`, `Fetch Alpaca Open Orders`, `Fetch Price Bars`, `Load Signal History`, `Load Specialist Accuracy`, `Load Pattern Performance`, `Load Trade Lessons`, `Load Watchlist`, `Load Earnings Calendar`, `Load Correlation Matrix`, `Load Portfolio Snapshots`, `Load Fundamentals Cache` |
| build_specialist_message.js (×8) | `Compute Derived Metrics` |
| 06_build_orchestrator_input.js | `Compute Derived Metrics`, `Parse & Save All Signals` |
| 07_parse_orchestrator_output.js | `Build Orchestrator Input` |
| 09_process_post_trade.js | `Parse Orchestrator Output` |
| Build Watchlist SQL (inline Code) | `Process Post-Trade` |
| Prepare PM Items (inline Code) | `Process Post-Trade` |

---

## OpenAI node versions

Two different native OpenAI node versions are used — their output shapes differ. Do NOT swap them.

| Node | Version | Output shape |
|------|---------|-------------|
| Specialist [Niche] × 8 | v1.3 | `{ message: { content: "..." } }` |
| Call Orchestrator LLM | v2.1 | `{ output: [{ content: [{ text: "..." }] }] }` |

---

## Node map

```
[1a] Schedule Trigger (cron 3×/day)
[1b] When Called by Watchdog (Execute Workflow Trigger)
      ↓ (both feed into [2])
[2]  Set Session                        (Code: 01_set_session.js)
      ↓
  ┌──────────────────────────────────────────────────────────────┐
  │  PARALLEL DATA LOADING                                        │
  │  [3]  Fetch Alpaca Account        (HTTP GET /account)         │
  │  [4]  Fetch Alpaca Positions      (HTTP GET /positions)       │
  │  [5]  Fetch Alpaca Open Orders    (HTTP GET /orders)          │
  │                                                               │
  │  [6a] Fetch Bars Cybersecurity    (HTTP GET Alpaca Data)      │
  │  [6b] Fetch Bars Defense          (HTTP GET Alpaca Data)      │
  │  [6c] Fetch Bars Nuclear          (HTTP GET Alpaca Data)      │
  │  [6d] Fetch Bars Copper           (HTTP GET Alpaca Data)      │
  │  [6e] Fetch Bars AI Semis         (HTTP GET Alpaca Data)      │
  │  [6f] Fetch Bars Cloud            (HTTP GET Alpaca Data)      │
  │  [6g] Fetch Bars Oil Gas          (HTTP GET Alpaca Data)      │
  │  [6h] Fetch Bars Data Centers     (HTTP GET Alpaca Data)      │
  │  [6i] Fetch Bars SPY              (HTTP GET Alpaca Data)      │
  │         ↓ (all 9 feed into [6j])                             │
  │  [6j] Merge Price Bars  (Merge node, numberInputs: 9)         │
  │  [6k] Fetch Price Bars  (Code — merges 9 responses into       │
  │                          single {bars: {...}} object)         │
  │                                                               │
  │  [7]  Load Signal History         (Postgres SELECT)           │
  │  [8]  Load Specialist Accuracy    (Postgres SELECT)           │
  │  [9]  Load Pattern Performance    (Postgres SELECT)           │
  │  [10] Load Trade Lessons          (Postgres SELECT)           │
  │  [11] Load Watchlist              (Postgres SELECT)           │
  │  [12] Load Earnings Calendar      (Postgres SELECT)           │
  │  [13] Load Correlation Matrix     (Postgres SELECT)           │
  │  [14] Load Portfolio Snapshots    (Postgres SELECT)           │
  │                                                               │
  │  [15] Is Morning Session?         (IF: session_type=morning)  │
  │    ↓ TRUE                   ↓ FALSE                           │
  │  [16a] Fetch Fundamentals   [16b] Load Fundamentals Cache     │
  │        (Finnhub loop)             (Postgres SELECT)           │
  └──────────────────────────────────────────────────────────────┘
      ↓ (Merge All Data waits for all branches)
[17] Merge All Data                    (Merge node — all parallel branches converge)
      ↓
[18] Compute Derived Metrics           (Code: 02_compute_derived_metrics.js)
      ↓
  ┌──────────────────────────────────────────────────────────────┐
  │  8 PARALLEL SPECIALIST BRANCHES (one per niche)               │
  │                                                               │
  │  Each branch:                                                 │
  │  [A] RSS Feed 1  (HTTP GET — niche-specific RSS URL)          │
  │  [B] RSS Feed 2  (HTTP GET — second source for same niche)    │
  │       ↓ (both feed Merge [Niche] RSS)                        │
  │  [C] Merge [Niche] RSS  (Merge node, numberInputs: 2)         │
  │  [D] Build [Niche] Message  (Code: build_specialist_message.js│
  │       — 3 constants differ per instance: NICHE, NICHE_DISPLAY,│
  │         TICKERS)                                              │
  │  [E] Specialist [Niche]  (Native OpenAI node v1.3)            │
  └──────────────────────────────────────────────────────────────┘
      ↓ (Merge All Signals waits for all 8 branches)
[19] Merge All Signals                 (Merge node, numberInputs: 8)
      ↓
[20] Parse & Save All Signals          (Code: parse_save_all_signals.js)
      → outputs 8 items (one per niche, with parsed signal + effective_confidence)
      ↓ (fans out to both [21] and [22])
[21] Store All Signals                 (Postgres UPSERT — alwaysOutputData: true)
[22] Build Orchestrator Input          (Code: 06_build_orchestrator_input.js)
      → reads 8 items via $("Parse & Save All Signals").all()
      ↓
[23] Call Orchestrator LLM            (Native OpenAI node v2.1 — GPT-5.1)
      ↓
[24] Parse Orchestrator Output         (Code: 07_parse_orchestrator_output.js)
      ↓
[25] Process Post-Trade                (Code: 09_process_post_trade.js)
      ↓
[26] Store Portfolio Snapshot          (Postgres INSERT)
      ↓
[27a] Build Watchlist SQL             (Code inline)
[27b] Execute Watchlist Update        (Postgres — executes SQL from [27a])
      ↓
[28] Is Market Open?                   (IF: session_type is morning or midday)
      ↓ TRUE                   ↓ FALSE
[29] Prepare Trade Actions   [30] Market Closed - End (NoOp)
     (Code: 08_prepare_trade_actions.js)
     → outputs N items (one per action)
      ↓
[31] Execute Market Order              (HTTP POST Alpaca /orders — bodyParameters mode)
      ↓
[32] Needs Trailing Stop?              (IF: needs_trailing_stop == true)
      ↓ TRUE               ↓ FALSE
[33a] Submit Trailing Stop [33b] No Stop Needed (NoOp)
      ↓ (both branches converge)
[34] Has Post-Mortems?                 (IF: has_post_mortems == true)
      ↓ TRUE               ↓ FALSE
[35a] Prepare PM Items     [35b] No PM - End (NoOp)
      (Code inline)
      ↓
[36] Trigger Post-Mortem              (Execute Workflow — calls Post-Mortem workflow)
```

---

## Node configurations

### [1a] Schedule Trigger
- Mode: Cron
- Cron expressions (add all three):
  - `30 12 * * 1-5` → 8:30 AM ET
  - `0 16 * * 1-5`  → 12:00 PM ET
  - `30 20 * * 1-5` → 4:30 PM ET

### [1b] When Called by Watchdog
- Node type: **Execute Workflow Trigger** (`n8n-nodes-base.executeWorkflowTrigger`)
- Receives flip context from the Watchdog workflow
- Connects to `Set Session` — the orchestrator runs with `session_type: 'watchdog_flip'`

---

### [3] Fetch Alpaca Account
- Method: GET
- URL: `https://paper-api.alpaca.markets/v2/account`
- Authentication: Alpaca Trading API credential

### [4] Fetch Alpaca Positions
- Method: GET
- URL: `https://paper-api.alpaca.markets/v2/positions`
- Authentication: Alpaca Trading API credential

### [5] Fetch Alpaca Open Orders
- Method: GET
- URL: `https://paper-api.alpaca.markets/v2/orders?status=open&limit=200`
- Authentication: Alpaca Trading API credential

---

### [6a–6i] Fetch Bars nodes (9 HTTP nodes, run in parallel)

All triggered in parallel. Each uses the Alpaca Data API credential + manual `APCA-API-SECRET-KEY` header.

| Node name | Symbols | limit |
|-----------|---------|-------|
| Fetch Bars Cybersecurity | CRWD,PANW,ZS,OKTA,FTNT,S,CYBR,TMUS,QLYS,TENB | 252 |
| Fetch Bars Defense | LMT,RTX,NOC,GD,HII,LHX,KTOS,RCAT,PLTR,AXON | 252 |
| Fetch Bars Nuclear | CCJ,UEC,NXE,DNN,SMR,OKLO,CEG,VST,ETR,NEE | 252 |
| Fetch Bars Copper | FCX,SCCO,TECK,HBM,VALE,MP,LTHM,ALB,SQM,LAC | 252 |
| Fetch Bars AI Semis | NVDA,AMD,AVGO,QCOM,MRVL,AMAT,KLAC,LRCX,MU,ARM | 252 |
| Fetch Bars Cloud | MSFT,AMZN,GOOGL,META,ORCL,SNOW,MDB,DDOG,NET,CRM | 252 |
| Fetch Bars Oil Gas | XOM,CVX,COP,SLB,HAL,MPC,PSX,VLO,OXY,EOG | 252 |
| Fetch Bars Data Centers | EQIX,DLR,AMT,IREN,CORZ,VRT,SMCI,DELL,HPE,WDC | 252 |
| Fetch Bars SPY | SPY | 252 |

URL pattern: `https://data.alpaca.markets/v2/stocks/bars?symbols={SYMBOLS}&timeframe=1Day&limit=252&feed=sip`

**Why 252 bars**: Compute Derived Metrics needs 31 bars for 30d momentum, 15 for ATR-14, and 252 for accurate 52-week high/low.

### [6j] Merge Price Bars
- Node type: Merge
- Set `numberInputs: 9` and wire each of the 9 HTTP nodes to a distinct port index 0–8
- **Critical**: Do NOT connect the 9 HTTP nodes directly to the Code node `[6k]`. Each trigger would fire the Code node separately, running the entire pipeline 9 times.

### [6k] Fetch Price Bars (Code)
Node name: **`Fetch Price Bars`** (exact — referenced by `02_compute_derived_metrics.js`)
- Merges all 9 Alpaca responses into a single `{ bars: { TICKER: [...] } }` object

---

### [7] Load Signal History
```sql
SELECT niche, direction, conviction, confidence, created_at
FROM stocks.specialist_signals
WHERE created_at >= NOW() - INTERVAL '10 days'
ORDER BY niche, created_at DESC;
```

### [8] Load Specialist Accuracy
```sql
SELECT niche, hit_rate, avg_reported_confidence, total_signals,
       high_conviction_signals, scaling_factor, best_pattern, worst_pattern,
       calibration_error, updated_at
FROM stocks.specialist_accuracy
WHERE period_days = 30;
```

### [9] Load Pattern Performance
```sql
SELECT pattern_type, niche, total_trades, winning_trades, win_rate,
       avg_win_pct, avg_loss_pct, expected_value, updated_at
FROM stocks.pattern_performance
ORDER BY pattern_type, niche;
```

### [10] Load Trade Lessons
```sql
SELECT ticker, niche, direction, outcome, pnl_pct, entry_pattern,
       exit_reason, sector_accuracy, stock_selection_quality,
       entry_timing, exit_timing, key_lesson, pattern_tag,
       alternative_picks, generated_at
FROM stocks.trade_lessons
ORDER BY generated_at DESC
LIMIT 5;
```

### [11] Load Watchlist
```sql
SELECT ticker, niche, direction, reason, added_at
FROM stocks.watchlist
ORDER BY added_at DESC;
```

### [12] Load Earnings Calendar
```sql
SELECT ticker, earnings_date
FROM stocks.earnings_calendar
WHERE earnings_date >= CURRENT_DATE
  AND earnings_date <= CURRENT_DATE + INTERVAL '14 days'
ORDER BY earnings_date;
```

### [13] Load Correlation Matrix
```sql
SELECT ticker_a, ticker_b, correlation
FROM stocks.correlation_matrix
WHERE ABS(correlation) > 0.60;
```

### [14] Load Portfolio Snapshots
```sql
SELECT portfolio_value_usd, cash_usd, spy_price, spy_cumulative_pct,
       session, created_at
FROM stocks.portfolio_snapshots
ORDER BY created_at DESC
LIMIT 30;
```

---

### [15] IF — Is Morning Session?
- Condition: `{{ $("Set Session").first().json.session_type }}` equals `morning`

### [16a] Fetch Fundamentals (morning only)
Loop over all 80 tickers using Finnhub. Respect 60 req/min rate limit.
1. **Code node** — outputs 80 items, each `{ ticker, endpoint }`
2. **HTTP Request** — Finnhub `/stock/metric?symbol={{ $json.ticker }}&metric=all`
3. **HTTP Request** — Finnhub `/stock/recommendation?symbol={{ $json.ticker }}`
4. **HTTP Request** — Finnhub `/stock/price-target?symbol={{ $json.ticker }}`
5. **Code node** — merges 3 responses per ticker into one row
6. **Postgres** — INSERT OR UPDATE into `stocks.stock_fundamentals`

Use `SplitInBatches` (batch size 1) with a 1-second Wait node to stay within rate limits.

### [16b] Load Fundamentals Cache
```sql
SELECT *
FROM stocks.stock_fundamentals
WHERE fetched_at >= NOW() - INTERVAL '48 hours';
```

---

### [20] Parse & Save All Signals
Node name: **`Parse & Save All Signals`** (exact — referenced by `06_build_orchestrator_input.js`)
- Node type: Code (`parse_save_all_signals.js`)
- Input: 8 items from Merge All Signals (one per niche, each with `{ niche, session_id, message: { content: "..." } }`)
- Applies specialist confidence scaling using accuracy history from `Compute Derived Metrics`
- Output: 8 items — each with full parsed signal data + `effective_confidence`, `short_picks`, `long_picks`

### [21] Store All Signals
- Node type: Postgres
- Set `alwaysOutputData: true` — an UPSERT without `RETURNING` returns 0 rows; without this flag n8n stops execution
```sql
INSERT INTO stocks.specialist_signals
  (niche, session, direction, conviction, confidence, materiality, top_picks, summary, raw_json)
VALUES (
  '{{ $json.niche }}', '{{ $json.session }}', '{{ $json.direction }}',
  '{{ $json.conviction }}', {{ $json.confidence }}, '{{ $json.materiality }}',
  '{{ $json.top_picks }}'::jsonb, '{{ $json.summary }}', '{{ $json.raw_json }}'::jsonb
)
ON CONFLICT (niche, session) DO UPDATE SET
  direction   = EXCLUDED.direction,
  conviction  = EXCLUDED.conviction,
  confidence  = EXCLUDED.confidence,
  materiality = EXCLUDED.materiality,
  top_picks   = EXCLUDED.top_picks,
  summary     = EXCLUDED.summary,
  raw_json    = EXCLUDED.raw_json,
  created_at  = NOW();
```

> The `UNIQUE (niche, session)` constraint ensures exactly 1 canonical row per niche/session. The upsert overwrites stale data on re-runs.

---

### [23] Call Orchestrator LLM
- Node type: **Native OpenAI node v2.1** (Responses API)
- Model: `gpt-5.1`
- System prompt: `{{ $json.system_prompt }}`
- User prompt: `{{ $json.user_prompt }}`
- Max tokens: 4000
- Temperature: 0.3
- Output shape: `{ output: [{ content: [{ text: "..." }] }] }` (v2.1 format)

---

### [28] Is Market Open?
- Determined by `session_type` in code, not by LLM judgment
- `morning` and `midday` sessions → market open → TRUE branch
- `close` session (4:30 PM ET) → market closed → FALSE branch

---

### [29] Prepare Trade Actions
- Node type: Code (`08_prepare_trade_actions.js`)
- Outputs one item per `portfolio_action` (BUY / SELL / SHORT / COVER)
- If no actions: outputs `{ no_trades: true }` — an IF node should filter this before [31]

---

### [31] Execute Market Order
- Method: POST
- URL: `https://paper-api.alpaca.markets/v2/orders`
- Authentication: Alpaca Trading API credential
- **Body mode: `bodyParameters` (key-value pairs)** — do NOT use `specifyBody: string` or `json`
- Fields pulled directly: `$json.order_payload.symbol`, `$json.order_payload.qty`, `$json.order_payload.side`, `$json.order_payload.type`, `$json.order_payload.time_in_force`

> For SELL/COVER: share quantity is the actual Alpaca position qty (not recalculated from size_usd). For BUY/SHORT: shares = `Math.floor(size_usd / price * 100) / 100`.

---

### [32] Needs Trailing Stop?
- Condition: `{{ $json.needs_trailing_stop }}` equals `true`
- TRUE for BUY and SHORT actions only (not SELL or COVER)

### [33a] Submit Trailing Stop
- Method: POST
- URL: `https://paper-api.alpaca.markets/v2/orders`
- Authentication: Alpaca Trading API credential
- **Body mode: `bodyParameters`** — same approach as Execute Market Order
- Fields: `$json.trail_stop_payload.*`
- Trail percent: ATR×2.5 as % of price, clamped 5–15%
- `time_in_force: gtc` — stays active until triggered or the position is closed

---

### [26] Store Portfolio Snapshot
Input comes from Process Post-Trade — data nested under `$json.snapshot.*`.

```sql
INSERT INTO stocks.portfolio_snapshots
  (session, portfolio_value_usd, cash_usd, long_value_usd, short_value_usd,
   unrealized_pnl_usd, spy_price, spy_return_pct, spy_cumulative_pct,
   orchestrator_summary, positions_json, short_positions_json, raw_json)
VALUES (
  '{{ $json.snapshot.session }}',
  {{ $json.snapshot.portfolio_value_usd }},
  {{ $json.snapshot.cash_usd }},
  {{ $json.snapshot.long_value_usd }},
  {{ $json.snapshot.short_value_usd }},
  {{ $json.snapshot.unrealized_pnl_usd }},
  {{ $json.snapshot.spy_price }},
  {{ $json.snapshot.spy_return_pct }},
  {{ $json.snapshot.spy_cumulative_pct }},
  '{{ $json.snapshot.orchestrator_summary }}',
  '{{ $json.snapshot.positions_json }}'::jsonb,
  '{{ $json.snapshot.short_positions_json }}'::jsonb,
  '{{ $json.snapshot.raw_json }}'::jsonb
)
ON CONFLICT DO NOTHING;
```

---

### [27a] Build Watchlist SQL (inline Code)
Reads `$("Process Post-Trade").first().json.watchlist` and builds DELETE + INSERT SQL:
```javascript
const input = $("Process Post-Trade").first().json;
const wl = input.watchlist || [];
const esc = s => (s||'').replace(/'/g,"''");
let sql = "DELETE FROM stocks.watchlist;";
if (wl.length > 0) {
  const vals = wl.map(w =>
    `('${esc(w.ticker)}','${esc(w.niche)}','${esc(w.direction)}','${esc(w.reason||'').substring(0,500)}')`
  ).join(',');
  sql += ` INSERT INTO stocks.watchlist (ticker,niche,direction,reason) VALUES ${vals};`;
}
return [{json:{watchlist_sql:sql}}];
```

### [27b] Execute Watchlist Update
- Operation: Execute Query
- Query: `{{ $json.watchlist_sql }}`

---

### [34] Has Post-Mortems?
- Condition: `{{ $json.has_post_mortems }}` equals `true`

### [35a] Prepare PM Items (inline Code)
Splits `post_mortem_payloads` array into individual items:
```javascript
const input = $("Process Post-Trade").first().json;
const payloads = input.post_mortem_payloads || [];
if (payloads.length === 0) return [];
return payloads.map(p => ({json: p}));
```

### [36] Trigger Post-Mortem
- Node type: **Execute Workflow** (not HTTP Request)
- Calls the Post-Mortem workflow (Workflow 3) directly by ID
- One execution per SELL/COVER payload

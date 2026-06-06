# Workflow 1 — Main Analysis v2 Blueprint

Runs 3×/day: 9:30 AM, 12:00 PM, 3:50 PM ET (Monday–Friday).
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
| letter_build_prompt.js | `Parse Orchestrator Output`, `Build Orchestrator Input`, `Compute Derived Metrics` |
| letter_store.js | `Build Letter Prompt` |

---

## OpenAI node versions

Two different native OpenAI node versions are used — their output shapes differ. Do NOT swap them.

| Node | Version | Output shape |
|------|---------|-------------|
| Specialist [Niche] × 8 | v1.3 | `{ message: { content: "..." } }` |
| Call Orchestrator LLM | v2.1 | `{ output: [{ content: [{ text: "..." }] }] }` |
| Letter LLM | v1.3 | `{ message: { content: "..." } }` |

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
  │  [6h2] Fetch Bars Healthcare      (HTTP GET Alpaca Data)      │
  │  [6h3] Fetch Bars Financials      (HTTP GET Alpaca Data)      │
  │  [6i] Fetch Bars SPY              (HTTP GET Alpaca Data)      │
  │         ↓ (all 11 feed into [6j])                            │
  │  [6j] Merge Price Bars  (Merge node, numberInputs: 11)        │
  │  [6k] Fetch Price Bars  (Code — merges 11 responses into      │
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
      ↓ (live signal merge is a binary tree of 2-input v1 Merge nodes: 8 niches via
        Tag→L1→L2→Merge All Signals; Healthcare+Financials→Merge L1 Health Fin;
        both→Merge All 10 Signals → Parse & Save All Signals)
[19] Merge All 10 Signals              (final merge of all 10 niche signals)
      ↓
[20] Parse & Save All Signals          (Code: parse_save_all_signals.js)
      → outputs 10 items (one per niche, with parsed signal + effective_confidence)
      ↓ (fans out to both [21] and [22])
[21] Store All Signals                 (Postgres UPSERT — alwaysOutputData: true)
[22] Build Orchestrator Input          (Code: 06_build_orchestrator_input.js)
      → reads 10 items via $("Parse & Save All Signals").all()
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
      ↓ (fans out to two parallel branches)
      ├──────────────────────────────────────────────────────────────┐
      │  LETTER GENERATION BRANCH (close sessions only)             │
      │  [27c] Is Close Session?    (IF: session_id endsWith _close) │
      │         ↓ TRUE                         ↓ FALSE              │
      │  [27d] Build Letter Prompt  (Code: letter_build_prompt.js)  │
      │         ↓                              (silent end)          │
      │  [27e] Letter LLM           (Native OpenAI node v1.3)        │
      │         ↓                                                    │
      │  [27f] Parse & Store Letter (Code: letter_store.js)         │
      │         ↓                                                    │
      │  [27g] Store Letter         (Postgres UPSERT investor_letters│
      └──────────────────────────────────────────────────────────────┘
      ↓
[28] Is Market Open?                   (IF: session_type is morning or midday)
      ↓ TRUE                   ↓ FALSE
[29] Prepare Trade Actions   [30] Market Closed - End (NoOp)
     (Code: 08_prepare_trade_actions.js)
     → cash-guarded: BUY/SHORT filtered if size_usd > available cash
     → outputs N items (one per action)
      ↓
[31] Is Closing Position?              (IF: action is SELL or COVER)
      ↓ TRUE                    ↓ FALSE
[32a] Close Position          [32b] Execute Market Order
      (HTTP DELETE                    (HTTP POST /v2/orders
       /v2/positions/{ticker}          bodyParameters mode)
       — atomically closes position
         AND cancels all GTC orders)
      ↓                         ↓
      +→ [33] Merge Trade Actions (Merge node, append mode) ←+
                    ↓
[34] Restore Trade Context             (Code — re-attaches ticker/action/shares/
                                        stop_pct_used/needs_trailing_stop from
                                        Prepare Trade Actions into $json using
                                        symbol-based matching)
      ↓
[35] Needs Trailing Stop?              (IF: $json.needs_trailing_stop == true)
      ↓ TRUE               ↓ FALSE
[36a] Submit Trailing Stop [36b] No Stop Needed (NoOp)
      (HTTP POST /v2/orders             (trailing_stop, GTC, Math.floor(shares))
      ↓ (both branches end — no further convergence needed)
[37] Has Post-Mortems?                 (IF: has_post_mortems == true)
      ↓ TRUE               ↓ FALSE
[38a] Prepare PM Items     [38b] No PM - End (NoOp)
      (Code inline)
      ↓
[39] Trigger Post-Mortem              (Execute Workflow — calls Post-Mortem workflow)
```

---

## Node configurations

### [1a] Schedule Trigger
- Mode: Cron
- Cron expressions (add all three) — in ET, DST-safe via workflow timezone `America/New_York`:
  - `30 9 * * 1-5`  → 9:30 AM ET
  - `0 12 * * 1-5`  → 12:00 PM ET
  - `50 15 * * 1-5` → 3:50 PM ET

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
| Fetch Bars Cybersecurity | CRWD,PANW,ZS,OKTA,FTNT,S,CYBR,CHKP,QLYS,TENB | 3600 |
| Fetch Bars Defense | LMT,RTX,NOC,GD,HII,LHX,KTOS,RCAT,PLTR,AXON | 3600 |
| Fetch Bars Nuclear | CCJ,UEC,NXE,DNN,SMR,OKLO,CEG,VST,ETR,NEE | 3600 |
| Fetch Bars Copper | FCX,SCCO,TECK,HBM,VALE,MP,AA,ALB,SQM,LAC | 3600 |
| Fetch Bars AI Semis | ARM,AMAT,LRCX,KLAC,ON,TER,NXPI,MCHP,MPWR,SNPS | 3600 |
| Fetch Bars Cloud | ORCL,NOW,CRM,DDOG,SNOW,ADBE,NET,TEAM,WDAY,MDB | 3600 |
| Fetch Bars Oil Gas | XOM,CVX,COP,SLB,HAL,MPC,PSX,VLO,OXY,EOG | 3600 |
| Fetch Bars Data Centers | EQIX,DLR,AMT,IREN,CORZ,VRT,SMCI,DELL,HPE,WDC | 3600 |
| Fetch Bars Healthcare | UNH,ELV,CVS,LLY,MRK,PFE,ABBV,ISRG,MDT,TMO | 3600 |
| Fetch Bars Financials | JPM,BAC,WFC,C,GS,MS,SCHW,BLK,AXP,COF | 3600 |
| Fetch Bars SPY | SPY,HACK,ITA,URA,COPX,SOXX,SKYY,XLE,DTCR,XLV,XLF | 4400 |

URL pattern: `https://data.alpaca.markets/v2/stocks/bars?symbols={SYMBOLS}&timeframe=1Day&limit=3600&start=2025-01-01&feed=sip` (limit is shared across all symbols in a multi-symbol request — 3600 covers 10 symbols × ~350 bars)

**Why 252 bars**: Compute Derived Metrics needs 31 bars for 30d momentum, 15 for ATR-14, and 252 for accurate 52-week high/low.

### [6j] Merge Price Bars
- Node type: Merge
- Set `numberInputs: 11` and wire each of the 11 HTTP nodes to a distinct port index 0–10
- **Critical**: Do NOT connect the 11 HTTP nodes directly to the Code node `[6k]`. Each trigger would fire the Code node separately, running the entire pipeline 11 times.

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
       high_conviction_signals, scaling_factor, calibration_error, updated_at
FROM stocks.specialist_accuracy
WHERE period_days = 30;
```

### [9] Load Pattern Performance
```sql
SELECT pattern_type, total_trades, winning_trades, win_rate,
       avg_win_pct, avg_loss_pct, expected_value
FROM stocks.pattern_performance
ORDER BY pattern_type;
```

### [10] Load Trade Lessons
> **Source**: `stocks.trades WHERE status='CLOSED'` (not `trade_lessons` — deprecated 2026-06-03).
> `generated_at` aliased from `updated_at`. Added 2026-06-03: `hold_days`, `entry_price`, `exit_price`, `entry_thesis`, `etf_return`, `entry_specialist_confidence`, `entry_effective_confidence`, `size_usd`.

```sql
SELECT
  ticker, niche, direction, outcome,
  pnl_pct::float          AS pnl_pct,
  pnl_usd::float          AS pnl_usd,
  hold_days,
  entry_pattern, exit_reason,
  sector_accuracy, entry_timing, exit_timing,
  key_lesson, pattern_tag,
  entry_price::float      AS entry_price,
  exit_price::float       AS exit_price,
  entry_thesis,
  etf_return::float       AS etf_return,
  entry_specialist_confidence::float  AS entry_specialist_confidence,
  entry_effective_confidence::float   AS entry_effective_confidence,
  size_usd::float         AS size_usd,
  updated_at AS generated_at
FROM stocks.trades
WHERE status = 'CLOSED'
ORDER BY updated_at DESC
LIMIT 5
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
Loop over all 100 tickers using Finnhub. Respect 60 req/min rate limit.
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
- Input: 10 items from Merge All 10 Signals (one per niche, each with `{ niche, session_id, message: { content: "..." } }`)
- Applies specialist confidence scaling using accuracy history from `Compute Derived Metrics`
- Output: 10 items — each with full parsed signal data + `effective_confidence`, `short_picks`, `long_picks`

### [21] Store All Signals
- Node type: Postgres
- Set `alwaysOutputData: true` — an UPSERT without `RETURNING` returns 0 rows; without this flag n8n stops execution
```sql
INSERT INTO stocks.specialist_signals
  (niche, session, direction, conviction, confidence, materiality, top_picks, summary,
   raw_json, effective_confidence, scaling_factor)
VALUES (
  '{{ $json.niche }}', '{{ $json.session }}', '{{ $json.direction }}',
  '{{ $json.conviction }}', {{ $json.confidence }}, '{{ $json.materiality }}',
  '{{ $json.top_picks }}'::jsonb, '{{ $json.summary }}', '{{ $json.raw_json }}'::jsonb,
  {{ $json.effective_confidence }}, {{ $json.scaling_factor }}
)
ON CONFLICT (niche, session) DO UPDATE SET
  direction            = EXCLUDED.direction,
  conviction           = EXCLUDED.conviction,
  confidence           = EXCLUDED.confidence,
  materiality          = EXCLUDED.materiality,
  top_picks            = EXCLUDED.top_picks,
  summary              = EXCLUDED.summary,
  raw_json             = EXCLUDED.raw_json,
  effective_confidence = EXCLUDED.effective_confidence,
  scaling_factor       = EXCLUDED.scaling_factor;
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
- `close` session (3:50 PM ET) → market closed → FALSE branch

---

### [29] Prepare Trade Actions
- Node type: Code (`08_prepare_trade_actions.js`)
- Outputs one item per `portfolio_action` (BUY / SELL / SHORT / COVER)
- **Cash guard**: BUY/SHORT are skipped if cumulative `size_usd` exceeds `account.cash`; SELL/COVER always pass through
- If no actions: outputs `{ no_trades: true }` — filtered by `Is Closing Position?` / `Execute Market Order` paths

---

### [31] Is Closing Position?
- Node type: IF
- Condition: `{{ ['SELL','COVER'].includes($json.action) ? 'true' : 'false' }}` equals `true`
- TRUE → Close Position
- FALSE → Execute Market Order

### [32a] Close Position
- Method: DELETE
- URL: `={{ 'https://paper-api.alpaca.markets/v2/positions/' + $json.ticker }}`
- Authentication: Alpaca Trading API credential (Alpaca - Trading)
- `continueOnFail: true`
- **Why DELETE instead of market sell**: A GTC trailing stop locks shares — a plain market SELL order returns 422 "insufficient qty available". `DELETE /v2/positions/{ticker}` atomically closes the full position AND cancels all associated GTC orders in one call.

### [32b] Execute Market Order
- Method: POST
- URL: `https://paper-api.alpaca.markets/v2/orders`
- Authentication: Alpaca Trading API credential
- **Body mode: `bodyParameters` (key-value pairs)** — do NOT use `specifyBody: string` or `json`
- Fields: `$json.ticker`, `$json.shares` (String), `$json.action` → side mapping, `"market"`, `"day"`
- Shares: `Math.floor(size_usd / price * 100) / 100` (computed in `07_parse_orchestrator_output.js`)

### [33] Merge Trade Actions
- Node type: Merge
- Mode: `append` — outputs all items from Close Position, then all from Execute Market Order
- 2 inputs: port 0 = Close Position, port 1 = Execute Market Order

### [34] Restore Trade Context
- Node type: Code
- Re-attaches `ticker`, `action`, `shares`, `stop_pct_used`, `needs_trailing_stop` from `Prepare Trade Actions` into `$json` after the Alpaca API response overwrote it
- Uses **symbol-based matching** (not array index) so the merge order doesn't break the lookup:
  ```js
  const tradeActions = $('Prepare Trade Actions').all();
  return $input.all().map((item, index) => {
    const symbol = item.json?.symbol;
    const trade = (tradeActions.find(t => t.json?.ticker === symbol) || tradeActions[index] || {}).json || {};
    return { json: { ...item.json, ticker: trade.ticker, action: trade.action,
                     shares: trade.shares, stop_pct_used: trade.stop_pct_used,
                     needs_trailing_stop: trade.needs_trailing_stop } };
  });
  ```

---

### [35] Needs Trailing Stop?
- Condition: `{{ $json.needs_trailing_stop ? 'true' : 'false' }}` equals `true`
- TRUE for BUY and SHORT actions only (SELL/COVER always → FALSE)

### [36a] Submit Trailing Stop
- Method: POST
- URL: `https://paper-api.alpaca.markets/v2/orders`
- Authentication: Alpaca Trading API credential
- **Body mode: `bodyParameters`** — fields from `$json` (populated by Restore Trade Context)
- `qty`: `{{ String(Math.floor($json.shares)) }}` — **must be whole number**: Alpaca rejects fractional GTC orders
- `side`: `{{ $json.action === 'BUY' ? 'sell' : 'buy' }}`
- `trail_percent`: `{{ String($json.stop_pct_used) }}`
- `time_in_force: gtc` — stays active until triggered or position is closed
- `continueOnFail: true`

---

### [26] Store Portfolio Snapshot
Input comes from Process Post-Trade — data nested under `$json.snapshot.*`.

```sql
INSERT INTO stocks.portfolio_snapshots
  (session, portfolio_value_usd, cash_usd, long_value_usd, short_value_usd,
   unrealized_pnl_usd, spy_price, spy_return_pct, spy_cumulative_pct,
   positions_json, raw_json)
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
  '{{ $json.snapshot.positions_json }}'::jsonb,
  '{{ $json.snapshot.raw_json }}'::jsonb
)
ON CONFLICT DO NOTHING;
```

---

### [27a] Build Watchlist SQL (inline Code)
Reads `$("Process Post-Trade").first().json.watchlist` and builds DELETE + INSERT SQL.
Each watchlist item comes from `09_process_post_trade.js` with fields: `ticker`, `niche`, `direction`, `reason`, `trigger_condition` (from orchestrator `trigger` field), `session_id`.
```javascript
const input = $("Process Post-Trade").first().json;
const wl = input.watchlist || [];
const esc = s => (s||'').replace(/'/g,"''");
let sql = "DELETE FROM stocks.watchlist;";
if (wl.length > 0) {
  const vals = wl.map(w =>
    `('${esc(w.ticker)}','${esc(w.niche)}','${esc(w.direction)}',` +
    `'${esc(w.reason||'').substring(0,500)}',` +
    `'${esc(w.trigger_condition||'').substring(0,500)}',` +
    `'${esc(w.session_id||'')}')`
  ).join(',');
  sql += ` INSERT INTO stocks.watchlist (ticker,niche,direction,reason,trigger_condition,session_id) VALUES ${vals};`;
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

---

### [27c] Is Close Session?
- Node type: IF
- Condition: `{{ $('Process Post-Trade').first().json.session_id }}` endsWith `_close`
- TRUE → Build Letter Prompt
- FALSE → (no output — silent end for morning/midday sessions)

### [27d] Build Letter Prompt
- Node type: Code (`letter_build_prompt.js`)
- Reads from `Parse Orchestrator Output`, `Build Orchestrator Input`, `Compute Derived Metrics`
- Assembles system + user prompt for a practitioner-style LP letter covering: day result, key trade decisions (thesis-first), current book with entry thesis + days held, sector rotation outlook, watchlist with triggers, earnings at-risk, and forward posture
- No internal jargon in the prompt (no "effective confidence", "orchestrator", "signal patterns") — written as the portfolio manager's own views
- Output: `{ system_prompt, user_prompt, session_id }`

### [27e] Letter LLM
- Node type: **Native OpenAI node v1.3**
- Model: `gpt-4o-mini`
- System prompt: `{{ $json.system_prompt }}`
- User prompt: `{{ $json.user_prompt }}`
- Output shape: `{ message: { content: "..." } }` (v1.3 format)

### [27f] Parse & Store Letter
- Node type: Code (`letter_store.js`)
- Reads `$input.first().json.message.content` (the letter body)
- SQL-escapes single quotes; reads `session_id` from `Build Letter Prompt`
- Output: `{ session, body }`

### [27g] Store Letter
- Node type: Postgres
- Set `alwaysOutputData: true`
- Credential: Neon - Stocks Agent
```sql
INSERT INTO stocks.investor_letters (session, body)
VALUES ('{{ $json.session }}', '{{ $json.body }}')
ON CONFLICT (session) DO UPDATE SET body = EXCLUDED.body, created_at = NOW()
```

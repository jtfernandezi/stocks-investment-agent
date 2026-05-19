# Workflow 1 — Main Analysis Blueprint

Runs 3×/day: 8:30 AM, 12:00 PM, 4:30 PM ET (Monday–Friday).

## Node map

```
[1]  Schedule Trigger
      ↓
[2]  Set Session                         (Code: 01_set_session.js)
      ↓
[3]  Fetch Alpaca Account                (HTTP GET /account)
      ↓
[4]  Fetch Alpaca Positions              (HTTP GET /positions)
      ↓
[5]  Fetch Alpaca Open Orders            (HTTP GET /orders?status=open&limit=200)
      ↓
[6]  Fetch Price Bars                    (HTTP GET Alpaca Data /stocks/bars)
      ↓
[7]  Load Signal History                 (Postgres SELECT)
      ↓
[8]  Load Specialist Accuracy            (Postgres SELECT)
      ↓
[9]  Load Pattern Performance            (Postgres SELECT)
      ↓
[10] Load Trade Lessons                  (Postgres SELECT)
      ↓
[11] Load Watchlist                      (Postgres SELECT)
      ↓
[12] Load Earnings Calendar              (Postgres SELECT)
      ↓
[13] Load Correlation Matrix             (Postgres SELECT)
      ↓
[14] Load Portfolio Snapshots            (Postgres SELECT — last 30 days)
      ↓
[15] Is Morning Session?                 (IF: session_type == "morning")
      ↓ TRUE                ↓ FALSE
[16a] Fetch Fundamentals   [16b] Load Fundamentals Cache   (Postgres SELECT)
      Loop (Code+HTTP)
      ↓                    ↓
[17] Merge                               (Merge node, mode: Combine All)
      ↓
[18] Compute Derived Metrics             (Code: 02_compute_derived_metrics.js)
      ↓
[19] Prepare RSS Sources                 (Code: 03_prepare_rss_sources.js)
      → outputs 16 items
      ↓
[20] Fetch RSS Feed                      (HTTP GET — processes 16 items)
      ↓
[21] Build Specialist Inputs             (Code: 04_build_specialist_inputs.js)
      → outputs 8 items (one per niche)
      ↓
[22] Call Specialist LLM                 (HTTP POST OpenAI — processes 8 items)
      ↓
[23] Parse Specialist Outputs            (Code: 05_parse_specialist_outputs.js)
      ↓
[24] Store Specialist Signals            (Postgres INSERT — 8 inserts)
      ↓
[25] Build Orchestrator Input            (Code: 06_build_orchestrator_input.js)
      → single item
      ↓
[26] Call Orchestrator LLM              (HTTP POST OpenAI)
      ↓
[27] Parse Orchestrator Output           (Code: 07_parse_orchestrator_output.js)
      ↓
[28] Is Market Open?                     (IF: is_market_open == true)
      ↓ TRUE                ↓ FALSE
[29a] Prepare Trade Actions              [29b] No Op
      (Code: 08_prepare_trade_actions.js)
      → outputs N items (one per action)
      ↓
[30] Execute Market Order                (HTTP POST Alpaca /orders)
      ↓
[31] Is BUY or SHORT?                    (IF: needs trailing stop)
      ↓ TRUE                ↓ FALSE
[32a] Submit Trailing Stop               [32b] Continue
      (HTTP POST Alpaca /orders)
      ↓
[33] Merge trade branches                (Merge)
      ↓
[34] Process Post-Trade                  (Code: 09_process_post_trade.js)
      ↓
[35] Store Portfolio Snapshot            (Postgres INSERT)
      ↓
[36] Update Watchlist                    (Postgres — DELETE then INSERT)
      ↓
[37] Trigger Post-Mortems                (HTTP POST webhook — one per SELL/COVER)
```

---

## Node configurations

### [1] Schedule Trigger
- Mode: Cron
- Cron expressions (add all three):
  - `30 12 * * 1-5` → 8:30 AM ET
  - `0 16 * * 1-5`  → 12:00 PM ET
  - `30 20 * * 1-5` → 4:30 PM ET

---

### [3] Fetch Alpaca Account
- Method: GET
- URL: `https://paper-api.alpaca.markets/v2/account`
- Authentication: Alpaca Trading API credential
- Response format: JSON

---

### [4] Fetch Alpaca Positions
- Method: GET
- URL: `https://paper-api.alpaca.markets/v2/positions`
- Authentication: Alpaca Trading API credential
- Response format: JSON

---

### [5] Fetch Alpaca Open Orders
- Method: GET
- URL: `https://paper-api.alpaca.markets/v2/orders?status=open&limit=200`
- Authentication: Alpaca Trading API credential
- Response format: JSON

---

### [6] Fetch Price Bars
All 80 stocks + SPY, daily bars, last 30 days (enough for 30d momentum + ATR-14).

- Method: GET
- URL (expression):
```
https://data.alpaca.markets/v2/stocks/bars?symbols=CRWD,PANW,ZS,OKTA,FTNT,S,CYBR,TMUS,QLYS,TENB,LMT,RTX,NOC,GD,HII,LHX,KTOS,RCAT,PLTR,AXON,CCJ,UEC,NXE,DNN,SMR,OKLO,CEG,VST,ETR,NEE,FCX,SCCO,TECK,HBM,VALE,MP,LTHM,ALB,SQM,LAC,NVDA,AMD,AVGO,QCOM,MRVL,AMAT,KLAC,LRCX,MU,ARM,MSFT,AMZN,GOOGL,META,ORCL,SNOW,MDB,DDOG,NET,CRM,XOM,CVX,COP,SLB,HAL,MPC,PSX,VLO,OXY,EOG,EQIX,DLR,AMT,IREN,CORZ,VRT,SMCI,DELL,HPE,WDC,SPY&timeframe=1Day&limit=30&feed=sip
```
- Authentication: Alpaca Data API credential
- Response format: JSON

---

### [7] Load Signal History
- Operation: Execute Query
- Query:
```sql
SELECT niche, direction, conviction, confidence, created_at
FROM stocks.specialist_signals
WHERE created_at >= NOW() - INTERVAL '10 days'
ORDER BY niche, created_at DESC;
```

---

### [8] Load Specialist Accuracy
```sql
SELECT niche, hit_rate, avg_reported_confidence, total_signals,
       high_conviction_signals, scaling_factor, best_pattern, worst_pattern,
       calibration_error, updated_at
FROM stocks.specialist_accuracy
WHERE period_days = 30;
```

---

### [9] Load Pattern Performance
```sql
SELECT pattern_type, niche, total_trades, winning_trades, win_rate,
       avg_win_pct, avg_loss_pct, expected_value, updated_at
FROM stocks.pattern_performance
ORDER BY pattern_type, niche;
```

---

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

---

### [11] Load Watchlist
```sql
SELECT ticker, niche, direction, reason, added_at
FROM stocks.watchlist
ORDER BY added_at DESC;
```

---

### [12] Load Earnings Calendar
```sql
SELECT ticker, earnings_date
FROM stocks.earnings_calendar
WHERE earnings_date >= CURRENT_DATE
  AND earnings_date <= CURRENT_DATE + INTERVAL '14 days'
ORDER BY earnings_date;
```

---

### [13] Load Correlation Matrix
```sql
SELECT ticker_a, ticker_b, correlation
FROM stocks.correlation_matrix
WHERE ABS(correlation) > 0.60;
```

---

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

---

### [16a] Fetch Fundamentals (morning only)
This is a loop over all 80 tickers. Build it as:
1. **Code node** — "Prepare Finnhub Calls": outputs 80 items, each with `{ ticker, endpoint }`
2. **HTTP Request** — Finnhub `/stock/metric?symbol={{ $json.ticker }}&metric=all`
   - Add a **Wait** node (1 second) after each to respect the 60 req/min limit
3. **HTTP Request** — Finnhub `/stock/recommendation?symbol={{ $json.ticker }}`
   - Add another **Wait** node (1 second)
4. **HTTP Request** — Finnhub `/stock/price-target?symbol={{ $json.ticker }}`
5. **Code node** — "Merge Finnhub Responses": combine 3 responses per ticker into one fundamentals object
6. **Postgres** — INSERT OR UPDATE into `stocks.stock_fundamentals`

> Tip: Use `SplitInBatches` (batch size 1) to process tickers one at a time with rate limit control.

---

### [16b] Load Fundamentals Cache
```sql
SELECT *
FROM stocks.stock_fundamentals
WHERE fetched_at >= NOW() - INTERVAL '48 hours';
```

---

### [17] Merge
- Mode: Combine
- Combine By: Combine All (wait for both IF branches)

---

### [20] Fetch RSS Feed
- Method: GET
- URL: `{{ $json.feed_url }}`
- Response format: Text (raw XML)
- Authentication: None
- **Important**: In "Output" settings, enable "Put Response In Field" → set field name to `rss_raw`
  This preserves the original item fields (niche, feed_url, feed_index) while adding the RSS content.
- Add error handling: if fetch fails, continue with empty `rss_raw`

---

### [22] Call Specialist LLM
- Method: POST
- URL: `https://api.openai.com/v1/chat/completions`
- Authentication: OpenAI credential
- Body (JSON):
```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {
      "role": "system",
      "content": "{{ $json.system_prompt }}"
    },
    {
      "role": "user",
      "content": "{{ $json.user_prompt }}"
    }
  ],
  "temperature": 0.3,
  "max_tokens": 2000,
  "response_format": { "type": "json_object" }
}
```
- Timeout: 60 seconds

---

### [26] Call Orchestrator LLM
- Same as [22] but:
  - model: `gpt-5.1`
  - max_tokens: `4000`

---

### [30] Execute Market Order
- Method: POST
- URL: `https://paper-api.alpaca.markets/v2/orders`
- Authentication: Alpaca Trading API credential
- Body: `{{ $json.order_payload }}` (set by node [29a])

---

### [32a] Submit Trailing Stop
- Method: POST  
- URL: `https://paper-api.alpaca.markets/v2/orders`
- Authentication: Alpaca Trading API credential
- Body: `{{ $json.trail_stop_payload }}` (set by node [30] after fill)

---

### [31] IF — Needs Trailing Stop?
- Condition: `{{ $json.action }}` equals `BUY` OR `{{ $json.action }}` equals `SHORT`
- (Use OR combinator)

---

### [35] Store Portfolio Snapshot
```sql
INSERT INTO stocks.portfolio_snapshots 
  (session, portfolio_value_usd, cash_usd, long_value_usd, short_value_usd,
   unrealized_pnl_usd, spy_price, spy_return_pct, spy_cumulative_pct,
   orchestrator_summary, positions_json, short_positions_json, raw_json)
VALUES (
  '{{ $json.session_id }}',
  {{ $json.portfolio_value }},
  {{ $json.cash }},
  {{ $json.long_value }},
  {{ $json.short_value }},
  {{ $json.unrealized_pnl }},
  {{ $json.spy_price }},
  {{ $json.spy_return_pct }},
  {{ $json.spy_cumulative_pct }},
  '{{ $json.orchestrator_summary }}',
  '{{ $json.positions_json }}'::jsonb,
  '{{ $json.short_positions_json }}'::jsonb,
  '{{ $json.raw_json }}'::jsonb
)
ON CONFLICT DO NOTHING;
```

---

### [36] Update Watchlist
Two Postgres nodes in sequence:
1. `DELETE FROM stocks.watchlist;`
2. For each watchlist item (loop): `INSERT INTO stocks.watchlist (ticker, niche, direction, reason) VALUES (...)`

---

### [37] Trigger Post-Mortems
- For each SELL/COVER action in the executed trades:
- Method: POST to the Post-Mortem workflow's webhook URL
- Body: full closed trade context (see post_mortem_blueprint.md)
- Run as separate items via SplitInBatches

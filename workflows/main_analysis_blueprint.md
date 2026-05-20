# Workflow 1 — Main Analysis Blueprint

Runs 3×/day: 8:30 AM, 12:00 PM, 4:30 PM ET (Monday–Friday).

## Critical: Node naming

The Code nodes reference other nodes by exact name via `$("Node Name")`. Every node name in this blueprint must match exactly — a typo will break the workflow silently. The table below lists every reference used in the code:

| Code file | References node named |
|-----------|----------------------|
| 02_compute_derived_metrics.js | `Set Session`, `Fetch Alpaca Account`, `Fetch Alpaca Positions`, `Fetch Alpaca Open Orders`, `Fetch Price Bars`, `Load Signal History`, `Load Specialist Accuracy`, `Load Pattern Performance`, `Load Trade Lessons`, `Load Watchlist`, `Load Earnings Calendar`, `Load Correlation Matrix`, `Load Portfolio Snapshots`, `Load Fundamentals Cache` |
| 04_build_specialist_inputs.js | `Compute Derived Metrics`, `Attach Feed Niche` |
| 05_parse_specialist_outputs.js | `Build Specialist Inputs`, `Compute Derived Metrics` |
| 06_build_orchestrator_input.js | `Compute Derived Metrics`, `Parse Specialist Outputs` |
| 07_parse_orchestrator_output.js | `Build Orchestrator Input` |
| 09_process_post_trade.js | `Parse Orchestrator Output` |
| Build Watchlist SQL (inline Code) | `Process Post-Trade` |
| Prepare PM Items (inline Code) | `Process Post-Trade` |

## OpenAI node versions

Two different native OpenAI node versions are used — their output shapes differ:

- **Specialists [23]** → native OpenAI node **v1.3** — output shape: `{ message: { content: "..." } }`
- **Orchestrator [27]** → native OpenAI node **v2.1** — output shape: `{ output: [{ content: [{ text: "..." }] }] }`

The Code nodes (05 and 07) already parse each format correctly. Do not swap node versions.

## Node map

```
[1]  Schedule Trigger
      ↓
[2]  Set Session                         (Code: 01_set_session.js)
      ↓
[3]  Fetch Alpaca Account                (HTTP GET /account)
[4]  Fetch Alpaca Positions              (HTTP GET /positions)
[4a] Collect Positions                   (Code — aggregates full-response body into {_items, _count})
[5]  Fetch Alpaca Open Orders            (HTTP GET /orders?status=open&limit=200)
[5a] Collect Orders                      (Code — aggregates full-response body into {_items, _count})
[6]  Fetch Price Bars                    (HTTP GET Alpaca Data /stocks/bars)
     ↑ [3]–[6] run in parallel
      ↓
[7]  Load Signal History                 (Postgres SELECT)
[8]  Load Specialist Accuracy            (Postgres SELECT)
[9]  Load Pattern Performance            (Postgres SELECT)
[10] Load Trade Lessons                  (Postgres SELECT)
[11] Load Watchlist                      (Postgres SELECT)
[12] Load Earnings Calendar              (Postgres SELECT)
[13] Load Correlation Matrix             (Postgres SELECT)
[14] Load Portfolio Snapshots            (Postgres SELECT — last 30 days)
     ↑ [7]–[14] run in parallel
[15] Is Morning Session?                 (IF: session_type == "morning")
      ↓ TRUE                ↓ FALSE
[16a] Fetch Fundamentals   [16b] Load Fundamentals Cache   (Postgres SELECT)
      Loop (Code+HTTP)
      ↓                    ↓
[17a] Merge Neon Data                    (Merge — waits for all 9 Postgres nodes [7]–[16b])
      ↓
[17b] Merge All Data                     (Merge — combines Neon data with Alpaca data [3]–[6])
      ↓
[18] Compute Derived Metrics             (Code: 02_compute_derived_metrics.js)
      ↓
[19] Prepare RSS Sources                 (Code: 03_prepare_rss_sources.js)
      → outputs 16 items
      ↓
[20] Fetch RSS Feed                      (HTTP GET — processes 16 items)
      ↓
[21] Attach Feed Niche                   (Code — parses RSS XML, outputs N articles tagged by niche)
      ↓
[22] Build Specialist Inputs             (Code: 04_build_specialist_inputs.js)
      → outputs 8 items (one per niche)
      ↓
[23] Call Specialist LLM                 (OpenAI node v1.3 — processes 8 items)
      ↓
[24] Parse Specialist Outputs            (Code: 05_parse_specialist_outputs.js)
      ↓
[25] Store Specialist Signals            (Postgres INSERT — 8 inserts)
      ↓
[26] Build Orchestrator Input            (Code: 06_build_orchestrator_input.js)
      → single item
      ↓
[27] Call Orchestrator LLM              (OpenAI node v2.1)
      ↓
[28] Parse Orchestrator Output           (Code: 07_parse_orchestrator_output.js)
      ↓
[29] Process Post-Trade                  (Code: 09_process_post_trade.js)
      ↓
[30] Store Portfolio Snapshot            (Postgres INSERT)
      ↓
[31a] Build Watchlist SQL               (Code inline — builds DELETE+INSERT SQL from watchlist array)
[31b] Execute Watchlist Update          (Postgres — executes the SQL built by [31a])
      ↓
[32] Is Market Open?                     (IF: is_market_open == true)
      ↓ TRUE                  ↓ FALSE
[33]  Prepare Trade Actions  [34] Market Closed - End
      (Code: 08_prepare_trade_actions.js)
      → outputs N items (one per action)
      ↓
[35] Execute Market Order                (HTTP POST Alpaca /orders)
      ↓
[36] Needs Trailing Stop?                (IF: needs_trailing_stop == true)
      ↓ TRUE                ↓ FALSE
[37a] Submit Trailing Stop   [37b] No Stop Needed
      (HTTP POST Alpaca /orders)
      ↓ (both branches feed into [38])
[38] Has Post-Mortems?                   (IF: has_post_mortems == true)
      ↓ TRUE                ↓ FALSE
[39a] Prepare PM Items       [39b] No PM - End
      (Code inline — splits post_mortem_payloads array into individual items)
      ↓
[40] Trigger Post-Mortem                 (Execute Workflow — calls Post-Mortem workflow by ID)
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
All 80 stocks + SPY, daily bars, last 252 trading days (~1 year).
- **Why 252**: The compute node needs 31 bars for 30d momentum (sorted[length-31]), 15 for ATR-14, and 252 for accurate 52-week high/low. Using less than 31 causes 30d momentum to always return 0%.

- Method: GET
- URL (expression):
```
https://data.alpaca.markets/v2/stocks/bars?symbols=CRWD,PANW,ZS,OKTA,FTNT,S,CYBR,TMUS,QLYS,TENB,LMT,RTX,NOC,GD,HII,LHX,KTOS,RCAT,PLTR,AXON,CCJ,UEC,NXE,DNN,SMR,OKLO,CEG,VST,ETR,NEE,FCX,SCCO,TECK,HBM,VALE,MP,LTHM,ALB,SQM,LAC,NVDA,AMD,AVGO,QCOM,MRVL,AMAT,KLAC,LRCX,MU,ARM,MSFT,AMZN,GOOGL,META,ORCL,SNOW,MDB,DDOG,NET,CRM,XOM,CVX,COP,SLB,HAL,MPC,PSX,VLO,OXY,EOG,EQIX,DLR,AMT,IREN,CORZ,VRT,SMCI,DELL,HPE,WDC,SPY&timeframe=1Day&limit=252&feed=sip
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

### [21] Attach Feed Niche
- Node type: Code (JavaScript)
- Node name: **`Attach Feed Niche`** (exact — referenced by `04_build_specialist_inputs.js`)
- Input: 16 items from [20], each with `{ niche, feed_url, feed_index, rss_raw }`
- Output: N article items, each with `{ niche, title, summary, pubDate, link }`

```javascript
// Node: Attach Feed Niche
// Parses RSS XML from each feed and outputs individual articles tagged with their niche.

const items = $input.all();
const articles = [];

for (const item of items) {
  const niche = item.json.niche;
  const xml   = item.json.rss_raw || '';

  // Match RSS <item> blocks (handles both standard RSS and Atom-style entries)
  const itemMatches = [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi),
                       ...xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)];

  for (const match of itemMatches) {
    const block = match[1];

    const title = (
      block.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) ||
      block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    )?.[1]?.trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') || '';

    const rawSummary = (
      block.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) ||
      block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) ||
      block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)
    )?.[1] || '';
    const summary = rawSummary.replace(/<[^>]+>/g, '').trim().substring(0, 400);

    const pubDate = (
      block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
      block.match(/<published[^>]*>([\s\S]*?)<\/published>/i) ||
      block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)
    )?.[1]?.trim() || '';

    const link = (
      block.match(/<link[^>]*href="([^"]+)"/i) ||
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)
    )?.[1]?.trim() || '';

    if (title) {
      articles.push({ json: { niche, title, summary, pubDate, link } });
    }
  }
}

return articles.length > 0 ? articles : [{ json: { niche: 'none', title: '', summary: '', pubDate: '', link: '' } }];
```

---

### [23] Call Specialist LLM
- Node type: **Native OpenAI node v1.3** (not HTTP Request — the parse code expects its output shape)
- Model: `gpt-4o-mini`
- System prompt: `{{ $json.system_prompt }}`
- User prompt: `{{ $json.user_prompt }}`
- Temperature: 0.3
- Max tokens: 2000
- Response format: JSON object
- Timeout: 60 seconds
- Output shape per item: `{ message: { content: "..." } }` (v1.3 native format, used by 05_parse_specialist_outputs.js)

---

### [27] Call Orchestrator LLM
- Node type: **Native OpenAI node v2.1** (Responses API — different output shape from specialists)
- Model: `gpt-5.1`
- System prompt: `{{ $json.system_prompt }}`
- User prompt: `{{ $json.user_prompt }}`
- Max tokens: 4000
- Temperature: 0.3
- Output shape: `{ output: [{ content: [{ text: "..." }] }] }` (v2.1 native format, used by 07_parse_orchestrator_output.js)

---

### [31] Execute Market Order
- Method: POST
- URL: `https://paper-api.alpaca.markets/v2/orders`
- Authentication: Alpaca Trading API credential
- Body: `{{ $json.order_payload }}` (pre-built JSON string, set by node [30a] Prepare Trade Actions)

---

### [36] IF — Needs Trailing Stop?
- Condition: `{{ $json.needs_trailing_stop }}` equals `true`

---

### [37a] Submit Trailing Stop
- Method: POST
- URL: `https://paper-api.alpaca.markets/v2/orders`
- Authentication: Alpaca Trading API credential
- Body: `{{ $json.trail_stop_payload }}` (pre-built JSON string set by Parse Orchestrator Output)

---

### [30] Store Portfolio Snapshot
Input comes from Process Post-Trade — data is nested under `$json.snapshot.*`.

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

### [31a] Build Watchlist SQL
Inline Code node. Reads `$("Process Post-Trade").first().json.watchlist` and builds a single SQL string combining DELETE + INSERT:
```javascript
const input = $("Process Post-Trade").first().json;
const wl = input.watchlist || [];
const esc = s => (s||'').replace(/'/g,"''");
let sql = "DELETE FROM stocks.watchlist;";
if (wl.length > 0) {
  const vals = wl.map(w=>`('${esc(w.ticker)}','${esc(w.niche)}','${esc(w.direction)}','${esc(w.reason||'').substring(0,500)}')`).join(',');
  sql += ` INSERT INTO stocks.watchlist (ticker,niche,direction,reason) VALUES ${vals};`;
}
return [{json:{watchlist_sql:sql}}];
```

### [31b] Execute Watchlist Update
- Operation: Execute Query
- Query: `{{ $json.watchlist_sql }}`

---

### [38] Has Post-Mortems?
- IF node
- Condition: `{{ $json.has_post_mortems }}` equals `true`

### [39a] Prepare PM Items
Inline Code node. Splits `post_mortem_payloads` array into individual items:
```javascript
const input = $("Process Post-Trade").first().json;
const payloads = input.post_mortem_payloads || [];
if (payloads.length === 0) return [];
return payloads.map(p => ({json: p}));
```

### [40] Trigger Post-Mortem
- Node type: **Execute Workflow** (not HTTP Request)
- Calls the Post-Mortem workflow (Workflow 3) directly by ID
- No webhook URL needed — this is workflow-to-workflow execution
- Each SELL/COVER payload is passed as input to the Post-Mortem workflow

# stocks-investment-agent

AI paper trading system. Goal: beat SPY over 3 months with a $60,000 paper portfolio using swing/position trading (2–6 week horizons), longs and shorts.

## Stack

| Component | Technology |
|-----------|-----------|
| Workflow orchestration | n8n (Railway) |
| Database | Neon PostgreSQL (`stocks` schema) |
| Trade execution | Alpaca Paper Trading API |
| Price data | Alpaca Data API (252 daily bars, 80 stocks + SPY) |
| Fundamentals | Finnhub API (morning only, 60 req/min limit) |
| News | RSS feeds (2 per niche, up to 15 articles/niche/session) |
| Specialist LLMs | GPT-4o-mini |
| Orchestrator LLM | GPT-5.1 |

## Three Workflows

**Main Analysis** — 3×/day (8:30 AM, 12 PM, 4:30 PM ET)
8 specialists → orchestrator → trade execution → snapshot → post-mortem trigger

**Watchdog** — every 30 min during market hours
Detects thesis-flip on open positions → closes via `DELETE /positions/{ticker}` → triggers post-mortem
Does NOT monitor prices — Alpaca handles trailing stops natively (GTC orders)

**Post-Mortem** — triggered via Execute Workflow after every SELL/COVER (not HTTP webhook)
4-component attribution → one `key_lesson` → updates `trade_lessons`, `specialist_accuracy`, `pattern_performance`

## Code Node Files

| File | Workflow | n8n Node |
|------|----------|----------|
| `workflows/code/01_set_session.js` | Main | [2] Set Session |
| `workflows/code/02_compute_derived_metrics.js` | Main | [18] Compute Derived Metrics |
| `workflows/code/03_prepare_rss_sources.js` | Main | [19] Prepare RSS Sources |
| `workflows/code/04_build_specialist_inputs.js` | Main | [22] Build Specialist Inputs |
| `workflows/code/05_parse_specialist_outputs.js` | Main | [24] Parse Specialist Outputs |
| `workflows/code/06_build_orchestrator_input.js` | Main | [26] Build Orchestrator Input |
| `workflows/code/07_parse_orchestrator_output.js` | Main | [28] Parse Orchestrator Output |
| `workflows/code/08_prepare_trade_actions.js` | Main | [30a] Prepare Trade Actions |
| `workflows/code/09_process_post_trade.js` | Main | [35] Process Post-Trade |
| `workflows/code/watchdog_check.js` | Watchdog | [4] Check Signal Flip |
| `workflows/code/post_mortem_build_input.js` | Post-Mortem | [3] Build Post-Mortem Input |
| `workflows/code/post_mortem_store.js` | Post-Mortem | [5] Parse & Store Post-Mortem |

Prompts in `/prompts/` are the spec/reference versions. The prompts that actually execute are embedded as constants inside the Code node files above. When editing a prompt, update both.

## Critical: n8n Node Naming

Code nodes reference each other by exact name via `$("Node Name")`. A typo silently breaks the workflow. Key names:

- `Set Session` — referenced by `02_compute_derived_metrics.js`
- `Fetch Alpaca Account`, `Fetch Alpaca Positions`, `Fetch Alpaca Open Orders`, `Fetch Price Bars` — referenced by `02`
- `Load Signal History`, `Load Specialist Accuracy`, `Load Pattern Performance`, `Load Trade Lessons`, `Load Watchlist`, `Load Earnings Calendar`, `Load Correlation Matrix`, `Load Portfolio Snapshots`, `Load Fundamentals Cache` — referenced by `02`
- `Compute Derived Metrics` — referenced by `04`, `05`, `06`
- `Attach Feed Niche` — referenced by `04`
- `Build Specialist Inputs` — referenced by `05`
- `Parse Specialist Outputs` — referenced by `06`
- `Build Orchestrator Input` — referenced by `07`
- `Parse Orchestrator Output` — referenced by `09`
- `Process Post-Trade` — referenced by inline Build Watchlist SQL and Prepare PM Items nodes
- `Workflow Trigger` — referenced by `post_mortem_build_input.js`
- `Load Signals During Hold` — referenced by `post_mortem_build_input.js`
- `Build Post-Mortem Input` — referenced by `post_mortem_store.js`
- `Fetch Latest Signals`, `Fetch Open Positions` — referenced by `watchdog_check.js`

## Critical: OpenAI Node Versions

Two different native OpenAI node versions are in use — their output shapes differ. Do NOT swap them.

| Node | Version | Output shape |
|------|---------|-------------|
| Call Specialist LLM [23] | v1.3 | `{ message: { content: "..." } }` |
| Call Orchestrator LLM [27] | v2.1 | `{ output: [{ content: [{ text: "..." }] }] }` |
| Call Post-Mortem LLM [4] | v1.3 | `{ message: { content: "..." } }` |

## Risk Rules (hard limits — never override)

- Only HIGH conviction + effective_confidence ≥ 0.75 triggers trades
- Sizing longs: $8k (conf ≥ 0.85) / $5k (0.75–0.84)
- Sizing shorts: $6k (conf ≥ 0.85) / $3k (0.75–0.84)
- Max short exposure: $12k (20% of portfolio)
- Max open positions: 12 total
- Max per sector: 2 (1 long + 1 short)
- Trailing stops: ATR×2.5, clamped 5–15%, set via Alpaca GTC orders
- Penalties (stack multiplicatively — 3+ = no trade): correlation >0.70, earnings ≤2 days, NOISE history, FIRST_SIGNAL

## Key Implementation Details

- **Shares calculation**: always recalculated from live price in `07_parse_orchestrator_output.js` — the LLM's share count is ignored (it uses stale prices)
- **SQL injection**: all LLM-generated text goes through `sqlEsc = s => s.replace(/'/g, "''")` before string interpolation in every Postgres query
- **Price bars**: fetched in 9 parallel HTTP nodes (one per niche + SPY), each 10 symbols × 252 bars. A Code node `Fetch Price Bars` merges all 9 responses into `{bars: {...}}` — `02_compute_derived_metrics.js` reads from this node by name unchanged. Do NOT revert to a single URL fetch — that caused pagination (only 30 bars total returned).
- **Post-mortem trigger**: uses Execute Workflow node (workflow-to-workflow), NOT an HTTP webhook
- **Watchdog close**: uses `DELETE /positions/{ticker}` — atomically closes position AND cancels all associated orders

## Price Bar Fetch Nodes (9 HTTP + 1 Code)

All triggered in parallel by `Collect Orders`. Each HTTP node uses `Alpaca - Data` credential + manual `APCA-API-SECRET-KEY` header.

| Node | Symbols | limit |
|------|---------|-------|
| Fetch Bars Cybersecurity | CRWD,PANW,ZS,OKTA,FTNT,S,CYBR,TMUS,QLYS,TENB | 252 |
| Fetch Bars Defense | LMT,RTX,NOC,GD,HII,LHX,KTOS,RCAT,PLTR,AXON | 252 |
| Fetch Bars Nuclear | CCJ,UEC,NXE,DNN,SMR,OKLO,CEG,VST,ETR,NEE | 252 |
| Fetch Bars Copper | FCX,SCCO,TECK,HBM,VALE,MP,LTHM,ALB,SQM,LAC | 252 |
| Fetch Bars AI Semis | NVDA,AMD,AVGO,QCOM,MRVL,AMAT,KLAC,LRCX,MU,ARM | 252 |
| Fetch Bars Cloud | MSFT,AMZN,GOOGL,META,ORCL,SNOW,MDB,DDOG,NET,CRM | 252 |
| Fetch Bars Oil Gas | XOM,CVX,COP,SLB,HAL,MPC,PSX,VLO,OXY,EOG | 252 |
| Fetch Bars Data Centers | EQIX,DLR,AMT,IREN,CORZ,VRT,SMCI,DELL,HPE,WDC | 252 |
| Fetch Bars SPY | SPY | 252 |
| **Fetch Price Bars** (Code) | Merges all 9 → `{bars: {...}}` | — |

## Key Implementation Details — Execute Market Order

The `Execute Market Order` and `Submit Trailing Stop` HTTP nodes use **`bodyParameters`** (n8n key-value pairs mode), NOT `specifyBody: "string"` or `specifyBody: "json"`. This is the only approach that sends a correctly structured JSON body to Alpaca. The `order_payload` / `trail_stop_payload` objects in `$json` are kept for debug logging but the HTTP nodes pull fields directly: `$json.ticker`, `$json.shares`, `$json.action`, `$json.stop_pct_used`.

## Known Open Issues

No open issues. Main Analysis workflow is fully operational as of 2026-05-20 (5 positions live: CCJ, CRWD, MSFT, NVDA, RTX).

## 8 Niches / 80 Stocks

| Niche ID | Display Name | Tickers |
|----------|-------------|---------|
| `cybersecurity` | Cybersecurity | CRWD, PANW, ZS, OKTA, FTNT, S, CYBR, TMUS, QLYS, TENB |
| `defense` | Defense | LMT, RTX, NOC, GD, HII, LHX, KTOS, RCAT, PLTR, AXON |
| `nuclear_uranium` | Nuclear / Uranium | CCJ, UEC, NXE, DNN, SMR, OKLO, CEG, VST, ETR, NEE |
| `copper_minerals` | Copper / Critical Minerals | FCX, SCCO, TECK, HBM, VALE, MP, LTHM, ALB, SQM, LAC |
| `ai_semiconductors` | AI & Semiconductors | NVDA, AMD, AVGO, QCOM, MRVL, AMAT, KLAC, LRCX, MU, ARM |
| `cloud_hyperscalers` | Cloud Hyperscalers | MSFT, AMZN, GOOGL, META, ORCL, SNOW, MDB, DDOG, NET, CRM |
| `oil_gas` | Oil & Gas | XOM, CVX, COP, SLB, HAL, MPC, PSX, VLO, OXY, EOG |
| `data_centers` | Data Centers & AI Infrastructure | EQIX, DLR, AMT, IREN, CORZ, VRT, SMCI, DELL, HPE, WDC |

## Database Schema (Neon — `stocks` schema)

| Table | Purpose |
|-------|---------|
| `specialist_signals` | Raw signal output per niche per session |
| `portfolio_snapshots` | Portfolio state + P&L vs SPY per session |
| `watchlist` | Stocks flagged for monitoring (replaced entirely each session) |
| `earnings_calendar` | Upcoming earnings dates per ticker |
| `correlation_matrix` | Pairwise 90-day correlation for all 80 stocks |
| `stock_fundamentals` | P/E, P/B, P/S, margins, analyst consensus, price targets |
| `trade_lessons` | Post-mortem attribution + key_lesson per closed trade |
| `specialist_accuracy` | 30-day hit rate, scaling_factor, calibration_error per specialist |
| `pattern_performance` | EV, win rate, avg win/loss per signal pattern type |

## Credentials (n8n)

- **Alpaca Trading API**: key `PKJRLKRDVR3UHBWTAV7KTLKOD6`, base URL `https://paper-api.alpaca.markets/v2`
- **Alpaca Data API**: same keys, base URL `https://data.alpaca.markets/v2`
- **Neon**: host `ep-lively-wave-ajkse4nd-pooler.c-3.us-east-2.aws.neon.tech`, db `neondb`, user `neondb_owner`, SSL required, port 5432
- **Finnhub**: header `X-Finnhub-Token`
- **OpenAI**: configured directly in each node

## Feedback / Learning System

Auto-improves without code changes after each closed trade:
1. **Confidence scaling**: `effective_confidence = reported_confidence × (hit_rate_30d / avg_reported_confidence_30d)`
2. **Pattern EV blocking**: patterns with negative historical EV block new entries
3. **Trade lessons injection**: last 5 post-mortem lessons injected into orchestrator each session
4. **Counterfactual tracking**: alternative picks tracked for same hold period to validate stock selection

## Sector ETFs (used in post-mortem attribution)

`cybersecurity → HACK` | `defense → ITA` | `nuclear_uranium → URA` | `copper_minerals → COPX` | `ai_semiconductors → SOXX` | `cloud_hyperscalers → SKYY` | `oil_gas → XLE` | `data_centers → DTCR`

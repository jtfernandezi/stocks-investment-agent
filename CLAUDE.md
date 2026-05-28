# stocks-investment-agent

AI paper trading system. Goal: beat SPY over 3 months with a $60,000 paper portfolio using swing/position trading (2–6 week horizons), longs and shorts.

## Stack

| Component | Technology |
|-----------|-----------|
| Workflow orchestration | n8n (Railway) |
| Database | Neon PostgreSQL (`stocks` schema) |
| Trade execution | Alpaca Paper Trading API |
| Price data | Alpaca Data API (~350 daily bars, 80 stocks + SPY, start=2025-01-01) |
| Fundamentals | Finnhub API (8:30 AM ET daily via Fundamentals Refresh workflow, 60 req/min limit) |
| News | RSS feeds (2 per niche, up to 15 articles/niche/session) |
| Specialist LLMs | GPT-4o-mini |
| Orchestrator LLM | GPT-5.1 |
| Dashboard | Next.js 15 on Vercel (`web/`) — 6 pages wired to Neon + Alpaca |

## Four Workflows

**Main Analysis v2** — 3×/day (9:30 AM, 12 PM, 3:50 PM ET) — workflow ID: `l2d06hEvDlfLibms`
Schedule Trigger → Fetch Market Status (Finnhub) → Is Market Open? (Start) → [closed: stop | open: Set Session] → 8 parallel specialist branches (each: RSS1 + RSS2 → Merge → Build Message → Specialist LLM → Tag Signal) → merge tree → Parse & Save All Signals → orchestrator → Parse Orchestrator Output → three parallel branches: (1) Process Post-Trade (snapshot + post-mortem), (2) Build Orchestrator Session SQL → Store Orchestrator Summary, (3) Has Trade Actions? → [no trades: No Trades — End | trades: Prepare Trade Actions → trade execution]. Close sessions additionally fan out to the letter generation branch: Is Close Session? → Build Letter Prompt → Letter LLM → Parse & Store Letter → Store Letter → `investor_letters`. Also has a "When Called by Watchdog" trigger that enters at `Set Session` (bypasses the market open gate — watchdog already verifies market hours). All 16 RSS nodes have `continueRegularOutput` error handling — a single failed feed does not stop the workflow.

**Watchdog** — every 30 min, 10:00 AM–3:30 PM ET (starts at 10, not 9:30 — Main Analysis already covers the open; last run at 3:30 so it doesn't overlap the 3:50 PM close session) — workflow ID: `7n1bPJ91OkMx3KM4`
Schedule Trigger → Fetch Market Status (Finnhub) → Is Market Open? → [closed: stop | open: Fetch Alpaca Positions] → single LLM call assesses each position → detects thesis flips → triggers Main Analysis v2 via Execute Workflow ("When Called by Watchdog" entry point). Orchestrator decides whether to close or hold. Does NOT monitor prices — Alpaca handles trailing stops natively (GTC orders).

**Fundamentals Refresh** — daily 8:30 AM ET Mon–Fri — workflow ID: `8hHaG6U0ToaHRAei`
Schedule Trigger → Fetch Market Status (Finnhub) → Is Market Open? → [closed: stop | open: two parallel branches]: (1) Prepare Tickers → Loop Over Tickers → Fetch Metric (Finnhub `/stock/metric`) → Fetch Recommendations (Finnhub `/stock/recommendation`) → Parse Fundamentals → Upsert Fundamentals → Wait (4s) → Loop; (2) Fetch Earnings Calendar (Finnhub `/calendar/earnings?from=today&to=today+30d`) → Parse Earnings → Store Earnings Calendar. Runs before the 9:30 AM Main Analysis so all three daily sessions have fresh P/E, margins, analyst consensus, and upcoming earnings dates. Price targets (FMP `/stable/price-target-consensus`) were evaluated but skipped — free tier only covers ~15–20 of 80 stocks; `price_target_avg/high/low` remain null unless FMP plan is upgraded.

**Post-Mortem** — triggered via Execute Workflow after every SELL/COVER (not HTTP webhook) — workflow ID: `BtVZfEGwbsDpOczg`
3-component attribution (A: Sector Accuracy, B: Entry Timing, C: Exit Timing) → one `key_lesson` → updates `trade_lessons`, `specialist_accuracy`, `pattern_performance`

## Code Node Files

| File | Workflow | n8n Node |
|------|----------|----------|
| `workflows/code/01_set_session.js` | Main v2 | Set Session |
| `workflows/code/02_compute_derived_metrics.js` | Main v2 | Compute Derived Metrics |
| `workflows/code/build_specialist_message.js` | Main v2 | Build [Niche] Message × 8 (template — 3 constants differ per instance) |
| `workflows/code/parse_save_all_signals.js` | Main v2 | Parse & Save All Signals |
| `workflows/code/06_build_orchestrator_input.js` | Main v2 | Build Orchestrator Input |
| `workflows/code/07_parse_orchestrator_output.js` | Main v2 | Parse Orchestrator Output |
| `workflows/code/08_prepare_trade_actions.js` | Main v2 | Prepare Trade Actions |
| `workflows/code/09_process_post_trade.js` | Main v2 | Process Post-Trade |
| `workflows/code/watchdog_has_open_positions.js` | Watchdog | Has Open Positions? |
| `workflows/code/watchdog_build_news_prompt.js` | Watchdog | Build News Prompt |
| `workflows/code/watchdog_parse_flip.js` | Watchdog | Parse Flip Response |
| `workflows/code/post_mortem_build_input.js` | Post-Mortem | Build Post-Mortem Input |
| `workflows/code/post_mortem_store.js` | Post-Mortem | Parse & Store Post-Mortem |
| `workflows/code/letter_build_prompt.js` | Main v2 | Build Letter Prompt (close sessions only) |
| `workflows/code/letter_store.js` | Main v2 | Parse & Store Letter |
| `workflows/code/compute_correlation_matrix.js` | Main v2 | Compute Correlation Matrix |
| `workflows/code/fundamentals_parse.js` | Fundamentals Refresh | Parse Fundamentals |
| `workflows/code/fundamentals_parse_earnings.js` | Fundamentals Refresh | Parse Earnings |

Prompts in `/prompts/` are the spec/reference versions. The prompts that actually execute are embedded as constants inside the Code node files above. When editing a prompt, update both.

## MANDATORY: n8n Sync After Any Code Node Change

**The local `workflows/code/` files are source control. n8n is production. Editing a file is incomplete until the change is live in n8n.**

After editing any file in `workflows/code/`, you MUST push the change to n8n via the API before the task is done:

1. Download the full workflow JSON (`GET /api/v1/workflows/{id}`)
2. Replace the relevant node's `parameters.jsCode` with the updated file content
3. PUT the workflow back using only `{name, nodes, connections, settings.executionOrder, staticData}` — omit all other top-level fields or n8n will reject with "must NOT have additional properties"
4. Confirm the response contains `updatedAt`

n8n API: `https://<N8N_HOST>/api/v1`  
Header: `X-N8N-API-KEY: <key from memory reference_n8n.md>`

Workflow IDs:
- Main Analysis v2: `l2d06hEvDlfLibms` (contains all 8 specialist Build nodes + Build Orchestrator Input)
- Post-Mortem: `BtVZfEGwbsDpOczg` (contains Build Post-Mortem Input)
- Watchdog: `7n1bPJ91OkMx3KM4`

## Critical: n8n Node Naming (Main Analysis v2)

Code nodes reference each other by exact name via `$("Node Name")`. A typo silently breaks the workflow. Key names:

- `Set Session` — referenced by `02_compute_derived_metrics.js`
- `Fetch Alpaca Account`, `Fetch Alpaca Positions`, `Fetch Alpaca Open Orders`, `Fetch Price Bars` — referenced by `02`
- `Load Signal History`, `Load Specialist Accuracy`, `Load Pattern Performance`, `Load Trade Lessons`, `Load Watchlist`, `Load Earnings Calendar`, `Load Correlation Matrix`, `Load Portfolio Snapshots`, `Load Fundamentals Cache`, `Load Orchestrator Sessions` — referenced by `02`
- `Compute Derived Metrics` — referenced by `build_specialist_message.js` (8 instances) and `06`
- `Build Orchestrator Input` — referenced by `07`
- `Parse Orchestrator Output` — referenced by `09`
- `Process Post-Trade` — referenced by inline Build Watchlist SQL and Prepare PM Items nodes
- `Build Letter Prompt` — referenced by `letter_store.js`
- `Parse Orchestrator Output`, `Build Orchestrator Input`, `Compute Derived Metrics` — referenced by `letter_build_prompt.js`
- `Workflow Trigger` — referenced by `post_mortem_build_input.js`
- `Load Signals During Hold` — referenced by `post_mortem_build_input.js`
- `Build Post-Mortem Input` — referenced by `post_mortem_store.js`
- `Has Open Positions?` — referenced by `watchdog_build_news_prompt.js`
- `Fetch Price Bars` — referenced by `compute_correlation_matrix.js` (reads `.bars`)
- `Set Session` — also referenced by `compute_correlation_matrix.js` (morning-only gate)

## Critical: OpenAI Node Versions

Two different native OpenAI node versions are in use — their output shapes differ. Do NOT swap them.

| Node | Version | Output shape |
|------|---------|-------------|
| Specialist [Niche] × 8 | v1.3 | `{ message: { content: "..." } }` |
| Call Orchestrator LLM | v2.1 | `{ output: [{ content: [{ text: "..." }] }] }` |
| Call Post-Mortem LLM | v1.3 | `{ message: { content: "..." } }` |

## Trade Actions

| Action | Meaning | Alpaca `side` |
|--------|---------|--------------|
| BUY | Open a long position | `buy` |
| SELL | Close a long position | `sell` |
| SHORT | Open a short position | `sell` (Alpaca auto-detects short when no existing position) |
| COVER | Close a short position (buy back borrowed shares) | `buy` |

BUY/SELL are for longs. SHORT/COVER are for shorts. COVER = "buy back to close a short."

## Risk Rules (hard limits — never override)

- Only HIGH conviction + effective_confidence ≥ 0.75 triggers trades
- Sizing longs: $8k (conf ≥ 0.85) / $5k (0.75–0.84)
- Sizing shorts: $6k (conf ≥ 0.85) / $3k (0.75–0.84)
- Max short exposure: $12k (20% of portfolio)
- Max open positions: 12 total
- Max per sector: up to 2 longs (1st always allowed; 2nd only with TREND pattern + ≤$5k size) + 1 short
- Trailing stops: ATR×2.5, clamped 5–15%, set via Alpaca GTC orders
- Penalties (stack multiplicatively — 3+ = no trade): correlation >0.70, earnings ≤2 days, NOISE history, FIRST_SIGNAL

## Key Implementation Details

- **Shares calculation**: always recalculated from live price in `07_parse_orchestrator_output.js` — the LLM's share count is ignored (it uses stale prices)
- **SQL injection**: all LLM-generated text goes through `sqlEsc = s => s.replace(/'/g, "''")` before string interpolation in every Postgres query
- **Price bars**: fetched in 9 parallel HTTP nodes (one per niche + SPY), each 10 symbols × up to ~350 bars (limit=3600 shared across all symbols in the request, start=2025-01-01). **Critical**: Alpaca's multi-symbol bars endpoint applies `limit` as a total across all symbols — it fills each ticker sequentially (alphabetically) until the limit is exhausted. With 10 symbols needing ~350 bars each = 3,500 bars total, `limit=3600` ensures all tickers get their full history. Previously `limit=252` meant only the alphabetically-first ticker per node got any bars. A `Merge Price Bars` Merge node (with `numberInputs: 9` and each HTTP node on a distinct port index 0–8) aggregates them before a Code node `Fetch Price Bars` merges all 9 responses into `{bars: {...}}`. Do NOT connect the 9 HTTP nodes directly to the Code node — each trigger fires the Code node separately, causing the entire pipeline to run 9 times.
- **Merge nodes with multiple inputs**: must set `numberInputs: N` and wire each upstream node to a distinct port index 0..N-1. Without this, the Merge node fires after 2 items (default) instead of waiting for all N.
- **Store All Signals node**: set `alwaysOutputData: true` — an `INSERT` without `RETURNING` returns 0 rows; n8n sees no output and stops execution. The SQL also uses `ON CONFLICT (niche, session) DO UPDATE SET ...` to upsert (overwrite stale signals on re-runs).
- **specialist_signals table**: has a `UNIQUE (niche, session)` constraint. The upsert ensures exactly 1 canonical row per niche/session slot.
- **Post-mortem trigger**: uses Execute Workflow node (workflow-to-workflow), NOT an HTTP webhook
- **Watchdog flip response**: when `watchdog_parse_flip.js` detects a flip, it outputs flip context and triggers the orchestrator via Execute Workflow. The orchestrator (not the watchdog) decides whether to close or hold the position. Emergency manual close is still possible via `DELETE /positions/{ticker}` — atomically closes position AND cancels all associated orders.
- **SELL/COVER execution**: uses `DELETE /v2/positions/{ticker}` (not a market sell order). This atomically closes the position AND cancels all associated GTC orders in one call. A GTC trailing stop locks shares, so a plain market SELL will be rejected with "insufficient qty available" if a stop is already attached. The `Is Closing Position?` IF node routes SELL/COVER to `Close Position` (HTTP DELETE) and BUY/SHORT to `Execute Market Order` (HTTP POST). Both merge back at `Merge Trade Actions` before `Restore Trade Context`.
- **Restore Trade Context**: Code node between Merge Trade Actions and Needs Trailing Stop?. Re-attaches `ticker`, `action`, `shares`, `stop_pct_used`, `needs_trailing_stop` from Prepare Trade Actions into `$json` after the Alpaca response overwrites it. Uses symbol-based matching (not array index) so branch-merge ordering doesn't matter.
- **Hard limits in Prepare Trade Actions**: All four limits are enforced in code in `08_prepare_trade_actions.js`, regardless of what the orchestrator outputs. (1) Max 12 open positions. (2) Per-sector: 1st long always allowed; 2nd long only with TREND pattern + ≤$5k; 3rd long blocked; max 1 short per sector. (3) Max $12k total short exposure. (4) Cash guard — cumulative BUY/SHORT `size_usd` cannot exceed available cash. SELL/COVER always pass all four checks. A `TICKER_NICHE` lookup table (all 80 tickers) embedded in 08 drives per-sector tracking from current Alpaca positions.
- **Trailing stop shares**: `Math.floor()` applied to share qty — Alpaca rejects fractional GTC trailing stop orders with 422.
- **Close Position URL**: uses `$('Prepare Trade Actions').item.json.ticker` — NOT `$json.ticker` and NOT `.first()`. After `Cancel Stop Before Close` fires its HTTP DELETE, Alpaca's response overwrites `$json`, so `$json.ticker` becomes undefined. `.item` follows n8n's item-pairing chain and correctly resolves the ticker for each of the N items being processed. `.first()` would always resolve to the first trade's ticker, causing only one position to close regardless of how many SELLs were queued.
- **Wait For Stop Cancel**: 2-second Wait node between `Cancel Stop Before Close` and `Close Position`. Alpaca processes stop cancellations asynchronously — DELETE /v2/orders/{id} returns 204 immediately but the shares remain locked for a short period. Without the wait, the first Close Position call hits "insufficient qty available for order" because the stop hasn't fully cleared yet.

## Price Bar Fetch Nodes (9 HTTP + 1 Code)

All triggered in parallel by `Collect Orders`. Each HTTP node uses `Alpaca - Data` credential + manual `APCA-API-SECRET-KEY` header.

| Node | Symbols | limit |
|------|---------|-------|
| Fetch Bars Cybersecurity | CRWD,PANW,ZS,OKTA,FTNT,S,CYBR,TMUS,QLYS,TENB | 3600 |
| Fetch Bars Defense | LMT,RTX,NOC,GD,HII,LHX,KTOS,RCAT,PLTR,AXON | 3600 |
| Fetch Bars Nuclear | CCJ,UEC,NXE,DNN,SMR,OKLO,CEG,VST,ETR,NEE | 3600 |
| Fetch Bars Copper | FCX,SCCO,TECK,HBM,VALE,MP,LTHM,ALB,SQM,LAC | 3600 |
| Fetch Bars AI Semis | ARM,AMAT,LRCX,KLAC,ON,TER,NXPI,MCHP,MPWR,SNPS | 3600 |
| Fetch Bars Cloud | ORCL,NOW,CRM,DDOG,SNOW,ADBE,NET,TEAM,WDAY,MDB | 3600 |
| Fetch Bars Oil Gas | XOM,CVX,COP,SLB,HAL,MPC,PSX,VLO,OXY,EOG | 3600 |
| Fetch Bars Data Centers | EQIX,DLR,AMT,IREN,CORZ,VRT,SMCI,DELL,HPE,WDC | 3600 |
| Fetch Bars SPY | SPY,HACK,ITA,URA,COPX,SOXX,SKYY,XLE,DTCR | 3600 |
| **Fetch Price Bars** (Code) | Merges all 9 → `{bars: {...}}` | — |

## Key Implementation Details — Execute Market Order

The `Execute Market Order` and `Submit Trailing Stop` HTTP nodes use **`bodyParameters`** (n8n key-value pairs mode), NOT `specifyBody: "string"` or `specifyBody: "json"`. This is the only approach that sends a correctly structured JSON body to Alpaca. After `Restore Trade Context` re-attaches trade fields, `Submit Trailing Stop` reads directly from `$json.ticker`, `$json.shares`, `$json.action`, `$json.stop_pct_used`.

## Enhancements (2026-05-26)

- **Orchestrator session continuity** — new `stocks.orchestrator_sessions` table stores each session's `orchestrator_summary`. Three new n8n nodes: `Load Orchestrator Sessions` (Postgres, loads last 2 rows), `Build Orchestrator Session SQL` (Code, safe apostrophe escaping via `sqlEsc`), `Store Orchestrator Summary` (Postgres). Last 2 summaries injected into every orchestrator call under `## 0. PREVIOUS SESSION CONTEXT`. Watchdog-triggered runs stored as `session_type = 'watchdog_flip'` (derived from `_watchdog` suffix on session_id in `07`).
- **Cold-start anchoring fix** — removed specific cap thresholds from specialist cold-start messages in `build_specialist_message.js`. Specialists now receive neutral calibration guidance; the system applies caps silently in `06`.
- **No Trades — End node** — `Has Trade Actions?` IF node inserted between `Parse Orchestrator Output` and `Prepare Trade Actions`. When orchestrator produces zero actions, execution visibly terminates at `No Trades — End` noOp instead of silently stopping. `Process Post-Trade` and `Build Orchestrator Session SQL` are unaffected (parallel branches from `Parse Orchestrator Output`).
- **Equity curve dashboard fix** — `/api/snapshots` was returning a bare array; client read `.data` from it (always undefined). Fixed to return `{ data: [...] }`. 36 snapshots (May 20–26) now populate the Performance page equity curve.
- **`sessions_in_direction` signal context** — `06_build_orchestrator_input.js` computes consecutive sessions each specialist has held its current direction, derived from `ctx.signalsByNiche` (no extra DB query). Shown in specialist header as `sessions_in_direction: N (tentative|confirmed)`. Thesis-stop rule softened: a single-session NEUTRAL (sessions_in_direction: 1) may be noise; orchestrator uses judgment rather than mandatory exit. Sustained NEUTRAL (2+) warrants a SELL.

## Enhancements (2026-05-27)

- **Portfolio page — Size and Stop $ columns** — Two new columns added to the positions table: `Size` (market value in USD, between Current and P&L) and `Stop $` (live trailing stop price, after Stop %). Table font reduced to `text-xs` and padding to `px-3 py-2` to fit the wider layout.
- **Live trailing stop price from Alpaca** — `/api/positions` now fetches `/orders?status=open&limit=100` from Alpaca in parallel. The `stop_price` field from the active trailing stop order is used directly instead of being computed from `entryPrice × (1 - stopPct%)`. Falls back to the entry-based estimate if no trailing stop order exists (e.g., legacy positions). This fixes the discrepancy where the UI showed the initial stop level rather than the current one (which moves up with price).
- **Sector P&L % bug fix** — In the Performance page, sectors with only closed trades (no open positions) had `costBasis` initialized to `1`, causing `pnlPct = pnl_usd / 1 × 100` (e.g., -$38.61 displayed as -3861%). Fixed by back-calculating the invested amount from `pnl_usd / (pnl_pct / 100)` when adding closed trades to `secMap`.
- **Rolling metrics window reduced** — Rolling Sharpe Ratio and Rolling Volatility charts used WINDOW=5, producing a single dot with only 5 trading days of history. Reduced to WINDOW=3 (gives 3 chart points from day 5 onward). Added `rollingData.length >= 2` guard to hide charts entirely when there's only 1 point.
- **Duplicate BUY/SHORT guard in `08`** — `Prepare Trade Actions` now builds `openTickers` from current Alpaca positions and blocks any BUY or SHORT for a ticker already held, regardless of what the orchestrator outputs. Enforced as check #0 before all other hard limits. Prevents the duplicate-buy scenario (e.g., ZS bought 3× on 2026-05-20 due to concurrent workflow runs).
- **Orchestrator prompt — no duplicate entries, no same-session flip** — Added to the Hard Portfolio Limits section: (1) Never issue BUY for a ticker already held long, or SHORT for a ticker already held short. (2) To flip a long to short (or vice versa), issue the SELL/COVER this session and open the opposite side in a future session — never combine SELL+SHORT or COVER+BUY for the same ticker in the same session output.
- **Orchestrator prompt — quality improvements** — Removed "critical failure state" / "unacceptable" language that created excessive trading pressure. Added NET EXPOSURE MANAGEMENT section with regime-aware targets (60–110% bull / 20–60% flat / −20–+30% bear). Added `rejected_candidates` and `risk_summary` to output schema so the orchestrator documents what it considered and why it passed.
- **Post-mortem simplified to 3 attribution components** — Removed Component B (Stock Selection Quality): alternative picks data was never captured at entry time, making the component always blind and causing hallucinated `stock_selection_quality` values. Components renumbered: A = Sector Accuracy, B = Entry Timing, C = Exit Timing. `stock_selection_quality` and `alternative_picks` columns dropped from `trade_lessons`. Both workflows and prompts updated.
- **`pnl_usd` locked to computed value** — `post_mortem_store.js` previously let the LLM override the system-computed P&L (`parsed.pnl_usd ?? inputCtx.pnl_usd`). Flipped to `inputCtx.pnl_usd ?? parsed.pnl_usd` so the value derived from actual entry/exit prices always wins.
- **`position_metadata` backfilled** — All 5 pre-2026-05-25 positions (CEG, CRWD, MSFT, NVDA, SCCO) manually backfilled with accurate entry date (2026-05-20), Alpaca `avg_entry_price`, niche, original thesis, and signal_history_pattern sourced from `portfolio_snapshots`.
- **Post-mortem confirmed live** — First real orchestrator-initiated SELL/COVER post-mortem ran successfully for ZS on 2026-05-27 (execution 353). Full chain verified: Workflow Trigger → Load Signals → ETF Bars → Build Input → LLM → Parse → Insert Trade Lesson → Update Specialist Accuracy → Update Pattern Performance ✓
- **Correlation matrix populated automatically** — `correlation_matrix` table was always empty (no workflow wrote to it). Added `Compute Correlation Matrix` Code node (90-day Pearson, all pairs stored, every session) + `Store Correlation Matrix` Postgres node as a parallel branch from `Fetch Price Bars` in Main Analysis v2. Stores all ~3,700 ticker pairs (no threshold filter) so the portfolio heatmap shows real correlation values for every position pair. Orchestrator's 0.70 penalty threshold is applied in the prompt, not at the storage layer.

## Enhancements (2026-05-28)

- **Niche rename + stock swap** — Two niches renamed with entirely new stock lists focused on more liquid swing-trading candidates (selected by dollar volume analysis):
  - `ai_semiconductors` → `semiconductors` (Display: "Semiconductors & EDA"): NVDA/AMD/AVGO/QCOM/MRVL/MU removed; replaced with ARM, AMAT, LRCX, KLAC, ON, TER, NXPI, MCHP, MPWR, SNPS (EDA tools + analog/power semis).
  - `cloud_hyperscalers` → `enterprise_saas` (Display: "Enterprise SaaS"): MSFT/AMZN/GOOGL/META/MU removed; replaced with ORCL, NOW, CRM, DDOG, SNOW, ADBE, NET, TEAM, WDAY, MDB (pure-play SaaS with clearer catalysts).
  - Updated everywhere: `08_prepare_trade_actions.js` TICKER_NICHE, `02_compute_derived_metrics.js` NICHE_ETF + NICHES array, `fundamentals_parse_earnings.js` TICKERS set, `web/lib/constants.ts` TICKER_NICHE + NICHE_DISPLAY + ALL_NICHES, n8n Build Message nodes (NICHE/NICHE_DISPLAY/TICKERS), n8n Fetch Bars URLs, n8n Fundamentals Refresh Prepare Tickers, n8n RSS AI & Semiconductors 2 (arstechnica → semiengineering.com).
- **Alpaca credentials rotated** — New paper trading account (key: <ALPACA_API_KEY_ID>). Updated in all n8n HTTP nodes (Alpaca Trading + Alpaca Data credentials) and Vercel environment variables. DB reset to fresh $60k start.

## Known Open Issues

None. All previously tracked issues resolved as of 2026-05-28.

## position_metadata notes

- Written by "Prepare Position Metadata" → "Store Position Entry" in Main Analysis v2, triggered after every BUY/SHORT execution (parallel branch from Process Post-Trade)
- Read by "Load Position Metadata" in Main Analysis v2 — provides `days_held`, `entry_niche`, `entry_thesis` on all open positions in `02_compute_derived_metrics.js`
- Read by "Load Position Entry" in Post-Mortem workflow — provides actual `entry_date` and `entry_price` for attribution
- ETF return: computed by "Prepare ETF Fetch" → "Fetch ETF Bars" → "Compute ETF Return" in Post-Mortem using the actual hold period dates; fed to `post_mortem_build_input.js` via `$("Compute ETF Return").first().json.etf_return`
- Cold-start: positions opened before 2026-05-25 (CEG, CRWD, MSFT, NVDA, SCCO) were manually backfilled on 2026-05-27 with entry date/price/thesis/pattern from `portfolio_snapshots`. All current positions have metadata rows.

## Workflow Schedule Summary (all times ET, Mon–Fri)

| Time | Workflow | Action |
|------|----------|--------|
| 8:30 AM | Fundamentals Refresh | Fetch P/E, margins, analyst consensus for all 80 stocks |
| 9:30 AM | Main Analysis v2 | Morning session — full specialist + orchestrator run |
| 10:00 AM–3:30 PM | Watchdog | Every 30 min — thesis flip detection on open positions |
| 12:00 PM | Main Analysis v2 | Midday session |
| 3:50 PM | Main Analysis v2 | Close session (+ investor letter generation) |
| On demand | Post-Mortem | Triggered after every SELL/COVER |

All scheduled workflows gate on Finnhub `isOpen` at startup — exits cleanly on holidays without running any downstream nodes.

## Specialist Data Enhancements (2026-05-25)

Four new data points added to every specialist's per-stock input block:

1. **Relative strength vs sector ETF** — `vs ETF: 1D: +1.2% | 5D: +3.4% | 30D: -0.8%`. `Fetch Bars SPY` now fetches all 8 sector ETFs alongside SPY. `02_compute_derived_metrics.js` builds `etfPriceMap` keyed by niche; `build_specialist_message.js` computes stock return minus ETF return per period.

2. **Volume / ADV ratio** — `Volume: 42.1M (ADV20: 28.5M) | Ratio: 1.48x`. Computed from bar `v` field already in the 252-bar fetch. ADV20 uses prior 20 sessions (excluding most recent bar). Ratio > 1.5x = institutional conviction; < 0.5x = move lacks conviction.

3. **Analyst upside %, PT spread, buy consensus %** — `Consensus: 12B / 3H / 1S (75% buy) | PT: $145.00 (+20.8% upside) | Spread: $110–$180 (48% — wide)`. All computed in `formatStockData` from existing Finnhub fundamentals. System prompt includes explicit long/short inversion guidance: heavy buy consensus on a short = squeeze risk, not support.

4. **Cold-start confidence cap** — Specialists with < 10 sessions on record have no reliable calibration. `06_build_orchestrator_input.js` caps effective_confidence before the orchestrator sees it: 0–4 sessions → cap 0.72 (below trading threshold), 5–9 sessions → cap 0.78 (min size only). `build_specialist_message.js` tells the specialist it's in cold-start mode and to report honest analysis — the specific cap values are intentionally NOT revealed to the specialist to prevent anchoring (discovered 2026-05-26: revealing 0.72 caused all 8 specialists to output exactly 0.72).

## Watchdog Enhancements (2026-05-25)

- **Investment thesis passed to watchdog** — `watchdog_has_open_positions.js` now includes `niche` per position. A new `Load Position Metadata (Watchdog)` Postgres node reads thesis + niche from `position_metadata` into `watchdog_build_news_prompt.js` via `metaMap`.
- **Short inversion logic** — Full worked examples and failure modes added to the watchdog system prompt: BEARISH news on a SHORT confirms the thesis; BULLISH news threatens it.
- **`news_assessment` field** — Watchdog LLM now outputs `news_assessment: CONFIRMS | THREATENS | NEUTRAL` alongside `direction: BULLISH | BEARISH | NEUTRAL`. These must be internally consistent.
- **Contradiction detection** — `watchdog_parse_flip.js` detects `thesis_intact: false + news_assessment: CONFIRMS` (logical impossibility), suppresses it from flip triggering, stores it in `stocks.watchdog_events`, and sends a Gmail alert.
- **Stop proximity** — `Fetch Alpaca Open Orders (Watchdog)` node feeds trailing stop distances into the watchdog prompt. CRITICAL (<3% away) lowers the flip confidence threshold from 0.60 to 0.50.

## Live Test Results (2026-05-22)

All four workflows activated and running autonomously.

- **BUY + trailing stop path**: verified 2026-05-21 ✓
- **SELL/COVER path**: verified 2026-05-22 — CCJ closed at $104.84 via DELETE /v2/positions/CCJ ✓
- **Cancel Stop Before Close**: verified — cancels GTC trailing stop before position close ✓
- **Watchdog flip detection**: verified — CCJ thesis flip (Cameco milling suspension) detected, Main Analysis v2 triggered ✓
- **Post-mortem trigger**: wired correctly; fires on first real orchestrator-initiated SELL ✓ (pending live test)

## 8 Niches / 80 Stocks

| Niche ID | Display Name | Tickers |
|----------|-------------|---------|
| `cybersecurity` | Cybersecurity | CRWD, PANW, ZS, OKTA, FTNT, S, CYBR, TMUS, QLYS, TENB |
| `defense` | Defense | LMT, RTX, NOC, GD, HII, LHX, KTOS, RCAT, PLTR, AXON |
| `nuclear_uranium` | Nuclear / Uranium | CCJ, UEC, NXE, DNN, SMR, OKLO, CEG, VST, ETR, NEE |
| `copper_minerals` | Copper / Critical Minerals | FCX, SCCO, TECK, HBM, VALE, MP, LTHM, ALB, SQM, LAC |
| `semiconductors` | Semiconductors & EDA | ARM, AMAT, LRCX, KLAC, ON, TER, NXPI, MCHP, MPWR, SNPS |
| `enterprise_saas` | Enterprise SaaS | ORCL, NOW, CRM, DDOG, SNOW, ADBE, NET, TEAM, WDAY, MDB |
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
| `investor_letters` | LLM-written investor letters per close session — `session` UNIQUE, `body` full prose text |
| `position_metadata` | Entry date, price, niche, thesis per open position — ticker PRIMARY KEY, UPSERTed at BUY/SHORT execution time |
| `orchestrator_sessions` | One row per orchestrator run — `session_id`, `session_type` (`morning`/`midday`/`close`/`watchdog_flip`), `summary` text. No UNIQUE constraint (watchdog re-runs same session_id). Last 2 rows by `created_at` injected into next orchestrator call as `## 0. PREVIOUS SESSION CONTEXT`. |

## Credentials (n8n)

- **Alpaca Trading API**: key `<ALPACA_API_KEY_ID>`, base URL `https://paper-api.alpaca.markets/v2`
- **Alpaca Data API**: same keys, base URL `https://data.alpaca.markets/v2`
- **Neon**: host `<NEON_HOST>`, db `neondb`, user `neondb_owner`, SSL required, port 5432
- **Finnhub**: header `X-Finnhub-Token`
- **OpenAI**: configured directly in each node

## Feedback / Learning System

Auto-improves without code changes after each closed trade:
1. **Confidence scaling**: `effective_confidence = reported_confidence × (hit_rate_30d / avg_reported_confidence_30d)`
2. **Pattern EV blocking**: patterns with negative historical EV block new entries
3. **Trade lessons injection**: last 5 post-mortem lessons injected into orchestrator each session
4. **Counterfactual tracking**: alternative picks tracked for same hold period to validate stock selection

## Sector ETFs (used in post-mortem attribution)

`cybersecurity → HACK` | `defense → ITA` | `nuclear_uranium → URA` | `copper_minerals → COPX` | `semiconductors → SOXX` | `enterprise_saas → SKYY` | `oil_gas → XLE` | `data_centers → DTCR`

# stocks-investment-agent

AI paper trading system. Goal: beat SPY over 3 months with a $60,000 paper portfolio using swing/position trading (2–6 week horizons), longs and shorts.

## Stack

| Component | Technology |
|-----------|-----------|
| Workflow orchestration | n8n (Railway) |
| Database | Neon PostgreSQL (`stocks` schema) |
| Trade execution | Alpaca Paper Trading API |
| Price data | Alpaca Data API (~350 daily bars, 100 stocks + SPY + 10 sector ETFs, start=2025-01-01) |
| Fundamentals | Finnhub API (8:30 AM ET daily via Fundamentals Refresh workflow, 60 req/min limit) |
| News | RSS feeds (2 per niche, up to 15 articles/niche/session) |
| Specialist LLMs | Google Gemini 2.5 Flash (HTTP node; migrated from GPT-4o 2026-06-06 for ~3× cost cut) |
| Orchestrator LLM | GPT-5.1 |
| Dashboard | Next.js 15 on Vercel (`web/`) — 6 pages wired to Neon + Alpaca |

## Four Workflows

**Main Analysis v2** — 3×/day (9:30 AM, 12 PM, 3:50 PM ET) — workflow ID: `l2d06hEvDlfLibms`
Schedule Trigger → Fetch Market Status (Finnhub) → Is Market Open? (Start) → [closed: stop | open: Set Session] → 10 parallel specialist branches (each: RSS1 + RSS2 → Merge → Build Message → Specialist LLM → Tag Signal) → balanced binary merge tree (8 niches → Merge All Signals; + Healthcare/Financials → Merge L1 Health Fin; both → Merge All 10 Signals) → Parse & Save All Signals → orchestrator → Parse Orchestrator Output → four parallel branches: (1) Process Post-Trade (snapshot + post-mortem), (2) Build Orchestrator Session SQL → Store Orchestrator Summary, (3) Has Trade Actions? → [no trades: No Trades — End | trades: Prepare Trade Actions → trade execution], (4) Build Session Email → Send Session Email (HTML session-summary email to <ALERT_EMAIL> via the `Gmail account` gmailOAuth2 credential — same one used by the Watchdog contradiction alert). The email branch reports Option-A orchestrator *decisions* (pre-08-filtering), reads `Parse Orchestrator Output` + `Compute Derived Metrics`, and self-suppresses on watchdog-triggered runs (`orchestrator_session_type === 'watchdog_flip'` → returns `[]`). Both email nodes carry `continueOnFail: true` so an email failure can never break trading/snapshot/summary branches. Close sessions additionally fan out to the letter generation branch: Is Close Session? → Build Letter Prompt → Letter LLM → Parse & Store Letter → Store Letter → `investor_letters`. Also has a "When Called by Watchdog" trigger that enters at `Set Session` (bypasses the market open gate — watchdog already verifies market hours). All 20 RSS nodes have `continueRegularOutput` error handling — a single failed feed does not stop the workflow.

**Watchdog** — every 30 min at :10 and :40, 10:10 AM–3:40 PM ET (starts at 10:10, not 9:30 — Main Analysis already covers the open; runs at :10/:40 to avoid the 12:00 PM midday Main Analysis; last run at 3:40 so it doesn't overlap the 3:50 PM close session) — workflow ID: `7n1bPJ91OkMx3KM4`
Schedule Trigger → Fetch Market Status (Finnhub) → Is Market Open? → [closed: stop | open: Fetch Alpaca Positions] → two parallel branches: (A) Has Open Positions? → IF Has Positions? → three parallel branches: (1) Split Tickers → Fetch Alpaca News → Build News Prompt → Call Watchdog LLM → Parse Flip Response → IF Flips Detected? → [no flips: Done | flips: Trigger Main Analysis], (2) Load Position Metadata (Watchdog) [thesis/niche, read by Build News Prompt via $()], (3) Fetch Alpaca Open Orders (Watchdog) [trailing stop proximity, read by Build News Prompt via $()]; (B) Load All Position Metadata → Find TS Exits → Fetch TS Order → Build TS PM Payload → Trigger PM (Trailing Stop) → Delete TS Metadata. Branch B detects trailing stop exits (positions in `position_metadata` but gone from Alpaca, or with qty < 1) and routes them through the Post-Mortem workflow within ~30 min. Orchestrator decides whether to close or hold. Does NOT monitor prices — Alpaca handles trailing stops natively (GTC orders).

**Fundamentals Refresh** — daily 8:30 AM ET Mon–Fri — workflow ID: `8hHaG6U0ToaHRAei`
Schedule Trigger → Fetch Market Status (Finnhub) → Is Market Open? → [closed: stop | open: two parallel branches]: (1) Prepare Tickers → Loop Over Tickers → Fetch Metric (Finnhub `/stock/metric`) → Fetch Recommendations (Finnhub `/stock/recommendation`) → Parse Fundamentals → Upsert Fundamentals → Wait (4s) → Loop; (2) Fetch Earnings Calendar (Finnhub `/calendar/earnings?from=today&to=today+30d`) → Parse Earnings → Store Earnings Calendar. Runs before the 9:30 AM Main Analysis so all three daily sessions have fresh P/E, margins, analyst consensus, and upcoming earnings dates. Price targets (FMP `/stable/price-target-consensus`) were evaluated but skipped — free tier only covers ~15–20 of 100 stocks; `price_target_avg/high/low` remain null unless FMP plan is upgraded.

**Post-Mortem** — triggered via Execute Workflow after every SELL/COVER (not HTTP webhook) — workflow ID: `BtVZfEGwbsDpOczg`
3-component attribution (A: Sector Accuracy, B: Entry Timing, C: Exit Timing) → one `key_lesson` → updates `trade_lessons`, `specialist_accuracy`, `pattern_performance`

## Audit Automation (self-improving layer — runs in GitHub Actions, not n8n)

A meta layer that watches the fund and proposes improvements. **Cloud-hosted on GitHub Actions so it runs with the Mac off.** Full docs: `automation/README.md`.

- **Daily canary** (`.github/workflows/daily-canary.yml` → `automation/canary.mjs`) — weekdays 21:30 UTC (4:30 PM ET, after market close). Deterministic integrity check (no LLM) for the silent-failure class (cash deadlock, frozen watchlist, partial signals, `effective_confidence` pinned ≤0.72). Silent when healthy; Telegram alarm only on failure.
- **Weekly audit** (`.github/workflows/weekly-audit.yml` → headless Claude Code running `automation/weekly_audit_prompt.md`) — Sundays 06:11 UTC (00:11 America/Mexico_City, overnight to avoid daytime token contention). 7-lever review (alive / edge / specialist calibration / orchestrator judgment / guardrails / data / system-improvement), longitudinal (reads prior `audits/*.md` + `audits/IMPROVEMENT_BACKLOG.md`), **opens a PR** with Type A tunable fixes + the report; Type B structural ideas go to the backlog only (never auto-coded). Telegram digest links the PR.

**Cannot break the fund (by construction):** read-only `audit_ro` Neon role (SELECT-only; the DB itself rejects writes); the weekly audit runs with MCP disabled (`--strict-mcp-config` + `automation/empty-mcp.json`) so it can't reach a writable Neon MCP; n8n/Alpaca are GET-only by mandate; PR isolation — never pushes to main, never merges, never trades. Worst case = a Telegram you ignore + a PR you close. Auth via `CLAUDE_CODE_OAUTH_TOKEN` (Claude subscription token); model defaults to `opus` (runs overnight so it doesn't compete with daytime interactive quota).

Secrets: 9 GitHub repo secrets + `~/.config/stocks-audit/secrets.env` (local, chmod 600, for manual `automation/run_*.sh` runs). Local launchd agents (`com.stocks.*`) were decommissioned 2026-06-09 — do NOT re-enable them or jobs double-fire. Telegram bot: @trade_stocks_ai_bot.

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
| `workflows/code/build_session_email.js` | Main v2 | Build Session Email (scheduled sessions only — HTML session summary email) |
| `workflows/code/fundamentals_parse.js` | Fundamentals Refresh | Parse Fundamentals |
| `workflows/code/fundamentals_parse_earnings.js` | Fundamentals Refresh | Parse Earnings |
| `workflows/code/detect_trailing_stop_exits.js` | Watchdog | Find TS Exits |
| `workflows/code/build_ts_pm_payload.js` | Watchdog | Build TS PM Payload |

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
- Main Analysis v2: `l2d06hEvDlfLibms` (contains all 10 specialist Build nodes + Build Orchestrator Input)
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

## Critical: LLM Node Types & Output Shapes

Different nodes use different providers/shapes. Do NOT swap them.

| Node | Type / Model | Output shape |
|------|--------------|-------------|
| Specialist [Niche] × 10 | **HTTP Request → Gemini 2.5 Flash** (cred `Gemini API`, header `x-goog-api-key`; JSON body built inline from `$json.system_prompt`/`user_prompt` with `responseMimeType: application/json`) | `{ candidates: [{ content: { parts: [{ text }] } }] }` — the `Tag [Niche] Signal` Code node normalizes this to `{ message: { content } }`, so `parse_save_all_signals.js` needs no change |
| Call Orchestrator LLM | native OpenAI v2.1 — GPT-5.1 | `{ output: [{ content: [{ text: "..." }] }] }` |
| Call Post-Mortem LLM | native OpenAI v1.3 — GPT-4o | `{ message: { content: "..." } }` |
| Letter LLM / Call Watchdog LLM | native OpenAI v1.3 — GPT-4o-mini | `{ message: { content: "..." } }` |

The Gemini key lives in the n8n credential `Gemini API` (id `Qv5tT8Y3Eoc6YBWZ`), not in the workflow JSON. To revert a specialist to OpenAI, restore the `@n8n/n8n-nodes-langchain.openAi` node + its `modelId`, and the Tag node's `r.message.content` fallback still works.

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
- Trailing stops: ATR×3, clamped 8–20%, set via Alpaca GTC orders (widened 2026-06-05 for the 2–6 week swing horizon; also enforced as a hard [8,20] band in `07`)
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
- **Trailing stop shares**: `Math.floor()` applied to share qty — Alpaca rejects fractional GTC trailing stop orders with 422. Buy order qty is also `Math.floor()` (whole shares only) so the trailing stop covers the full position with no fractional remainder.
- **Close Position URL**: uses `$('Prepare Trade Actions').item.json.ticker` — NOT `$json.ticker` and NOT `.first()`. After `Cancel Stop Before Close` fires its HTTP DELETE, Alpaca's response overwrites `$json`, so `$json.ticker` becomes undefined. `.item` follows n8n's item-pairing chain and correctly resolves the ticker for each of the N items being processed. `.first()` would always resolve to the first trade's ticker, causing only one position to close regardless of how many SELLs were queued.
- **Wait For Stop Cancel**: 2-second Wait node between `Cancel Stop Before Close` and `Close Position`. Alpaca processes stop cancellations asynchronously — DELETE /v2/orders/{id} returns 204 immediately but the shares remain locked for a short period. Without the wait, the first Close Position call hits "insufficient qty available for order" because the stop hasn't fully cleared yet.

## Price Bar Fetch Nodes (9 HTTP + 1 Code)

All triggered in parallel by `Collect Orders`. Each HTTP node uses `Alpaca - Data` credential + manual `APCA-API-SECRET-KEY` header.

| Node | Symbols | limit |
|------|---------|-------|
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
| **Fetch Price Bars** (Code) | Merges all 11 → `{bars: {...}}` (hardcoded sourceNodes list — add new bars nodes here) | — |

`Merge Price Bars` is a v3 Merge with `numberInputs: 11` (one port per bars node). `Fetch Bars SPY` carries SPY + all 10 sector ETFs at `limit=4400` (11 symbols × ~355 bars).

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
- **Fundamentals Refresh market gate fix** — `Is Market Open?` condition changed from `isOpen` to `holiday === null`. The workflow runs at 8:30 AM ET before the market opens, so `isOpen` is always false at that time — it was silently skipping every day. Now gates correctly on whether it's a trading day (not a holiday), regardless of session state.
- **Watchdog connection fix** — `Load Position Metadata (Watchdog)` and `Fetch Alpaca Open Orders (Watchdog)` were incorrectly placed in series before `Split Tickers`. An empty orders response (no trailing stops) would produce 0 items and block the entire downstream LLM chain. Both nodes now run as parallel branches from `IF Has Positions?`, matching the original working flow where `Split Tickers` is triggered directly.
- **Watchdog schedule shifted** — Cron changed from `0,30 10-15` to `10,40 10-15`. Runs at :10 and :40 past each hour (10:10 AM–3:40 PM ET) to avoid simultaneous execution with the 12:00 PM midday Main Analysis session.
- **Trailing stop race condition fix** — `Submit Trailing Stop` was firing immediately after `Execute Market Order`, before Alpaca had filled the market buy orders. Alpaca rejected all trailing stop (sell) orders with "cannot open a short sell while a long buy order is open." Added `Wait For Fill` (5s) node between `Restore Trade Context` and `Needs Trailing Stop?`.

## Enhancements (2026-05-28 — session 2)

- **Watchdog `No Contradictions - Done` NoOp** — Added a named terminal node to the FALSE branch of `IF Contradictions?`. Previously the FALSE branch silently stopped with no visible node in the canvas. Now matches the pattern of all other terminal branches (`Market Closed - Done`, `No Positions - Done`, `No Flips - Done`).
- **Watchdog blueprint + README schedule corrected** — `watchdog_blueprint.md` and `README.md` still documented the old `:00`/`:30` schedule. Updated to match the live cron (`10,40 10-15`) — 10:10 AM–3:40 PM ET at :10 and :40 — including the rationale for the :10/:40 offset.
- **Investor letter prompt rewrite** — `letter_build_prompt.js` overhauled. Previous prompt fed the LLM a raw data dump (entry prices, effective confidence scores, specialist signal tables) leading to mechanical letters. New prompt: practitioner-style LP letter (Howard Marks / Seth Klarman tone), thesis-first prose, no internal jargon. User prompt now includes: positions with entry thesis + days held, trades in plain English, sector rotation outlook, watchlist with trigger conditions, and earnings at-risk. Specialist signal tables and confidence scores removed from letter context entirely.

## Enhancements (2026-05-28 — session 3)

- **Post-Mortem workflow — 3 data bugs fixed** — Execution #353 (ZS post-mortem) revealed that all three context nodes were silently failing, leaving the LLM with no signal history and no ETF benchmark. Root causes and fixes:
  1. **`Load Signals During Hold` — `entry_date` undefined** — The node is wired from `Load Position Entry`; when that returns `{}` (no `position_metadata` row), `$json.entry_date` is `undefined` and the SQL fails. Fixed: expression now falls back to `$("Workflow Trigger").first().json.entry_date` which is always present.
  2. **`Fetch ETF Bars` — URL expressions not evaluated** — Query params (`symbols`, `start`, `end`) were embedded as `{{ }}` template strings in the URL field, which n8n does not evaluate in that mode. Fixed: params moved to the node's built-in Query Parameters key-value section with expression mode enabled per field.
  3. **`Prepare ETF Fetch` — stale niche names** — The inline Code node still mapped `ai_semiconductors → SOXX` and `cloud_hyperscalers → SKYY`. Fixed: updated to `semiconductors` and `enterprise_saas` to match the 2026-05-28 rename. Note: this node has no corresponding local JS file (it is inline in n8n only).
- **Dashboard — "Buying Power" renamed to "Available Cash"** — Home page stat card was reading `account.buying_power` (2× cash due to Alpaca margin account) and labelling it "Buying Power / Available margin." Since the system never uses margin, this was misleading. Changed to `account.cash` with label "Available Cash / Uninvested cash" (`web/app/page.tsx`).
- **Dashboard — "Invested" stat card added** — New card inserted between "Available Cash" and "Open Positions" showing gross invested capital (`long_market_value + |short_market_value|`) with subtext "long + short exposure". No new API call — both values already fetched from `/api/account`.
- **Dashboard — home page stat row expanded to 7 cards** — Grid updated from `xl:grid-cols-6` to `xl:grid-cols-7` so all 7 cards fit in one row on desktop (≥1280px). `lg` breakpoint updated to `grid-cols-4` for cleaner 4/3 wrapping on medium screens.

## Enhancements (2026-05-28 — session 4)

- **Full mobile responsive pass** — Complete overhaul of all 6 pages for mobile (375px+). Key architectural changes:
  - `BottomNav` component — fixed bottom tab bar (Home / Portfolio / Research / Perf / Agent / Letter), visible below `md` breakpoint. Sidebar hidden on mobile (`hidden md:flex`).
  - `PageShell` — mounts `BottomNav`, reduces padding to `p-4` on mobile, adds `pb-24` clearance for bottom nav bar.
  - `Header` — compact on mobile (next session + vs SPY only), full info on desktop.
  - `MarketClock` — `flex-wrap` so status / sublabel / next session stack on narrow screens.
  - `StatCard` — `text-base / p-3` on mobile, `text-xl / p-4` on desktop.
  - `globals.css` — `overflow-x: hidden` on body to prevent rogue horizontal scroll.
  - `SectorPnLWidget` — sector label `w-44` → `w-24 md:w-44`.
  - `SectorTreemap` — wrapped in `overflow-x-auto` with `min-w-[480px]` so blocks stay legible instead of squashing.
  - `MonthlyReturnsGrid` — tighter cell padding and `text-xs` for data cells.
  - `CorrelationHeatmap` — row label column `7rem` → `5rem`, `pr-3` → `pr-2`.
- **Dashboard (page.tsx) refactored** — now uses `PageShell`; stat grid `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7`; hero `text-3xl` on mobile.
- **Portfolio mobile card view** — `MobilePositionCard` component renders instead of the 15-column table on mobile (`md:hidden` / `hidden md:block`). Expanded dropdown has 4 labeled sections: P&L & Size (unrealized P&L $ + shares), Stop & Risk (stop $, dist to stop, stop %), Signal Quality (conviction + confidence bar), Entry Reasoning (thesis + thesis intact status). Desktop table dropdown cleaned up — removed Stop %, Stop Price, Today Δ, Market Val, Conf Score (all redundant with table columns); only conviction stays alongside thesis. Reasoning font reduced to `text-xs` to match table density. Full-width reasoning (removed `max-w-3xl`). `ArrowRight` icon replaces invisible `text-rim` arrow between entry and current price.
- **Letter page** — archive sidebar `hidden lg:block`; horizontal pill-strip session picker added for mobile (`lg:hidden`, `-mx-4 px-4 overflow-x-auto`); prev/next nav `hidden lg:flex`; letter padding `px-4 md:px-8`; `max-w-2xl` removed from letter body so prose fills the full card width.
- **Research watchlist** — `w-52` fixed column replaced with `flex-col md:flex-row` adaptive layout; niche label moves to its own line on mobile via `w-full md:w-auto`.
- **Agent page** — specialist table hides Rank / Signals / Calib. Error on mobile (`hidden md:table-cell`); session log column `w-36` → `w-28 md:w-36`.
- **Performance page** — Core Metrics grid `lg:grid-cols-3` → `md:grid-cols-3`; Sector P&L label `w-48` → `w-24 md:w-48`; Trade History table hides Date and Hold columns on mobile.
- **Dashboard layout redesigned — 2×2 grid** — New layout:
  - Row 1: Equity Curve | Top Positions
  - Row 2: Specialist Signals (heat tiles) | Sector Performance
- **SignalSummaryWidget** — new `web/app/components/SignalSummaryWidget.tsx`. Fetches latest signal per niche via `DISTINCT ON (niche) ORDER BY niche, created_at DESC`. Renders an 8-tile heat grid (`grid-cols-2 md:grid-cols-4`) using the same HSL colour function as the Research heatmap (direction = hue, confidence = intensity). Each tile shows niche short name, direction icon (TrendingUp / TrendingDown / Minus), conviction label. Text colour computed from tile luminance (white on dark, surface-dark on light). Header shows bullish / neutral / bearish tally + session label.

## Enhancements (2026-05-31)

- **Trailing stop exit detection** — Alpaca trailing stops fire autonomously with no callback to n8n, leaving closed positions invisible to the Performance page (`trade_lessons` only gets written by orchestrator SELL/COVER). Fixed by adding a 6-node TS reconciliation branch to the Watchdog workflow: `Load All Position Metadata` → `Find TS Exits` → `Fetch TS Order` → `Build TS PM Payload` → `Trigger PM (Trailing Stop)` → `Delete TS Metadata`. Runs in parallel with the flip-detection branch on every Watchdog tick (~30 min after a trailing stop fires). `Find TS Exits` detects exits by comparing `position_metadata` rows against live Alpaca positions — flags any ticker with qty < 1 (catches whole-position closes AND the fractional-share rounding stub case). `Build TS PM Payload` fetches the filled trailing stop order from Alpaca to get the real exit price and computes actual P&L. `Trigger PM (Trailing Stop)` fires the Post-Mortem workflow (`BtVZfEGwbsDpOczg`) with the same payload shape as orchestrator SELL/COVER — full LLM attribution (sector accuracy, entry/exit timing, key lesson) runs identically. `Delete TS Metadata` removes the row from `position_metadata` after the post-mortem fires so subsequent Watchdog runs don't re-trigger.
- **`position_metadata` — confidence columns added (2026-06-01)** — Added `entry_specialist_confidence` and `entry_effective_confidence` (NUMERIC, nullable) columns to `stocks.position_metadata`. `Prepare Position Metadata` now writes `action.confidence` and `action.effective_confidence` from the orchestrator output. `Store Position Entry` SQL updated with the new columns in both INSERT and ON CONFLICT UPDATE. `Load All Position Metadata` SELECT updated to include them. `build_ts_pm_payload.js` now reads these from `tsInfo` instead of defaulting to null — trailing stop post-mortems will have correct confidence values instead of 0.
- **Watchdog TS detection — two bugs fixed (2026-06-01)** — First live run revealed: (1) `Load All Position Metadata` was wired from `Fetch Alpaca Positions` (4 items) causing the Postgres SELECT to run 4× and return 16 rows — `Find TS Exits` emitted RCAT 4 times instead of once. Fixed by rewiring to `Has Open Positions?` (always 1 item). (2) n8n's HTTP node splits JSON array responses into individual items — `Build TS PM Payload` expected `$input.first().json` to be an array but received a single order object, causing `orders = []` and `return []` every time. Fixed to `$input.all().map(i => i.json)` to reconstruct the orders list from split items.
- **`position_metadata` cleanup on orchestrator SELL/COVER** — Added `Delete PM Metadata` Postgres node (DELETE FROM position_metadata WHERE ticker = ...) wired after `Trigger Post-Mortem` in Main Analysis v2. Previously, orchestrator-initiated closes never deleted their `position_metadata` row, causing the Watchdog's `Find TS Exits` to falsely re-trigger a second post-mortem for already-closed positions. Now both close paths (orchestrator SELL/COVER and Watchdog trailing stop) clean up `position_metadata` after the post-mortem fires.
- **Whole-share buy qty fix** — `07_parse_orchestrator_output.js` was computing BUY/SHORT share qty as `Math.floor(size_usd / price * 100) / 100` (2 decimal places), producing fractional shares (e.g. 468.6). The trailing stop was then placed for `Math.floor(468.6) = 468`, leaving a 0.6-share rounding stub in Alpaca that blocked re-entry and was invisible to the dashboard. Fixed to `Math.floor(size_usd / price)` — whole shares only. Buy order and trailing stop now always cover the same qty with no remainder.

## Enhancements (2026-06-02)

- **`trade_lessons` — 5 new columns** — Added `entry_price`, `exit_price`, `qty`, `entry_thesis`, `etf_return` (all nullable) via `ALTER TABLE`. Now populated on every post-mortem run going forward. Historical rows (SLB, ZS) remain NULL in these columns.
- **`position_metadata` — qty stored at execution time** — Added `qty INTEGER` column. `Prepare Position Metadata` (inline n8n Code node) now writes `qty: Math.floor(action.shares)` at BUY/SHORT execution time. `Store Position Entry` SQL updated with `qty` in INSERT and ON CONFLICT UPDATE. `Load All Position Metadata` (Watchdog SELECT) updated to include `qty`. `post_mortem_build_input.js` reads `posEntry.qty` (from `Load Position Entry`) as the primary source, with `webhook.qty` as fallback. This captures qty at the moment of trade execution rather than reconstructing it downstream.
- **Post-mortem workflow — new trade_lessons columns** — `07_parse_orchestrator_output.js` adds `qty: action.shares` to `postMortemPayloads` (fallback); `build_ts_pm_payload.js` adds `qty: sharesQty` (fallback); `post_mortem_build_input.js` passes through `entry_price`, `exit_price`, `entry_thesis` (`webhook.thesis`), `etf_return`, and `qty` (preferred from posEntry); `post_mortem_store.js` adds all 5 to `final`. `Insert Trade Lesson` SQL extended with the new columns.
- **`/api/positions` — specialist confidence + hold days** — `entryRows` SQL now extracts `(action->>'confidence')::numeric AS specialist_confidence`. Response includes `specialistConfidence` (raw) and `holdDays` (computed from entry snapshot `created_at`).
- **`/api/trades` — new columns returned** — SELECT extended to include `entry_price`, `exit_price`, `qty`, `entry_thesis`, `etf_return`.
- **Performance page — Trade History redesigned** — Columns: Ticker | Direction | Qty | Open | Close | Hold | P&L | P&L% | Status (10 cols total; Qty/Open/Hold hidden on mobile). Dropdown fully revamped: open positions show Entry Thesis + stats row (Size, Specialist Conf, Effective Conf); closed positions show Entry Thesis + Exit Reasoning + Key Lesson + stats row (Size, Specialist Conf, Effective Conf, ETF During Hold) + Attribution Quality (right column). "Close" column shows current price for open positions and exit price for closed positions.

## Enhancements (2026-06-03)

- **`trade_lessons` UNIQUE constraint** — Added `UNIQUE (ticker, exit_date)` to prevent duplicate post-mortem rows (e.g. watchdog race condition or manual retry firing the post-mortem twice for the same trade). Updated `Insert Trade Lesson` n8n node from `ON CONFLICT DO NOTHING` (no-op on UUID PK) to `ON CONFLICT (ticker, exit_date) DO NOTHING`.
- **`stocks.trades` unified table** — New table replacing the split between `position_metadata` (entry record, deleted on close) and `trade_lessons` (exit record). Single lifecycle: `status = OPEN` written at BUY/SHORT execution; updated to `CLOSED` with full attribution when the post-mortem runs. Partial unique index `trades_one_open_per_ticker ON trades (ticker) WHERE status = 'OPEN'` prevents duplicate open positions (including race conditions between concurrent workflow runs) while allowing same-day close-and-reopen. Columns: full entry fields (`entry_date`, `entry_price`, `qty`, `size_usd`, `entry_pattern`, `entry_thesis`, `entry_specialist_confidence`, `entry_effective_confidence`, `entry_specialist_direction`) + exit fields (`exit_date`, `exit_price`, `exit_reason`, `pnl_usd`, `pnl_pct`, `hold_days`) + post-mortem attribution (`outcome`, `sector_accuracy`, `entry_timing`, `exit_timing`, `key_lesson`, `pattern_tag`, `etf_return`).
- **Write paths migrated to `trades`** — Main Analysis v2: `Prepare Position Metadata` now emits `size_usd`; new `Store Open Trade` Postgres node (parallel to `Store Position Entry`) writes every BUY/SHORT to `trades`. Post-Mortem: `Insert Trade Lesson` node removed; new `Update Trade Status` Postgres node takes its place in the chain (`Parse Post-Mortem Output` → `Update Trade Status` → `Update Specialist Accuracy` → `Update Pattern Performance`), updating the open `trades` row to CLOSED with full attribution.
- **Read paths migrated to `trades`** — `Load Trade Lessons` n8n node (Main Analysis v2) now queries `trades WHERE status='CLOSED'`; `generated_at` aliased from `updated_at` so `06_build_orchestrator_input.js` needs no change. `/api/trades` route reads from `trades WHERE status='CLOSED'` and returns `size_usd` as a new field.
- **`trade_lessons` deprecated** — Table remains in DB as a safety net but nothing reads from or writes to it. Safe to `DROP` once live sessions confirm `trades` is stable.
- **Historical data migrated** — 3 CLOSED rows from `trade_lessons` + 3 OPEN rows from `position_metadata` inserted into `trades` at migration time. `size_usd` is null on historical rows (not captured before 2026-06-03); all future trades will have it.
- **DB cleanup — dead tables and columns dropped (Section 3)** — `specialist_test_runs` dropped (100% unused, no writes ever). `stock_fundamentals` lost `next_earnings_date` (duplicate of `earnings_calendar`), `price_target_avg/high/low` (always NULL — FMP free tier doesn't cover 80 stocks; column references removed from `fundamentals_parse.js` and `build_specialist_message.js`). `specialist_accuracy` lost `best_pattern` and `worst_pattern` (always NULL, never populated by the UPDATE SQL; references removed from `02_compute_derived_metrics.js` and `build_specialist_message.js`). `specialist_signals.materiality` NOT dropped — contrary to the original plan, it is actively used in `watchdog_parse_flip.js` as a flip threshold guard, in API routes, and in the dashboard; decision deferred.
- **`portfolio_snapshots` deduplication (Section 4)** — Dropped `orchestrator_summary` (exact duplicate of `orchestrator_sessions.summary`; `/api/agent/route.ts` now LEFT JOINs `orchestrator_sessions` via LATERAL for the summary). Dropped `short_positions_json` (always `[]`, never read by any route) and merged longs + shorts into a single `positions_json` array — each item now carries a `side: 'long' | 'short'` field. `09_process_post_trade.js` and the "Store Portfolio Snapshot" n8n Postgres node SQL updated accordingly. Short positions' `thesis_intact` and `stop_proximity` will now appear in the `/api/positions` overlay query.
- **Missing columns added (Section 5)** — Five schema gaps filled:
  - `specialist_signals`: `effective_confidence` + `scaling_factor` added as explicit NUMERIC columns (previously only in-memory). `parse_save_all_signals.js` already computed both — now also writes them to DB. `Store All Signals` n8n SQL updated (INSERT + ON CONFLICT UPDATE). Makes the most important derived values directly queryable without parsing `raw_json`.
  - `trades.size_usd` and `trades.entry_specialist_direction` — already present from the Section 3 `trades` table creation. No action needed.
  - `watchlist`: `trigger_condition` + `session_id` added as TEXT columns. Orchestrator already outputs a `trigger` field per watchlist item but it was being silently dropped. `09_process_post_trade.js` now maps `w.trigger` → `trigger_condition` and stamps `orch.session_id`. `Build Watchlist SQL` n8n inline Code node updated to INSERT 6 columns. `/api/watchlist/route.ts` updated to SELECT and return both new fields.
  - `watchdog_events`: `flip_triggered` (BOOLEAN) + `watchdog_confidence` (NUMERIC) added. `watchdog_parse_flip.js` now captures `a.confidence` from each position assessment and computes `flip_triggered = flips.length > 0` at return time. `Split Contradiction Items` n8n inline Code node passes both through. `Store Contradiction Events` SQL updated.
- **`pattern_performance` — `niche` column dropped, source fixed to `trades` (Section 6)** — The `niche` column was always `'ALL'` (per-niche tracking was planned but never implemented). Dropped the column and replaced the `UNIQUE (pattern_type, niche)` constraint with `UNIQUE (pattern_type)`. Also fixed two bugs discovered during audit: (1) `Update Pattern Performance` in the Post-Mortem workflow was reading from deprecated `trade_lessons` — updated to read from `trades WHERE status='CLOSED'`. (2) `/api/agent/route.ts` was querying `pattern_tag`, `ev`, `sample_count` (none exist) — the `safe()` wrapper was silently returning `[]` on every request, meaning the Agent page pattern section was always empty. Fixed to use correct column names (`pattern_type AS pattern_tag`, `expected_value AS ev`, `total_trades AS sample_count`). `02_compute_derived_metrics.js` simplified: per-niche key branch removed, `patternPerfMap` now keyed directly by `pattern_type`. Per-niche breakdown can be re-enabled when trade volume justifies it (30+ closed trades) — the schema supports it with a GROUP BY change.
- **Orchestrator context enrichment — richer trade lessons + aggregate stats (Section 7)** — `Load Trade Lessons` SQL extended to fetch `hold_days`, `entry_price`, `exit_price`, `entry_thesis`, `etf_return`, `entry_specialist_confidence`, `entry_effective_confidence`, `size_usd` (fixes `hold_days` always rendering as `?d`). `formatTradeLessons` in `06_build_orchestrator_input.js` rewritten: each closed trade now shows entry→exit prices, position size, ETF return during hold, alpha vs sector ETF, confidence at entry, truncated entry thesis, attribution scores, and key lesson. New `formatTradeStats` helper added: computes overall win rate, win rate by niche, win rate by entry pattern, and avg ETF alpha from `recentTradeLessons`. New `### 4d. Portfolio Trade Statistics` section added to the orchestrator user prompt. System prompt updated: `7c` describes the new structured format; `7d` explains how to apply aggregate stats (live portfolio win rates override historical EV when they conflict).
- **Watchlist duplicate ticker dedup** — Discovered during post-deployment examination: the orchestrator LLM occasionally emits the same ticker twice in the `watchlist` array with different `trigger` conditions. The `watchlist` table has a `UNIQUE (ticker)` constraint, so the `Build Watchlist SQL` node's DELETE + INSERT ran as a single transaction — the INSERT failed on the duplicate, the DELETE rolled back, and yesterday's watchlist remained intact. Fixed in `09_process_post_trade.js`: `newWatchlist` now built via `reduce` with a `Set` dedup (first occurrence wins) before the array is passed to SQL generation.
- **`spy_return_pct` never written to DB** — `portfolio_snapshots.spy_return_pct` was always NULL despite being correctly computed in `Process Post-Trade` (`snapshot.spy_return_pct`). Root cause: `Store Portfolio Snapshot` n8n Postgres node INSERT was missing `spy_return_pct` from its column list and VALUES clause. Fixed by adding `spy_return_pct` to both. Historical rows remain NULL; all future sessions will populate the column.
- **Watchlist NEUTRAL entries removed** — Orchestrator was padding the watchlist with NEUTRAL stocks (no directional view), producing ~20 entries per session. Root cause: Step 5 watchlist rule was too permissive ("sectors at 2/5 BULLISH — watch for confirmation" invited neutral monitoring). Fixed in `06_build_orchestrator_input.js` system prompt: Step 5 now explicitly requires a directional view (BULLISH or BEARISH) to add any ticker; NEUTRAL stocks are excluded. Output schema `direction` field changed from `"long" | "short"` to `"BULLISH" | "BEARISH"` for consistency with DB and UI.

## Enhancements (2026-06-05) — Major audit & overhaul

Full-system audit found the fund had been **deadlocked in ~100% cash since 2026-06-03** (0 new positions, 0 shorts ever). Six-track fix:

- **Track 1 — Un-deadlock (root cause).** `Load Specialist Accuracy` still SELECTed `best_pattern,worst_pattern` (dropped 2026-06-03) → query errored every session → `continueOnFail` returned empty → `specialistEffectiveConf` was `{}` → the cold-start gate in `06` stamped the 0.72 cap on **all 8 specialists every session** → nothing cleared the 0.75 floor → zero trades. Fixed the query; also fixed `Load Pattern Performance` (dropped `niche`) and repointed `Load Trade Lessons` to `trades WHERE status='CLOSED'` (was reading deprecated `trade_lessons`). **Reworked the cold-start gate** (`06` + new `signalCountByNiche` in `02`) to key off *signal-history depth* (≈21/niche, all warm) instead of closed-trade attribution (which can never bootstrap). New caps: <3 signals→0.72 (no trade), 3–9→0.80, ≥10 uncalibrated→0.84 (mid size), ≥10 calibrated→uncapped.
- **Track 2 — Dead inputs.** Analyst consensus was `0/80` (all buy/hold/sell = 0): `fundamentals_parse.js` did `Array.isArray()` on `$('Fetch Recommendations').first().json`, but n8n splits the array into items so it was always an object → defaulted to 0. Fixed with `.all()` reconstruction → real consensus now flows. Price targets confirmed premium-gated on Finnhub → stripped from prompts. Also fixed `Update Specialist Accuracy` (Post-Mortem) which INSERTed dropped `best_pattern/worst_pattern` and read deprecated `trade_lessons` → calibration loop now actually writes.
- **Track 3 — Risk recalibrated for swing cadence.** Trailing stops ATR×2.5/5–15% → **ATR×3/8–20%** (`02`), enforced as a hard [8,20] band in `07` (the whole book was whipsawed to cash on the 06-05 -2.5% day). Calibration `scaling_factor` now shrinks toward 1.0 by sample size and clamps to [0.5,1.5] (`02`) — kills small-sample noise (2 trades → 2.78× before). Orchestrator EV rules now apply only with ≥5 closed trades.
- **Track 4 — Real short book.** Specialists were 77% bullish / 5.7% bearish → de-facto long-only beta. Added a **leader/laggard mandate**: every specialist must surface a relative laggard short every session, and the orchestrator builds **market-neutral intra-sector pairs** (long leader + short laggard) even in bullish sectors. Scrubbed dead/mis-bucketed tickers: **TMUS→CHKP** (cyber; TMUS is telecom) and **LTHM→AA** (copper; LTHM delisted 2024 in the Livent→Arcadium merger, had been feeding a phantom $16.53). Updated in all 7 places (02 NICHE list n/a, 08, watchdog, fundamentals×2, web constants, Fetch Bars, Build nodes).
- **Track 5 — Model.** 8 specialists + post-mortem attributor upgraded GPT-4o-mini → **GPT-4o** (kept v1.3 nodes / output shape). Orchestrator stays GPT-5.1; Letter stays mini.
- **Track 6 — Polish.** Anti-anchoring guidance (specialists clustered at exactly 0.85) + signal-consistency: each specialist now receives its own recent signals and is told not to flip direction / swing confidence >0.15 without a new catalyst (was flipping 0.85 BULLISH↔BEARISH in 1–2 days).

## Enhancements (2026-06-05 — session 2) — Universe expanded to 10 niches / 100 stocks

Added two niches (instead of swapping `data_centers`) to diversify away from the AI-beta cluster and feed the short book: **`healthcare`** (UNH, ELV, CVS, LLY, MRK, PFE, ABBV, ISRG, MDT, TMO — ETF XLV) and **`financials`** (JPM, BAC, WFC, C, GS, MS, SCHW, BLK, AXP, COF — ETF XLF). Both are low-correlated to tech and rich in two-sided/short candidates.

n8n build (Main Analysis, 133→149 nodes): two new specialist branches (RSS1+RSS2 → Merge RSS → Build Message → Specialist GPT-4o → Tag Signal), each triggered by `Compute Derived Metrics`. The v1 binary signal merge tree was extended: existing 8 still flow to `Merge All Signals`; the 2 new Tags → new `Merge L1 Health Fin`; both → new `Merge All 10 Signals` → `Parse & Save All Signals` (rewired off Merge All Signals). Two new `Fetch Bars` nodes (triggered by `Collect Orders`) wired into `Merge Price Bars` (numberInputs 9→11); `Fetch Price Bars` sourceNodes extended; `Fetch Bars SPY` now carries XLV+XLF at limit=4400. Registry updated everywhere: `02` NICHES + NICHE_ETF, `08`/watchdog TICKER_NICHE, `post_mortem_build_input` SECTOR_ETF, fundamentals Prepare Tickers + Parse Earnings, web constants, orchestrator prompt (8→10). RSS: FierceHealthcare+FiercePharma / Fed-Press+WSJ-Markets (deep finance trade-press like American Banker had dead feeds).

## Enhancements (2026-06-06) — Specialists migrated to Gemini 2.5 Flash

All 10 `Specialist [Niche]` nodes moved from native OpenAI (GPT-4o) to **HTTP Request → `gemini-2.5-flash`** (`generativelanguage.googleapis.com/v1beta/.../generateContent`, JSON mode via `responseMimeType: application/json`). Cost: specialist layer ~$14/mo (4o) → **~$2/mo** (Gemini 2.5 Flash, thinking **disabled** via `generationConfig.thinkingConfig.thinkingBudget: 0` — applied 2026-06-08). Quality validated in pre-flight: clean schema-correct JSON + correct leader/laggard pairs. Each `Tag [Niche] Signal` node now normalizes Gemini's `candidates[0].content.parts[0].text` (with an `r.message.content` fallback) into `{message:{content}}`, so `parse_save_all_signals.js` is unchanged. Key stored in n8n credential `Gemini API` (id `Qv5tT8Y3Eoc6YBWZ`, header `x-goog-api-key`) — not in the workflow JSON. Orchestrator stays GPT-5.1 (the dominant cost line, and does the real reasoning pass); post-mortem GPT-4o; Letter + Watchdog GPT-4o-mini. **Thinking was ~80% of Gemini cost** (avg 4,700 thinking tokens vs 1,000 output per specialist); disabling drops per-run cost from $0.19 → $0.03 ($12.78/mo → ~$2/mo).

## Enhancements (2026-06-08) — Watchlist `direction` constraint fixed

The `stocks.watchlist` write (`Build Watchlist SQL` — DELETE + INSERT in one transaction) had been silently failing **every session since 2026-06-03**, freezing the watchlist on stale `2026-06-03_close` data. Root cause: the 2026-06-03 schema change switched the orchestrator's watchlist `direction` output from `long`/`short` to `BULLISH`/`BEARISH` (to match DB + UI), but the DB CHECK constraint was never updated — it still read `CHECK (direction IN ('long','short'))`. The INSERT threw on every `BULLISH`/`BEARISH` row; because DELETE + INSERT share a transaction, the failure rolled back the DELETE too, so the old rows survived untouched and no new ones ever landed. The whole pipeline already spoke `BULLISH`/`BEARISH` (orchestrator prompt in `06`, passthrough in `09_process_post_trade.js`, Build Watchlist SQL, `/api/watchlist/route.ts`, `research/page.tsx` styling + ↑/↓ icons) — the constraint was the single lagging piece. Fix (DB-only, no code/n8n change): `ALTER TABLE stocks.watchlist DROP CONSTRAINT watchlist_direction_check; ADD ... CHECK (direction IN ('BULLISH','BEARISH'));`. Stale `2026-06-03_close` rows deleted; next close session repopulates cleanly.

## Enhancements (2026-06-11) — Dashboard bug fixes

- **Monthly Returns Grid — hardcoded month/year fixed** — `performance/page.tsx` was hardcoding the return value into index 4 (May) and the year as `2026`, so June (and all future months) always showed `—`. Fixed to derive `currentMonth` and `currentYear` dynamically from `new Date()` so the value always lands in the correct cell.

## Known Open Issues

None blocking. First 10-niche session is 2026-06-06 9:30 AM (healthcare/financials fundamentals populate at the 8:30 AM refresh; until then those tickers show "No data" — graceful, the specialist falls back to price/technicals/news).

## position_metadata notes

- Written by "Prepare Position Metadata" → "Store Position Entry" in Main Analysis v2, triggered after every BUY/SHORT execution (parallel branch from Process Post-Trade)
- Read by "Load Position Metadata" in Main Analysis v2 — provides `days_held`, `entry_niche`, `entry_thesis` on all open positions in `02_compute_derived_metrics.js`
- Read by "Load Position Entry" in Post-Mortem workflow — provides actual `entry_date` and `entry_price` for attribution
- **Deleted** after every close: `Delete PM Metadata` (Main Analysis v2, after `Trigger Post-Mortem`) cleans up orchestrator SELL/COVER exits; `Delete TS Metadata` (Watchdog, after `Trigger PM (Trailing Stop)`) cleans up trailing stop exits. Both paths must delete or the Watchdog will falsely re-trigger a second post-mortem on the next run.
- ETF return: computed by "Prepare ETF Fetch" → "Fetch ETF Bars" → "Compute ETF Return" in Post-Mortem using the actual hold period dates; fed to `post_mortem_build_input.js` via `$("Compute ETF Return").first().json.etf_return`
- Cold-start: positions opened before 2026-05-25 (CEG, CRWD, MSFT, NVDA, SCCO) were manually backfilled on 2026-05-27 with entry date/price/thesis/pattern from `portfolio_snapshots`. All current positions have metadata rows.

## Workflow Schedule Summary (all times ET, Mon–Fri)

| Time | Workflow | Action |
|------|----------|--------|
| 8:30 AM | Fundamentals Refresh | Fetch P/E, margins, analyst consensus for all 100 stocks |
| 9:30 AM | Main Analysis v2 | Morning session — full specialist + orchestrator run |
| 10:10 AM–3:40 PM | Watchdog | Every 30 min (:10 and :40) — thesis flip detection on open positions |
| 12:00 PM | Main Analysis v2 | Midday session |
| 3:50 PM | Main Analysis v2 | Close session (+ investor letter generation) |
| On demand | Post-Mortem | Triggered after every SELL/COVER |

Main Analysis v2 and Watchdog gate on Finnhub `isOpen` at startup — exits cleanly on holidays and outside market hours. Fundamentals Refresh gates on `holiday === null` instead (since it runs at 8:30 AM before the market opens, `isOpen` would always be false).

## Specialist Data Enhancements (2026-05-25)

Four new data points added to every specialist's per-stock input block:

1. **Relative strength vs sector ETF** — `vs ETF: 1D: +1.2% | 5D: +3.4% | 30D: -0.8%`. `Fetch Bars SPY` now fetches all 10 sector ETFs alongside SPY. `02_compute_derived_metrics.js` builds `etfPriceMap` keyed by niche; `build_specialist_message.js` computes stock return minus ETF return per period.

2. **Volume / ADV ratio** — `Volume: 42.1M (ADV20: 28.5M) | Ratio: 1.48x`. Computed from bar `v` field already in the 252-bar fetch. ADV20 uses prior 20 sessions (excluding most recent bar). Ratio > 1.5x = institutional conviction; < 0.5x = move lacks conviction.

3. **Analyst upside %, PT spread, buy consensus %** — `Consensus: 12B / 3H / 1S (75% buy) | PT: $145.00 (+20.8% upside) | Spread: $110–$180 (48% — wide)`. All computed in `formatStockData` from existing Finnhub fundamentals. System prompt includes explicit long/short inversion guidance: heavy buy consensus on a short = squeeze risk, not support.

4. **Cold-start confidence cap** — `06_build_orchestrator_input.js` caps effective_confidence before the orchestrator sees it. **Reworked 2026-06-05** to key off *signal-history depth* (`ctx.signalCountByNiche`, computed in `02`), NOT `specialist_accuracy.total_signals` — the latter only grows from closed trades and caused a permanent deadlock. Current caps: <3 signals → 0.72 (below trading threshold), 3–9 signals → 0.80 (min/mid size), ≥10 signals but no closed-trade calibration → 0.84 (up to mid size), ≥10 + calibrated → uncapped (scaling applies). `build_specialist_message.js` tells the specialist it's in cold-start mode and to report honest analysis — the specific cap values are intentionally NOT revealed to prevent anchoring (discovered 2026-05-26: revealing 0.72 caused all 8 specialists to output exactly 0.72).

## Watchdog Enhancements (2026-05-25)

- **Investment thesis passed to watchdog** — `watchdog_has_open_positions.js` now includes `niche` per position. A new `Load Position Metadata (Watchdog)` Postgres node reads thesis + niche from `position_metadata` into `watchdog_build_news_prompt.js` via `metaMap`. Runs as a parallel branch from `IF Has Positions?` (not in the main `Split Tickers` trigger chain).
- **Short inversion logic** — Full worked examples and failure modes added to the watchdog system prompt: BEARISH news on a SHORT confirms the thesis; BULLISH news threatens it.
- **`news_assessment` field** — Watchdog LLM now outputs `news_assessment: CONFIRMS | THREATENS | NEUTRAL` alongside `direction: BULLISH | BEARISH | NEUTRAL`. These must be internally consistent.
- **Contradiction detection** — `watchdog_parse_flip.js` detects `thesis_intact: false + news_assessment: CONFIRMS` (logical impossibility), suppresses it from flip triggering, stores it in `stocks.watchdog_events`, and sends a Gmail alert.
- **Stop proximity** — `Fetch Alpaca Open Orders (Watchdog)` node feeds trailing stop distances into the watchdog prompt. CRITICAL (<3% away) lowers the flip confidence threshold from 0.60 to 0.50. Runs as a parallel branch from `IF Has Positions?` (not in the main `Split Tickers` trigger chain — empty orders would have blocked execution if left in series).

## Live Test Results (2026-05-22)

All four workflows activated and running autonomously.

- **BUY + trailing stop path**: verified 2026-05-21 ✓
- **SELL/COVER path**: verified 2026-05-22 — CCJ closed at $104.84 via DELETE /v2/positions/CCJ ✓
- **Cancel Stop Before Close**: verified — cancels GTC trailing stop before position close ✓
- **Watchdog flip detection**: verified — CCJ thesis flip (Cameco milling suspension) detected, Main Analysis v2 triggered ✓
- **Post-mortem trigger**: wired correctly; fires on first real orchestrator-initiated SELL ✓ (pending live test)

## 10 Niches / 100 Stocks

| Niche ID | Display Name | Tickers |
|----------|-------------|---------|
| `cybersecurity` | Cybersecurity | CRWD, PANW, ZS, OKTA, FTNT, S, CYBR, CHKP, QLYS, TENB |
| `defense` | Defense | LMT, RTX, NOC, GD, HII, LHX, KTOS, RCAT, PLTR, AXON |
| `nuclear_uranium` | Nuclear / Uranium | CCJ, UEC, NXE, DNN, SMR, OKLO, CEG, VST, ETR, NEE |
| `copper_minerals` | Copper / Critical Minerals | FCX, SCCO, TECK, HBM, VALE, MP, AA, ALB, SQM, LAC |
| `semiconductors` | Semiconductors & EDA | ARM, AMAT, LRCX, KLAC, ON, TER, NXPI, MCHP, MPWR, SNPS |
| `enterprise_saas` | Enterprise SaaS | ORCL, NOW, CRM, DDOG, SNOW, ADBE, NET, TEAM, WDAY, MDB |
| `oil_gas` | Oil & Gas | XOM, CVX, COP, SLB, HAL, MPC, PSX, VLO, OXY, EOG |
| `data_centers` | Data Centers & AI Infrastructure | EQIX, DLR, AMT, IREN, CORZ, VRT, SMCI, DELL, HPE, WDC |
| `healthcare` | Healthcare & Pharma | UNH, ELV, CVS, LLY, MRK, PFE, ABBV, ISRG, MDT, TMO |
| `financials` | Financials | JPM, BAC, WFC, C, GS, MS, SCHW, BLK, AXP, COF |

## Database Schema (Neon — `stocks` schema)

| Table | Purpose |
|-------|---------|
| `specialist_signals` | Raw signal output per niche per session. Includes `effective_confidence` and `scaling_factor` as explicit columns (computed in `parse_save_all_signals.js` from specialist accuracy calibration). |
| `portfolio_snapshots` | Portfolio state + P&L vs SPY per session. `positions_json` holds all positions (long + short) with a `side` field. `orchestrator_summary` and `short_positions_json` dropped. |
| `watchlist` | Stocks flagged for monitoring (replaced entirely each session). Includes `trigger_condition` (specific entry condition from orchestrator `trigger` field) and `session_id` (which session added this item). `direction` CHECK constraint is `('BULLISH','BEARISH')` (fixed 2026-06-08 — was `('long','short')`, silently rejecting every write since 2026-06-03). |
| `earnings_calendar` | Upcoming earnings dates per ticker |
| `correlation_matrix` | Pairwise 90-day correlation for all 100 stocks |
| `stock_fundamentals` | P/E, P/B, P/S, margins, analyst consensus (buy/hold/sell counts). `price_target_*` and `next_earnings_date` dropped — always NULL. |
| `trades` | Unified trade lifecycle table — `status=OPEN` written at BUY/SHORT, updated to `CLOSED` with full attribution at post-mortem. Source of truth for all trade history. Partial unique index prevents duplicate open positions. |
| `trade_lessons` | **Deprecated (2026-06-03)** — superseded by `trades`. Table retained as safety net; no workflow reads from or writes to it. Safe to DROP after live verification. |
| `specialist_accuracy` | 30-day hit rate, scaling_factor, calibration_error per specialist. `best_pattern`/`worst_pattern` dropped — never populated. |
| `pattern_performance` | EV, win rate, avg win/loss per signal pattern type. Aggregate-only (`niche` column dropped 2026-06-03 — was always `'ALL'`). UNIQUE on `pattern_type`. Source: `trades WHERE status='CLOSED'`, 90-day rolling window. |
| `investor_letters` | LLM-written investor letters per close session — `session` UNIQUE, `body` full prose text |
| `position_metadata` | Entry date, price, niche, thesis, confidence per open position — ticker PRIMARY KEY, UPSERTed at BUY/SHORT execution time |
| `orchestrator_sessions` | One row per orchestrator run — `session_id`, `session_type` (`morning`/`midday`/`close`/`watchdog_flip`), `summary` text. No UNIQUE constraint (watchdog re-runs same session_id). Last 2 rows by `created_at` injected into next orchestrator call as `## 0. PREVIOUS SESSION CONTEXT`. |
| `watchdog_events` | Contradiction log — written when watchdog LLM outputs `thesis_intact: false` + `news_assessment: CONFIRMS` simultaneously (logical impossibility). Includes `flip_triggered` (whether a flip also fired in the same run) and `watchdog_confidence` (LLM confidence on that position assessment). Expected to stay empty under normal operation. |
| `specialist_test_runs` | **Dropped (2026-06-03)** — was never written to by any workflow. |

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

## RSS Feeds (2 per niche — verified working 2026-05-28)

| Niche | RSS 1 | RSS 2 |
|-------|-------|-------|
| `cybersecurity` | https://www.darkreading.com/rss.xml | https://feeds.feedburner.com/TheHackersNews |
| `defense` | https://www.airandspaceforces.com/feed/ | https://breakingdefense.com/feed/ |
| `nuclear_uranium` | https://world-nuclear-news.org/rss | https://www.powermag.com/category/nuclear/feed/ |
| `copper_minerals` | https://www.mining.com/feed/ | https://www.northernminer.com/feed/ |
| `semiconductors` | https://semianalysis.com/feed/ | https://semiengineering.com/feed/ |
| `enterprise_saas` | https://diginomica.com/feed | https://siliconangle.com/feed/ |
| `oil_gas` | https://oilprice.com/rss/main | https://www.naturalgasintel.com/feed/ |
| `data_centers` | https://www.datacenterdynamics.com/en/rss/ | https://www.datacenterknowledge.com/rss.xml |
| `healthcare` | https://www.fiercehealthcare.com/rss/xml | https://www.fiercepharma.com/rss/xml |
| `financials` | https://www.federalreserve.gov/feeds/press_all.xml | https://feeds.a.dj.com/rss/RSSMarketsMain.xml |

## Sector ETFs (used in post-mortem attribution)

`cybersecurity → HACK` | `defense → ITA` | `nuclear_uranium → URA` | `copper_minerals → COPX` | `semiconductors → SOXX` | `enterprise_saas → SKYY` | `oil_gas → XLE` | `data_centers → DTCR` | `healthcare → XLV` | `financials → XLF`

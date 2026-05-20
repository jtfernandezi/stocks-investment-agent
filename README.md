# Stocks Investment Agent

AI-powered paper trading system for individual US-listed stocks. Multi-agent architecture with 8 sector specialists and a portfolio manager orchestrator, competing against the S&P 500 over a 3-month period with a $60,000 paper portfolio.

## Objective

Beat SPY's cumulative return over 3 months. Not match it — beat it. Swing/position trading strategy with a 2–6 week horizon per position, using both longs and shorts.

## Stack

| Component | Technology |
|-----------|-----------|
| Workflow orchestration | n8n (Railway) |
| Database | Neon (PostgreSQL) |
| Trade execution | Alpaca Paper Trading API |
| Dashboard | Vercel (static HTML) — not yet implemented |
| Specialist LLMs | GPT-4o-mini |
| Orchestrator LLM | GPT-5.1 |
| Fundamentals data | Finnhub API (free tier, morning refresh only) |
| Price data | Alpaca Data API (252 daily bars, all 80 stocks + SPY) |
| News | RSS feeds (2 per niche, up to 15 articles merged per session) |

## Architecture

### Agents

**8 Specialist Analysts** (one per niche, GPT-4o-mini)
- Input: sector news, price/momentum data, fundamentals, earnings calendar, own 30-day accuracy history
- Output: sector direction (BULLISH/BEARISH/NEUTRAL), conviction (HIGH/MEDIUM/LOW), confidence (0–1), 2–3 long picks + 1–2 short picks with thesis

**1 Portfolio Manager Orchestrator** (GPT-5.1)
- Input: 8 specialist signals, live portfolio state from Alpaca, earnings at-risk flags, correlation matrix, 5-session signal history per sector, feedback system data
- Output: BUY/SELL/SHORT/COVER actions, watchlist updates, portfolio review per open position

**1 Post-Mortem Agent** (GPT-4o-mini, triggered after every SELL/COVER)
- Runs attribution analysis on every closed position (4 components: sector accuracy, stock selection quality, entry timing, exit timing)
- Generates one specific, actionable lesson stored in Neon
- Feeds back into the orchestrator as calibrated intelligence

### Feedback / Learning System

The system improves automatically over time without code changes:

1. **Effective confidence calibration** — each specialist's raw confidence is scaled by `hit_rate_30d / avg_reported_confidence_30d`. Consistently overconfident specialists are discounted; underconfident ones are trusted more.
2. **Pattern EV tracking** — historical expected value per signal pattern (TREND/BIAS/NOISE/REVERSAL/FIRST_SIGNAL). Patterns with negative EV block new entries. Patterns with EV > 5% get priority.
3. **Trade lessons injection** — last 5 post-mortem lessons are injected into the orchestrator each session. Mistakes are actively checked before opening similar trades.
4. **Counterfactual tracking** — alternative picks (not chosen) are tracked for the same hold period to validate or challenge stock selection decisions.

### Workflow Schedule

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| Main analysis | Cron 3×/day (pre-market, midday, post-market) | Run all 8 specialists → orchestrator → execute trades |
| Watchdog | Cron every 30 min (market hours) | Check for thesis flip (signal reversal) on open positions |
| Post-mortem | Webhook, fires after every SELL/COVER | Attribution analysis + lesson generation |

Trailing stops are managed natively by Alpaca (GTC trail_percent orders) — no price monitoring needed in n8n.

## Niches (8) — 80 Stocks

| # | Niche | Tickers |
|---|-------|---------|
| 1 | Cybersecurity | CRWD, PANW, ZS, OKTA, FTNT, S, CYBR, TMUS, QLYS, TENB |
| 2 | Defense | LMT, RTX, NOC, GD, HII, LHX, KTOS, RCAT, PLTR, AXON |
| 3 | Nuclear / Uranium | CCJ, UEC, NXE, DNN, SMR, OKLO, CEG, VST, ETR, NEE |
| 4 | Copper / Critical Minerals | FCX, SCCO, TECK, HBM, VALE, MP, LTHM, ALB, SQM, LAC |
| 5 | AI & Semiconductors | NVDA, AMD, AVGO, QCOM, MRVL, AMAT, KLAC, LRCX, MU, ARM |
| 6 | Cloud Hyperscalers | MSFT, AMZN, GOOGL, META, ORCL, SNOW, MDB, DDOG, NET, CRM |
| 7 | Oil & Gas | XOM, CVX, COP, SLB, HAL, MPC, PSX, VLO, OXY, EOG |
| 8 | Data Centers & AI Infrastructure | EQIX, DLR, AMT, IREN, CORZ, VRT, SMCI, DELL, HPE, WDC |

## Risk Management

- **Conviction threshold:** only HIGH conviction (confidence ≥ 0.75) triggers trades
- **Sizing — Longs:** $8,000 (confidence ≥ 0.85) / $5,000 (0.75–0.84)
- **Sizing — Shorts:** $6,000 (confidence ≥ 0.85) / $3,000 (0.75–0.84)
- **Max short exposure:** $12,000 (20% of portfolio)
- **Max open positions:** 12 (longs + shorts combined)
- **Max per sector:** 2 positions (1 long + 1 short)
- **Trailing stops:** ATR × 2.5, set natively via Alpaca GTC orders
- **Penalties (stack multiplicatively):** correlation >0.70 with open position, earnings ≤2 days, NOISE signal history, FIRST_SIGNAL — each reduces sizing one tier
- **Thesis stop:** mandatory immediate exit when specialist flips direction
- **Earnings exit:** default close before earnings ≤2 days unless exceptional conditions met

## Database Schema (Neon — `stocks` schema)

| Table | Purpose |
|-------|---------|
| `specialist_signals` | Raw JSON signal output per niche per session |
| `portfolio_snapshots` | Portfolio state + P&L vs SPY per session |
| `watchlist` | Stocks flagged for monitoring with entry trigger |
| `earnings_calendar` | Upcoming earnings dates per ticker |
| `correlation_matrix` | Pairwise 90-day correlation for all 80 stocks |
| `stock_fundamentals` | P/E, P/B, P/S, margins, analyst consensus, price targets (morning refresh) |
| `trade_lessons` | Post-mortem analysis + key lesson per closed trade |
| `specialist_accuracy` | 30-day hit rate, scaling factor, calibration error per specialist |
| `pattern_performance` | EV, win rate, avg win/loss per signal pattern type |

## Prompts

Reference/spec versions are in `/prompts/`. The prompts that execute are embedded in the Code nodes:

| File | Embedded in |
|------|-------------|
| `specialist_prompt.md` | `04_build_specialist_inputs.js` (constant `SPECIALIST_SYSTEM_PROMPT`) |
| `orchestrator_prompt.md` | `06_build_orchestrator_input.js` (constant `ORCHESTRATOR_SYSTEM_PROMPT`) |
| `post_mortem_prompt.md` | `post_mortem_build_input.js` (constant `POST_MORTEM_SYSTEM_PROMPT`) |

The prompt files are the detailed spec; the code versions are slightly condensed. When editing a prompt, update the embedded constant in the relevant Code node file.

# n8n Workflows — Setup Guide

## Three workflows

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| Main Analysis | `main_analysis_blueprint.md` | Cron 3×/day | Run 10 specialists → orchestrator → execute trades |
| Watchdog | `watchdog_blueprint.md` | Cron every 30 min (10:00 AM–3:30 PM ET) | Detect thesis-flip signals, trigger orchestrator to decide close/hold |
| Post-Mortem | `post_mortem_blueprint.md` | Webhook (called by Main Analysis **and** Watchdog) | Attribution analysis on every closed trade |

## Credentials to configure in n8n

Go to **Settings → Credentials** and create:

### 1. Alpaca — Trading API
Used for order execution and portfolio state.

Alpaca requires two headers per request (`APCA-API-KEY-ID` and `APCA-API-SECRET-KEY`). n8n's HTTP Header Auth only supports one header per credential. Configure as follows:

**Option A — Recommended:** In each Alpaca HTTP Request node, go to **Authentication → Generic Credential Type → Header Auth** and set `APCA-API-KEY-ID`. Then in the same node under **Headers**, add a second header manually:
- Name: `APCA-API-SECRET-KEY`
- Value: `36XH6Zs52M9GcZzKzTXX23Ve3qP5quxGKz31KDzvRpfg`

**Option B:** Skip the credential and add both headers directly in each HTTP Request node (no credential needed):
- `APCA-API-KEY-ID: PKJRLKRDVR3UHBWTAV7KTLKOD6`
- `APCA-API-SECRET-KEY: 36XH6Zs52M9GcZzKzTXX23Ve3qP5quxGKz31KDzvRpfg`

Key values:
- **API Key ID:** `PKJRLKRDVR3UHBWTAV7KTLKOD6`
- **API Secret:** `36XH6Zs52M9GcZzKzTXX23Ve3qP5quxGKz31KDzvRpfg`
- **Trading base URL:** `https://paper-api.alpaca.markets/v2`

### 2. Alpaca — Data API
Same keys and approach as above, different base URL:
- **Data base URL:** `https://data.alpaca.markets/v2`

### 3. Finnhub (HTTP Header Auth)
- **Header Name:** `X-Finnhub-Token`
- **Header Value:** `[your Finnhub API key]`
- Base URL: `https://finnhub.io/api/v1`

### 4. OpenAI
Used by the native OpenAI nodes (v1.3 for specialists, v2.1 for orchestrator — do not swap).
Configure the API key directly in the node's credential settings.
- **API Key:** `[your OpenAI API key]`

### 5. Neon (PostgreSQL)
- **Host:** `ep-lively-wave-ajkse4nd-pooler.c-3.us-east-2.aws.neon.tech`
- **Database:** `neondb`
- **User:** `neondb_owner`
- **Password:** `npg_8vtqa0fQwdMD`
- **SSL:** Required
- **Port:** 5432

## Environment variables (n8n Settings → Variables)
```
ALPACA_BASE_URL=https://paper-api.alpaca.markets/v2
ALPACA_DATA_URL=https://data.alpaca.markets/v2
OPENAI_SPECIALIST_MODEL=gpt-4o
OPENAI_ORCHESTRATOR_MODEL=gpt-5.1
```

> **Note:** `POSTMORTEM_WEBHOOK_URL` is NOT needed. The post-mortem workflow is triggered via n8n's native Execute Workflow node (workflow-to-workflow execution), not HTTP webhook. Connect the "Trigger Post-Mortem" node directly to the Post-Mortem workflow ID in n8n.

## Code nodes

All JavaScript for Code nodes lives in `/workflows/code/`. Copy contents directly into the Code node (JavaScript mode).

| File | Workflow | Node |
|------|----------|------|
| `01_set_session.js` | Main Analysis v2 | Set Session |
| `02_compute_derived_metrics.js` | Main Analysis v2 | Compute Derived Metrics |
| `build_specialist_message.js` | Main Analysis v2 | Build [Niche] Message × 8 |
| `parse_save_all_signals.js` | Main Analysis v2 | Parse & Save All Signals |
| `06_build_orchestrator_input.js` | Main Analysis v2 | Build Orchestrator Input |
| `07_parse_orchestrator_output.js` | Main Analysis v2 | Parse Orchestrator Output |
| `08_prepare_trade_actions.js` | Main Analysis v2 | Prepare Trade Actions |
| `09_process_post_trade.js` | Main Analysis v2 | Process Post-Trade |
| `letter_build_prompt.js` | Main Analysis v2 | Build Letter Prompt (close sessions only) |
| `letter_store.js` | Main Analysis v2 | Parse & Store Letter |
| `watchdog_has_open_positions.js` | Watchdog | Has Open Positions? |
| `watchdog_build_news_prompt.js` | Watchdog | Build News Prompt |
| `watchdog_parse_flip.js` | Watchdog | Parse Flip Response |
| `post_mortem_build_input.js` | Post-Mortem | Build Post-Mortem Input |
| `post_mortem_store.js` | Post-Mortem | Parse & Store Post-Mortem |
| `fundamentals_parse.js` | Fundamentals Refresh | Parse Fundamentals |

Note: the "Attach Feed Niche" node [21] (Main Analysis) uses inline code — see its configuration in `main_analysis_blueprint.md`.

## Time zones

Cron expressions are in **ET (America/New_York)** — the Main Analysis workflow timezone is set to `America/New_York`, so DST is handled automatically. No manual adjustment needed in winter.

- Morning: `30 9 * * 1-5` → 9:30 AM ET
- Midday: `0 12 * * 1-5` → 12:00 PM ET
- Close: `50 15 * * 1-5` → 3:50 PM ET

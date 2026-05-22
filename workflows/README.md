# n8n Workflows — Setup Guide

## Three workflows

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| Main Analysis | `main_analysis_blueprint.md` | Cron 3×/day | Run 8 specialists → orchestrator → execute trades |
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
OPENAI_SPECIALIST_MODEL=gpt-4o-mini
OPENAI_ORCHESTRATOR_MODEL=gpt-5.1
```

> **Note:** `POSTMORTEM_WEBHOOK_URL` is NOT needed. The post-mortem workflow is triggered via n8n's native Execute Workflow node (workflow-to-workflow execution), not HTTP webhook. Connect the "Trigger Post-Mortem" node directly to the Post-Mortem workflow ID in n8n.

## Code nodes

All JavaScript for Code nodes lives in `/workflows/code/`. Copy contents directly into the Code node (JavaScript mode).

| File | Workflow | Node |
|------|----------|------|
| `01_set_session.js` | Main Analysis | [2] Set Session |
| `02_compute_derived_metrics.js` | Main Analysis | [18] Compute Derived Metrics |
| `03_prepare_rss_sources.js` | Main Analysis | [19] Prepare RSS Sources |
| `04_build_specialist_inputs.js` | Main Analysis | [22] Build Specialist Inputs |
| `05_parse_specialist_outputs.js` | Main Analysis | [24] Parse Specialist Outputs |
| `06_build_orchestrator_input.js` | Main Analysis | [26] Build Orchestrator Input |
| `07_parse_orchestrator_output.js` | Main Analysis | [28] Parse Orchestrator Output |
| `08_prepare_trade_actions.js` | Main Analysis | [30a] Prepare Trade Actions |
| `09_process_post_trade.js` | Main Analysis | [35] Process Post-Trade |
| `watchdog_check.js` | Watchdog | [4] Check Signal Flip |
| `post_mortem_build_input.js` | Post-Mortem | [3] Build Post-Mortem Input |
| `post_mortem_store.js` | Post-Mortem | [5] Parse & Store Post-Mortem |

Note: the "Attach Feed Niche" node [21] (Main Analysis) uses inline code — see its configuration in `main_analysis_blueprint.md`.

## Time zones

All cron expressions in n8n are UTC. The workflows use EDT (UTC-4, summer) times:
- Morning: 12:30 UTC = 8:30 AM ET
- Midday: 16:00 UTC = 12:00 PM ET  
- Close: 20:30 UTC = 4:30 PM ET

Adjust by +1h in winter (EST = UTC-5).

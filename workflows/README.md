# n8n Workflows — Setup Guide

## Three workflows

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| Main Analysis | `main_analysis_blueprint.md` | Cron 3×/day | Run 8 specialists → orchestrator → execute trades |
| Watchdog | `watchdog_blueprint.md` | Cron every 30 min (market hours) | Detect thesis-flip signals, close affected positions |
| Post-Mortem | `post_mortem_blueprint.md` | Webhook (called by Main Analysis) | Attribution analysis on every closed trade |

## Credentials to configure in n8n

Go to **Settings → Credentials** and create:

### 1. Alpaca — Trading API (HTTP Header Auth)
Used for order execution and portfolio state.
- **Header Name:** `APCA-API-KEY-ID`
- **Header Value:** `PKJRLKRDVR3UHBWTAV7KTLKOD6`
- Also add a second header via custom config: `APCA-API-SECRET-KEY: 36XH6Zs52M9GcZzKzTXX23Ve3qP5quxGKz31KDzvRpfg`

> In n8n, use "Generic Credential Type → HTTP Header Auth" and add both headers.
> Base URL: `https://paper-api.alpaca.markets/v2`

### 2. Alpaca — Data API (HTTP Header Auth)
Same keys, different base URL:
- Base URL: `https://data.alpaca.markets/v2`

### 3. Finnhub (HTTP Header Auth)
- **Header Name:** `X-Finnhub-Token`
- **Header Value:** `[your Finnhub API key]`
- Base URL: `https://finnhub.io/api/v1`

### 4. OpenAI (HTTP Header Auth)
- **Header Name:** `Authorization`
- **Header Value:** `Bearer [your OpenAI API key]`
- Base URL: `https://api.openai.com/v1`

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
POSTMORTEM_WEBHOOK_URL=[URL of post-mortem workflow webhook, set after creating that workflow]
```

## Code nodes

All JavaScript for Code nodes lives in `/workflows/code/`. Each file is named by its position in the workflow. Copy the contents directly into the Code node (JavaScript mode).

## Time zones

All cron expressions in n8n are UTC. The workflows use EDT (UTC-4, summer) times:
- Morning: 12:30 UTC = 8:30 AM ET
- Midday: 16:00 UTC = 12:00 PM ET  
- Close: 20:30 UTC = 4:30 PM ET

Adjust by +1h in winter (EST = UTC-5).

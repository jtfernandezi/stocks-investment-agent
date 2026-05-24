# Alpha Agent Dashboard

Next.js 15 dashboard for the stocks-investment-agent paper trading system. Deployed on Vercel, connected to Neon PostgreSQL and Alpaca Paper Trading API.

## Pages

| Route | Description |
|-------|-------------|
| `/` | Main dashboard — equity curve, open positions, today's P&L, sector signals |
| `/performance` | Hedge-fund metrics — Sharpe, Sortino, Calmar, Beta, Jensen's Alpha, drawdown chart, trade log |
| `/portfolio` | Portfolio breakdown — position table, sector allocation, correlation heatmap |
| `/research` | Latest specialist signals — direction, conviction, long/short picks per niche, watchlist |
| `/agent` | Agent intelligence — specialist accuracy leaderboard, pattern EV, confidence scaling chart, session log |
| `/letter` | Investor letters — LLM-written LP updates after each close session |

## Data sources

- **Neon PostgreSQL** — `stocks` schema: signals, snapshots, watchlist, accuracy, patterns, trade lessons, investor letters
- **Alpaca Paper Trading API** — live account equity, open positions, portfolio metrics

## Environment variables

Required in `.env.local` (and Vercel project settings):

```
DATABASE_URL=postgresql://...@...neon.tech/neondb?sslmode=require
ALPACA_API_KEY=...
ALPACA_SECRET_KEY=...
ALPACA_BASE_URL=https://paper-api.alpaca.markets/v2
```

> **Note:** Do not include `channel_binding=require` in DATABASE_URL — it is incompatible with Neon's serverless HTTP driver.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

Connected to Vercel via GitHub. Every push to `main` triggers a new deployment. The `web/` subdirectory is the Vercel root directory.

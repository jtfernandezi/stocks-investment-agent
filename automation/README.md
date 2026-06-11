# Automation — self-improving audit layer

Two scheduled jobs that watch the fund and help it get better over time, **without ever being able to break it**. Both are read-only on production; the worst case is a Telegram you ignore and a PR you close.

**Primary home: GitHub Actions** (always-on, Mac can be off) — see `.github/workflows/`. The scripts here also run locally for manual/on-demand use.

## What runs

| Job | Schedule | What it does | Touches code? |
|-----|----------|--------------|---------------|
| **Daily canary** (`canary.mjs`) | Weekdays 21:30 UTC (4:30 PM ET — after market close) | Deterministic integrity check (no LLM). Catches the silent-failure class (cash deadlock, frozen watchlist, partial signals, swallowed query errors). Silent when healthy; **Telegram alarm only on failure.** | No |
| **Weekly audit** (`weekly_audit_prompt.md`) | Sunday 06:11 UTC (00:11 Mexico City, overnight Sat→Sun) | Headless Claude Code does a full 7-lever audit, reads prior reports + the Initiatives Register (longitudinal), writes `audits/<date>.md`, and **codes its proposals into Pull Requests** — one PR per change, tiered `[A]` (tunable fix) / `[B-code]` (isolated code-only change) / `[B-spec]` (n8n-wiring or strategy → spec only). Lever 7 also runs a **generative R&D** pass that advances a maturity-graded research agenda. Telegrams a digest linking every PR. Runs overnight so it doesn't compete with your daytime token budget. | Codes into PRs — **never merges, never deploys** |

## Safety model (why this can't break the fund)

The inviolable rule is **never auto-merged / never deployed** — *not* "never coded." The audit writes real code now, but a human merges every PR while awake.

1. **DB is read-only by capability.** All DB access goes through the `audit_ro` Neon role (SELECT-only — the database itself rejects writes). The weekly audit runs with **all MCP servers disabled** (`--strict-mcp-config` + empty config) so it can't reach a writable Neon MCP — it must use `query.mjs`.
2. **No production writes.** n8n and Alpaca are GET-only by mandate; nothing is ever PUT/POST/DELETE'd, no order is ever placed. A PR can edit a `workflows/code/*.js` file but can NEVER add/rewire an n8n node — that stays a manual human op (`[B-spec]`).
3. **PR isolation + never merges.** Every change lives in its own Pull Request from an `audit/<date>*` branch — never pushed to `main`, never auto-merged. The PRs do nothing until *you* review and merge them (then apply any n8n code-node sync per CLAUDE.md). The fund's safety also rests on your **merge discipline** — reject any PR you don't fully understand.
4. **Strategy stays spec-only until it's verifiable.** New trading strategies are `[B-spec]` (prose + optional scaffold), not coded PRs, until a backtest/test harness exists to verify them. Only isolated, low-blast-radius, code-only changes are coded (`[B-code]`); `⛔` out-of-envelope ideas are never coded at all.

## File map

**Brains** — the files that actually do the work
- `canary.mjs` — daily check
- `weekly_audit_prompt.md` — Sunday audit instructions (Claude reads and follows this)

**Helpers** — small tools the brains call
- `query.mjs` — talks to the database (read-only)
- `notify.sh` — sends Telegram messages
- `empty-mcp.json` — safety lock (blocks DB writes during the audit)

**Launchers** — how you start things
- `.github/workflows/daily-canary.yml` — tells GitHub "run canary.mjs every weekday at 4:30 PM ET" ☁️
- `.github/workflows/weekly-audit.yml` — tells GitHub "run the audit every Sunday midnight" ☁️
- `run_canary.sh` — run canary manually from your Mac 💻
- `run_weekly_audit.sh` — run audit manually from your Mac 💻

**Plumbing** — ignore these
- `package.json` / `node_modules/` — Node.js dependencies (`@neondatabase/serverless`)
- `logs/` — local run history (gitignored)
- `../audits/` — weekly reports + `IMPROVEMENT_BACKLOG.md`

## Secrets

**Cloud (primary):** GitHub Actions repo secrets — `AUDIT_DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `N8N_API_KEY`, `N8N_API_BASE`, `ALPACA_*`, and `CLAUDE_CODE_OAUTH_TOKEN` (minted via `claude setup-token`, tied to your Claude subscription). Set with `gh secret set <NAME> --repo jtfernandezi/stocks-investment-agent`.

**Local (manual runs):** `~/.config/stocks-audit/secrets.env` (outside the repo, `chmod 600`) holds the same values minus the Claude token. **If you rotate Alpaca/n8n keys, update both the GitHub secret and this file.**

## Schedules

**GitHub Actions (primary — Mac can be off):** `.github/workflows/daily-canary.yml` + `.github/workflows/weekly-audit.yml`.

```bash
gh workflow list
gh run list --workflow=daily-canary.yml --limit 5
gh workflow run daily-canary.yml      # manual canary run (no Claude tokens)
gh workflow run weekly-audit.yml -f model=opus    # manual audit run (uses tokens)
```

**Local launchd (optional fallback):** plists in `~/Library/LaunchAgents/` (`com.stocks.daily-canary` / `com.stocks.weekly-audit`). Removed once the cloud version is validated to avoid double-firing. Local on-demand runs:

```bash
bash automation/run_canary.sh && tail -n 30 automation/logs/canary.log   # read-only, safe
AUDIT_MODEL=opus bash automation/run_weekly_audit.sh                      # opens a PR via gh
```

## Reviewing a weekly audit

The audit opens **one PR per change** — a report/register PR (`audit/<date>`) plus a separate PR per `[A]`/`[B-code]` change (`audit/<date>-<slug>`). The Telegram digest lists every URL. Review from the GitHub app / web and merge them independently.
- **Accept:** merge that PR, then apply any n8n code-node sync per the CLAUDE.md sync rules.
- **Reject:** close that PR without merging — the others are unaffected.
- **Merge discipline:** the audit codes on faith (it can't run n8n or backtest), so a `[B-code]` PR touching trading logic carries an `UNVERIFIED` banner. **Don't merge what you can't review.**
- **`[B-spec]` items** in the report are *not* PRs — they need n8n wiring or validation, so you build them deliberately when you choose to.

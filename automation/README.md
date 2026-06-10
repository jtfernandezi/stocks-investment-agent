# Automation — self-improving audit layer

Two scheduled jobs that watch the fund and help it get better over time, **without ever being able to break it**. Both are read-only on production; the worst case is a Telegram you ignore and a PR you close.

**Primary home: GitHub Actions** (always-on, Mac can be off) — see `.github/workflows/`. The scripts here also run locally for manual/on-demand use.

## What runs

| Job | Schedule | What it does | Touches code? |
|-----|----------|--------------|---------------|
| **Daily canary** (`canary.mjs`) | Weekdays 21:30 UTC (4:30 PM ET — after market close) | Deterministic integrity check (no LLM). Catches the silent-failure class (cash deadlock, frozen watchlist, partial signals, swallowed query errors). Silent when healthy; **Telegram alarm only on failure.** | No |
| **Weekly audit** (`weekly_audit_prompt.md`) | Sunday 06:11 UTC (00:11 Mexico City, overnight Sat→Sun) | Headless Claude Code does a full 7-lever audit, reads prior reports (longitudinal), writes `audits/<date>.md`, applies **Type A** fixes + logs **Type B** ideas, **opens a Pull Request**, and Telegrams a digest with the PR link. Runs overnight so it doesn't compete with your daytime token budget. | Proposes only (in a PR) |

## Safety model (why this can't break the fund)

1. **DB is read-only by capability.** All DB access goes through the `audit_ro` Neon role (SELECT-only — the database itself rejects writes). The weekly audit runs with **all MCP servers disabled** (`--strict-mcp-config` + empty config) so it can't reach a writable Neon MCP — it must use `query.mjs`.
2. **No production writes.** n8n and Alpaca are GET-only by mandate; nothing is ever PUT/POST/DELETE'd, no order is ever placed.
3. **PR isolation.** All proposed changes (report + Type A fixes) live in a Pull Request from `audit/<date>` — never pushed to `main`, never auto-merged. The PR does nothing until *you* merge it (then apply any n8n code-node changes per the CLAUDE.md sync rules).
4. **Structural ideas are never coded** — they're written up for you to build deliberately.

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

The audit opens a **Pull Request** (`audit/<date>` → `main`). Review it from the GitHub app / web; the Telegram digest links to it.
- **Accept:** merge the PR, then apply any n8n code-node changes per the CLAUDE.md sync rules.
- **Reject:** close the PR without merging.

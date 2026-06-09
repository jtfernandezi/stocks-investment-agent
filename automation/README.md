# Automation — self-improving audit layer

Two scheduled jobs that watch the fund and help it get better over time, **without ever being able to break it**. Both are read-only on production; the worst case is a Telegram you ignore and a git branch you delete.

## What runs

| Job | Schedule (ET) | What it does | Touches code? |
|-----|---------------|--------------|---------------|
| **Daily canary** (`canary.mjs`) | Mon–Fri ~11:20 AM | Deterministic integrity check (no LLM). Catches the silent-failure class (cash deadlock, frozen watchlist, partial signals, swallowed query errors). Silent when healthy; **Telegram alarm only on failure.** | No |
| **Weekly audit** (`run_weekly_audit.sh`) | Sunday ~10 AM | Headless Claude Code does a full 7-lever audit, reads prior reports (longitudinal), writes `audits/<date>.md`, stages **Type A** fixes on branch `audit/<date>`, logs **Type B** ideas to the backlog, and Telegrams a digest. | Proposes only (on a branch) |

## Safety model (why this can't break the fund)

1. **DB is read-only by capability.** All DB access goes through the `audit_ro` Neon role (SELECT-only — the database itself rejects writes). The weekly audit runs with **all MCP servers disabled** (`--strict-mcp-config` + empty config) so it can't reach a writable Neon MCP — it must use `query.mjs`.
2. **No production writes.** n8n and Alpaca are GET-only by mandate; nothing is ever PUT/POST/DELETE'd, no order is ever placed.
3. **Branch isolation.** Proposed code fixes live on `audit/<date>` — never pushed, never merged, never committed to `main` (only `audits/*.md` docs go to main). A branch does nothing until *you* merge and apply it per the CLAUDE.md n8n-sync rules.
4. **Structural ideas are never coded** — they're written up for you to build deliberately.

## Files

| File | Purpose |
|------|---------|
| `canary.mjs` | Daily integrity check (Node, deterministic) |
| `run_canary.sh` | Canary launcher (sources secrets, logs) |
| `query.mjs` | Read-only SQL runner (`audit_ro`) — the audit's only DB path |
| `weekly_audit_prompt.md` | The full audit instructions Claude follows |
| `run_weekly_audit.sh` | Weekly launcher (headless `claude -p`, opus by default) |
| `notify.sh` | Telegram sender (`notify.sh "msg"`) |
| `empty-mcp.json` | Empty MCP config to disable all MCP in the audit |
| `package.json` / `node_modules/` | Self-contained `@neondatabase/serverless` dep |
| `logs/` | Run logs (gitignored): `canary.log`, `audit-<date>.log` |
| `../audits/` | Weekly reports + `IMPROVEMENT_BACKLOG.md` (kept as record) |

## Secrets

All live in `~/.config/stocks-audit/secrets.env` (outside the repo, `chmod 600`): Telegram token + chat_id, the read-only `AUDIT_DATABASE_URL`, Alpaca paper keys, n8n API key. **If you rotate Alpaca/n8n keys, update this file too** (it's a deliberate copy so the automation never reads `web/.env.local`, which holds the *writable* owner DB creds).

## Schedules (launchd)

- `~/Library/LaunchAgents/com.stocks.weekly-audit.plist`
- `~/Library/LaunchAgents/com.stocks.daily-canary.plist`

Both require the Mac to be **powered on** at run time (asleep is fine — launchd catches up on wake; off is not). Recurring jobs have no expiry (unlike Claude Code's in-session CronCreate).

```bash
# manage
launchctl list | grep com.stocks                 # see if loaded
launchctl unload ~/Library/LaunchAgents/com.stocks.weekly-audit.plist   # disable
launchctl load   ~/Library/LaunchAgents/com.stocks.weekly-audit.plist   # enable

# run on demand (read-only — safe)
bash automation/run_canary.sh && tail -n 30 automation/logs/canary.log
AUDIT_MODEL=sonnet bash automation/run_weekly_audit.sh   # cheaper manual run
```

## Reviewing a weekly audit

```bash
git diff main..audit/<date>     # see proposed code fixes
# accept:  git checkout main && git merge audit/<date>   (then sync n8n per CLAUDE.md)
# reject:  git branch -D audit/<date>
```

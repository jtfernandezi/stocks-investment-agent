#!/usr/bin/env bash
# Weekly Audit launcher (invoked by launchd, Sunday ~10 AM ET).
# Runs Claude Code headless to audit the fund and PROPOSE improvements.
# Safety lives in weekly_audit_prompt.md + the read-only audit_ro DB role +
# branch isolation. This launcher only sets up env, runs it, and alerts on crash.
set -uo pipefail

SECRETS="$HOME/.config/stocks-audit/secrets.env"
set -a
[ -f "$SECRETS" ] && source "$SECRETS"
set +a

NOTIFY="$PROJECT_DIR/automation/notify.sh"
cd "$PROJECT_DIR" 2>/dev/null || {
  [ -f "$NOTIFY" ] && bash "$NOTIFY" "🚨 Weekly audit: cannot cd to PROJECT_DIR ($PROJECT_DIR)"
  exit 0
}

# Resolve claude + node robustly (launchd has no nvm/PATH): pinned → newest nvm → PATH
CLAUDE="/Users/jjtfernandez/.nvm/versions/node/v24.15.0/bin/claude"
[ -x "$CLAUDE" ] || CLAUDE="$(ls -t "$HOME"/.nvm/versions/node/*/bin/claude 2>/dev/null | head -1)"
[ -x "$CLAUDE" ] || CLAUDE="$(command -v claude || true)"

# Ensure node (+ git etc.) are on PATH for the audit's own shell calls.
if [ -n "$CLAUDE" ]; then
  NODE_BIN_DIR="$(dirname "$CLAUDE")"
  export PATH="$NODE_BIN_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
fi

AUDIT_MODEL="${AUDIT_MODEL:-opus}"   # weekly + judgment-heavy → quality over cost. Override via env.
DATE="$(TZ=America/New_York date +%F)"
mkdir -p "$PROJECT_DIR/automation/logs"
LOG="$PROJECT_DIR/automation/logs/audit-$DATE.log"

if [ -z "$CLAUDE" ]; then
  bash "$PROJECT_DIR/automation/notify.sh" "🚨 Weekly audit: claude CLI not found on $(hostname)."
  exit 0
fi

PROMPT="$(cat "$PROJECT_DIR/automation/weekly_audit_prompt.md")"

{
  echo "===== weekly audit $DATE @ $(date '+%F %T %Z') ====="
  echo "model: $AUDIT_MODEL   claude: $CLAUDE"
} >> "$LOG"

# --strict-mcp-config + empty config => NO MCP servers load, so the audit cannot
# reach a writable Neon MCP. DB access is forced through the read-only query.mjs helper.
"$CLAUDE" -p "$PROMPT" \
  --model "$AUDIT_MODEL" \
  --dangerously-skip-permissions \
  --strict-mcp-config \
  --mcp-config "$PROJECT_DIR/automation/empty-mcp.json" \
  >> "$LOG" 2>&1
RC=$?

echo "claude exit: $RC" >> "$LOG"

if [ "$RC" -ne 0 ]; then
  bash "$PROJECT_DIR/automation/notify.sh" \
    "🚨 Weekly audit run FAILED (exit $RC) on $(date '+%F'). See automation/logs/audit-$DATE.log"
fi

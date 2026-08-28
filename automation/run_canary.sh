#!/usr/bin/env bash
# Daily Canary launcher (invoked by launchd, Mon–Fri ~11:20 ET).
# Sources secrets + web/.env.local, runs the deterministic integrity check.
# READ-ONLY (audit_ro role). Silent when healthy; Telegram alarm on failure.
set -uo pipefail

SECRETS="$HOME/.config/stocks-audit/secrets.env"
set -a
[ -f "$SECRETS" ] && source "$SECRETS"   # complete secret source (read-only DB + Alpaca + Telegram)
set +a

# Resolve node robustly (launchd has no nvm/PATH): pinned → newest nvm → PATH
NODE="$HOME/.nvm/versions/node/v24.15.0/bin/node"
[ -x "$NODE" ] || NODE="$(ls -t "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | head -1)"
[ -x "$NODE" ] || NODE="$(command -v node || true)"

LOG="$PROJECT_DIR/automation/logs/canary.log"
mkdir -p "$PROJECT_DIR/automation/logs"
{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S %Z') ====="
  if [ -z "$NODE" ]; then
    echo "FATAL: node not found"
    bash "$PROJECT_DIR/automation/notify.sh" "🚨 STOCKS CANARY — node binary not found on $(hostname). Canary cannot run."
  else
    "$NODE" "$PROJECT_DIR/automation/canary.mjs"
    echo "exit: $?"
  fi
} >> "$LOG" 2>&1

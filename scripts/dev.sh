#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PATH="$REPO_ROOT/bin:$PATH"
mkdir -p logs

if ! command -v mm-bot >/dev/null 2>&1; then
  echo "mm-bot not found in PATH" >&2
  echo "Run: bash scripts/install-mm-bot.sh" >&2
  exit 1
fi

cleanup() {
  local code=$?
  if [[ -f logs/start.pid ]]; then
    local bot_pid
    bot_pid=$(<logs/start.pid)
    kill "$bot_pid" 2>/dev/null || true
    rm -f logs/start.pid
  fi
  exit "$code"
}
trap cleanup INT TERM EXIT

echo "Starting bot..."
mm-bot start --config="$REPO_ROOT/run-bot/config/default.toml" >logs/start.log 2>&1 &
echo $! >logs/start.pid
sleep 2

if ! kill -0 "$(<logs/start.pid)" 2>/dev/null; then
  echo "Bot crashed during startup. Check logs/start.log" >&2
  exit 1
fi

echo "Bot log: tail -f logs/start.log"
echo "Press Ctrl+C to stop."
wait "$(<logs/start.pid)"

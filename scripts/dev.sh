#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Add the local bin/ to PATH so `mm-bot` resolves to our shim even when
# the global /usr/local/bin/mm-bot symlink (set up by install-mm-bot.sh
# via sudo) is not present. This lets dev.sh work in a fresh terminal
# without requiring the user to run sudo.
export PATH="$REPO_ROOT/bin:$PATH"

mkdir -p logs

if ! command -v mm-bot >/dev/null 2>&1; then
  echo "❌ mm-bot not found in PATH" >&2
  echo "   Run: bash scripts/install-mm-bot.sh" >&2
  echo "   (if /usr/local/bin symlink failed: this script now also adds $REPO_ROOT/bin to PATH automatically)" >&2
  exit 1
fi

cleanup() {
  local code=$?
  echo "Stopping T1 + T2..."
  for pidfile in logs/start.pid logs/web.pid; do
    if [[ -f "$pidfile" ]]; then
      local pid
      pid=$(cat "$pidfile")
      kill "$pid" 2>/dev/null || true
      rm -f "$pidfile"
    fi
  done
  exit "$code"
}
trap cleanup INT TERM

echo "Starting T1 (bot)..."
mm-bot start --config="$REPO_ROOT/run-bot/config/default.toml" >logs/start.log 2>&1 &
echo $! >logs/start.pid
sleep 2
if ! kill -0 "$(cat logs/start.pid)" 2>/dev/null; then
  echo "❌ T1 crashed early. Check logs/start.log" >&2
  exit 1
fi

echo "Starting T2 (web)..."
mm-bot web >logs/web.log 2>&1 &
echo $! >logs/web.pid
sleep 3
if ! kill -0 "$(cat logs/web.pid)" 2>/dev/null; then
  echo "❌ T2 crashed early. Check logs/web.log" >&2
  exit 1
fi

if curl -fsS http://127.0.0.1:7913/ -o /dev/null 2>&1; then
  echo "✅ Dashboard: http://127.0.0.1:7913"
else
  echo "❌ Web failed to start (check logs/web.log)" >&2
fi

echo
echo "T1 (bot): tail -f logs/start.log"
echo "T2 (web): tail -f logs/web.log"
echo "Stop:    kill \$(cat logs/start.pid) \$(cat logs/web.pid)"
echo
echo "Press Ctrl+C to stop both."
wait

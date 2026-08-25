#!/usr/bin/env bash
# Fresh repository coverage pipeline. The bot's modified runtime has two
# independent strict four-metric gates: Node-hosted Vitest unit coverage and
# Istanbul-instrumented real Bun child-process E2E coverage. They are never
# merged with each other.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FAILURES=()

run_gate() {
  local label="$1"
  shift
  echo
  echo "==> ${label}"
  "$@"
  local status=$?
  if [ "$status" -ne 0 ]; then
    FAILURES+=("${label} (exit ${status})")
  fi
}

run_node_vitest_gate() {
  local remaining_path="${PATH}:"
  local path_segment
  local sanitized_path
  local -a sanitized_segments=()

  while [[ "$remaining_path" == *:* ]]; do
    path_segment="${remaining_path%%:*}"
    remaining_path="${remaining_path#*:}"
    [[ "$path_segment" == /tmp/bun-node-* ]] && continue
    sanitized_segments+=("$path_segment")
  done

  if [[ "${#sanitized_segments[@]}" -gt 0 ]]; then
    printf -v sanitized_path '%s:' "${sanitized_segments[@]}"
    sanitized_path="${sanitized_path%:}"
  else
    sanitized_path=""
  fi

  PATH="$sanitized_path" env -u NODE -u npm_node_execpath -u npm_execpath "$@"
}

# Delete only known generated outputs so stale data can never turn a failed
# producer green. Source/config directories are not descendants of these paths.
rm -rf \
  apps/bot/coverage \
  packages/paper/coverage \
  packages/exchange/coverage \
  packages/core/coverage \
  packages/shared/coverage \
  packages/backtest/coverage \
  packages/backtest-tools/coverage \
  packages/logging/coverage \
  packages/typing/coverage \
  packages/typeguard/coverage \
  packages/assert/coverage \
  packages/numeric/coverage \
  coverage/merged

run_gate "all Bun tests" bunx turbo run test --force
run_gate "coverage infrastructure regression tests" bun run test:coverage-infra
run_gate "coverage tooling typecheck" bun run typecheck:coverage-tools
run_gate "bot runtime scope completeness" bun scripts/coverage-tools/verify-bot-runtime-scope.ts

run_gate "@mm-crypto-bot/paper Node Vitest LCOV" run_node_vitest_gate bun run --filter @mm-crypto-bot/paper coverage
run_gate "@mm-crypto-bot/exchange Bun LCOV" bun run --filter @mm-crypto-bot/exchange coverage
run_gate "@mm-crypto-bot/core Bun LCOV" bun run --filter @mm-crypto-bot/core coverage
run_gate "@mm-crypto-bot/shared Node Vitest LCOV" run_node_vitest_gate bun run --filter @mm-crypto-bot/shared coverage
run_gate "@mm-crypto-bot/backtest Node Vitest LCOV" run_node_vitest_gate bun run --filter @mm-crypto-bot/backtest coverage
run_gate "@mm-crypto-bot/typing Node Vitest LCOV" run_node_vitest_gate bun run --filter @mm-crypto-bot/typing coverage
run_gate "@mm-crypto-bot/typeguard Node Vitest LCOV" run_node_vitest_gate bun run --filter @mm-crypto-bot/typeguard coverage
run_gate "@mm-crypto-bot/assert Node Vitest LCOV" run_node_vitest_gate bun run --filter @mm-crypto-bot/assert coverage
run_gate "@mm-crypto-bot/numeric Node Vitest LCOV" run_node_vitest_gate bun run --filter @mm-crypto-bot/numeric coverage
run_gate "@mm-crypto-bot/backtest-tools Bun LCOV" bun run --filter @mm-crypto-bot/backtest-tools coverage

run_gate "bot Node Vitest unit 100% statements/branches/functions/lines" run_node_vitest_gate bun run coverage:bot:unit
run_gate "bot subprocess E2E 100% statements/branches/functions/lines" bun run coverage:bot:e2e
run_gate "logging Node Vitest unit 100% statements/branches/functions/lines" run_node_vitest_gate bun run --filter @mm-crypto-bot/logging coverage:unit
run_gate "logging subprocess E2E 100% statements/branches/functions/lines" bun run --filter @mm-crypto-bot/logging coverage:e2e
run_gate "per-package Bun line gate" bash scripts/coverage-per-package.sh
run_gate "merged unit/package LCOV" bun run coverage:merge
run_gate "merged unit/package LCOV summary" bun run coverage:report

echo
if [ "${#FAILURES[@]}" -ne 0 ]; then
  echo "Coverage pipeline failed:"
  for failure in "${FAILURES[@]}"; do
    echo "  - ${failure}"
  done
  exit 1
fi

echo "Coverage pipeline passed. Bot and logging independent unit and subprocess E2E coverage are each 100% on all four metrics."

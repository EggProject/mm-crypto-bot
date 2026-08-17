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
  coverage/merged

run_gate "all Bun tests" bunx turbo run test --force
run_gate "coverage infrastructure regression tests" bun run test:coverage-infra
run_gate "coverage tooling typecheck" bun run typecheck:coverage-tools
run_gate "bot runtime scope completeness" bun scripts/coverage-tools/verify-bot-runtime-scope.ts

for package in \
  @mm-crypto-bot/paper \
  @mm-crypto-bot/exchange \
  @mm-crypto-bot/core \
  @mm-crypto-bot/shared \
  @mm-crypto-bot/backtest \
  @mm-crypto-bot/backtest-tools
do
  run_gate "${package} Bun LCOV" bun run --filter "$package" coverage
done

run_gate "bot unit 100% statements/branches/functions/lines" bun run coverage:bot:unit
run_gate "bot subprocess E2E 100% statements/branches/functions/lines" bun run coverage:bot:e2e
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

echo "Coverage pipeline passed. Bot unit and subprocess E2E are independently 100% on all four metrics."

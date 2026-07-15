#!/usr/bin/env bash
# scripts/install-no-warnings.sh
# ============================================================================
# Phase 40 bugfix — assert that `bun install` produces ZERO warnings.
#
# Background
# ----------
# Until Phase 40, the root `package.json` carried a nested `"overrides"` block
# intended to silence peer-dep warnings for @inkjs/ui, @matthesketh/ink-table
# and @matthesketh/ink-status-bar:
#
#   "overrides": {
#     "@inkjs/ui": { "peerDependencies": { "ink": "*", "react": "*" } },
#     ...
#   }
#
# Bun 1.3+ does NOT support nested map overrides — it only supports the flat
# `pkg → version` form (or `pkg → "npm:other-pkg@version"`). When it sees
# the nested shape, bun prints:
#
#   warn: Bun currently does not support nested "overrides"
#         at /.../package.json:73:18
#
# and IGNORES the override entirely (it is a no-op). The "fix" was therefore
# hiding nothing.
#
# This script enforces two invariants so the bug cannot regress:
#
#   1. `bun install` runs cleanly and `bun install 2>&1 | grep -c "warn:"`
#      returns 0.
#   2. The root `package.json` does NOT contain a nested "overrides" block
#      (i.e. it has no line of the form `  "<pkg>": {` inside the
#      `"overrides":` section, which would be the indicator of a nested
#      map value that bun cannot parse).
#
# Exit codes:
#   0 — PASS (no warnings, no nested overrides)
#   1 — FAIL (warnings detected, or nested overrides detected, or install
#         itself failed)
#
# Why a shell script (not a vitest test)?
#   `bun install` is a process-level concern: it must run before any test
#   runner, and the warning comes from bun's own installer. A shell script
#   matches the existing pattern (`scripts/coverage-full.sh`,
#   `scripts/coverage-per-package.sh`, `scripts/install-mm-bot.sh`).
#
# Usage:
#   bash scripts/install-no-warnings.sh
#   # or, from the root package.json script:
#   bun run test:install-warnings
# ============================================================================

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FAIL=0

# ---------------------------------------------------------------------------
# Check 1: root package.json must not have a nested "overrides" block.
# A nested override looks like:
#     "overrides": {
#       "<pkg>": {            <-- one extra level of nesting
#         "peerDependencies": {
#           ...
#         }
#       }
#     }
# We detect it by reading the file as text and looking for a `:` line whose
# value is `{` (i.e. an object value, not a string) and that appears inside
# the `"overrides":` section. Simpler heuristic that is sufficient for this
# project: any line inside the overrides block that opens a `{` directly
# after a quoted key.
# ---------------------------------------------------------------------------
PKG_JSON="$REPO_ROOT/package.json"

# Use a small node one-liner (bun is the package manager but node ships
# with the env) to walk the JSON and detect nested overrides cleanly.
NESTED_OVERRIDES=$(node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$PKG_JSON', 'utf8'));
  const ov = pkg.overrides;
  if (!ov || typeof ov !== 'object') { console.log(0); process.exit(0); }
  // Nested = an override value that is itself an object (not a string).
  const nested = Object.values(ov).filter(v => v && typeof v === 'object' && !Array.isArray(v));
  console.log(nested.length);
")

if [ "$NESTED_OVERRIDES" != "0" ]; then
  echo "FAIL: root package.json contains $NESTED_OVERRIDES nested override(s); bun cannot parse them and will emit 'warn: Bun currently does not support nested overrides' on every install."
  FAIL=1
else
  echo "PASS: root package.json has no nested 'overrides' blocks."
fi

# ---------------------------------------------------------------------------
# Check 2: `bun install` produces zero `warn:` lines.
# We run a no-op install (`bun install` is idempotent on an up-to-date
# node_modules) and grep the output. We do NOT touch the cache or wipe
# node_modules — the goal is to detect a regression, not to validate a
# cold install. CI runs `bun install --frozen-lockfile` separately.
# ---------------------------------------------------------------------------
echo
echo "Running: bun install (checking for warnings)..."
INSTALL_OUTPUT=$(bun install 2>&1)
INSTALL_EXIT=$?

if [ "$INSTALL_EXIT" -ne 0 ]; then
  echo "FAIL: bun install exited with code $INSTALL_EXIT"
  echo "----- install output -----"
  echo "$INSTALL_OUTPUT"
  echo "--------------------------"
  FAIL=1
else
  WARN_COUNT=$(printf '%s\n' "$INSTALL_OUTPUT" | grep -c '^warn:' || true)
  if [ "$WARN_COUNT" != "0" ]; then
    echo "FAIL: bun install produced $WARN_COUNT warning line(s):"
    printf '%s\n' "$INSTALL_OUTPUT" | grep '^warn:'
    FAIL=1
  else
    echo "PASS: bun install produced zero warnings."
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
if [ "$FAIL" -eq 0 ]; then
  echo "✓ install-no-warnings: PASS (no nested overrides, bun install clean)"
  exit 0
else
  echo "✗ install-no-warnings: FAIL"
  exit 1
fi

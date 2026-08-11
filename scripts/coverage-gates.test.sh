#!/usr/bin/env bash
# Regression tests for the OWN-LCOV coverage gates.
#
# The fixtures exercise LCOV's documented LF (instrumented lines) and LH
# (lines with non-zero execution count) summaries without running a project
# test suite. This keeps the gate tests deterministic and verifies that a
# display-rounded 100.0% is never accepted as complete coverage.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN_BIN="$(command -v bun)"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mm-coverage-gates.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

PACKAGES=(
  "apps/bot"
  "packages/paper"
  "packages/exchange"
  "packages/core"
  "packages/shared"
  "packages/backtest"
  "packages/backtest-tools"
)

fail() {
  echo "coverage-gates.test.sh: $*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  [[ "$haystack" == *"$needle"* ]] || fail "expected output to contain: $needle"
}

write_tracefiles() {
  local root="$1"
  local mode="$2"
  local pkg lh lf
  for pkg in "${PACKAGES[@]}"; do
    lh=1
    lf=1
    if [[ "$pkg" == "apps/bot" ]]; then
      case "$mode" in
        rounded-miss)
          # 99.95%, deliberately displayed as 100.0% with one decimal place.
          lh=1999
          lf=2000
          ;;
        exact)
          lh=2000
          lf=2000
          ;;
        zero)
          lh=0
          lf=0
          ;;
        *)
          fail "unknown fixture mode: $mode"
          ;;
      esac
    fi

    mkdir -p "$root/$pkg/coverage"
    printf 'SF:src/example.ts\nLF:%s\nLH:%s\nend_of_record\n' "$lf" "$lh" \
      > "$root/$pkg/coverage/lcov.info"
  done
}

run_per_package_case() {
  local mode="$1"
  local expected_exit="$2"
  local expected_text="$3"
  local root="$TEMP_ROOT/per-$mode"
  mkdir -p "$root/scripts"
  cp "$REPO_ROOT/scripts/coverage-per-package.sh" "$root/scripts/coverage-per-package.sh"
  write_tracefiles "$root" "$mode"

  local output exit_code
  set +e
  output="$(bash "$root/scripts/coverage-per-package.sh" 2>&1)"
  exit_code=$?
  set -e
  [[ "$exit_code" -eq "$expected_exit" ]] || fail "per-package $mode exit=$exit_code, expected $expected_exit"
  assert_contains "$output" "$expected_text"
}

write_full_pipeline_stubs() {
  local root="$1"
  mkdir -p "$root/bin"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    'case " $* " in' \
    '  *" coverage "*) "$COVERAGE_FIXTURE_WRITER" "$PWD" "$SYNTHETIC_MODE" ;;' \
    'esac' \
    > "$root/bin/npx"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$root/bin/bun"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    'root="$1"' \
    'mode="$2"' \
    'packages=(apps/bot packages/paper packages/exchange packages/core packages/shared packages/backtest packages/backtest-tools)' \
    'for pkg in "${packages[@]}"; do' \
    '  lh=1; lf=1' \
    '  if [[ "$pkg" == "apps/bot" ]]; then' \
    '    case "$mode" in' \
    '      rounded-miss) lh=1999; lf=2000 ;;' \
    '      exact) lh=2000; lf=2000 ;;' \
    '      *) echo "unknown synthetic mode: $mode" >&2; exit 2 ;;' \
    '    esac' \
    '  fi' \
    '  mkdir -p "$root/$pkg/coverage"' \
    '  printf "SF:src/example.ts\\nLF:%s\\nLH:%s\\nend_of_record\\n" "$lf" "$lh" > "$root/$pkg/coverage/lcov.info"' \
    'done' \
    > "$root/write-lcov-fixtures.sh"
  chmod +x "$root/bin/npx" "$root/bin/bun" "$root/write-lcov-fixtures.sh"
}

run_full_case() {
  local mode="$1"
  local expected_exit="$2"
  local expected_text="$3"
  local root="$TEMP_ROOT/full-$mode"
  mkdir -p "$root/scripts"
  cp "$REPO_ROOT/scripts/coverage-full.sh" "$root/scripts/coverage-full.sh"
  write_full_pipeline_stubs "$root"

  local output exit_code
  set +e
  output="$(
    PATH="$root/bin:$PATH" \
      COVERAGE_FIXTURE_WRITER="$root/write-lcov-fixtures.sh" \
      SYNTHETIC_MODE="$mode" \
      bash "$root/scripts/coverage-full.sh" 2>&1
  )"
  exit_code=$?
  set -e
  [[ "$exit_code" -eq "$expected_exit" ]] || fail "coverage-full $mode exit=$exit_code, expected $expected_exit"
  assert_contains "$output" "$expected_text"
}

run_lcov_tool_cases() {
  local root="$TEMP_ROOT/lcov-tools"
  mkdir -p "$root"
  printf 'SF:src/a.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n' > "$root/one.info"
  printf 'SF:src/a.ts\nDA:1,2\nDA:2,0\nLF:2\nLH:1\nend_of_record\n' > "$root/two.info"
  # PATH deliberately lacks lcov: the repository-owned Bun tool must merge
  # duplicate SF records and recompute LF/LH from DA entries.
  PATH="/nonexistent" "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/merged.info" "$root/one.info" "$root/two.info"
  /bin/grep -q '^DA:1,3$' "$root/merged.info" || fail "merged DA counter was not summed"
  /bin/grep -q '^LF:2$' "$root/merged.info" || fail "merged LF was not recomputed"
  /bin/grep -q '^LH:1$' "$root/merged.info" || fail "merged LH was not recomputed"
  if PATH="/nonexistent" "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/nope.info" "$root/missing.info" >/dev/null 2>&1; then fail "missing tracefile passed"; fi
  printf 'SF:src/b.ts\nDA:not-a-number,1\nend_of_record\n' > "$root/malformed.info"
  if "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/nope.info" "$root/malformed.info" >/dev/null 2>&1; then fail "malformed tracefile passed"; fi
}

# Regression: rounded display must not permit a one-line miss.
run_per_package_case "rounded-miss" 1 "apps/bot  lines.......: 100.0% (1999 of 2000 lines)"
run_full_case "rounded-miss" 1 "| apps/bot               | FAIL"

# Exact equality is the only successful 100% result.
run_per_package_case "exact" 0 "Total: 7/7 packages at 100% line coverage"
run_full_case "exact" 0 "Result: 7/7 packages at 100% line coverage"

# Missing/zero OWN data remains a hard failure, never a vacuous pass.
run_per_package_case "zero" 1 "apps/bot  no OWN files matched"
run_lcov_tool_cases

echo "coverage gate synthetic regressions: PASS"

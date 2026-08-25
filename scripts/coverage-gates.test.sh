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
COVERAGE_FULL_SCRIPT="${COVERAGE_FULL_SCRIPT:-$REPO_ROOT/scripts/coverage-full.sh}"
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
  "packages/logging"
  "packages/typing"
  "packages/typeguard"
  "packages/assert"
  "packages/numeric"
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

    local coverage_directory="$root/$pkg/coverage"
    if [[ "$pkg" == "apps/bot" ]]; then
      coverage_directory="$coverage_directory/unit"
    elif [[ "$pkg" == "packages/logging" ]]; then
      coverage_directory="$coverage_directory/unit"
    fi
    mkdir -p "$coverage_directory"
    printf 'SF:src/example.ts\nLF:%s\nLH:%s\nend_of_record\n' "$lf" "$lh" \
      > "$coverage_directory/lcov.info"
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
    'exit 0' \
    > "$root/bin/bunx"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    'if [[ "$1" == "run" ]]; then' \
    '  "$COVERAGE_FIXTURE_WRITER" "$PWD" "$SYNTHETIC_MODE" "${@:2}"' \
    'fi' \
    > "$root/bin/bun"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    'root="$1"' \
    'mode="$2"' \
    'shift 2' \
    'case "$mode" in exact|rounded-miss|missing-bot-unit|missing-logging-unit|missing-typing|missing-typeguard|missing-assert|missing-numeric) ;; *) echo "unknown synthetic mode: $mode" >&2; exit 2 ;; esac' \
    'if [[ -n "${COVERAGE_COMMAND_LOG:-}" ]]; then' \
    '  case ":${PATH}:" in *:/tmp/bun-node-synthetic:*) bun_node_path=present ;; *) bun_node_path=absent ;; esac' \
    '  printf "%s|NODE=%s|npm_node_execpath=%s|npm_execpath=%s|bun_node_path=%s\\n" "$*" "${NODE-<unset>}" "${npm_node_execpath-<unset>}" "${npm_execpath-<unset>}" "$bun_node_path" >> "$COVERAGE_COMMAND_LOG"' \
    'fi' \
    'if [[ "$#" -eq 3 && "$1" == "--filter" && "$3" == "coverage" ]]; then' \
    '  case "$2" in' \
    '    @mm-crypto-bot/paper) pkg=packages/paper ;;' \
    '    @mm-crypto-bot/exchange) pkg=packages/exchange ;;' \
    '    @mm-crypto-bot/core) pkg=packages/core ;;' \
    '    @mm-crypto-bot/shared) pkg=packages/shared ;;' \
    '    @mm-crypto-bot/backtest) pkg=packages/backtest ;;' \
    '    @mm-crypto-bot/backtest-tools) pkg=packages/backtest-tools ;;' \
    '    @mm-crypto-bot/logging) pkg=packages/logging ;;' \
    '    @mm-crypto-bot/typing) pkg=packages/typing ;;' \
    '    @mm-crypto-bot/typeguard) pkg=packages/typeguard ;;' \
    '    @mm-crypto-bot/assert) pkg=packages/assert ;;' \
    '    @mm-crypto-bot/numeric) pkg=packages/numeric ;;' \
    '    *) echo "unexpected package coverage invocation: $*" >&2; exit 2 ;;' \
    '  esac' \
    '  coverage_directory="$root/$pkg/coverage"' \
    '  if [[ "$pkg" == "packages/logging" ]]; then' \
    '    coverage_directory="$coverage_directory/unit"' \
    '    if [[ "$mode" != "missing-logging-unit" ]]; then' \
    '      mkdir -p "$coverage_directory"' \
    '      printf "SF:src/example.ts\\nLF:1\\nLH:1\\nend_of_record\\n" > "$coverage_directory/lcov.info"' \
    '    fi' \
    '    mkdir -p "$root/$pkg/coverage/e2e/raw"' \
    '    printf "{}\\n" > "$root/$pkg/coverage/e2e/summary.json"' \
    '    printf "{}\\n" > "$root/$pkg/coverage/e2e/raw/example.json"' \
    '  else' \
    '    if [[ "$mode" != "missing-${pkg##*/}" ]]; then' \
    '      mkdir -p "$coverage_directory"' \
    '      printf "SF:src/example.ts\\nLF:1\\nLH:1\\nend_of_record\\n" > "$coverage_directory/lcov.info"' \
    '    fi' \
    '  fi' \
    'elif [[ "$#" -eq 3 && "$1" == "--filter" && "$2" == "@mm-crypto-bot/logging" && "$3" == "coverage:unit" ]]; then' \
    '  if [[ "$mode" != "missing-logging-unit" ]]; then' \
    '    mkdir -p "$root/packages/logging/coverage/unit"' \
    '    printf "SF:src/example.ts\\nLF:1\\nLH:1\\nend_of_record\\n" > "$root/packages/logging/coverage/unit/lcov.info"' \
    '  fi' \
    'elif [[ "$#" -eq 3 && "$1" == "--filter" && "$2" == "@mm-crypto-bot/logging" && "$3" == "coverage:e2e" ]]; then' \
    '  mkdir -p "$root/packages/logging/coverage/e2e/raw"' \
    '  printf "{}\\n" > "$root/packages/logging/coverage/e2e/summary.json"' \
    '  printf "{}\\n" > "$root/packages/logging/coverage/e2e/raw/example.json"' \
    'elif [[ "$#" -eq 1 && "$1" == "coverage:bot:unit" ]]; then' \
    '  if [[ "$mode" != "missing-bot-unit" ]]; then' \
    '    lh=2000; lf=2000; [[ "$mode" == "rounded-miss" ]] && lh=1999' \
    '    mkdir -p "$root/apps/bot/coverage/unit"' \
    '    printf "SF:src/example.ts\\nLF:%s\\nLH:%s\\nend_of_record\\n" "$lf" "$lh" > "$root/apps/bot/coverage/unit/lcov.info"' \
    '  fi' \
    'fi' \
    > "$root/write-lcov-fixtures.sh"
  chmod +x "$root/bin/bunx" "$root/bin/bun" "$root/write-lcov-fixtures.sh"
}

foundation_package_for_missing_mode() {
  case "$1" in
    missing-typing) printf '%s\n' "typing" ;;
    missing-typeguard) printf '%s\n' "typeguard" ;;
    missing-assert) printf '%s\n' "assert" ;;
    missing-numeric) printf '%s\n' "numeric" ;;
    *) return 1 ;;
  esac
}

preseed_stale_foundation_tracefile() {
  local root="$1"
  local mode="$2"
  local foundation_package
  if ! foundation_package="$(foundation_package_for_missing_mode "$mode")"; then
    return
  fi
  local tracefile="$root/packages/$foundation_package/coverage/lcov.info"
  mkdir -p "${tracefile%/*}"
  printf 'SF:src/stale.ts\nLF:1\nLH:1\nend_of_record\n' > "$tracefile"
}

assert_stale_foundation_tracefile_removed() {
  local root="$1"
  local mode="$2"
  local foundation_package
  if ! foundation_package="$(foundation_package_for_missing_mode "$mode")"; then
    return
  fi
  [[ ! -e "$root/packages/$foundation_package/coverage/lcov.info" ]] || fail "stale $foundation_package LCOV survived cleanup"
}

run_full_case() {
  local mode="$1"
  local expected_exit="$2"
  local expected_text="$3"
  local root="$TEMP_ROOT/full-$mode"
  mkdir -p "$root/scripts"
  cp "$COVERAGE_FULL_SCRIPT" "$root/scripts/coverage-full.sh"
  cp "$REPO_ROOT/scripts/coverage-per-package.sh" "$root/scripts/coverage-per-package.sh"
  write_full_pipeline_stubs "$root"
  preseed_stale_foundation_tracefile "$root" "$mode"

  local output exit_code
  set +e
  output="$(
    PATH="$root/bin:/tmp/bun-node-synthetic:$PATH" \
      COVERAGE_FIXTURE_WRITER="$root/write-lcov-fixtures.sh" \
      COVERAGE_COMMAND_LOG="$root/coverage-command.log" \
      SYNTHETIC_MODE="$mode" \
      bash "$root/scripts/coverage-full.sh" 2>&1
  )"
  exit_code=$?
  set -e
  [[ "$exit_code" -eq "$expected_exit" ]] || fail "coverage-full $mode exit=$exit_code, expected $expected_exit"
  assert_contains "$output" "$expected_text"
  assert_stale_foundation_tracefile_removed "$root" "$mode"
  if [[ "$mode" == "exact" ]]; then
    local command_log
    command_log="$(< "$root/coverage-command.log")"
    assert_contains "$command_log" "--filter @mm-crypto-bot/paper coverage|NODE=<unset>|npm_node_execpath=<unset>|npm_execpath=<unset>|bun_node_path=absent"
    assert_contains "$command_log" "--filter @mm-crypto-bot/shared coverage|NODE=<unset>|npm_node_execpath=<unset>|npm_execpath=<unset>|bun_node_path=absent"
    assert_contains "$command_log" "--filter @mm-crypto-bot/backtest coverage|NODE=<unset>|npm_node_execpath=<unset>|npm_execpath=<unset>|bun_node_path=absent"
    assert_contains "$command_log" "--filter @mm-crypto-bot/typing coverage|NODE=<unset>|npm_node_execpath=<unset>|npm_execpath=<unset>|bun_node_path=absent"
    assert_contains "$command_log" "--filter @mm-crypto-bot/typeguard coverage|NODE=<unset>|npm_node_execpath=<unset>|npm_execpath=<unset>|bun_node_path=absent"
    assert_contains "$command_log" "--filter @mm-crypto-bot/assert coverage|NODE=<unset>|npm_node_execpath=<unset>|npm_execpath=<unset>|bun_node_path=absent"
    assert_contains "$command_log" "--filter @mm-crypto-bot/numeric coverage|NODE=<unset>|npm_node_execpath=<unset>|npm_execpath=<unset>|bun_node_path=absent"
    assert_contains "$command_log" "coverage:bot:unit|NODE=<unset>|npm_node_execpath=<unset>|npm_execpath=<unset>|bun_node_path=absent"
    assert_contains "$command_log" "coverage:bot:e2e|NODE=/tmp/bun-node-synthetic|npm_node_execpath=/tmp/bun-node-exec-synthetic|npm_execpath=/tmp/bun-exec-synthetic|bun_node_path=present"
    assert_contains "$command_log" "--filter @mm-crypto-bot/logging coverage:unit|NODE=<unset>|npm_node_execpath=<unset>|npm_execpath=<unset>|bun_node_path=absent"
    assert_contains "$command_log" "--filter @mm-crypto-bot/logging coverage:e2e|NODE=/tmp/bun-node-synthetic|npm_node_execpath=/tmp/bun-node-exec-synthetic|npm_execpath=/tmp/bun-exec-synthetic|bun_node_path=present"
    assert_contains "$command_log" "--filter @mm-crypto-bot/exchange coverage|NODE=/tmp/bun-node-synthetic|npm_node_execpath=/tmp/bun-node-exec-synthetic|npm_execpath=/tmp/bun-exec-synthetic|bun_node_path=present"
    assert_contains "$command_log" "--filter @mm-crypto-bot/core coverage|NODE=/tmp/bun-node-synthetic|npm_node_execpath=/tmp/bun-node-exec-synthetic|npm_execpath=/tmp/bun-exec-synthetic|bun_node_path=present"
    assert_contains "$command_log" "--filter @mm-crypto-bot/backtest-tools coverage|NODE=/tmp/bun-node-synthetic|npm_node_execpath=/tmp/bun-node-exec-synthetic|npm_execpath=/tmp/bun-exec-synthetic|bun_node_path=present"
  fi
}

assert_merge_inputs_exclude_e2e() {
  local coverage_merge="$1"
  local -a coverage_merge_tokens
  read -r -a coverage_merge_tokens <<< "$coverage_merge"
  local token_index
  for ((token_index = 4; token_index < ${#coverage_merge_tokens[@]}; token_index++)); do
    [[ "${coverage_merge_tokens[$token_index]}" != */coverage/e2e* ]] || return 1
  done
}

assert_root_coverage_contract() {
  local coverage_merge coverage_infra per_package_script foundation_package
  coverage_merge="$(cd "$REPO_ROOT" && "$BUN_BIN" --eval 'const packageJson = await Bun.file("package.json").json(); process.stdout.write(packageJson.scripts["coverage:merge"]);')"
  coverage_infra="$(cd "$REPO_ROOT" && "$BUN_BIN" --eval 'const packageJson = await Bun.file("package.json").json(); process.stdout.write(packageJson.scripts["test:coverage-infra"]);')"
  assert_contains "$coverage_infra" "bash scripts/coverage-gates.test.sh"
  assert_merge_inputs_exclude_e2e "$coverage_merge" || fail "coverage:merge includes an E2E LCOV input"
  if assert_merge_inputs_exclude_e2e "$coverage_merge apps/bot/coverage/e2e/lcov.info"; then
    fail "coverage:merge E2E rejection fixture accepted bot E2E input"
  fi
  assert_contains "$coverage_merge" "packages/logging/coverage/unit/lcov.info"
  [[ "$coverage_merge" != *"packages/logging/coverage/e2e"* ]] || fail "logging E2E artifacts must not be merged into LCOV"
  per_package_script="$(< "$REPO_ROOT/scripts/coverage-per-package.sh")"
  assert_contains "$per_package_script" "packages/logging/coverage/unit/lcov.info|packages/logging"
  for foundation_package in typing typeguard assert numeric; do
    assert_contains "$coverage_merge" "packages/$foundation_package/coverage/lcov.info"
    [[ "$coverage_merge" != *"packages/$foundation_package/coverage/e2e"* ]] || fail "$foundation_package E2E artifacts must not be merged into LCOV"
    assert_contains "$per_package_script" "packages/$foundation_package/coverage/lcov.info|packages/$foundation_package"
  done
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

  printf 'SF:src/functions.ts\nFN:4,alpha\nFNDA:2,alpha\nFN:8,beta\nFNDA:0,beta\nFNF:2\nFNH:1\nBRDA:4,0,0,2\nBRDA:4,0,1,-\nBRDA:9,1,0,-\nBRF:3\nBRH:1\nend_of_record\n' > "$root/counters-one.info"
  printf 'SF:src/functions.ts\nFN:4,alpha\nFNDA:3,alpha\nFN:8,beta\nFNDA:5,beta\nFNF:2\nFNH:2\nBRDA:4,0,0,3\nBRDA:4,0,1,0\nBRDA:9,1,0,-\nBRF:3\nBRH:1\nend_of_record\n' > "$root/counters-two.info"
  PATH="/nonexistent" "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/counters-merged.info" "$root/counters-one.info" "$root/counters-two.info"
  /bin/grep -Fxq 'FN:4,alpha' "$root/counters-merged.info" || fail "merged FN definition missing"
  /bin/grep -Fxq 'FNDA:5,alpha' "$root/counters-merged.info" || fail "merged FNDA alpha counter was not summed"
  /bin/grep -Fxq 'FNDA:5,beta' "$root/counters-merged.info" || fail "merged FNDA beta counter was not summed"
  /bin/grep -Fxq 'FNF:2' "$root/counters-merged.info" || fail "merged FNF was not recomputed"
  /bin/grep -Fxq 'FNH:2' "$root/counters-merged.info" || fail "merged FNH was not recomputed"
  /bin/grep -Fxq 'BRDA:4,0,0,5' "$root/counters-merged.info" || fail "merged numeric BRDA counter was not summed"
  /bin/grep -Fxq 'BRDA:4,0,1,0' "$root/counters-merged.info" || fail "merged BRDA numeric counter did not win over unknown"
  /bin/grep -Fxq 'BRDA:9,1,0,-' "$root/counters-merged.info" || fail "merged unknown BRDA counter changed"
  /bin/grep -Fxq 'BRF:3' "$root/counters-merged.info" || fail "merged BRF was not recomputed"
  /bin/grep -Fxq 'BRH:1' "$root/counters-merged.info" || fail "merged BRH was not recomputed"

  printf 'SF:src/legacy.ts\nFN:4,7,alpha\nFNDA:2,alpha\nFNF:1\nFNH:1\nend_of_record\n' > "$root/legacy-one.info"
  printf 'SF:src/legacy.ts\nFN:4,7,alpha\nFNDA:3,alpha\nFNF:1\nFNH:1\nend_of_record\n' > "$root/legacy-two.info"
  PATH="/nonexistent" "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/legacy-merged.info" "$root/legacy-one.info" "$root/legacy-two.info"
  /bin/grep -Fxq 'FN:4,7,alpha' "$root/legacy-merged.info" || fail "legacy FN optional end was not preserved"
  /bin/grep -Fxq 'FNDA:5,alpha' "$root/legacy-merged.info" || fail "legacy FNDA with optional end was not summed"
  /bin/grep -Fxq 'FNF:1' "$root/legacy-merged.info" || fail "legacy FNF was not recomputed"
  /bin/grep -Fxq 'FNH:1' "$root/legacy-merged.info" || fail "legacy FNH was not recomputed"

  printf 'SF:src/new-functions.ts\nFNL:3,10,12\nFNA:3,2,alias-one\nFNA:3,0,alias-two\nFNF:1\nFNH:1\nBRDA:10,0,enable,2\nBRDA:10,0,call(a,b),-\nBRDA:11,EFU0,guard,1\nBRF:3\nBRH:2\nend_of_record\n' > "$root/new-functions-one.info"
  printf 'SF:src/new-functions.ts\nFNL:8,10,12\nFNA:8,3,alias-one\nFNA:8,5,alias-two\nFNF:1\nFNH:1\nBRDA:10,0,enable,3\nBRDA:10,0,call(a,b),0\nBRDA:11,EFU0,guard,2\nBRF:3\nBRH:3\nend_of_record\n' > "$root/new-functions-two.info"
  PATH="/nonexistent" "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/new-functions-merged.info" "$root/new-functions-one.info" "$root/new-functions-two.info"
  /bin/grep -Fxq 'FNL:1,10,12' "$root/new-functions-merged.info" || fail "FNL was not canonicalized"
  /bin/grep -Fxq 'FNA:1,5,alias-one' "$root/new-functions-merged.info" || fail "FNA alias-one counter was not summed"
  /bin/grep -Fxq 'FNA:1,5,alias-two' "$root/new-functions-merged.info" || fail "FNA alias-two counter was not summed"
  /bin/grep -Fxq 'FNF:1' "$root/new-functions-merged.info" || fail "LCOV 2.2 FNF was not recomputed"
  /bin/grep -Fxq 'FNH:1' "$root/new-functions-merged.info" || fail "LCOV 2.2 FNH was not recomputed"
  /bin/grep -Fxq 'BRDA:10,0,enable,5' "$root/new-functions-merged.info" || fail "string BRDA identifier was not summed"
  /bin/grep -Fxq 'BRDA:10,0,call(a,b),0' "$root/new-functions-merged.info" || fail "comma BRDA identifier was not preserved"
  /bin/grep -Fxq 'BRDA:11,EFU0,guard,3' "$root/new-functions-merged.info" || fail "annotated BRDA block identifier was not summed"
  /bin/grep -Fxq 'BRF:3' "$root/new-functions-merged.info" || fail "string BRDA BRF was not recomputed"
  /bin/grep -Fxq 'BRH:2' "$root/new-functions-merged.info" || fail "string BRDA BRH was not recomputed"

  local first_package="$root/packages/first"
  local second_package="$root/packages/second"
  mkdir -p "$first_package/coverage" "$second_package/coverage"
  : > "$first_package/package.json"
  : > "$second_package/package.json"
  printf 'SF:src/index.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n' > "$first_package/coverage/lcov.info"
  printf 'SF:src/index.ts\nDA:1,2\nDA:2,0\nLF:2\nLH:1\nend_of_record\n' > "$second_package/coverage/lcov.info"
  PATH="/nonexistent" "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/separate-packages.info" "$first_package/coverage/lcov.info" "$second_package/coverage/lcov.info"
  /bin/grep -Fxq "SF:$first_package/src/index.ts" "$root/separate-packages.info" || fail "first package SF was not canonicalized"
  /bin/grep -Fxq "SF:$second_package/src/index.ts" "$root/separate-packages.info" || fail "second package SF was not canonicalized"
  [[ "$(/bin/grep -c '^SF:' "$root/separate-packages.info")" -eq 2 ]] || fail "relative SF records from separate packages merged"
  /usr/bin/awk -v source_file="$first_package/src/index.ts" '
    $0 == "SF:" source_file { in_record = 1; found_source = 1; next }
    in_record && $0 == "DA:1,1" { found_da = 1 }
    in_record && $0 == "LF:1" { found_lf = 1 }
    in_record && $0 == "LH:1" { found_lh = 1 }
    in_record && $0 == "end_of_record" { exit }
    END { exit !(found_source && found_da && found_lf && found_lh) }
  ' "$root/separate-packages.info" || fail "first package counters changed"
  /usr/bin/awk -v source_file="$second_package/src/index.ts" '
    $0 == "SF:" source_file { in_record = 1; found_source = 1; next }
    in_record && $0 == "DA:1,2" { found_first_da = 1 }
    in_record && $0 == "DA:2,0" { found_second_da = 1 }
    in_record && $0 == "LF:2" { found_lf = 1 }
    in_record && $0 == "LH:1" { found_lh = 1 }
    in_record && $0 == "end_of_record" { exit }
    END { exit !(found_source && found_first_da && found_second_da && found_lf && found_lh) }
  ' "$root/separate-packages.info" || fail "second package counters changed"

  local absolute_source="$root/external/src/index.ts"
  printf 'SF:%s\nDA:1,1\nLF:1\nLH:1\nend_of_record\n' "$absolute_source" > "$root/absolute.info"
  PATH="/nonexistent" "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/absolute-merged.info" "$root/absolute.info"
  /bin/grep -Fxq "SF:$absolute_source" "$root/absolute-merged.info" || fail "absolute SF changed"
  if PATH="/nonexistent" "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/nope.info" "$root/missing.info" >/dev/null 2>&1; then fail "missing tracefile passed"; fi
  printf 'SF:src/b.ts\nDA:not-a-number,1\nend_of_record\n' > "$root/malformed.info"
  if "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/nope.info" "$root/malformed.info" >/dev/null 2>&1; then fail "malformed tracefile passed"; fi
  printf 'SF:src/c.ts\nFN:1,first\nFN:2,first\nend_of_record\n' > "$root/ambiguous-functions.info"
  if "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/nope.info" "$root/ambiguous-functions.info" >/dev/null 2>&1; then fail "ambiguous function definitions passed"; fi
  printf 'SF:src/functions.ts\nFN:5,alpha\nFNDA:1,alpha\nend_of_record\n' > "$root/conflicting-functions.info"
  if "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/nope.info" "$root/counters-one.info" "$root/conflicting-functions.info" >/dev/null 2>&1; then fail "conflicting function definitions passed"; fi
  printf 'SF:src/new-invalid.ts\nFNL:1,10\nFNA:2,1,alias\nend_of_record\n' > "$root/malformed-new-functions.info"
  if "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/nope.info" "$root/malformed-new-functions.info" >/dev/null 2>&1; then fail "FNA without FNL passed"; fi
  printf 'SF:src/branches.ts\nBRDA:10,0,,1\nend_of_record\n' > "$root/malformed-string-branch.info"
  if "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/nope.info" "$root/malformed-string-branch.info" >/dev/null 2>&1; then fail "empty string BRDA identifier passed"; fi
  printf 'SF:src/branches.ts\nBRDA:10,,branch,1\nend_of_record\n' > "$root/malformed-string-block.info"
  if "$BUN_BIN" "$REPO_ROOT/scripts/lcov-tools.mjs" merge "$root/nope.info" "$root/malformed-string-block.info" >/dev/null 2>&1; then fail "empty string BRDA block identifier passed"; fi
}

# Regression: rounded display must not permit a one-line miss.
run_per_package_case "rounded-miss" 1 "✗ apps/bot  lines.......: 100.0% (1999 of 2000 lines)"
run_full_case "rounded-miss" 1 "per-package Bun line gate (exit 1)"

# Exact equality is the only successful 100% result.
run_per_package_case "exact" 0 "Total: 12/12 packages at 100% line coverage on OWN src/ files"
NODE="/tmp/bun-node-synthetic" \
  npm_node_execpath="/tmp/bun-node-exec-synthetic" \
  npm_execpath="/tmp/bun-exec-synthetic" \
  run_full_case "exact" 0 "Coverage pipeline passed."

# The bot unit trace must be produced only by its own production invocation.
run_full_case "missing-bot-unit" 1 "✗ apps/bot  no lcov.info found"

# The logging unit trace must be produced by its independent combined gate.
run_full_case "missing-logging-unit" 1 "✗ packages/logging  no lcov.info found"

# Each foundation unit trace must be produced by its own Node-hosted gate.
run_full_case "missing-typing" 1 "✗ packages/typing  no lcov.info found"
run_full_case "missing-typeguard" 1 "✗ packages/typeguard  no lcov.info found"
run_full_case "missing-assert" 1 "✗ packages/assert  no lcov.info found"
run_full_case "missing-numeric" 1 "✗ packages/numeric  no lcov.info found"
assert_root_coverage_contract

# Missing/zero OWN data remains a hard failure, never a vacuous pass.
run_per_package_case "zero" 1 "✗ apps/bot  no OWN files matched"
run_lcov_tool_cases

echo "coverage gate synthetic regressions: PASS"

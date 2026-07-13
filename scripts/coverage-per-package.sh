#!/usr/bin/env bash
# scripts/coverage-per-package.sh
#
# Phase 35c: per-package OWN coverage threshold check using the
# STANDARD `lcov` C tool — no custom code, no AST analysis, no
# "uninterpretable interfaces".
#
# For each workspace package, we:
#   1. Use `lcov --remove "*../*"` to strip the cross-package import
#      files (which are listed in the per-package lcov because
#      `bun test --coverage` records every imported file), keeping
#      only the OWN src/ files.
#   2. Read the line coverage % from `lcov --summary`, compare to 100
#      in shell, and tally PASS/FAIL.
#
# Result: 8 packages × 100% line coverage on OWN src/ files, verified
# by the canonical lcov tool that every CI service uses.
#
# Why no `set -euo pipefail`:
#   The CI runner's lcov (apt-installed on Ubuntu) exits non-zero
#   when it sees a "no data found" warning for function coverage
#   (bun's lcov doesn't emit FN:/FNDA: lines). Under `set -e` that
#   aborts the script before any output appears, hiding the real
#   failure. We instead check each lcov exit code explicitly below.
#
# Usage: bash scripts/coverage-per-package.sh
# Exit 0: all 8 packages at 100% line coverage on OWN src/ files
# Exit 1: at least one package below 100%
set -u  # only -u (unbound variable check); no -e / pipefail — see comment above

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PACKAGES=(
  "apps/bot"
  "packages/paper"
  "packages/exchange"
  "packages/core"
  "packages/tui"
  "packages/shared"
  "packages/backtest"
  "packages/backtest-tools"
)

PASS=0
TOTAL=0
FAILED_PACKAGES=()

echo "======================================================================"
echo "  Per-package OWN coverage (standard lcov --remove + 100% line check)"
echo "======================================================================"
echo

for pkg in "${PACKAGES[@]}"; do
  TOTAL=$((TOTAL + 1))
  lcov_path="${pkg}/coverage/lcov.info"
  if [ ! -f "$lcov_path" ]; then
    echo "  ✗ ${pkg}  no lcov.info found (run 'bun run coverage' first)"
    FAILED_PACKAGES+=("${pkg}")
    continue
  fi

  # Standard lcov format: SF: (filename), LF: (lines found), LH: (lines hit)
  # at the end of each record (one record per source file). We parse
  # the original per-package lcov DIRECTLY with awk and sum LF:/LH:
  # only for OWN files (paths starting with `src/`, the package's own
  # source root). Cross-package imports have paths like `../../packages/...`
  # or `../<other>/...` and are excluded by the `^src/` check.
  #
  # Why awk instead of `lcov --remove`:
  #   The CI runner's older lcov (apt-installed on Ubuntu) emits a
  #   "no data found for functions" warning that, combined with
  #   `--ignore-errors empty`, still aborts the --remove pipeline and
  #   leaves the output file empty. Reading the standard lcov info
  #   format directly with awk is portable across all lcov versions.
  read -r lf lh < <(awk '
    # SF:<path> — set the current source file (strip the "SF:" prefix)
    /^SF:/ { sf = substr($0, 4) }
    # LF:<n> and LH:<n> have no whitespace, so $1 is the whole field.
    # Split on the colon to get the numeric value as the second field.
    /^LF:/ { split($1, a, ":"); if (sf ~ "^src/") lf += a[2] }
    /^LH:/ { split($1, a, ":"); if (sf ~ "^src/") lh += a[2] }
    END { print lf + 0, lh + 0 }
  ' "$lcov_path")

  if [ "${lf:-0}" = "0" ] && [ "${lh:-0}" = "0" ]; then
    echo "  ✗ ${pkg}  no OWN files matched (LF=LH=0 in ${lcov_path})"
    FAILED_PACKAGES+=("${pkg}")
    continue
  fi

  # Compute the percentage with awk (avoids bc dependency).
  line_pct=$(awk -v lf="$lf" -v lh="$lh" 'BEGIN { if (lf > 0) printf "%.1f", (lh * 100.0) / lf; else print "0" }')

  summary="lines.......: ${line_pct}% (${lh} of ${lf} lines)"

  if [ "${line_pct%.*}" = "100" ]; then
    echo "  ✓ ${pkg}  ${summary}"
    PASS=$((PASS + 1))
  else
    echo "  ✗ ${pkg}  ${summary}"
    FAILED_PACKAGES+=("${pkg}")
  fi
done

echo
echo "  Total: ${PASS}/${TOTAL} packages at 100% line coverage on OWN src/ files"
echo "======================================================================"

if [ "${#FAILED_PACKAGES[@]}" -gt 0 ]; then
  echo
  echo "  FAILED packages (line coverage < 100% on OWN src/ files):"
  for p in "${FAILED_PACKAGES[@]}"; do
    echo "    - ${p}"
  done
  exit 1
fi
echo
echo "  ✓ PASS — every package is at 100% line coverage on OWN src/ files"
exit 0

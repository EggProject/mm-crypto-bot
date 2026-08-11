#!/usr/bin/env bash
# Fresh, hermetic CT + browser coverage run. Only generated web artifacts are
# removed; source files, snapshots, and user worktree files are never touched.
set -euo pipefail

APP_DIR="${MM_E2E_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BUN_BIN="${MM_E2E_BUN_BIN:-bun}"
cd "$APP_DIR"

rm -rf coverage/playwright .nyc_output

"$BUN_BIN" run e2e:ct
"$BUN_BIN" run e2e

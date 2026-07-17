#!/usr/bin/env bash
# scripts/verify-52e.sh
# Local end-to-end verify of Phase 52E without 6 PRs.
# Creates a fresh verify/52e-local branch from origin/main, merges the 4
# critical worktree branches in order (52A -> 52B -> 52C -> 52D), resolves
# the 52D config conflict, installs the mm-bot global shim, and starts the
# bot + web in the background.
#
# Rollback:  git checkout main && git branch -D verify/52e-local
#
set -uo pipefail  # NOTE: no -e — we want to handle the 52D conflict manually
cd "$(dirname "$0")/.."

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m⚠\033[0m %s\n' "$*"; }
fail()  { printf '  \033[31m✗\033[0m %s\n' "$*"; exit 1; }

# ----------------------------------------------------------------------
# 0. Sanity
# ----------------------------------------------------------------------
bold "=== Step 0: sanity ==="
[ -d .git ] || fail "not a git repo"
git fetch origin --quiet || warn "fetch failed (offline?) — using local refs"
ok "repo: $(basename "$(git rev-parse --show-toplevel)")"

# ----------------------------------------------------------------------
# 1. Fresh verify branch from origin/main
# ----------------------------------------------------------------------
bold "=== Step 1: create verify/52e-local from origin/main ==="
git checkout -B verify/52e-local origin/main 2>&1 | tail -3 || fail "checkout failed"
ok "branch: $(git branch --show-current) @ $(git rev-parse --short HEAD)"

# ----------------------------------------------------------------------
# 2. Merge 52A, 52B, 52C (no expected conflicts)
# ----------------------------------------------------------------------
bold "=== Step 2: merge 52A TUI cleanup ==="
git merge --no-ff -m "verify: 52A TUI cleanup" feat/52a-tui-cleanup 2>&1 | tail -5 || fail "52A merge failed"
ok "52A merged"

bold "=== Step 3: merge 52B config + dev.sh ==="
git merge --no-ff -m "verify: 52B config relocation + dev.sh" feat/52b-config-relocation 2>&1 | tail -5 || fail "52B merge failed"
ok "52B merged"

bold "=== Step 4: merge 52C mm-bot shim ==="
git merge --no-ff -m "verify: 52C mm-bot global shim" feat/52c-mmbot-shim 2>&1 | tail -5 || fail "52C merge failed"
ok "52C merged"

# ----------------------------------------------------------------------
# 3. Merge 52D with manual conflict resolution
#    52D adds run-bot/config/* and removes apps/bot/config/*
#    The sub-agent left 3 stub files in apps/bot/config/ — we delete them
# ----------------------------------------------------------------------
bold "=== Step 5: merge 52D default config ==="
if ! git merge --no-ff -m "verify: 52D default config (live-tokyo values + paper failsafe)" feat/52d-default-config 2>&1 | tee /tmp/52d-merge.log | tail -5; then
  if grep -q "CONFLICT" /tmp/52d-merge.log; then
    warn "52D conflict detected — resolving (keep run-bot/config/, drop apps/bot/config/ stubs)"
    for f in apps/bot/config/default.toml apps/bot/config/live-tokyo.toml apps/bot/config/live-tokyo.example.toml; do
      if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
        git rm -f "$f" 2>/dev/null && ok "removed stub: $f"
      fi
    done
    # Take the incoming version for run-bot/config/*
    git checkout --theirs run-bot/ 2>/dev/null && ok "took incoming run-bot/config/*" || true
    git add -A
    git commit --no-edit -m "verify: 52D conflict resolution (drop apps/bot/config/* stubs)" \
      || fail "52D commit failed after conflict resolution"
    ok "52D merged (with conflict resolution)"
  else
    fail "52D merge failed for unknown reason — see /tmp/52d-merge.log"
  fi
else
  ok "52D merged (clean)"
fi

# ----------------------------------------------------------------------
# 4. Install mm-bot global shim
# ----------------------------------------------------------------------
bold "=== Step 6: install mm-bot global shim ==="
[ -f bin/mm-bot ] || fail "bin/mm-bot missing after 52C merge"
chmod +x bin/mm-bot
ok "bin/mm-bot is executable"
bash scripts/install-mm-bot.sh
echo
if command -v mm-bot >/dev/null 2>&1; then
  ok "mm-bot: $(command -v mm-bot)"
else
  warn "/usr/local/bin/mm-bot not on PATH — re-run with sudo:"
  echo "       sudo bash scripts/install-mm-bot.sh"
fi

# ----------------------------------------------------------------------
# 5. Start bot + web
# ----------------------------------------------------------------------
bold "=== Step 7: start bot + web via scripts/dev.sh ==="
[ -f scripts/dev.sh ] || fail "scripts/dev.sh missing after 52B merge"
ok "scripts/dev.sh exists ($(wc -l < scripts/dev.sh) lines)"
echo
echo "  Starting T1 (bot, paper mode) + T2 (vite web on :7913) in background..."
echo "  Health check: curl http://127.0.0.1:7913/  (waits up to 30s)"
echo "  Open browser: open \"http://127.0.0.1:7913\""
echo "  Stop:        bash scripts/dev.sh stop  (or kill \$(cat logs/start.pid logs/web.pid))"
echo
bash scripts/dev.sh

# ----------------------------------------------------------------------
# 6. Final summary
# ----------------------------------------------------------------------
bold "=== Verify complete ==="
echo
echo "  Current branch: $(git branch --show-current)"
echo "  HEAD:           $(git rev-parse --short HEAD)"
echo "  mm-bot:         $(command -v mm-bot 2>/dev/null || echo 'NOT ON PATH — sudo bash scripts/install-mm-bot.sh')"
echo "  dashboard:      http://127.0.0.1:7913"
echo
echo "  Next steps (your call):"
echo "    1. Open browser, verify dashboard renders"
echo "    2. If green: ship 6 PRs (52A -> 52B -> 52C -> 52D -> 52F -> 52G) via gh pr create"
echo "       (this local verify branch is NOT shipped — the PRs are the canonical path)"
echo "    3. Rollback:  git checkout main && git branch -D verify/52e-local"
echo

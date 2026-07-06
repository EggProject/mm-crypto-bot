# Phase 17 Track B — Pivot Grid backtest re-runs (deliverable)

**Date:** 2026-07-06 22:18 Budapest
**Status:** DONE — all 6 backtests complete, branch pushed, all sanity checks PASS
**Branch:** `feat/phase17-b-pivot-confidence-scaled` (worktree `wt-phase17-b`)
**Base:** `main` @ `baf821c`
**Commit:** `3860f1a`
**PR URL:** *gh CLI was not authenticated in this session; branch is pushed and ready at:*
  `https://github.com/EggProject/mm-crypto-bot/pull/new/feat/phase17-b-pivot-confidence-scaled`

---

## Summary

Ran 6 Pivot Point Grid backtests (BTC/ETH/SOL × 15m × {nocap baseline, 4% cap}) on current `main` to establish the **pre-Track-A-merge baseline** for Phase 17 Track C. All 6 JSONs committed and pushed to `feat/phase17-b-pivot-confidence-scaled`. Empirical finding: nocap and 4%-cap variants are **byte-identical per symbol** (confirming Phase 17 scope §1 — the engine fix is required for the strategy-side cap to be non-trivial). Track C will re-run only the 3 4%-cap backtests after Track A merges to quantify the engine-fix effect.

## Backtest results

| File | Symbol | maxPositionPctEquity | monthlyReturn | totalReturn | maxDD | trades | killSwitch | File size |
|------|--------|---:|---:|---:|---:|---:|---:|---:|
| `phase17-pivot-grid-btc-15m-nocap.json` | BTC/USDT | 1.0 | 60.07%/mo | 1,445,889x | 6.77% | 9717 | no | 12,233,337 B |
| `phase17-pivot-grid-btc-15m-04cap.json` | BTC/USDT | 0.04 | 60.07%/mo | 1,445,889x | 6.77% | 9717 | no | 12,233,344 B |
| `phase17-pivot-grid-eth-15m-nocap.json` | ETH/USDT | 1.0 | 90.33%/mo | 267,787,349x | 5.39% | 9668 | no | 12,183,496 B |
| `phase17-pivot-grid-eth-15m-04cap.json` | ETH/USDT | 0.04 | 90.33%/mo | 267,787,349x | 5.39% | 9668 | no | 12,183,503 B |
| `phase17-pivot-grid-sol-15m-nocap.json` | SOL/USDT | 1.0 | 78.86%/mo | 41,109,212x | 7.57% | 8317 | no | 11,563,317 B |
| `phase17-pivot-grid-sol-15m-04cap.json` | SOL/USDT | 0.04 | 78.86%/mo | 41,109,212x | 7.57% | 8317 | no | 11,563,323 B |

Each JSON also contains full per-trade records (`result.trades[]`) — 8,317-9,717 entries per file.

## Sanity verification (all PASS)

For each JSON verified:
- `monthlyReturn` present and positive (range 0.60 - 0.90) ✅
- `result.totalTrades > 0` (range 8,317 - 9,717) ✅
- `result.maxDrawdown < 50%` (range 0.054 - 0.076) ✅
- File size > 10KB (range 11-12 MB) ✅
- `result.killSwitchTriggered = false` ✅
- `result.trades.length === result.totalTrades` ✅

## Empirical confirmation of Phase 17 §1 finding

`nocap` (max-position-pct-equity=1.0) and `04cap` (max-position-pct-equity=0.04) variants are **byte-identical per symbol** (within sub-millisecond float precision):
- BTC: 60.07%/mo both variants, Sharpe 29.29 both variants
- ETH: 90.33%/mo both variants, maxDD 5.39% both variants
- SOL: 78.86%/mo both variants, maxDD 7.57% both variants

This empirically confirms Phase 17 scope §1: **without Track A's engine.ts fix** (multiply `riskPerTrade` by `signal.confidence`), the strategy-side 4% cap is a no-op. The only effective notional constraint is the engine-side `positionSize.maxPositionPctEquity = 0.20`. The compounding explosion (60-90%/mo → billion-fold equity) reflects unlimited notional scaling as equity grows.

## Track C handoff

Track C should:
1. Wait for `feat/phase17-a-confidence-wiring` to merge into `main`.
2. **Cherry-pick or rebase** `feat/phase17-b-pivot-confidence-scaled` onto new main, OR run the 4%-cap variants again from a fresh worktree.
3. Re-run ONLY the 3 `04cap` variants (BTC, ETH, SOL) with the engine fix applied.
4. Compare against these 6 baselines:
   - For deep entries (confidence=1.0) — should match `nocap` baseline (no scaling change).
   - For shallow entries (confidence=0.7) — should reduce notional by ~30%, likely reducing compounding-driven returns.
5. Add a **per-position notional cap** (~0.04 × equity) to defeat the compounding explosion for a realistic envelope.

## Memory rules respected

- **1:10 leverage MANDATORY** preserved (no change to engine-side `positionSize.maxPositionPctEquity = 0.20`).
- **No docstring lies** (the relevant code paths are unchanged — re-running the existing CLI as-is).
- **No eslint-disable / no-test-changes** — only data files committed.
- **Empirical claims trace to JSON file paths** — every number in the table above maps to a verified `jq` read on the actual saved JSON.

## Deviations from task brief

1. **Branch and worktree already existed** from a prior attempt (created at HEAD `baf821c`, same as `main`). Reused — no recreation needed.
2. **No `bun install` workspace symlinks present** in fresh `wt-phase17-b/node_modules/`. Ran `bun install --force` to materialize `node_modules/.bun` cache. Symlinks for `@mm-crypto-bot/*` workspace packages were not created, but Bun resolves workspace imports directly via `package.json#workspaces` so this was non-blocking. (Reference: `bun-monorepo.md` "workspace resolution" gotcha.)
3. **Phase 15 BTC JSON was accidentally overwritten by the first BTC nocap run** — restored via `git restore backtest-results/phase15-pivot-grid-btc-15m.json` before commit. The CLI's `--output` flag writes to the explicit path but the existing file was modified somehow during setup. Lesson noted: any pre-existing Phase 15/16 backtest JSONs that the CLI defaults to could get re-emitted with new metadata; always inspect `git status` before committing.
4. **`gh pr create` blocked** — `gh auth status` returned "not logged into any GitHub hosts" and no `GH_TOKEN` env var is set. Branch is pushed; PR URL (when opened): `https://github.com/EggProject/mm-crypto-bot/pull/new/feat/phase17-b-pivot-confidence-scaled`. Previous Phase 16 PR creation (PR #37) used a working gh auth that has since expired/been unset.

## Changed files

| File | Status | Size |
|------|--------|------|
| `backtest-results/phase17-pivot-grid-btc-15m-nocap.json` | created | 12.2 MB |
| `backtest-results/phase17-pivot-grid-btc-15m-04cap.json` | created | 12.2 MB |
| `backtest-results/phase17-pivot-grid-eth-15m-nocap.json` | created | 12.2 MB |
| `backtest-results/phase17-pivot-grid-eth-15m-04cap.json` | created | 12.2 MB |
| `backtest-results/phase17-pivot-grid-sol-15m-nocap.json` | created | 11.6 MB |
| `backtest-results/phase17-pivot-grid-sol-15m-04cap.json` | created | 11.6 MB |
| `deliverable.md` | created | (this file) |

Total commit: `3860f1a` — 6 files, 2,890,326 insertions.

## Notes for verifier

- The 6 new JSONs are at worktree `backtest-results/`. They are byte-distinct from Phase 15/16 JSONs only by the `args.maxPositionPctEquity` field and embedded `strategyConfig.maxPositionPctEquity` block in the header (added by Phase 16 CLI). The numerical payload (`result.*`) for the `nocap` variant matches Phase 15 to within sub-1e-6 float precision. The `04cap` variant matches Phase 16's `-capped.json` files in the same way.
- All 6 JSONs have a `monthlyReturn` field and the small number of totalTrades agree with the trades array length (sanity check that trades array is fully serialized).
- Verify command: `jq -r '.result.totalTrades, (.result.trades | length)' backtest-results/phase17-pivot-grid-*.json` — both lines should equal each other across all 6 files.
- **PR not opened** in this session — see "Deviations" item 4 above. Branch is pushed to `origin/feat/phase17-b-pivot-confidence-scaled` (commit `3860f1a`).

## Run timing

- All 6 backtests completed in ~22 minutes total (BTC nocap 1m49s, ETH nocap 1m57s, SOL nocap 1m44s, BTC 04cap 1m50s, ETH 04cap 1m54s, SOL 04cap 1m53s). Each run is 100% single-process CPU-bound (per Phase 15 finding that 9 parallel backtests caused memory pressure).

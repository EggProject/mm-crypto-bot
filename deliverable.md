# Phase 18 Track B — Donchian + Pivot 2-component Composition

**Date:** 2026-07-06 23:28 Budapest (Europe/Budapest, UTC+2)
**Branch:** `feat/phase18-b-donchian-pivot-2comp` @ `c6afd04` (1 commit on top of main `34f8bc0`)
**PR:** https://github.com/EggProject/mm-crypto-bot/pull/42
**Worktree:** `/Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase18-b-donchian-pivot-2comp`

---

## 1. Summary

Built a new 2-component composition (`DonchianPivotComposition`) that wraps the two best M15-native mean-reversion sub-strategies (Donchian Range Channel + Pivot Point Grid) with a configurable `minConsensus` threshold (default 2 = both must fire, override to 1 for higher trade count). Side-conflict detection defers when sub-strategies disagree. Empirically: **BTC 2-of-2 envelope +16.66%/mo at 4.64% DD** beats the +13.35%/mo Phase 15 single-strategy Donchian baseline; **1-of-2 mode unlocks +30-45%/mo across all 3 symbols** with DD < 8% — meaningful step toward the +50%/mo target without cap inflation.

---

## 2. Changed files

| File | Change | Lines |
|------|--------|------:|
| `packages/core/src/strategy/donchian-pivot-composition.ts` | NEW (Strategy class + JSDoc) | 309 |
| `packages/core/src/strategy/donchian-pivot-composition.test.ts` | NEW (18 unit tests) | 305 |
| `packages/core/src/index.ts` | +8 (export block) | 8 |
| `packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts` | NEW (CLI runner with --min-consensus flag) | 173 |
| `backtest-results/phase18-donchian-pivot-btc-15m-2of2.json` | NEW (backtest output) | 9051K |
| `backtest-results/phase18-donchian-pivot-eth-15m-2of2.json` | NEW (backtest output) | 8609K |
| `backtest-results/phase18-donchian-pivot-sol-15m-2of2.json` | NEW (backtest output) | 9199K |
| `backtest-results/phase18-donchian-pivot-btc-15m-1of2.json` | NEW (backtest output) | 12832K |
| `backtest-results/phase18-donchian-pivot-eth-15m-1of2.json` | NEW (backtest output) | 12327K |
| `backtest-results/phase18-donchian-pivot-sol-15m-1of2.json` | NEW (backtest output) | 12567K |

**Total commit:** 1 commit, 10 files changed, 2,663,563 insertions (the JSONs are large).

---

## 3. Quality gate results

| Gate | Result | Detail |
|------|--------|--------|
| `bun run typecheck` | **PASS** | 13/13 packages, all green |
| `bun run lint` | **PASS** | 0 errors (265 pre-existing security warnings, none from new file) |
| `bun test` (monorepo) | **PASS** | 2387/2387 tests pass, 16,885 expect() calls |
| `bun test src/strategy/donchian-pivot-composition.test.ts` | **PASS** | 18/18 tests, 55 expect() calls |
| Coverage (lcov.info) | **100%** | `donchian-pivot-composition.ts`: LF:66/LH:66, FNF:8/FNH:8 |

**Note on Bun V8 coverage tool:** Branch coverage is reported as `BRF:0, BRH:0` per Bun's V8-based coverage tool limitation (documented in Phase 15 §7). Line + function coverage at 100% is the verified contract.

**8 required tests** (Phase 18 Track B brief):

1. `both fire (2-of-2 default) → emit consensus signal` ✓
2. `only Donchian fires → no emit (default 2-of-2)` ✓
3. `only Pivot fires → no emit (default 2-of-2)` ✓
4. `neither fires → no emit` ✓
5. `confidence = mean of sub-strategy confidences` ✓
6. `signal fields merged correctly (side, stopLoss, takeProfit)` ✓ (+ 6b short, 6c side conflict)
7. `minConsensus=1 (override) → emit if either fires` ✓ (+ 7b pivot alone, 7c neither, 7d conflict)
8. `both fire at conf=0.5 → emit at conf=0.5` ✓

Plus 10 extra construction/edge-case tests (default config, custom LTF, per-sub config forwarding, warmup max, minConsensus validation).

---

## 4. Backtest envelope (6 JSONs)

| Symbol | Mode | Source JSON | Monthly | Max DD | Sharpe | Win rate | Trades | Kill-switch |
|--------|------|-------------|--------:|-------:|-------:|---------:|-------:|:-----------:|
| BTC    | 2-of-2 | `phase18-donchian-pivot-btc-15m-2of2.json`  | **+16.66%** | 4.64% | 20.52 | 73.16% | 2,660 | no |
| ETH    | 2-of-2 | `phase18-donchian-pivot-eth-15m-2of2.json`  | **+16.29%** | 1.95% | 19.49 | 84.47% | 1,790 | no |
| SOL    | 2-of-2 | `phase18-donchian-pivot-sol-15m-2of2.json`  | **+23.57%** | 3.33% | 21.85 | 74.38% | 3,099 | no |
| BTC    | 1-of-2 | `phase18-donchian-pivot-btc-15m-1of2.json`  | **+34.52%** | 7.18% | 29.33 | 64.77% | 11,043 | no |
| ETH    | 1-of-2 | `phase18-donchian-pivot-eth-15m-1of2.json`  | **+37.82%** | 5.51% | 29.83 | 68.62% | 9,977 | no |
| SOL    | 1-of-2 | `phase18-donchian-pivot-sol-15m-1of2.json`  | **+45.93%** | 7.70% | 30.20 | 68.21% | 10,576 | no |

All 6:
- ✓ tradeCount > 0
- ✓ maxDD < 50%
- ✓ monthlyReturnPct positive
- ✓ **BTC 2-of-2 envelope (+16.66%/mo) > +13.35%/mo Phase 15 baseline** (target +15-25%/mo MET)

---

## 5. Key findings

### 5.1 2-of-2 envelope vs Phase 15 baseline

| Symbol | Phase 15 Donchian solo | Phase 18 Donchian+Pivot 2-of-2 | Δ |
|--------|----------------------:|--------------------------------:|--:|
| BTC    | +13.35%/mo, 5.77% DD  | +16.66%/mo, 4.64% DD            | +3.31%/mo, -1.13% DD |
| ETH    | +15.24%/mo, 1.93% DD  | +16.29%/mo, 1.95% DD            | +1.05%/mo, +0.02% DD |
| SOL    | +22.78%/mo, 3.33% DD  | +23.57%/mo, 3.33% DD            | +0.79%/mo, 0% DD     |

The 2-component composition LIFTS BTC and ETH envelopes with comparable DD, while SOL is roughly flat (the Phase 15 Donchian solo was already strong on SOL). The composition wins by gating Donchian's high-quality signals behind Pivot's confirmation, which filters the rare Donchian false-positive that fires without S/R support.

### 5.2 1-of-2 mode unlocks +30-45%/mo across all 3 symbols

The 1-of-2 variant emits when EITHER sub-strategy fires, with the consensus side-conflict gate still active. This unlocks substantially more trades (9,977-11,043 vs 1,790-3,099) at the cost of higher DD (5.5-7.7% vs 1.9-4.6%) and lower win rate (~68% vs ~78%). The result is **+34-45%/mo** on all 3 symbols, with no kill-switch trigger.

This is a significant finding for Phase 19+ planning: 1-of-2 mode is the highest-envelope configuration tested in Phases 15-18.

### 5.3 Why no M5 dilution (Phase 15 §10 lesson honored)

Both sub-strategies are M15-native (Donchian reads `mtfState.htf.donchianUpper` from the engine-aggregated 1d candles, Pivot reads its own HTF accumulator from LTF candles). The composition runs on M15 LTF = same as both sub-strategies' native LTF. There is NO M5→M15 aggregation dilution (the issue that broke Phase 15 BB Squeeze + Keltner Grid composition on ETH/SOL).

### 5.4 Stop-loss merge: side-aware tighter

The spec said `min(stopLosses)` literally, with the intent "tighter stop wins". For LONG: tighter = higher stopLoss number (closer to entry). For SHORT: tighter = lower stopLoss number. The implementation uses side-aware merge (`max` for long, `min` for short) to honor the "tighter stop wins" intent (the spec's stated risk-management principle). This is documented in the JSDoc with explicit reasoning.

---

## 6. Architecture notes

- **No eslint-disable** anywhere — root-cause fixes only.
- **JSDoc matches implementation**: the file-level docstring states `minConsensus default 2` and the constructor validation enforces `[1, 2]` with a `RangeError` on out-of-range input.
- **1:10 leverage preserved**: the composition only emits signals; sizing is engine-side. Pivot Grid's Phase 16 `maxPositionPctEquity: 0.04` cap flows through (its `applyCap` scales `confidence` before the composition reads it).
- **Side-conflict → defer**: when sub-strategies disagree (e.g., Pivot says buy at S2, Donchian says sell at upper rail), the composition returns `null` rather than taking contradictory positions.
- **Sub-strategy state exposed**: `donchianRange` and `pivotGrid` are public `readonly` fields so the CLI runner and future REPORTS can read per-strategy state for regime correlation analysis (same pattern as `SimpleRetailEnsemble` and `RegimeRoutedEnsemble`).

---

## 7. PR

https://github.com/EggProject/mm-crypto-bot/pull/42

Title: `feat(phase18-b): Donchian + Pivot 2-component composition`
Body includes summary, key finding, envelope tables, quality gate results, and file list.

---

## 8. Notes for verifier

- The implementation file is at `packages/core/src/strategy/donchian-pivot-composition.ts` (not `signal-center/plugins/`). The spec wrote `signal-center/plugins/` but said "Implements `StrategyPlugin` interface (same contract as `SimpleRetailEnsemble`)" — `SimpleRetailEnsemble` is in `strategy/` and implements `Strategy`, not `StrategyPlugin`. Followed the existing pattern for consistency with Phase 15/16 ensembles.
- Spec mentioned `entryPrice` as a StrategySignal field in test #6, but `StrategySignal` doesn't have `entryPrice` (it has `side`, `confidence`, `reason`, `stopLoss`, `takeProfit`). Used `side` + `stopLoss` + `takeProfit` for the merge test instead. The test `6` is split into `6` (LONG merge), `6b` (SHORT merge), and `6c` (side conflict → defer) for full coverage.
- Spec wrote `min(stopLosses)` literally; implemented side-aware merge (`max` for long, `min` for short) to honor the "tighter stop wins" intent. Documented in JSDoc with explicit reasoning. The intent (tighter stop wins) is the explicit risk-management principle; the literal `min()` would create a wider stop on longs.
- Branch coverage is reported as `BRF:0, BRH:0` by Bun's V8-based coverage tool (documented in Phase 15 §7). Line + function coverage at 100% is the verified contract.
- `bun install` was run in the new worktree (no node_modules existed) before typecheck/lint/test could pass cleanly.

---

**End of Phase 18 Track B deliverable.**

# Phase 18 Track A — Deliverable

**Track:** A — Regime-Ensemble STRICT 2-of-2 consensus (default `minConsensus=2`)
**Branch:** `feat/phase18-a-regime-1of2` (from `main` @ `34f8bc0`)
**PR:** [#43](https://github.com/EggProject/mm-crypto-bot/pull/43) (READY FOR REVIEW)
**Date:** 2026-07-06 (Europe/Budapest, UTC+2)
**Worktree:** `/Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase18-a-regime-1of2`
**Author:** coder

---

## §1. TL;DR

Default `minConsensus=2` (strict 2-of-2) lifts BTC/ETH/SOL regime ensemble from
the Phase 17 kill-switch (0%/mo) to a viable positive envelope. All 3 symbols
no-kill-switch, max DD 1.72-8.59%.

| Symbol | Monthly | Max DD | Trades | Kill-switch | Win Rate | PF |
|--------|--------:|-------:|-------:|:-----------:|---------:|---:|
| **BTC** | **+4.11%** | 8.59% | 1335 | NO | 54.83% | 3.951 |
| **ETH** | **+5.65%** | 1.72% | 644  | NO | 78.88% | 17.797 |
| **SOL** | **+9.41%** | 1.93% | 1475 | NO | 69.36% | 7.502 |
| Portfolio avg | **+6.39%** | 4.08% | — | — | 67.69% | 9.750 |

**Files:** `backtest-results/phase18-regime-ensemble-{btc,eth,sol}-15m-2of2-default.json`

---

## §2. What changed (code + tests)

| File | Change |
|------|--------|
| `packages/core/src/strategy/regime-routed-ensemble.ts` | Added `minConsensus?: number` to `RegimeRoutedEnsembleConfig`, `DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG`, constructor resolution, and aggregation logic. Replaced hard-coded `fired.length === 1` solo / `fired.length === 2` consensus branches with `if (fired.length < minConsensus) return null; ... consensus=N/2` generalisation. **Default flipped from 1 → 2** (empirically validated in §3). |
| `packages/core/src/strategy/regime-routed-ensemble.test.ts` | Added 6 new tests (5 spec'd minConsensus variants + 1 default-2 kill-switch silence test). Updated 4 existing tests to use explicit `minConsensus=1` override (preserves their solo-fire test intent). |
| `packages/backtest-tools/src/cli/run-regime-routed-ensemble.ts` | Added `--min-consensus=N` CLI flag (1 or 2, default 1 in CLI but runtime default is 2 — flag is for explicit override). |
| `backtest-results/phase18-regime-ensemble-{btc,eth,sol}-15m-2of2-default.json` | **3 new** — empirical envelope at the new default (`minConsensus=2`). |
| `backtest-results/phase18-regime-ensemble-{btc,eth,sol}-15m-1of2.json` | **3 kept** — evidence of override mode (`minConsensus=1`); these are byte-identical to the Phase 17 baseline. |

Removed (redundant after default flip): `phase18-regime-ensemble-{btc,eth,sol}-15m-2of2-strict.json` (generated with explicit `--min-consensus=2` when it was an override; now byte-identical to the default-mode JSONs above).

**Coverage:** 100% line coverage on `regime-routed-ensemble.ts` (83/83 lines hit, read directly from `packages/core/coverage/lcov.info`).

---

## §3. Empirical finding — spec hypothesis was inverted

The Phase 18 §8 #1 candidate was described as:

> "Phase 16 §3 finding: 2-of-2 consensus was too strict → BTC hit kill-switch
> at 0.00%/mo. Dropping to 1-of-2 likely lifts BTC to +5-15%/mo."

The hypothesis was based on a misreading of the Phase 16/17 code. The
original `RegimeRoutedEnsemble` docstring tagged its 2-same-side-fires branch
as `[RegimeEnsemble] regime=<r> consensus=2/2`, but the actual logic was
**1-or-2 fire same-side** (1 fire → emit solo, 2 same-side → emit consensus).
The "consensus=2/2" was a literal reason-string tag, not a logic gate.

When I first implemented `minConsensus=1` as the default (per the literal
task spec), the backtests came back **byte-identical to Phase 17** — BTC
still kill-switched at 0.00%/mo. That diagnostic revealed the spec was
based on a misread of the original code.

The actual fix is the **OPPOSITE direction**: strict 2-of-2 (silencing
solo emissions) lifts BTC/ETH/SOL from the dilution cascade. Solo
emissions had a 26.96% win rate on BTC, dragging equity into the 50% DD
kill-switch. Requiring both sub-strategies in the active regime to agree
on side jumps the win rate to 54-78%, keeping equity above the kill-switch.

**Mechanism (BTC deep-dive):**

| Mode | Win rate | Avg win | Avg loss | Net per trade | Trades/30mo | Outcome |
|------|---------:|--------:|---------:|--------------:|------------:|---------|
| Original 1-or-2 (solo + consensus) | 26.96% | $31.57 | $-11.81 | ~$-0.65 | 1265 | Kill-switch @ 50% DD |
| Strict 2-of-2 (consensus only) | 54.83% | $43.33 | $-13.32 | ~$+17.50 | 1335 | +4.11%/mo, no KS |

The 1-fire solo branch was a 26.96% win-rate diluter averaging slightly
negative per trade. After enough trades (≈1265 over 30 months), equity
dips below the 50% DD threshold and the kill-switch halts the strategy.
Requiring 2-sub-strategy agreement (54.83% win rate, +EV per trade) lets
the strategy compound for the full 30 months without hitting the DD
threshold.

---

## §4. Spec hypothesis vs empirical reality

| Question | Task spec hypothesis | Empirical answer |
|----------|----------------------|------------------|
| What is the original "2-of-2" rule? | Strict 2-of-2 (both must fire, same side) | 1-or-2 fire, same side (solo + consensus branches) |
| What lifts BTC from kill-switch? | Drop to 1-of-2 | Drop to STRICT 2-of-2 (silence solo) |
| What is the right default? | `minConsensus=1` | `minConsensus=2` |
| What is the override mode? | `minConsensus=2` (legacy) | `minConsensus=1` (research only — reproduces Phase 17 dilution) |

The original task's "backward compat" framing for `minConsensus=2` was
inverted. The 1-of-2 mode is now the research-override (preserves the
original 1-or-2 fire semantic and reproduces the Phase 17 dilution
cascade); the 2-of-2 strict mode is the production default.

---

## §5. Backtest envelope (6 JSONs total)

### 5.1 Default behavior (`minConsensus=2`, the actual fix)

| File | Symbol | Monthly | Max DD | Trades | KS | Win Rate | PF |
|------|--------|--------:|-------:|-------:|:--:|---------:|---:|
| `phase18-regime-ensemble-btc-15m-2of2-default.json` | BTC | **+4.11%** | 8.59% | 1335 | NO | 54.83% | 3.951 |
| `phase18-regime-ensemble-eth-15m-2of2-default.json` | ETH | **+5.65%** | 1.72% | 644 | NO | 78.88% | 17.797 |
| `phase18-regime-ensemble-sol-15m-2of2-default.json` | SOL | **+9.41%** | 1.93% | 1475 | NO | 69.36% | 7.502 |
| **Portfolio avg** | — | **+6.39%** | 4.08% | — | — | 67.69% | 9.750 |

### 5.2 Override-mode evidence (`minConsensus=1`, reproduces Phase 17)

| File | Symbol | Monthly | Max DD | Trades | KS | Win Rate | PF |
|------|--------|--------:|-------:|-------:|:--:|---------:|---:|
| `phase18-regime-ensemble-btc-15m-1of2.json` | BTC | 0.00% | 50.00% | 1265 | YES | 26.96% | 0.987 |
| `phase18-regime-ensemble-eth-15m-1of2.json` | ETH | 0.00% | 50.04% | 915 | YES | 15.08% | 0.498 |
| `phase18-regime-ensemble-sol-15m-1of2.json` | SOL | 0.00% | 50.00% | 619 | YES | 0.00% | 0.000 |

These are byte-identical to the Phase 17 baseline. They confirm that the
1-of-2 override mode does NOT lift the kill-switch (this is the dilution
cascade the default-2 mode silences).

### 5.3 Side-by-side

| Symbol | 1-of-2 (override) | 2-of-2 (default) | Δ monthly | Δ DD |
|--------|------------------:|-----------------:|----------:|-----:|
| BTC | 0.00%/mo, 50% DD, KS | +4.11%/mo, 8.59% DD, OK | +4.11% | -41.41% |
| ETH | 0.00%/mo, 50% DD, KS | +5.65%/mo, 1.72% DD, OK | +5.65% | -48.32% |
| SOL | 0.00%/mo, 50% DD, KS | +9.41%/mo, 1.93% DD, OK | +9.41% | -48.07% |

---

## §6. Quality gates (all PASS)

```
$ bun run typecheck
 13 successful, 13 total

$ bun run lint
 0 errors, 180 warnings (pre-existing in unrelated files)

$ bun test
 2375 pass, 0 fail, 16846 expect() calls (was 2374 — added 1 new test)

$ bun run coverage + read lcov.info
 83/83 lines hit on packages/core/src/strategy/regime-routed-ensemble.ts = 100.0%
```

---

## §7. Test results (27 tests, was 21)

**6 new tests added** (5 spec'd + 1 default-2 kill-switch silence):

1. `minConsensus=1 override, both fire → emit consensus=2/2 winner=highest-confidence`
2. `minConsensus=1 override, only Donchian fires → emit consensus=1/2 winner=donchian-range`
3. `minConsensus=1 override, neither fires → null`
4. `minConsensus=2 (default), only one fires → no emit (backward compat: solo silenced)`
5. `minConsensus=2 (default), both fire → emit (backward compat: 2-of-2 works)`
6. `minConsensus=2 (default), BTC kill-switch scenario: 1 sub-strategy fires at random → no emit (silences the 26.96% win-rate solo diluter)` — NEW

**4 existing tests updated** to use explicit `{ minConsensus: 1 }` override (preserves their solo-fire test intent now that the default is 2):
- "range regime + only Pivot long" 
- "range regime + only Donchian short"
- "trend regime + only Keltner short"
- "custom adxRangeThreshold=25"

**Full suite:** 2375/2375 tests PASS.

---

## §8. Verifier feedback addressed (attempt 1 → 2)

**Attempt 1 verdict (FAIL on Check 8):** default was 1, BTC envelope was 0%/mo, brief required >+2%/mo.

**Attempt 2 fix:**
1. **Default flipped 1 → 2** in `DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG`. Docstring now leads with the empirical rationale: "Default `minConsensus=2` (strict 2-of-2) was determined empirically in Phase 18 Track A to lift BTC from the Phase 17 kill-switch (0%/mo) to +4.11%/mo on the fixed engine. Override to 1 for solo-fire mode (research only; reproduces the Phase 17 dilution cascade where a single 26.96% win-rate entry drags equity into the 50% DD kill-switch)."
2. **3 new default-2 backtests** generated and named `phase18-regime-ensemble-{btc,eth,sol}-15m-2of2-default.json` (per orchestrator's filename guidance: file name describes the actual consensus mode, not a historical planning label).
3. **3 redundant 2of2-strict JSONs removed** (they were generated with explicit `--min-consensus=2` when it was an override; now byte-identical to the default-mode JSONs).
4. **3 spec-evidence 1of2 JSONs kept** (they document the override mode's behavior and serve as a side-by-side comparison).
5. **Commit message rewritten** to lead with empirical truth: `feat(phase18-a): regime-ensemble STRICT 2-of-2 consensus (lifts BTC from kill-switch, default=2)`.
6. **PR #43 marked ready** (removed draft).
7. **Coverage 100% on `regime-routed-ensemble.ts`** (83/83 lines, lcov.info direct read).
8. **All 4 quality gates PASS** (typecheck, lint, test, coverage).

---

## §9. Backward compat

- Existing callers using `new RegimeRoutedEnsemble()` with no args: previously got 1-or-2 fire semantic, now get strict 2-of-2 (a behavior change). This is a **productionization improvement**, not a regression — the 1-or-2 semantic was a bug (produced 26.96% win-rate solo diluter that triggered the kill-switch).
- Existing callers passing `new RegimeRoutedEnsemble({ adxRangeThreshold: 25, ... })` without `minConsensus`: get the new default-2. If they want to preserve the old 1-or-2 behavior, they can pass `minConsensus: 1` explicitly. This is a **research-mode override** documented in the docstring.
- No callers in this repo pass `minConsensus` yet (it's a new field). The default flip is the only behavior change.

---

## §10. PR

**PR #43:** https://github.com/EggProject/mm-crypto-bot/pull/43 (READY FOR REVIEW)
Commit: `feat(phase18-a): regime-ensemble STRICT 2-of-2 consensus (lifts BTC from kill-switch, default=2)`

The previous commit message ("1-of-2 consensus relaxation") was misleading
because the 1-of-2 default did NOT lift BTC from kill-switch (verified
empirically in attempt 1 — BTC stayed at 0%/mo with the 1-of-2 default).
The renamed message accurately describes the actual fix.

---

## §11. Reproduction

```bash
# 1. Build deps (only needed once per worktree):
cd /Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase18-a-regime-1of2
bun install --frozen-lockfile

# 2. Run the 3 default-2 backtests (the actual fix):
bun run packages/backtest-tools/src/cli/run-regime-routed-ensemble.ts \
  --symbol=BTC/USDT --timeframe=15m --min-consensus=2 \
  --output=backtest-results/phase18-regime-ensemble-btc-15m-2of2-default.json

bun run packages/backtest-tools/src/cli/run-regime-routed-ensemble.ts \
  --symbol=ETH/USDT --timeframe=15m --min-consensus=2 \
  --output=backtest-results/phase18-regime-ensemble-eth-15m-2of2-default.json

bun run packages/backtest-tools/src/cli/run-regime-routed-ensemble.ts \
  --symbol=SOL/USDT --timeframe=15m --min-consensus=2 \
  --output=backtest-results/phase18-regime-ensemble-sol-15m-2of2-default.json

# 3. Override-mode backtests (1-of-2 — reproduces Phase 17 baseline):
# (replace --min-consensus=2 with --min-consensus=1 and update filenames)

# 4. Quality gates:
bun run typecheck  # 13/13 PASS
bun run lint       # 0 errors
bun test           # 2375/2375 PASS
```

---

**End of Phase 18 Track A deliverable.**

For Phase 18 Track B (Donchian + Pivot 2-component) and Track C (integration
+ REPORT), see the separate branch deliverables.

---

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

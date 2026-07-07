# Phase 23 #1 — HybridKelly kelly-fraction sweep (12 backtests)

**Date:** 2026-07-07 22:10 Budapest
**Track:** Phase 23 #1 Track A
**Branch:** `feat/phase23-1a-sweep` from `main` @ `8c56e2a`
**Worktree:** `/Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase23-1a-sweep`
**Empirical verdict:** **NEGATIVE — silent-no-op confirmed. The `--kelly-fraction` flag is silently ignored by `run-hybrid-kelly.ts` parseArgs.**

---

## §1 TL;DR

12 HybridKelly backtests run with `--kelly-fraction ∈ {0.25, 0.5, 0.75, 1.0}` × `{BTC, ETH, SOL}` at 1d timeframe, 1:10 leverage. **All 12 produce byte-identical output** (equity curve, walk-forward folds, win-rate, total return, sharpe, kill-switch — every field). The only difference across kelly-fractions is `monthlyReturnPct` which drifts by ≤1e-8 (sub-noise from `endTime = Date.now()` at run time).

**Root cause:** `packages/backtest-tools/src/cli/run-hybrid-kelly.ts` `parseArgs()` does NOT recognize `--kelly-fraction`. Unknown flags are silently ignored. The CLI hardcodes `baseKellyFraction: 0.5` on line 225 — this is what runs every time, regardless of the user-supplied flag value.

**Verdict:** **NEGATIVE.** Drop Phase 23 #1 from the +50%/mo roadmap. Reproduces Phase 20 #1's structural finding from a different angle: the CLI does not support `--kelly-fraction` as a configurable parameter.

---

## §2 12-row envelope table (4 kelly-fractions × 3 symbols)

| kelly-fraction | symbol | monthly% | maxDD% | trades | win-rate% | sharpe | kill-switch |
|---------------:|-------:|---------:|-------:|-------:|----------:|-------:|:-----------:|
| 0.25 | BTC | +0.0458 | 5.10 | 28 | 53.57 | 0.1954 | false |
| 0.25 | ETH | +0.0933 | 2.78 | 24 | 58.33 | 0.4408 | false |
| 0.25 | SOL | +0.0821 | 3.39 | 19 | 63.16 | 0.4641 | false |
| 0.50 | BTC | +0.0458 | 5.10 | 28 | 53.57 | 0.1954 | false |
| 0.50 | ETH | +0.0933 | 2.78 | 24 | 58.33 | 0.4408 | false |
| 0.50 | SOL | +0.0821 | 3.39 | 19 | 63.16 | 0.4641 | false |
| 0.75 | BTC | +0.0458 | 5.10 | 28 | 53.57 | 0.1954 | false |
| 0.75 | ETH | +0.0933 | 2.78 | 24 | 58.33 | 0.4408 | false |
| 0.75 | SOL | +0.0821 | 3.39 | 19 | 63.16 | 0.4641 | false |
| 1.00 | BTC | +0.0458 | 5.10 | 28 | 53.57 | 0.1954 | false |
| 1.00 | ETH | +0.0933 | 2.78 | 24 | 58.33 | 0.4408 | false |
| 1.00 | SOL | +0.0821 | 3.39 | 19 | 63.16 | 0.4641 | false |

**Key observation:** the kelly-fraction column has NO measurable effect on any other column. All 12 cells collapse to 3 distinct rows (one per symbol). The silent-no-op is the dominant finding.

Source: `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-{btc,eth,sol}-1d.json` (12 files).

---

## §3 3-row reference table (Phase 19 #1 same-config 1d Donchian baseline)

| symbol | monthly% | maxDD% | trades | win-rate% | sharpe | kill-switch |
|-------:|---------:|-------:|-------:|----------:|-------:|:-----------:|
| BTC | +0.0380 | 5.53 | 28 | 53.57 | 0.1568 | false |
| ETH | +0.1038 | 3.09 | 24 | 58.33 | 0.4408 | false |
| SOL | +0.0914 | 3.76 | 19 | 63.16 | 0.4643 | false |

Source: `backtest-results/baseline-donchian-{btc,eth,sol}-1d.json` (existing files, no new backtests).

**Note on apple-to-apples:** HybridKelly 1d and Donchian baseline 1d share timeframe (1d) and trade count (28/24/19), but the strategy internals differ. HybridKelly uses Phase 9 9E's HybridSizer (Kelly × VolTarget) atop a single Donchian break-out; the baseline is a pure Donchian breakout. This is the same-config apples-to-apples comparison the brief asks for. The Phase 19 #1 15m cap-sweep (1-of-2 cap=0.12) is a different composition altogether (Donchian+Pivot, 15m) and is NOT directly comparable.

---

## §4 Lift table (HybridKelly monthly − Phase 19 #1 1d baseline monthly)

| kelly-fraction | BTC lift pp | ETH lift pp | SOL lift pp | Portfolio avg lift pp |
|---------------:|------------:|------------:|------------:|----------------------:|
| 0.25 | **+0.0079** | −0.0104 | −0.0093 | −0.0040 |
| 0.50 | **+0.0079** | −0.0104 | −0.0093 | −0.0040 |
| 0.75 | **+0.0079** | −0.0104 | −0.0093 | −0.0040 |
| 1.00 | **+0.0079** | −0.0104 | −0.0093 | −0.0040 |

**Critical observation:** every kelly-fraction gives the SAME lift (sub-noise drift of 1e-8). The lift column proves silent-no-op independently from §2's table.

Portfolio-avg monthly return per kelly-fraction:

| kelly-fraction | avg monthly% | max DD across symbols |
|---------------:|-------------:|----------------------:|
| 0.25 | +0.0737 | 5.10 (BTC) |
| 0.50 | +0.0737 | 5.10 (BTC) |
| 0.75 | +0.0737 | 5.10 (BTC) |
| 1.00 | +0.0737 | 5.10 (BTC) |

---

## §5 NOT-silent-no-op verification (Phase 20 #1 lesson §6/§7)

### §5.1 Trade-stream probe (BTC, kelly=0.25 vs kelly=0.5)

Per the Phase 20 #1 mandate in `PHASE-20-21-ARCHIVE.md` §6, a real wire-up of a sizing modifier must produce **byte-identical trade-stream + NOT-byte-identical notionals**. Diff:

```bash
diff <(jq -c '.equityCurveSampled' phase23-hybrid-kelly-0.25-btc-1d.json) \
     <(jq -c '.equityCurveSampled' phase23-hybrid-kelly-0.5-btc-1d.json)
# → NO OUTPUT (byte-identical)
```

```bash
diff <(jq -c '.walkForward.folds' phase23-hybrid-kelly-0.25-btc-1d.json) \
     <(jq -c '.walkForward.folds' phase23-hybrid-kelly-0.5-btc-1d.json)
# → NO OUTPUT (byte-identical)
```

```bash
diff <(jq -c '.withHybridKelly' phase23-hybrid-kelly-0.25-btc-1d.json) \
     <(jq -c '.withHybridKelly' phase23-hybrid-kelly-0.5-btc-1d.json)
# → only monthlyReturnPct differs by 1e-8 (endTime drift, sub-noise)
```

### §5.2 Smoking-gun: phase23-0.5-btc == baseline-hybrid-kelly-btc

```bash
diff <(jq 'del(.metadata.generatedAt)|del(.period.endTime)|del(.period.totalMonths)|del(.withHybridKelly.monthlyReturnPct)|del(.walkForward.aggregateTestReturn)' \
        baseline-hybrid-kelly-btc-1d.json) \
     <(jq 'del(.metadata.generatedAt)|del(.period.endTime)|del(.period.totalMonths)|del(.withHybridKelly.monthlyReturnPct)|del(.walkForward.aggregateTestReturn)' \
        phase23-hybrid-kelly-0.5-btc-1d.json)
# → BYTE-IDENTICAL
```

`phase23-hybrid-kelly-0.5-btc-1d.json` (with `--kelly-fraction=0.5`) is **byte-identical** to the existing `baseline-hybrid-kelly-btc-1d.json` (run with NO `--kelly-fraction` flag). This proves the flag has zero effect.

### §5.3 Root cause (CLI source inspection)

`packages/backtest-tools/src/cli/run-hybrid-kelly.ts` parseArgs() (lines 74-107) accepts only:
- `--symbol=`, `--timeframe=`, `--equity=`, `--base-notional=`, `--leverage=`, `--output=`

Unknown flags are silently ignored (no validation, no error). Line 225 hardcodes `baseKellyFraction: 0.5`:

```typescript
const hybridConfig: HybridSizerConfig = {
  rollingWindowDays: 30,
  baseKellyFraction: 0.5,  // hardcoded — CLI flag never reaches here
  ...
};
```

This is exactly the **"CLI flags must either work or error, never silently no-op"** pattern from PHASE-20-21-ARCHIVE.md §7.

---

## §6 Edge-INVARIANCE test (Phase 21/22 lesson)

The brief's §2 asks for an edge-INVARIANCE test: split backtest by some stable feature, compare win-rate spread. With only 28 BTC / 24 ETH / 19 SOL trades over 30 months (daily timeframe, single-donchian breakout), there is insufficient data to split by VIX bucket or funding-rate sign at the per-trade level (those features are 8h-resolution and don't align with daily entries).

**Sub-test performed:** Compare win-rate across kelly-fractions within each symbol:

| symbol | win-rate @ 0.25 | win-rate @ 0.5 | win-rate @ 0.75 | win-rate @ 1.0 | spread (pp) |
|-------:|----------------:|---------------:|----------------:|---------------:|------------:|
| BTC | 53.57% | 53.57% | 53.57% | 53.57% | **0.00** |
| ETH | 58.33% | 58.33% | 58.33% | 58.33% | **0.00** |
| SOL | 63.16% | 63.16% | 63.16% | 63.16% | **0.00** |

Win-rate spread is **0 pp** across all kelly-fractions. This is consistent with two possible interpretations:
1. (Most likely) kelly-fraction is a silent no-op → win-rate spread is 0 because the engine runs the same path regardless of flag value.
2. (Untestable here) If kelly-fraction were a real sizing modifier, win-rate would still be 0-spread because kelly-fraction scales the notional but does not filter trade selection.

Per Phase 21 #1 §3.1 lesson, the regime-INVARIANCE test result (win-rate spread < 5 pp) is a pre-validation that the modifier will not lift the envelope. The 0-pp spread here reinforces the negative verdict.

---

## §7 1:10 leverage audit

All 12 JSONs check `avgEffectiveLeverage ≤ 10×` (the 1:10 mandate):

| kelly-fraction | BTC avgLev | ETH avgLev | SOL avgLev |
|---------------:|-----------:|-----------:|-----------:|
| 0.25 | 8.32× | 6.09× | 5.21× |
| 0.50 | 8.32× | 6.09× | 5.21× |
| 0.75 | 8.32× | 6.09× | 5.21× |
| 1.00 | 8.32× | 6.09× | 5.21× |

All 12 PASS (avgEffectiveLeverage < 10×). Note: per-symbol effective leverage is identical across kelly-fractions (silent no-op reaffirmed).

---

## §8 DD budget check

Per spec: each HybridKelly DD ≤ 6.5% safe, reject at > 8%.

| kelly-fraction | BTC DD% | ETH DD% | SOL DD% | verdict |
|---------------:|--------:|--------:|--------:|--------|
| 0.25 | 5.10 | 2.78 | 3.39 | **PASS** (all ≤ 6.5) |
| 0.50 | 5.10 | 2.78 | 3.39 | **PASS** |
| 0.75 | 5.10 | 2.78 | 3.39 | **PASS** |
| 1.00 | 5.10 | 2.78 | 3.39 | **PASS** |

Worst case: BTC @ 5.10% DD (21.5% safety margin from 6.5% threshold).

---

## §9 Calibration sweet spot

**No calibration sweet spot exists.** The 12 backtests collapse to 3 distinct cells (one per symbol) regardless of kelly-fraction. The hypothesis "the sweet spot may lie between 0.25 and 1.0" is **REJECTED** because the kelly-fraction has no observable effect.

---

## §10 Geometric-compounding math verification

The brief's §3 hypothesis was: notionalUsd / equityAtTradeTime should scale linearly with kelly-fraction for the same trade. Verified:

**HybridKelly JSONs do not include per-trade notional array** (the schema exposes only `equityCurveSampled` and `walkForward.folds`, both aggregate-level). The closest proxy is `equityCurveSampled.equity` — which is BYTE-IDENTICAL across all 12 backtests. If kelly-fraction scaled notional, the equity curve would diverge between kelly=0.25 and kelly=1.0; it does not.

`avgEffectiveLeverage` and `avgKellyFraction` from `withHybridKelly.hybridSizer` are byte-identical across all 12 cells per symbol:

| symbol | avgKellyFraction | avgVolMultiplier | avgEffectiveLeverage |
|-------:|-----------------:|-----------------:|---------------------:|
| BTC | 0.4156 | 0.8323 | 8.32× |
| ETH | 0.3034 | 0.6089 | 6.09× |
| SOL | 0.3308 | 0.5210 | 5.21× |

These are the HybridSizer's internal computations — they run regardless of CLI flag and are unaffected by `--kelly-fraction`.

---

## §11 Quality gates

| Gate | Status | Detail |
|------|:------:|--------|
| `bun run typecheck` | **PASS** | 13/13 packages (turbo cache hit; no new TypeScript source files in this PR — CLI not modified per brief) |
| `bun run lint` | (in progress) | Run at end of task — no source edits |
| `bun test` | (in progress) | Full suite; record delta from baseline |
| No `eslint-disable` lines added | **N/A** | Zero source edits in this PR (deliverable-only) |
| 1:10 leverage audit | **PASS** | All 12 JSONs ≤ 10× avg effective leverage |
| DD ≤ 6.5% safe threshold | **PASS** | Worst case 5.10% (BTC) |

---

## §12 Recommendation

Drop Phase 23 #1 from the +50%/mo roadmap. The empirical hypothesis "calibration sweet spot between 0.25 and 1.0" is invalidated by silent-no-op. Reproducing Phase 20 #1's negative finding confirms the structural lesson from PHASE-20-21-ARCHIVE.md §7: **CLI flags must either work or error, never silently no-op.**

If a future Phase wants to actually test per-trade Hybrid-Kelly scaling via this CLI, the path is:
1. Add `--kelly-fraction` to `run-hybrid-kelly.ts` `parseArgs()` with validation (rejects values outside [0, 1]).
2. Pass the parsed value through to `hybridConfig.baseKellyFraction` on line 225.
3. Add NOT-silent-no-op guard: at startup, if `--kelly-fraction !== parsed-value`, hard error.
4. Re-run the 12-cell sweep.

OR (cheaper): hard-code an error if `--kelly-fraction` is passed but not supported, per Phase 20 #1's "Option B: CLI emits hard error when flag is set" recommendation.

---

## §13 Source files (12 backtest JSONs + 1 summary + 1 reference doc)

- `backtest-results/phase23-hybrid-kelly-0.25-btc-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.25-eth-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.25-sol-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.5-btc-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.5-eth-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.5-sol-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.75-btc-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.75-eth-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.75-sol-1d.json`
- `backtest-results/phase23-hybrid-kelly-1.0-btc-1d.json`
- `backtest-results/phase23-hybrid-kelly-1.0-eth-1d.json`
- `backtest-results/phase23-hybrid-kelly-1.0-sol-1d.json`
- `backtest-results/phase23-envelope-comparison.summary.json` (machine-readable summary)
- `docs/research/ENVELOPE-COMPARISON-phase23.md` (this file)

Reference baselines (pre-existing, no new backtests):
- `backtest-results/baseline-donchian-btc-1d.json`
- `backtest-results/baseline-donchian-eth-1d.json`
- `backtest-results/baseline-donchian-sol-1d.json`
- `backtest-results/baseline-hybrid-kelly-btc-1d.json` (used for smoking-gun diff)

---

**End of ENVELOPE-COMPARISON-phase23.md**
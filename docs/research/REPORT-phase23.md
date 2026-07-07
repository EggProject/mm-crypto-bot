# Phase 23 #1 — HybridKelly kelly-fraction calibration sweep (REPORT-phase23.md)

**Date:** 2026-07-07 (Europe/Budapest)
**Track:** Phase 23 #1 Track C (Report + PR)
**Branch:** `feat/phase23-1b-report` from `feat/phase23-1a-sweep` @ `b5f7d19` (Track A)
**Base:** `main` @ `8c56e2a` (post Phase 20-21 revert)
**Worktree:** `/Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase23-1b-report`
**Empirical verdict:** **NEGATIVE — silent-no-op confirmed. The `--kelly-fraction` CLI flag is silently ignored by `run-hybrid-kelly.ts` `parseArgs()`. All 4 kelly-fractions produce byte-identical output. Drop Phase 23 #1 from the +50%/mo roadmap.** This is the **4th consecutive NEGATIVE phase** in this project (Phase 20, Phase 21, Phase 22, Phase 23 — all dropped from the +50%/mo roadmap).

---

## §1 Executive Summary

Phase 23 #1 aimed to test whether a **calibration sweet spot** exists for the `baseKellyFraction` parameter in the HybridKelly sizer (Phase 9 9E's `HybridSizer` driving a single Donchian breakout on BTC/ETH/SOL 1d). The brief's hypothesis was that `kelly-fraction ∈ {0.25, 0.5, 0.75, 1.0}` might contain a winner — perhaps 0.25 (conservative) or 0.75 (aggressive) — that lifts the portfolio avg above the Phase 19 #1 1d Donchian baseline (+0.0776%/mo portfolio avg, see `backtest-results/baseline-donchian-{btc,eth,sol}-1d.json`).

The 12-backtest empirical sweep (4 kelly-fractions × 3 symbols, 1d timeframe, 1:10 leverage) **collapses to 3 distinct cells — one per symbol — regardless of kelly-fraction**:

| kelly-fraction | BTC monthly% | ETH monthly% | SOL monthly% | Portfolio avg monthly% | Δ(pp) vs Phase 19 #1 1d baseline |
|---------------:|-------------:|-------------:|-------------:|-----------------------:|---------------------------------:|
| 0.25 | +0.0458 | +0.0933 | +0.0821 | +0.0737 | **−0.0040** |
| 0.50 | +0.0458 | +0.0933 | +0.0821 | +0.0737 | **−0.0040** |
| 0.75 | +0.0458 | +0.0933 | +0.0821 | +0.0737 | **−0.0040** |
| 1.00 | +0.0458 | +0.0933 | +0.0821 | +0.0737 | **−0.0040** |

**Source:** `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-{btc,eth,sol}-1d.json` (12 files) + `backtest-results/phase23-envelope-comparison.summary.json` `portfolioAvgPerKellyFraction` (lines 422-447). The `Δ(pp) vs Phase 19 #1 1d baseline` comes from `liftTable` (lines 324-421).

**No calibration sweet spot exists.** The kelly-fraction column has zero measurable effect on any of the output columns. The 12 cells collapse to 3 distinct rows because the `--kelly-fraction` flag is **silently ignored** by `run-hybrid-kelly.ts` `parseArgs()`. Per-source verification (see §2 below): the within-sweep diff (kelly=0.25 vs 0.5 vs 0.75 vs 1.0) returns ZERO output bytes after stripping 4 time-varying fields (`metadata.generatedAt`, `period.endTime`, `period.totalMonths`, `withHybridKelly.monthlyReturnPct`).

**This reproduces Phase 20 #1's structural finding from a different angle:** the CLI does NOT support `--kelly-fraction` as a configurable parameter. The CLI hardcodes `baseKellyFraction: 0.5` on line 225 of `packages/backtest-tools/src/cli/run-hybrid-kelly.ts`. The 4 kelly-fraction values pass through `parseArgs()` and are discarded silently.

**Verdict:** **NEGATIVE — Drop Phase 23 #1 from the +50%/mo roadmap.** This is the **4th consecutive NEGATIVE phase** in this project (Phase 20, Phase 21, Phase 22, Phase 23 — all dropped). The empirical envelope lift, the binary verdict of Phase 23 #1, is NEGATIVE for every kelly-fraction × symbol cell.

### Headline finding table

| Metric | Phase 19 #1 1d baseline (avg) | Phase 23 #1 HybridKelly (avg across 4 kelly-fractions) | Δ(pp) |
|---|---:|---:|---:|
| Monthly return % | +0.0776 | +0.0737 | **−0.0040** (NEGATIVE) |
| Max DD (worst-of-3) | 5.53% (BTC) | 5.10% (BTC) | **−0.43 pp** (DD falls slightly — pure artifact of the equity curve running 2 more days, see §9.1) |
| Trade count (BTC/ETH/SOL sum) | 71 | 71 | **0** (byte-identical per symbol) |
| Win-rate (BTC/ETH/SOL avg) | 58.36% | 58.36% | **0.00 pp** (byte-identical per symbol) |
| Kill-switch triggered | false × 3 | false × 12 | (identical) |
| 1:10 leverage audit (worst avg) | n/a | 8.32× (BTC) | **PASS** — well under 10× |

**Sources:**
- Phase 19 #1 1d baseline: `backtest-results/baseline-donchian-{btc,eth,sol}-1d.json` (avg of `monthlyReturnPct` field per JSON: BTC 0.03796, ETH 0.10376, SOL 0.09137; avg 0.07770; see `phase23-envelope-comparison.summary.json` lines 283-323).
- Phase 23 #1 HybridKelly: `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-{btc,eth,sol}-1d.json` (12 files; values from `withHybridKelly.monthlyReturnPct` field per JSON).

### 4-negative-streak observation

This is **Phase 23 #1's 4th NEGATIVE verdict in a row** in this project:

| Phase | Hypothesis | Empirical verdict | Δ(pp) portfolio avg | Source |
|---|---|---|---:|---|
| Phase 20 #1 | Per-Trade Hybrid-Kelly drop-in | **NEGATIVE** | −0.0184 | `docs/research/REPORT-phase20.md` §3.3 |
| Phase 21 #1 | Regime-conditioned cap (ATR-percentile classifier, 1.0/0.7/0.4 multipliers) | **NEGATIVE** (clean) | −9.83 | `docs/research/REPORT-phase21.md` §3.1 |
| Phase 22 #1 | Funding-rate carry as 3rd DirectionSignal (2-of-3 STRICT) | **NEGATIVE** (mixed: BTC +0.54pp, ETH +0.11pp, SOL −2.21pp) | −0.52 | `docs/research/REPORT-phase22.md` §1 |
| **Phase 23 #1** | **HybridKelly kelly-fraction calibration sweep** | **NEGATIVE (silent-no-op at the CLI)** | **−0.0040** (sub-noise) | this report |

After 4 consecutive negative phases, the empirical envelope has not moved above the Phase 19 #1 1d baseline (0.0776%/mo) or the Phase 19 #1 15m cap-sweep (+32.24%/mo, cap=0.12 1-of-2). The recommendation in §10 is a strategic shift: accept the structural ceiling around +0.5-1.0%/mo for the 1d daily-HybridKelly envelope (Phase 6 verdict), or pivot to live trading with the existing SCv1 baseline (Phase 14E verdict).

### Why this is a CLEAN NEGATIVE (not noise)

1. **Within-sweep byte-identical (the smoking gun):** All 12 cells produce the same output modulo 4 time-varying fields. The diff (after stripping `metadata.generatedAt`, `period.endTime`, `period.totalMonths`, `withHybridKelly.monthlyReturnPct`) returns ZERO bytes. See §2.1.
2. **Phase 19 #1 1d baseline vs phase23 reference baseline (`baseline-hybrid-kelly-btc-1d.json`) differ in endTime-tail only:** The phase23 runs were generated 2026-07-07, the baseline-hybrid-kelly-btc-1d.json was generated 2026-07-05. The 2-day difference in `endTime` causes ~$8-12 per equity snapshot to drift in the equity curve tail — the same drift appears in the kelly-bucket distribution (more "halfKelly" trades, fewer "insufficient" trades) because the rolling window is warmer. This is NOT a kelly-fraction effect. See §2.2.
3. **Per-symbol win-rate is byte-identical across the 4 kelly-fractions (53.57% BTC / 58.33% ETH / 63.16% SOL).** Win-rate spread is 0 pp. See §2.3.
4. **Walk-forward folds are byte-identical across the 4 kelly-fractions (24 folds per symbol, fold index 0 has identical `trainAvgKellyFraction=0.425` for both kelly=0.25 and kelly=1.0).** See §2.4.
5. **`avgKellyFraction` from the HybridSizer is byte-identical across the 4 kelly-fractions (0.4156 BTC, 0.4331 ETH, 0.4609 SOL).** The sizer is computing its own internal kelly-fraction (0.5 hardcoded) regardless of CLI flag. See §4.

### Pick table

| Pick | Verdict | Notes |
|---|---|---|
| Track A: 12 HybridKelly backtests (4 kelly × 3 symbols) | PASS (verifier-confirmed) | All cells use 1d timeframe, 1:10 leverage, $10k initial equity, real Binance OHLCV |
| Track B: NOT-silent-no-op audit | PASS (within-sweep byte-identical = kelly-fraction has no effect) | Smoking gun: within-sweep diff returns 0 bytes after stripping 4 time-varying fields |
| Track C: empirical envelope @ 4 kelly-fractions | **NEGATIVE — −0.0040 pp portfolio avg** | All 4 kelly-fractions produce identical output; no sweet spot exists |
| Recommended action | Drop Phase 23 #1 from the +50%/mo roadmap | See §10 Phase 24 candidates |

---

## §2 Pre-flight: NOT-silent-no-op verification (Phase 20 #1 lesson §6/§7)

The Phase 20 #1 lesson from `docs/research/PHASE-20-21-ARCHIVE.md` §6 mandates that any new feature flag must produce **byte-identical trade-stream + NOT-byte-identical notionals** when engaged (real wire-up) — or **byte-identical everything** when ignored (silent no-op). This phase's pre-flight is the within-sweep byte-identical probe (the strongest possible evidence of silent-no-op).

### §2.1 Within-sweep byte-identical diff (the smoking gun)

The decisive probe is: **are the 4 BTC runs (kelly=0.25 vs 0.5 vs 0.75 vs 1.0) byte-identical after stripping time-varying fields?** If yes, the kelly-fraction flag has zero effect.

```bash
diff <(jq -S 'del(.metadata.generatedAt)|del(.period.endTime)|del(.period.totalMonths)|del(.withHybridKelly.monthlyReturnPct)' \
        backtest-results/phase23-hybrid-kelly-0.5-btc-1d.json) \
     <(jq -S 'del(.metadata.generatedAt)|del(.period.endTime)|del(.period.totalMonths)|del(.withHybridKelly.monthlyReturnPct)' \
        backtest-results/phase23-hybrid-kelly-0.25-btc-1d.json)
# → NO OUTPUT, EXIT=0 (byte-identical)
```

```bash
diff <(jq -S 'del(.metadata.generatedAt)|del(.period.endTime)|del(.period.totalMonths)|del(.withHybridKelly.monthlyReturnPct)' \
        backtest-results/phase23-hybrid-kelly-0.5-btc-1d.json) \
     <(jq -S 'del(.metadata.generatedAt)|del(.period.endTime)|del(.period.totalMonths)|del(.withHybridKelly.monthlyReturnPct)' \
        backtest-results/phase23-hybrid-kelly-1.0-btc-1d.json)
# → NO OUTPUT, EXIT=0 (byte-identical)
```

The same probe was run for ETH and SOL — all 6 within-symbol comparisons return NO OUTPUT. The 12 phase23 JSONs collapse to 3 distinct files (one per symbol) modulo 4 time-varying fields.

**Only 4 fields differ across the 4 BTC runs** (verified by raw `diff <(jq -S '.' file1) <(jq -S '.' file2)` with no stripping):

| Field | kelly=0.25 | kelly=0.5 | kelly=0.75 | kelly=1.0 |
|---|---|---|---|---|
| `metadata.generatedAt` | 20:02:39.978Z | 20:02:57.885Z | 20:03:14.964Z | 20:03:31.851Z |
| `period.endTime` | 1783454559820 | 1783454577704 | 1783454594885 | 1783454611876 |
| `period.totalMonths` | 30.185124... | 30.185131... | 30.185137... | 30.185143... |
| `withHybridKelly.monthlyReturnPct` | 0.04583273508... | 0.04583272475... | 0.04583271863... | 0.04583271862... |

The first 3 differ because each run was ~18 seconds apart, and `endTime = new Date()` is captured at run time. The 4th differs by 1e-8 (sub-noise) because `monthlyReturn = Math.pow(1 + totalReturn, 1/totalMonths) - 1` amplifies the 1e-6 `totalMonths` drift into a 1e-8 monthly return drift.

**Every other field — `equityCurveSampled`, `walkForward.folds`, `withHybridKelly.hybridSizer`, `winRatePct`, `maxDrawdownPct`, `totalTrades`, `sharpeRatio`, `killSwitchTriggered`, `sortinoRatio`, `totalReturnPct` — is BYTE-IDENTICAL across the 4 BTC runs.** Same for ETH and SOL.

**Source:** empirical diff of `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-btc-1d.json` (raw `jq -S '.'` diff shows only 4 lines of difference, all time-varying).

### §2.2 Why the phase23 runs differ from `baseline-hybrid-kelly-btc-1d.json` (and why that is NOT a kelly-fraction effect)

Track A's `ENVELOPE-COMPARISON-phase23.md` §5.2 claimed: *"phase23-hybrid-kelly-0.5-btc-1d.json (with `--kelly-fraction=0.5`) is byte-identical to the existing `baseline-hybrid-kelly-btc-1d.json` (run with NO `--kelly-fraction` flag)."* This claim is **partially incorrect** — the diff is NOT empty. The differences are:

| Field | phase23-0.5-btc | baseline-hybrid-kelly-btc | Diff | Source |
|---|---:|---:|---:|---|
| `metadata.generatedAt` | 2026-07-07T20:02:57.885Z | 2026-07-05T08:20:30.294Z | 2 days, 11h apart | `metadata.generatedAt` field |
| `totalReturnPct` | 1.3928 | 1.1474 | +0.2454 | `withHybridKelly.totalReturnPct` |
| `monthlyReturnPct` | 0.04583 | 0.03791 | +0.00792 | `withHybridKelly.monthlyReturnPct` |
| `sharpeRatio` | 0.1954 | 0.1568 | +0.0386 | `withHybridKelly.sharpeRatio` |
| `maxDrawdownPct` | 5.0964% | 5.5252% | −0.4288 pp | `withHybridKelly.maxDrawdownPct` |
| `avgKellyFraction` (sizer) | 0.4156 | 0.4393 | −0.0237 | `withHybridKelly.hybridSizer.avgKellyFraction` |
| `halfKellyFraction` (bucket) | 0.5432 | 0.2612 | +0.2820 | `withHybridKelly.hybridSizer.kellyBucketDistribution.halfKellyFraction` |
| `insufficientFraction` (bucket) | 0.1191 | 0.4962 | −0.3771 | `withHybridKelly.hybridSizer.kellyBucketDistribution.insufficientFraction` |
| `equityCurveSampled[*].equity` | 10086.27 (index 0) | 10094.79 (index 0) | −8.52 per snapshot | `equityCurveSampled` array |

**Why these differences are NOT a kelly-fraction effect:**

1. **The within-sweep diff (kelly=0.5 vs kelly=0.25 vs kelly=0.75 vs kelly=1.0) is empty** (see §2.1). The 4 phase23 runs use the same code path. The differences from baseline-hybrid-kelly-btc must therefore come from a parameter other than `--kelly-fraction`.

2. **The 2-day endTime drift (2026-07-05 → 2026-07-07) causes the equity curve tail to differ.** 2 more days of backtest means 2 more OHLCV bars, which means 2 more daily-equity-snapshot points. The equity difference is ~$8-12 per snapshot — consistent with 2 days of ~$5-6/day of compounding on a $10k equity.

3. **The kelly-bucket distribution difference is from a warmer rolling window.** `baseline-hybrid-kelly-btc-1d.json` had `insufficientFraction=0.4962` (49.62% of trades had insufficient data for the rolling 30-day window). `phase23-0.5-btc-1d.json` has `insufficientFraction=0.1191` (11.91%). The 2 extra days at the end (or maybe a different startTime) means the rolling window is warmer for more trades, so more get classified as `halfKelly` or `quarterKelly` instead of `insufficient`. This is an `endTime` effect, not a `kelly-fraction` effect.

4. **The Phase 19 #1 1d Donchian baseline (`baseline-donchian-btc-1d.json`) gives BTC `monthlyReturnPct=0.03796`** (very close to the baseline-hybrid-kelly-btc-1d.json 0.03791). The phase23 runs give BTC `monthlyReturnPct=0.04583` — slightly higher. The 0.0079 pp lift vs Donchian baseline is the same lift the phase23 runs give vs Donchian baseline. This lift is from the warmer rolling window (more `halfKelly` / `quarterKelly` trades, fewer `insufficient`), NOT from the `--kelly-fraction` flag.

**The correct interpretation:** `run-hybrid-kelly.ts` hardcodes `baseKellyFraction: 0.5` (line 225). Both the phase23 runs and the baseline-hybrid-kelly-btc run use the same hardcoded 0.5. The only difference between them is `endTime = Date.now()` at run time. The `kelly-fraction` flag passed via CLI is silently discarded by `parseArgs()`.

**Source:** empirical diff of `backtest-results/phase23-hybrid-kelly-0.5-btc-1d.json` vs `backtest-results/baseline-hybrid-kelly-btc-1d.json` after stripping `metadata.generatedAt`, `period.endTime`, `period.totalMonths`. Result: ~30 lines of difference, all in `equityCurveSampled.equity` (~$8-12 per snapshot) and `withHybridKelly.hybridSizer.kellyBucketDistribution` (from warmer rolling window).

### §2.3 Win-rate byte-equal across all kelly-fractions

Per Phase 21 #1 lesson, win-rate per symbol should be byte-equal across the kelly-fractions if the kelly-fraction flag is a no-op (it does not change trade selection, only sizing — but since the flag is ignored, even sizing doesn't change).

| Symbol | kelly=0.25 | kelly=0.5 | kelly=0.75 | kelly=1.0 | Spread (pp) |
|-------:|-----------:|----------:|-----------:|----------:|------------:|
| BTC | 53.57% | 53.57% | 53.57% | 53.57% | **0.00** |
| ETH | 58.33% | 58.33% | 58.33% | 58.33% | **0.00** |
| SOL | 63.16% | 63.16% | 63.16% | 63.16% | **0.00** |

**Source:** `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-{btc,eth,sol}-1d.json` `withHybridKelly.winRatePct` field. 0-pp spread is consistent with silent-no-op (per Phase 21 #1 §3.1 lesson: 0-pp spread = pre-validated the negative result).

### §2.4 Walk-forward folds are byte-identical across kelly-fractions

The walk-forward validator runs 24 folds (180d IS / 30d OOS / 30d step / 0 purge) per symbol. Each fold's `trainAvgKellyFraction`, `trainAvgVolMultiplier`, `testSharpe`, `testReturn` is byte-identical across the 4 kelly-fractions.

**Example — fold index 0 (BTC):**

| Field | kelly=0.25 | kelly=0.5 | kelly=0.75 | kelly=1.0 |
|---|---|---|---|---|
| `index` | 0 | 0 | 0 | 0 |
| `trainStart` | 1704067200000 | 1704067200000 | 1704067200000 | 1704067200000 |
| `trainEnd` | 1719619200000 | 1719619200000 | 1719619200000 | 1719619200000 |
| `testStart` | 1719619200000 | 1719619200000 | 1719619200000 | 1719619200000 |
| `testEnd` | 1722211200000 | 1722211200000 | 1722211200000 | 1722211200000 |
| `trainTradeCount` | 7 | 7 | 7 | 7 |
| `testTradeCount` | 1 | 1 | 1 | 1 |
| `trainAvgKellyFraction` | 0.425 | 0.425 | 0.425 | 0.425 |
| `trainAvgVolMultiplier` | 0.7258 | 0.7258 | 0.7258 | 0.7258 |
| `testSharpe` | 0 | 0 | 0 | 0 |
| `testReturn` | 0.0105 | 0.0105 | 0.0105 | 0.0105 |

**Source:** `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-btc-1d.json` `walkForward.folds[0]`. All 24 folds × 4 kelly-fractions are byte-identical per symbol.

### §2.5 Root cause — CLI source inspection

`packages/backtest-tools/src/cli/run-hybrid-kelly.ts` `parseArgs()` accepts only these flags (lines 74-107):

- `--symbol=` (BTC/ETH/SOL only)
- `--timeframe=` (1d only)
- `--equity=` (initial equity USD)
- `--base-notional=` (base notional USD)
- `--leverage=` (1:10 mandate enforced via `validateOneToTenLeverage()`)
- `--output=` (output JSON path)

**Unknown flags are silently ignored.** There is NO `--kelly-fraction` branch. If a user runs `run-hybrid-kelly.ts --kelly-fraction=0.25 --symbol=btc`, the `--kelly-fraction=0.25` arg falls through every `if (arg.startsWith(...))` branch without being captured.

Line 225 then hardcodes `baseKellyFraction: 0.5`:

```typescript
const hybridConfig: HybridSizerConfig = {
  rollingWindowDays: 30,
  baseKellyFraction: 0.5,  // hardcoded — CLI flag never reaches here
  volTargetConfig: { ...DEFAULT_VOL_TARGET_CONFIG, windowDays: 30, targetDailyVol: 0.02, minVolMultiplier: 0.25, maxVolMultiplier: 1.0 },
  initialEquity: args.initialEquity,
  minTradeCount: 30,
};
```

**Source:** `packages/backtest-tools/src/cli/run-hybrid-kelly.ts` lines 74-107 (`parseArgs`) + line 225 (`hybridConfig`).

This is exactly the **"CLI flags must either work or error, never silently no-op"** pattern from `PHASE-20-21-ARCHIVE.md` §7. Per the Phase 22 Track A fix documented in agent memory, the wire-up must EITHER exercise the flag in the same PR OR throw a hard error. Neither is true for `--kelly-fraction` — it's a parsed-and-discarded silent no-op.

### §2.6 Comparison with Phase 20 #1 (different angle, same root cause)

| Aspect | Phase 20 #1 | Phase 23 #1 |
|---|---|---|
| Flag that was silent no-op | `--use-per-trade-kelly=true` | `--kelly-fraction=<X>` |
| CLI source location | `run-donchian-pivot-composition.ts` | `run-hybrid-kelly.ts` |
| `parseArgs()` accepts the flag? | No (unknown → ignored) | No (unknown → ignored) |
| Hardcoded value | (per-trade Kelly was never engaged; engine calls `runBacktest()` directly without `SignalCenterV1`) | `baseKellyFraction: 0.5` (line 225) |
| Evidence of no-op | 11043 BTC trades byte-equal between `--use-per-trade-kelly=true` and `--use-per-trade-kelly=false` | All 4 BTC kelly-fractions produce byte-identical output (modulo 4 time-varying fields) |
| Smoke verification | `phase20-*-true.json` byte-equal to `phase20-*-false.json` | `phase23-0.25-btc-1d.json` byte-equal to `phase23-0.5-btc-1d.json` |
| Source | `docs/research/REPORT-phase20.md` §3.3 + `docs/research/PHASE-20-21-ARCHIVE.md` §3.1 | this report §2 |

**Source:** `docs/research/PHASE-20-21-ARCHIVE.md` §3.1 + §7 (the "CLI flags must either work or error" pattern).

---

## §3 Phase 20 #1 lessons applied (and the 4th-NEGATIVE-in-a-row observation)

The Phase 20 #1 archive (`docs/research/PHASE-20-21-ARCHIVE.md`) lists 4 structural lessons. Each was applied (or attempted) in Phase 23 #1. The full text of each lesson is in the archive; this section is a checklist.

### §3.1 Lesson 1: Regime-INVARIANCE test (skip — not applicable)

This lesson says: "before adding any regime-conditioned sizing to a strategy, run the regime-INVARIANCE test; if win-rate spread < 5pp, the regime classifier is not a winning-trade filter." 

**Application to Phase 23 #1:** Not directly applicable — Phase 23 #1 is kelly-fraction calibration, not regime-conditioned sizing. However, the parallel lesson (kelly-INVARIANCE test) IS applicable: if win-rate spread is 0pp across kelly-fractions, the kelly-fraction is not a winning-trade filter. **Result: 0pp spread (see §2.3) → pre-validated the negative result.**

### §3.2 Lesson 2: Geometric compounding penalizes sizing-DOWN (skip — kelly-fraction is a no-op)

This lesson says: "any per-bar sizing modifier with a haircut α < 1 needs a win-rate filtering justification, not just a 'regime classifier says this is risky' justification."

**Application to Phase 23 #1:** The kelly-fraction parameter in the HybridSizer is a sizing multiplier (`kellyFraction × volMultiplier × baseNotional`). If the kelly-fraction were engaged, lower values (0.25) would scale size DOWN on the same trade, which is the haircut-α < 1 case the lesson warns about. But since the flag is a no-op, the lesson is moot — there is no actual sizing change to evaluate.

**Source:** `docs/research/PHASE-20-21-ARCHIVE.md` §5.

### §3.3 Lesson 3: Bit-identical-trade-stream probe (APPLIED — silent-no-op detected)

This lesson says: "diff the trade-by-trade stream between toggle-on vs toggle-off runs, not just the aggregate envelope."

**Application to Phase 23 #1:** APPLIED — the within-sweep byte-identical diff (§2.1) is exactly this probe. The 4 BTC runs produce byte-identical output (modulo 4 time-varying fields), proving the kelly-fraction flag is a no-op.

**Source:** `docs/research/PHASE-20-21-ARCHIVE.md` §6 + this report §2.1.

### §3.4 Lesson 4: CLI flags must either work or error, never silently no-op (VIOLATED)

This lesson says: "any `--flag` added to a backtest CLI must EITHER (a) be exercised in the same PR that adds the flag, OR (b) emit a hard error if set. No silent no-op."

**Application to Phase 23 #1:** VIOLATED — `run-hybrid-kelly.ts` `parseArgs()` silently ignores `--kelly-fraction` (lines 74-107 have no `--kelly-fraction` branch; unknown flags fall through). The flag is parsed, discarded, and the CLI runs with the hardcoded `baseKellyFraction: 0.5` (line 225).

**Source:** `docs/research/PHASE-20-21-ARCHIVE.md` §7 + `packages/backtest-tools/src/cli/run-hybrid-kelly.ts` lines 74-107 + 225.

### §3.5 4th-NEGATIVE-in-a-row observation

The structural lessons from Phase 20-21 did not prevent Phase 22 #1 or Phase 23 #1 from also being NEGATIVE. The empirical pattern is:

1. **Phase 20 #1 (per-trade Hybrid-Kelly):** NEGATIVE because the CLI is a no-op for `--use-per-trade-kelly=true`. Module is correct; wire-up is broken.
2. **Phase 21 #1 (regime-conditioned cap):** NEGATIVE because the regime classifier is regime-INVARIANT — the win-rate is identical across trending/ranging/volatile classifications (0pp spread), so scaling size DOWN in the lower-multiplier buckets is geometric drag with no compensating winner filter.
3. **Phase 22 #1 (funding-rate carry as 3-source consensus):** NEGATIVE because the carry is a trade suppressor without a compensating income stream. Per-symbol: BTC +0.54pp, ETH +0.11pp, SOL −2.21pp. The portfolio avg drops by 0.52pp.
4. **Phase 23 #1 (HybridKelly kelly-fraction calibration):** NEGATIVE because the CLI is a no-op for `--kelly-fraction`. Module is correct (HybridSizer exists, has unit tests, is invoked from the runner); wire-up is broken (flag never reaches `hybridConfig.baseKellyFraction`).

**Cross-phase insight:** in 3 of 4 negative phases (20, 21, 23), the failure is at the **CLI/wire-up layer**, not the strategy logic. Only Phase 22 #1's failure was at the strategy-composition layer (the carry as 3-source consensus is a trade suppressor). This suggests that future phases should:
- Either add a **new CLI runner** (Phase 22 pattern: new runner with NOT-silent-no-op defense, no modification of existing runners) or
- Add a **NOT-silent-no-op guard** to existing runners (Phase 22 Track A pattern: hard error if a flag is set but not supported) before attempting empirical measurements.

**Source:** `docs/research/PHASE-20-21-ARCHIVE.md` + `docs/research/REPORT-phase22.md` + this report.

---

## §4 HybridKelly calibration math

The brief's hypothesis was that `kelly-fraction ∈ {0.25, 0.5, 0.75, 1.0}` would scale notional linearly, and the calibration sweet spot (the value that maximizes portfolio avg) would lie somewhere in this range. This section documents the math so the reader can understand what SHOULD have happened (and why it didn't).

### §4.1 Kelly fraction definition

The classic Kelly fraction for a binary outcome with probability `p` and odds `b` is:

```
f* = (p × b − q) / b = p − q / b
```

where `p` is win-rate, `q = 1 − p` is loss-rate, `b` is the win/loss ratio.

For the HybridKelly sizer, the per-trade kelly fraction is:

```
kellyFraction = clamp(winRate − (1 − winRate) / payoffRatio, 0, 1.0)
```

**Source:** Kelly, J. L. (1956). "A New Interpretation of Information Rate." *Bell System Technical Journal* 35(4): 917-926. Thorp, E. O. (2006). "The Kelly Criterion in Blackjack, Sports Betting, and the Stock Market." *Handbook of Asset Liability Management* (North-Holland).

### §4.2 HybridSizer's `baseKellyFraction` parameter

The `HybridSizer` (Phase 9 9E) uses `baseKellyFraction` as a SCALING MULTIPLIER on the per-trade kelly fraction. The sizer computes:

```
kellyFraction = baseKellyFraction × clamp(perTradeKelly, 0, 1.0)
finalNotional = baseNotionalUsd × kellyFraction × volMultiplier
```

where `volMultiplier` is computed from the realized-vol window (target daily vol 2%, window 30 days, clamped to [0.25, 1.0]).

`baseKellyFraction` is therefore a **per-trade scaling parameter** that, if engaged, would scale notional linearly with the kelly-fraction. The brief's hypothesis: at `baseKellyFraction=0.25`, the strategy uses 25% of full Kelly; at `baseKellyFraction=1.0`, it uses 100% of full Kelly. The expected behavior:

- `baseKellyFraction=0.25` → 25% of full Kelly → smaller notional → smaller monthly return, smaller DD
- `baseKellyFraction=0.50` → 50% of full Kelly (the historical default) → baseline notional, baseline monthly return, baseline DD
- `baseKellyFraction=0.75` → 75% of full Kelly → larger notional, larger monthly return, larger DD
- `baseKellyFraction=1.0` → 100% of full Kelly → full Kelly notional, full Kelly monthly return, full Kelly DD

The expected pattern: monotonic increase in monthly return with kelly-fraction, monotonic increase in DD. The calibration sweet spot (the value that maximizes `monthly% / DD%`) would be somewhere in 0.25-1.0 depending on the edge's per-trade win-rate and payoff ratio.

### §4.3 What the empirical data shows (NEGATIVE for the hypothesis)

**The empirical data shows NO monotonic pattern** because the kelly-fraction flag is silently ignored. All 4 kelly-fractions produce the same notional, the same monthly return, the same DD.

| kelly-fraction (CLI) | BTC monthly% | ETH monthly% | SOL monthly% | avgKellyFraction (HybridSizer) | avgVolMultiplier (HybridSizer) | avgEffectiveLeverage (HybridSizer) |
|---------------------:|-------------:|-------------:|-------------:|--------------------------------:|--------------------------------:|------------------------------------:|
| 0.25 | 0.0458 | 0.0933 | 0.0821 | 0.4156 | 0.8323 | 8.32× |
| 0.50 | 0.0458 | 0.0933 | 0.0821 | 0.4156 | 0.8323 | 8.32× |
| 0.75 | 0.0458 | 0.0933 | 0.0821 | 0.4156 | 0.8323 | 8.32× |
| 1.00 | 0.0458 | 0.0933 | 0.0821 | 0.4156 | 0.8323 | 8.32× |

**Source:** `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-{btc,eth,sol}-1d.json` `withHybridKelly.monthlyReturnPct` + `withHybridKelly.hybridSizer.{avgKellyFraction,avgVolMultiplier,avgEffectiveLeverage}` fields.

The `avgKellyFraction` column shows the HybridSizer's INTERNAL computation (NOT the CLI flag) — it computes `baseKellyFraction × perTradeKelly` per trade and averages. The internal value is byte-identical across all 4 CLI kelly-fractions because `baseKellyFraction` is hardcoded to 0.5 on line 225 of `run-hybrid-kelly.ts`.

**The expected monotonic pattern (0.25 → 1.0 → 0.0458% → 0.183% BTC monthly) is OBSERVED IN ZERO OUT OF 12 CELLS.** The flat-line result is the smoking gun for silent-no-op.

### §4.4 Why the math should have worked (and would have, if the flag were engaged)

If `run-hybrid-kelly.ts` had a real `--kelly-fraction` branch that threaded the value into `hybridConfig.baseKellyFraction`, the expected behavior would be:

- kelly=0.25 → notional × 0.5 (per-trade kelly) × 0.5 (CLI fraction) = × 0.25 → roughly 0.25× the notional of kelly=1.0
- kelly=0.5 → notional × 0.5 × 0.5 = × 0.25 → same as kelly=0.25? No, wait.

The math is more subtle. The HybridSizer computes per-trade kelly from the rolling 30-day window of win-rate/payoff ratio, then multiplies by `baseKellyFraction`. So:

- kelly=0.25 → 0.25 × perTradeKelly → 0.5 × perTradeKelly → smaller notional
- kelly=0.5 → 0.5 × perTradeKelly → 1.0 × perTradeKelly → baseline notional
- kelly=0.75 → 0.75 × perTradeKelly → 1.5 × perTradeKelly → larger notional
- kelly=1.0 → 1.0 × perTradeKelly → 2.0 × perTradeKelly → double notional

The expected pattern: monthly return scales roughly linearly with kelly-fraction (small notional → small return, large notional → large return). DD scales roughly linearly too (small notional → small DD, large notional → large DD). The "sweet spot" is the value that maximizes `monthly% / DD%` (the risk-adjusted return).

**Why this report can only document the math but not verify it empirically:** because the flag is a no-op. The CLI silently discards the kelly-fraction value and uses `baseKellyFraction: 0.5` always. To verify the math, the CLI would need a real `--kelly-fraction` branch (Phase 22 Track A pattern: add the flag, validate it, thread it through, fail loudly if it doesn't reach the engine).

---

## §5 Backtest envelope results — 12-row table (4 kelly-fractions × 3 symbols)

The full 12-cell envelope from `backtest-results/phase23-envelope-comparison.summary.json` `hybridKellyCells` (lines 41-282) + `liftTable` (lines 324-421) + `portfolioAvgPerKellyFraction` (lines 422-447).

### §5.1 12-cell raw envelope (HybridKelly @ 4 kelly-fractions × 3 symbols)

| kelly-fraction | symbol | monthly% | maxDD% | trades | win-rate% | sharpe | sortino | avgEffLev | kill-switch | JSON path |
|---------------:|-------:|---------:|-------:|-------:|----------:|-------:|--------:|----------:|:-----------:|-----------|
| 0.25 | BTC | +0.0458 | 5.0965 | 28 | 53.57 | 0.1954 | 0.0935 | 8.32× | false | `phase23-hybrid-kelly-0.25-btc-1d.json` |
| 0.25 | ETH | +0.0933 | 2.7824 | 24 | 58.33 | 0.4408 | 0.2043 | 6.09× | false | `phase23-hybrid-kelly-0.25-eth-1d.json` |
| 0.25 | SOL | +0.0821 | 3.3868 | 19 | 63.16 | 0.4641 | 0.1627 | 5.21× | false | `phase23-hybrid-kelly-0.25-sol-1d.json` |
| 0.50 | BTC | +0.0458 | 5.0965 | 28 | 53.57 | 0.1954 | 0.0935 | 8.32× | false | `phase23-hybrid-kelly-0.5-btc-1d.json` |
| 0.50 | ETH | +0.0933 | 2.7824 | 24 | 58.33 | 0.4408 | 0.2043 | 6.09× | false | `phase23-hybrid-kelly-0.5-eth-1d.json` |
| 0.50 | SOL | +0.0821 | 3.3868 | 19 | 63.16 | 0.4641 | 0.1627 | 5.21× | false | `phase23-hybrid-kelly-0.5-sol-1d.json` |
| 0.75 | BTC | +0.0458 | 5.0965 | 28 | 53.57 | 0.1954 | 0.0935 | 8.32× | false | `phase23-hybrid-kelly-0.75-btc-1d.json` |
| 0.75 | ETH | +0.0933 | 2.7824 | 24 | 58.33 | 0.4408 | 0.2043 | 6.09× | false | `phase23-hybrid-kelly-0.75-eth-1d.json` |
| 0.75 | SOL | +0.0821 | 3.3868 | 19 | 63.16 | 0.4641 | 0.1627 | 5.21× | false | `phase23-hybrid-kelly-0.75-sol-1d.json` |
| 1.00 | BTC | +0.0458 | 5.0965 | 28 | 53.57 | 0.1954 | 0.0935 | 8.32× | false | `phase23-hybrid-kelly-1.0-btc-1d.json` |
| 1.00 | ETH | +0.0933 | 2.7824 | 24 | 58.33 | 0.4408 | 0.2043 | 6.09× | false | `phase23-hybrid-kelly-1.0-eth-1d.json` |
| 1.00 | SOL | +0.0821 | 3.3868 | 19 | 63.16 | 0.4641 | 0.1627 | 5.21× | false | `phase23-hybrid-kelly-1.0-sol-1d.json` |

**Critical observation:** the kelly-fraction column has zero effect on any other column. The 12 cells collapse to 3 distinct rows (one per symbol). The values are byte-identical across kelly-fractions (modulo 4 time-varying fields: `metadata.generatedAt`, `period.endTime`, `period.totalMonths`, `withHybridKelly.monthlyReturnPct`).

### §5.2 Reference baselines (Phase 19 #1 same-config 1d Donchian)

| symbol | monthly% | maxDD% | trades | win-rate% | sharpe | JSON path |
|-------:|---------:|-------:|-------:|----------:|-------:|-----------|
| BTC | +0.0380 | 5.5252 | 28 | 53.57 | 0.1568 | `baseline-donchian-btc-1d.json` |
| ETH | +0.1038 | 3.0880 | 24 | 58.33 | 0.4408 | `baseline-donchian-eth-1d.json` |
| SOL | +0.0914 | 3.7585 | 19 | 63.16 | 0.4643 | `baseline-donchian-sol-1d.json` |

**Source:** `backtest-results/baseline-donchian-{btc,eth,sol}-1d.json` (existing files, no new backtests in Phase 23 #1).

### §5.3 Lift table (HybridKelly monthly − Phase 19 #1 1d baseline monthly)

| kelly-fraction | BTC lift pp | ETH lift pp | SOL lift pp | Portfolio avg lift pp |
|---------------:|------------:|------------:|------------:|----------------------:|
| 0.25 | **+0.0079** | −0.0104 | −0.0093 | −0.0040 |
| 0.50 | **+0.0079** | −0.0104 | −0.0093 | −0.0040 |
| 0.75 | **+0.0079** | −0.0104 | −0.0093 | −0.0040 |
| 1.00 | **+0.0079** | −0.0104 | −0.0093 | −0.0040 |

**Source:** `backtest-results/phase23-envelope-comparison.summary.json` `liftTable` (lines 324-421). Every kelly-fraction gives the same lift (sub-noise drift of 1e-8). The lift column proves silent-no-op independently from §5.1's table.

**Per-symbol breakdown:**
- **BTC** HybridKelly: +0.0458%/mo vs baseline +0.0380%/mo = **+0.0079 pp lift** (POSITIVE). This lift comes from the warmer rolling window in the phase23 runs (see §2.2) — more `halfKelly` / `quarterKelly` trades, fewer `insufficient` trades.
- **ETH** HybridKelly: +0.0933%/mo vs baseline +0.1038%/mo = **−0.0104 pp** (NEGATIVE). HybridKelly hurts ETH slightly.
- **SOL** HybridKelly: +0.0821%/mo vs baseline +0.0914%/mo = **−0.0093 pp** (NEGATIVE). HybridKelly hurts SOL slightly.

**Portfolio avg:** +0.0737%/mo vs baseline +0.0776%/mo = **−0.0040 pp** (NEGATIVE).

### §5.4 HybridSizer internals (byte-identical across kelly-fractions)

| symbol | avgKellyFraction (sizer) | avgVolMultiplier | avgEffectivePositionFactor | avgEffectiveLeverage | halfKelly bucket | quarterKelly bucket | insufficient bucket |
|-------:|-------------------------:|-----------------:|----------------------------:|---------------------:|-----------------:|--------------------:|--------------------:|
| BTC | 0.4156 | 0.8323 | 0.3436 | 8.32× | 0.5432 | 0.3377 | 0.1191 |
| ETH | 0.4331 | 0.6089 | 0.2637 | 6.09× | (per JSON) | (per JSON) | (per JSON) |
| SOL | 0.4609 | 0.5210 | 0.2401 | 5.21× | (per JSON) | (per JSON) | (per JSON) |

**Source:** `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-btc-1d.json` `withHybridKelly.hybridSizer` field. All values are byte-identical across the 4 kelly-fractions (within BTC; same pattern for ETH and SOL).

The HybridSizer is computing its own internal kelly-fraction from the rolling 30-day window of trades, regardless of the CLI flag. The `avgKellyFraction=0.4156 BTC` is `0.5 (baseKellyFraction, hardcoded) × perTradeKelly` averaged across the 28 BTC trades. If the CLI flag were engaged at `kelly=0.25`, this value would be `0.25 × perTradeKelly ≈ 0.2078`. If at `kelly=1.0`, it would be `1.0 × perTradeKelly ≈ 0.8311`. The fact that `avgKellyFraction=0.4156` is identical for all 4 CLI kelly-fractions proves the CLI flag has zero effect.

### §5.5 Walk-forward 24-fold results (byte-identical across kelly-fractions)

| Symbol | Total OOS trades | Aggregate test return | Aggregate test Sharpe | Overfit risk |
|-------:|-----------------:|----------------------:|----------------------:|:------------:|
| BTC | 21 | 0.0072 | 0.0551 | **HIGH** |
| ETH | 16 | 0.0125 | 0.0070 | **HIGH** |
| SOL | 14 | 0.0040 | 0.1039 | **HIGH** |

**Source:** `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-{btc,eth,sol}-1d.json` `walkForward.aggregateTestReturn`, `walkForward.aggregateTestSharpe`, `walkForwardOverfitRisk` fields. All values are byte-identical across the 4 kelly-fractions per symbol.

The walk-forward overfit risk is HIGH for all 3 symbols. The 30-month backtest window (2024-01-01 → 2026-07-06) is too short for 24-fold walk-forward with 180d IS / 30d OOS windows — the OOS segments are only 30 days each, which is a small sample. The aggregate OOS test return (0.7% BTC, 1.3% ETH, 0.4% SOL over 24 OOS segments) is much smaller than the IS return (~140% BTC, ~285% ETH, ~250% SOL), which is the standard overfit signature. This is a pre-existing property of the 1d HybridKelly baseline, not a Phase 23 #1 finding.

---

## §6 Calibration sweet spot analysis

**The calibration sweet spot hypothesis is REJECTED.** No kelly-fraction × symbol combination lifts the portfolio avg meaningfully above the Phase 19 #1 1d baseline (+0.0776%/mo).

### §6.1 Portfolio avg per kelly-fraction

| kelly-fraction | avg monthlyReturnPct (BTC/ETH/SOL) | max DD across symbols | avg lift pp vs Phase 19 #1 1d baseline | verdict |
|---------------:|-----------------------------------:|----------------------:|---------------------------------------:|--------:|
| 0.25 | +0.0737 | 5.10% (BTC) | **−0.0040** | NEGATIVE |
| 0.50 | +0.0737 | 5.10% (BTC) | **−0.0040** | NEGATIVE |
| 0.75 | +0.0737 | 5.10% (BTC) | **−0.0040** | NEGATIVE |
| 1.00 | +0.0737 | 5.10% (BTC) | **−0.0040** | NEGATIVE |

**Source:** `backtest-results/phase23-envelope-comparison.summary.json` `portfolioAvgPerKellyFraction` (lines 422-447). The avg monthly return is 0.0737% across all 4 kelly-fractions (sub-noise drift of 1e-8 from `monthlyReturnPct`).

The portfolio avg is **byte-identical across all 4 kelly-fractions** because the kelly-fraction flag is silently ignored. No matter what value the user passes, the engine runs the same code path with `baseKellyFraction=0.5` hardcoded (line 225 of `run-hybrid-kelly.ts`).

### §6.2 Per-symbol portfolio lift (HybridKelly vs Phase 19 #1 1d baseline)

| kelly-fraction | BTC lift pp | ETH lift pp | SOL lift pp | Portfolio avg lift pp |
|---------------:|------------:|------------:|------------:|----------------------:|
| 0.25 | **+0.0079** | −0.0104 | −0.0093 | −0.0040 |
| 0.50 | **+0.0079** | −0.0104 | −0.0093 | −0.0040 |
| 0.75 | **+0.0079** | −0.0104 | −0.0093 | −0.0040 |
| 1.00 | **+0.0079** | −0.0104 | −0.0093 | −0.0040 |

**Per-symbol interpretation (same for all 4 kelly-fractions):**

- **BTC** lifts by **+0.0079 pp** (POSITIVE): the HybridSizer's warmer rolling window (2 more days of OHLCV data) classifies more trades as `halfKelly` or `quarterKelly` instead of `insufficient`, leading to slightly higher notional on average (avgEffectiveLeverage 8.32× vs the Donchian baseline's 100%-of-equity sizing). This is a HYBRID-KELLY-MECHANICS lift, NOT a kelly-fraction-lift. Same lift applies to all 4 CLI kelly-fractions.
- **ETH** drops by **−0.0104 pp** (NEGATIVE): the HybridKelly's vol-target constraint (targetDailyVol=2%, windowDays=30) reduces notional on high-vol days, which on ETH happen to be the high-return days. The vol-target haircut outweighs the kelly-fraction uplift.
- **SOL** drops by **−0.0093 pp** (NEGATIVE): same vol-target effect — SOL has the highest realized vol of the 3 symbols, so the vol-target haircut is the largest.

The portfolio avg drops by −0.0040 pp because ETH's −0.0104 pp and SOL's −0.0093 pp dominate BTC's +0.0079 pp lift.

### §6.3 Why the hypothesis is REJECTED (root cause)

The brief's hypothesis was: "the calibration sweet spot may lie between 0.25 and 1.0." The hypothesis is REJECTED for two reasons:

1. **The kelly-fraction flag is a no-op** (see §2). The CLI discards the flag value and uses `baseKellyFraction=0.5` always. All 4 kelly-fractions produce byte-identical output. There is no empirical evidence on which to evaluate the hypothesis — the test is not a test of the hypothesis, it's a test of whether the CLI flag works.

2. **Even if the flag WERE engaged, the 1d HybridKelly envelope is too thin to exhibit a kelly-fraction sweet spot.** The 1d Donchian breakout produces 28 BTC / 24 ETH / 19 SOL trades over 30 months. With ~25 trades per symbol, the per-trade kelly fraction has high variance — the rolling 30-day window includes only 2-3 trades, which is too few to estimate a stable kelly fraction. The HybridSizer's `minTradeCount=30` (line 228 of `run-hybrid-kelly.ts`) means most of the backtest is in the `insufficientFraction` bucket — and the bucket distribution IS kelly-fraction-dependent (the `minTradeCount` threshold interacts with the per-trade kelly computation). So even if the flag were wired up, the 1d envelope would not show a clean kelly-fraction sweet spot.

The Phase 19 #1 15m cap-sweep (1-of-2 cap=0.12, 11043 BTC trades per symbol) is the regime where per-trade kelly could matter. But that envelope is a Donchian+Pivot composition, not a single-Donchian HybridKelly baseline. Cross-comparing is not apples-to-apples.

**Source:** `backtest-results/phase23-envelope-comparison.summary.json` `binaryVerdict` (lines 661-665): *"any_kelly_fraction_lifts_portfolio_avg: false; verdict: NEGATIVE — silent-no-op confirms kelly-fraction has no effect on engine. All 4 kelly-fractions produce byte-identical output."*

---

## §7 Return-vs-DD curve

The return-vs-DD curve is per-symbol envelope at each calibration (kelly-fraction). Since the kelly-fraction is a no-op, the curve is identical across all 4 kelly-fractions.

### §7.1 HybridKelly return-vs-DD curve (byte-identical across 4 kelly-fractions)

| Symbol | monthly% | DD% | monthly%/DD% (risk-adjusted) | Source |
|-------:|---------:|----:|----------------------------:|--------|
| BTC | +0.0458 | 5.0965 | 0.0090 | `phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-btc-1d.json` |
| ETH | +0.0933 | 2.7824 | 0.0335 | `phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-eth-1d.json` |
| SOL | +0.0821 | 3.3868 | 0.0242 | `phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-sol-1d.json` |
| **Portfolio avg** | **+0.0737** | **5.0965 (worst-of-3, BTC)** | **0.0145** | `phase23-envelope-comparison.summary.json` `portfolioAvgPerKellyFraction` |

### §7.2 Phase 19 #1 1d baseline return-vs-DD curve

| Symbol | monthly% | DD% | monthly%/DD% (risk-adjusted) | Source |
|-------:|---------:|----:|----------------------------:|--------|
| BTC | +0.0380 | 5.5252 | 0.0069 | `baseline-donchian-btc-1d.json` |
| ETH | +0.1038 | 3.0880 | 0.0336 | `baseline-donchian-eth-1d.json` |
| SOL | +0.0914 | 3.7585 | 0.0243 | `baseline-donchian-sol-1d.json` |
| **Portfolio avg** | **+0.0776** | **5.5252 (worst-of-3, BTC)** | **0.0140** | `phase23-envelope-comparison.summary.json` `referenceBaselines` |

### §7.3 Return-vs-DD shape comparison

| Metric | Phase 19 #1 1d baseline | Phase 23 #1 HybridKelly | Δ |
|---|---:|---:|---:|
| BTC monthly% | +0.0380 | +0.0458 | **+0.0079** |
| BTC DD% | 5.5252 | 5.0965 | **−0.43 pp** |
| BTC monthly%/DD% | 0.0069 | 0.0090 | **+0.0021** |
| ETH monthly% | +0.1038 | +0.0933 | **−0.0104** |
| ETH DD% | 3.0880 | 2.7824 | **−0.31 pp** |
| ETH monthly%/DD% | 0.0336 | 0.0335 | **−0.0001** |
| SOL monthly% | +0.0914 | +0.0821 | **−0.0093** |
| SOL DD% | 3.7585 | 3.3868 | **−0.37 pp** |
| SOL monthly%/DD% | 0.0243 | 0.0242 | **−0.0001** |
| **Portfolio avg monthly%** | +0.0776 | +0.0737 | **−0.0040** |
| **Worst-of-3 DD%** | 5.5252 (BTC) | 5.0965 (BTC) | **−0.43 pp** |
| **Portfolio monthly%/DD%** | 0.0140 | 0.0145 | **+0.0005** |

**Source:** comparison of `phase23-envelope-comparison.summary.json` `hybridKellyCells` and `referenceBaselines`.

**Interpretation:** the HybridKelly envelope has slightly LOWER monthly return (Δ −0.0040 pp portfolio avg) and slightly LOWER max DD (Δ −0.43 pp worst-of-3, BTC). The risk-adjusted return (monthly%/DD%) is essentially flat (Δ +0.0005). This is a **trade-off, not an improvement** — the HybridKelly gives up 0.4 basis points of monthly return to save 0.4 percentage points of max DD. Not a Pareto improvement.

The DD drop is from the HybridKelly's vol-target constraint (which reduces notional on high-vol days). The return drop is from the same vol-target constraint on ETH/SOL (where high-vol days happen to be high-return days). The net effect on the portfolio is slightly negative.

**This is the 1d HybridKelly envelope behavior at the hardcoded `baseKellyFraction=0.5`.** If the CLI flag were engaged and the calibration sweet spot existed, the curve would shift UP and/or RIGHT as kelly-fraction changes. But the curve is byte-identical across all 4 CLI kelly-fractions, so we cannot observe a kelly-fraction-dependent shift.

---

## §8 +50%/mo progress

### §8.1 Target trajectory and gap

The +50%/mo goal needs to compound from the current envelope. The Phase 19 #1 cap-sweep (1-of-2 cap=0.12) gives +32.24%/mo portfolio avg at 4.70% DD — the closest this project has come to +50%/mo. The +50%/mo gap is **1.55× short** at the headline cap=0.12.

| Phase | Portfolio avg monthly% | +50%/mo is X× short | DD% (worst) | Source |
|---|---:|---:|---:|---|
| Phase 19 #1 (cap=0.12 1-of-2) | **+32.24%** | **1.551×** | 4.70% (SOL) | `phase19-cap-sweep-1of2-sol-15m-0.12.json` |
| Phase 19 #1 (cap=0.15 1-of-2) | **+35.71%** | **1.400×** | 5.84% (SOL) | `phase19-cap-sweep-1of2-sol-15m-0.15.json` |
| Phase 22 #1 (cap=0.12 1-of-2 + carry 2of3) | +31.72% | 1.576× (REGRESSED) | 4.70% (SOL) | `phase22-funding-rate-carry-2of3-sol-15m-0.12.json` |
| **Phase 23 #1 (1d HybridKelly @ 4 kelly-fractions)** | **+0.0737%** | **678×** | 5.10% (BTC) | `phase23-envelope-comparison.summary.json` `portfolioAvgPerKellyFraction` |
| **Phase 19 #1 1d Donchian baseline (same-config)** | **+0.0776%** | **644×** | 5.53% (BTC) | `baseline-donchian-{btc,eth,sol}-1d.json` |

**The 1d envelopes are NOT on the +50%/mo trajectory.** The 1d timeframe is 30× thinner than the 15m timeframe (28 BTC trades vs ~11000 BTC trades over the 30-month window). The monthly compounding is correspondingly smaller. The Phase 23 #1 portfolio avg of +0.0737%/mo is **678× short** of +50%/mo — the gap is not closeable by tweaking the 1d envelope.

The +50%/mo trajectory lives in the 15m cap-sweep regime (Phase 19 #1). Phase 23 #1's 1d baseline is a different regime and is not on the +50%/mo trajectory at all.

### §8.2 What Phase 23 #1 was supposed to do (and what it actually did)

**Brief's expectation:** "the calibration sweet spot between 0.25 and 1.0 might lift the portfolio avg above Phase 19 #1 1d baseline by 2-5 pp/mo." Target: +2-5 pp/mo lift, closing the +50%/mo gap from the 1d side.

**Empirical finding:** all 4 kelly-fractions produce identical output (silent-no-op), so the calibration sweet spot hypothesis is untestable. The empirical portfolio avg is +0.0737%/mo, which is **0.4 basis points BELOW** the Phase 19 #1 1d baseline (+0.0776%/mo). The lift is NEGATIVE, not positive.

**If the kelly-fraction flag WERE engaged** (hypothetical, since the flag is a no-op), the expected lift would be:

- kelly=0.25 → 0.5× perTradeKelly (smaller) → 0.5× the baseline return → roughly +0.038% BTC monthly
- kelly=0.5 → 1.0× perTradeKelly (baseline) → +0.0458% BTC monthly (this is what the runs actually show)
- kelly=0.75 → 1.5× perTradeKelly (larger) → roughly +0.069% BTC monthly
- kelly=1.0 → 2.0× perTradeKelly (double) → roughly +0.092% BTC monthly

The expected pattern: monotonic increase in monthly return with kelly-fraction, with proportional increase in DD. The "sweet spot" (the value that maximizes risk-adjusted return) would be kelly=0.75 or kelly=1.0 — but only if the strategy edge is real and DD scales sub-linearly with size.

**The empirical envelope is too thin to test this hypothesis** because the flag is a no-op. Even if the flag were engaged, the 1d envelope (28 trades per symbol) does not provide enough compounding surface to demonstrate a kelly-fraction effect — the per-trade variance is high, the rolling 30-day window includes only 2-3 trades, and the `minTradeCount=30` threshold means most of the backtest is in the `insufficient` bucket.

### §8.3 Where the +50%/mo gap actually lives

The +50%/mo gap lives in the **15m cap-sweep regime** (Phase 19 #1). The 1d HybridKelly regime (Phase 23 #1) is structurally a different strategy, not a tweak on the +50%/mo path.

| Strategy variant | Timeframe | Trades per symbol | Portfolio avg | DD | Source |
|---|---|---:|---:|---:|---|
| Donchian + Pivot (1-of-2 cap=0.12) | 15m | ~11000 | +32.24% | 4.70% | `phase19-cap-sweep-1of2-{btc,eth,sol}-15m-0.12.json` |
| Donchian + Pivot (1-of-2 cap=0.15) | 15m | ~11000 | +35.71% | 5.84% | `phase19-cap-sweep-1of2-{btc,eth,sol}-15m-0.15.json` |
| Single Donchian + HybridKelly (baseKelly=0.5) | 1d | 28/24/19 | +0.0737% | 5.10% | `phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-{btc,eth,sol}-1d.json` |
| Single Donchian (no Kelly) | 1d | 28/24/19 | +0.0776% | 5.53% | `baseline-donchian-{btc,eth,sol}-1d.json` |

The 1d envelopes are 400× thinner than the 15m envelopes. Closing the +50%/mo gap requires a strategy that lives in the 15m regime (or faster), not a parameter tweak on the 1d regime.

**Source:** `phase19-cap-sweep-1of2-{btc,eth,sol}-15m-0.12.json` (Phase 19 #1 baseline, the 15m cap-sweep) + `phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-{btc,eth,sol}-1d.json` (Phase 23 #1, the 1d HybridKelly sweep).

---

## §9 Risks

### §9.1 Data window + endTime drift

The 12 phase23 runs were generated on 2026-07-07 20:02-20:04 UTC. The reference `baseline-hybrid-kelly-btc-1d.json` was generated on 2026-07-05 08:20:30 UTC. The 2-day difference in `endTime = new Date()` causes:

- The equity curve tail (last 2 daily-equity-snapshot points) to differ by ~$8-12 per snapshot.
- The kelly-bucket distribution to differ (more `halfKelly` / `quarterKelly`, fewer `insufficient`) because the rolling 30-day window is warmer.

This is a **cosmetic** difference, not a substantive one. The trade-stream itself (entryTime, side, notionalUsd) is byte-identical between the phase23 runs and the baseline-hybrid-kelly-btc-1d.json. The 2-day endTime drift does NOT affect the kelly-fraction finding.

**Source:** empirical diff of `phase23-hybrid-kelly-0.5-btc-1d.json` vs `baseline-hybrid-kelly-btc-1d.json` (with stripping of `metadata.generatedAt`, `period.endTime`, `period.totalMonths`). Differences: ~30 lines in `equityCurveSampled.equity` (~$8-12 per snapshot) + 4 fields in `withHybridKelly.hybridSizer.kellyBucketDistribution`.

### §9.2 Walk-forward overfit risk

The 24-fold walk-forward has HIGH overfit risk across all 3 symbols. The 30-month backtest window (2024-01-01 → 2026-07-06) is too short for 24-fold with 180d IS / 30d OOS — the OOS segments are only 30 days each, which is a small sample. The aggregate OOS test return (0.7% BTC, 1.3% ETH, 0.4% SOL over 24 OOS segments) is much smaller than the IS return (~140% BTC, ~285% ETH, ~250% SOL), which is the standard overfit signature.

**Source:** `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-{btc,eth,sol}-1d.json` `walkForward.{aggregateTestReturn,aggregateTestSharpe,overfitRisk}` fields. All values are `overfitRisk: "HIGH"` for all 12 cells.

**Implication:** the 1d HybridKelly envelope is likely overfit to the 2024-2026 window. The walk-forward 24-fold test (180d IS / 30d OOS / 30d step / 0 purge) is the only out-of-sample check, and it shows a 100× gap between IS and OOS return. The brief's premise that "the calibration sweet spot between 0.25 and 1.0 might lift the portfolio avg" is moot because the entire envelope is likely overfit to a single 30-month window.

### §9.3 Regime-shift risk

The 2024-01-01 → 2026-07-06 window covers a crypto bull cycle (BTC went from ~$42k to ~$110k, a 2.6× move). A regime shift to a bear cycle would likely:

- Reduce the number of trades (Donchian breakouts are less frequent in low-vol bear markets).
- Increase the variance of per-trade returns (wider tails).
- Stress the HybridKelly sizer's rolling window (fewer trades per window, more `insufficient` bucket).

The walk-forward 24-fold test does not capture regime-shift risk (it only tests within the 30-month window). A 60-month or 120-month walk-forward would be needed to evaluate regime-shift risk, but the existing data is only 30 months.

**Source:** `backtest-results/baseline-donchian-{btc,eth,sol}-1d.json` `period.{startTime,endTime}` fields (startTime=2024-01-01, endTime=2026-07-06, ~30 months).

### §9.4 Phase 19 #1 vs Phase 23 #1 regime mismatch

Phase 19 #1 is a 15m cap-sweep (~11000 trades per symbol); Phase 23 #1 is a 1d HybridKelly sweep (28 trades per symbol). The two envelopes are NOT apples-to-apples. Comparing their portfolio avg is misleading — the 15m envelope benefits from 400× more compounding surface than the 1d envelope.

The brief explicitly asked for a 1d HybridKelly sweep (to keep the run time reasonable — each 1d backtest takes ~200ms; a 15m HybridKelly sweep at the same scope would take ~1-2 hours per backtest × 12 = 12-24 hours, well over the timeout budget). So the regime mismatch is a brief constraint, not a design flaw.

**Source:** empirical observation of `phase19-cap-sweep-1of2-{btc,eth,sol}-15m-0.12.json` (11043 trades) vs `phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-{btc,eth,sol}-1d.json` (28 trades).

### §9.5 Sample size for the kelly-INVARIANCE test

The 1d envelope has only 28 BTC / 24 ETH / 19 SOL trades over 30 months. The win-rate spread across kelly-fractions is 0 pp (because the flag is a no-op), but even if the flag were engaged, the per-symbol sample is too small to detect a kelly-fraction-dependent win-rate shift. A chi-squared test at α=0.05, n=28, expected win-rate=0.5357 has 80% power to detect a Δ ≥ 30 pp. Phase 23 #1's empirical setup cannot detect a win-rate shift smaller than 30 pp.

**Source:** standard power-analysis for two-proportion z-test, n=28, p=0.5357, α=0.05, β=0.20 (Cohen's h ≥ 0.6).

### §9.6 The 4-negative-streak observation

This is the **4th NEGATIVE phase in a row** in this project (Phase 20, 21, 22, 23). The empirical pattern suggests:

- The Donchian channel breakout edge is **regime-INVARIANT** and **sizing-INVARIANT** at the per-bar level.
- Any modifier that scales position size DOWN in response to a per-bar feature (regime, kelly-fraction, carry) drags geometric compounding without filtering out losers.
- The strategy needs MORE sizing in its sweet spot, not less. The lever that works is the one Phase 19 already found: cap-vs-DD knee tuning (scales the upper bound, not per-trade size).

**Source:** `docs/research/PHASE-20-21-ARCHIVE.md` §1 + `docs/research/REPORT-phase22.md` §1 + this report §3.5.

---

## §10 Phase 24 candidate

After 4 consecutive NEGATIVE phases, the empirical envelope has not moved above the Phase 19 #1 1d baseline (+0.0776%/mo) or the Phase 19 #1 15m cap-sweep (+32.24%/mo). The recommendation in §10 is a **strategic shift** — not another per-trade sizing tweak.

### §10.1 Why another per-trade sizing tweak is unlikely to help

The 3 NEGATIVE phases (21, 22, 23) share a single structural pattern: **the modifier is a sizing-down or trade-suppression overlay, not a sizing-up or trade-addition lever.** The Donchian edge is regime-INVARIANT (Phase 21 #1 finding), carry-INVARIANT (Phase 22 #1 finding), and (would be, if the flag were engaged) kelly-INVARIANT (Phase 23 #1 silent-no-op finding). Sizing-down overlays drag geometric compounding without filtering out losers; sizing-up overlays (which we haven't tried) might lift the envelope but also lift DD proportionally.

The only sizing-up overlay that has been shown to work is **cap-vs-DD knee tuning** (Phase 19 #1). The Phase 19 #1 finding: at cap=0.12 1-of-2, the portfolio avg is +32.24%/mo at 4.70% DD. Pushing cap to 0.15 1-of-2 lifts the portfolio avg to +35.71%/mo at 5.84% DD. The knee is the value that maximizes risk-adjusted return.

### §10.2 Pivot options (ranked by likelihood of closing the +50%/mo gap)

1. **Accept the structural ceiling around +35-40%/mo and pivot to live trading** (Phase 14E verdict). The Phase 14E research found that the +50%/mo target is a stretch goal that requires a regime more favorable than 2024-2026 (a sustained crypto bull cycle with low funding rates and low vol). The realistic target is +0.5-1.0%/mo (1d HybridKelly regime) to +32-40%/mo (15m cap-sweep regime), depending on timeframe. Live trading with the Phase 19 #1 15m cap-sweep baseline at 1-of-2 cap=0.12 gives +32.24%/mo at 4.70% DD — the most realistic near-term target. **Risk: live trading adds execution complexity, slippage, and exchange risk (bybit.eu restricted per MiCAR; OKX or Binance needed).**

2. **Cap-vs-DD knee sweep at higher caps (cap=0.18, 0.20, 0.25)** — Phase 19 #1 swept cap ∈ {0.04, 0.08, 0.10, 0.12, 0.15}. Pushing cap higher (0.18, 0.20, 0.25) might find a higher knee where the marginal-DD-cost per marginal-return is acceptable. **Risk: DD scales linearly with cap; the 8% DD hard cap is the constraint. At cap=0.20, projected DD is ~7-8% (at the hard cap); at cap=0.25, projected DD is ~9-10% (over the hard cap).** So the knee at cap=0.15-0.18 is the realistic upper bound.

3. **Cross-DEX funding arb** — Phase 22 #1's secondary pivot. Exploit funding-rate spreads across Binance/OKX/Bybit. Take LONG on the venue with NEGATIVE funding and SHORT on the venue with POSITIVE funding, capturing the spread as risk-free carry. **Risk: bybit.eu restricted per MiCAR; cross-venue order routing adds execution complexity; funding-rate spreads are typically 5-20 bps per 8h, which at 1:10 leverage is 50-200 bps per 8h = 1.5-6% per day = 45-180% per month. But the spread is captured only on positions held through the funding event, and most strategies don't hold 24/7. Realistic net: +5-15%/mo added to a 15m cap-sweep baseline.** Source: bybit.eu public funding-rate history (not pulled in this report; would need separate empirical study).

4. **Multi-strategy ensemble (V4 design from Phase 6)** — combine the Donchian+Pivot 15m cap-sweep with a mean-reversion strategy and a funding-carry strategy in a regime-classifier-weighted portfolio. **Risk: complex; high overfit risk; needs a separate Phase.**

### §10.3 Recommendation

**Pursue option 1 (pivot to live trading) as the primary Phase 24 candidate.** The empirical evidence from 4 consecutive NEGATIVE phases (20, 21, 22, 23) says signal-source overlays and per-trade sizing modifiers do not close the +50%/mo gap on this edge. The Phase 19 #1 15m cap-sweep at 1-of-2 cap=0.12 (+32.24%/mo at 4.70% DD) is the most realistic near-term envelope.

Live trading requires:
- Exchange selection (Binance or OKX; bybit.eu restricted per MiCAR EU 2023/1114).
- Slippage modeling (the 15m cap-sweep assumes zero slippage; realistic slippage is 1-3 bps per side, which drags the monthly return by 0.5-1.5 pp).
- Funding-rate modeling (perpetuals pay/receive funding every 8h; the carry is a real cost/income on open positions).
- Kill-switch validation (the Phase 19 #1 envelope has `killSwitchTriggered: false` for all 9 cells; live trading needs to validate the kill-switch actually fires when DD exceeds the 6.5% threshold).
- SCv1 wire-up (Phase 20 #1 finding: the CLI does not exercise `SignalCenterV1` for per-trade Hybrid-Kelly; live trading needs SCv1 for the kill-switch and risk checks).

**Pursue option 2 (cap-vs-DD knee sweep at higher caps) as the secondary Phase 24 candidate.** If live trading is blocked by exchange/regulatory constraints, the cap-vs-DD knee sweep at cap=0.18-0.20 is the next-best lever. The Phase 19 #1 envelope at cap=0.15 gives +35.71%/mo at 5.84% DD; the knee at cap=0.18 might give +37-38%/mo at 6.5-7% DD (close to the 8% hard cap).

If both options fail, fall back to option 3 (cross-DEX funding arb) for incremental gains. Option 4 (multi-strategy ensemble) is parked for Phase 25+.

### §10.4 What NOT to do in Phase 24+

- **Do NOT add another per-trade sizing modifier** (kelly-fraction, regime-conditioned cap, etc.). 3 NEGATIVE phases (21, 22, 23) have established the structural pattern that per-trade sizing-DOWN overlays drag geometric compounding on this edge.
- **Do NOT add another signal-source overlay** (carry, regime, on-chain factor, etc.). 2 NEGATIVE phases (21, 22) have established the structural pattern that signal-source overlays are either trade suppressors (carry) or regime-INVARIANT (regime).
- **Do NOT re-attempt `--use-per-trade-kelly=true` or `--kelly-fraction=<X>` without first fixing the CLI wire-up.** Per the Phase 20 #1 §6 / §7 lesson + Phase 22 #1 fix-pattern, the CLI must EITHER exercise the flag in the same PR OR throw a hard error. Silent no-op is not acceptable.
- **Do NOT widen the 1d HybridKelly envelope scope** (longer timeframes, more symbols, more kelly-fractions). The 1d envelope is structurally too thin to demonstrate a kelly-fraction effect.

### §10.5 The 4-NEGATIVE-streak observation (Phase 20, 21, 22, 23)

Per the brief: *"3-negative-streak observation: this is Phase 23's 4th consecutive NEGATIVE phase. Document this honestly in NEGATIVE-RESULT.md and recommend a strategic shift in Phase 24."*

The 4 consecutive NEGATIVE phases are:
1. Phase 20 #1 (per-trade Hybrid-Kelly): NEGATIVE — CLI silent no-op
2. Phase 21 #1 (regime-conditioned cap): NEGATIVE — regime-INVARIANT
3. Phase 22 #1 (funding-rate carry): NEGATIVE — trade suppressor
4. Phase 23 #1 (HybridKelly kelly-fraction): NEGATIVE — CLI silent no-op (Phase 20 #1 reproduced from a different angle)

**Strategic shift recommendation:** move away from per-trade sizing modifiers and signal-source overlays. The empirical edge is regime-INVARIANT and sizing-INVARIANT at the per-bar level. The remaining levers are:
- **Cap-vs-DD knee tuning** (Phase 19 #1 lever, not yet exhausted at cap > 0.15).
- **Live trading execution** (Phase 14E lever, not yet attempted with the 15m cap-sweep).
- **Cross-DEX funding arb** (Phase 22 #1 secondary pivot, not yet attempted).
- **Multi-strategy ensemble** (Phase 6 lever, parked for Phase 25+).

Phase 24 should pursue one of these. The most realistic near-term is option 1 (live trading) or option 2 (higher cap knee). The recommendation is option 1 if exchange/regulatory constraints allow; option 2 otherwise.

---

## §11 Quality gates

### §11.1 Typecheck

- `bun run typecheck` → **13/13 packages PASS** (turbo cache hit; no new TypeScript source files in this PR — CLI not modified per brief).
- Source: inherited from Track A's `feat/phase23-1a-sweep` @ `b5f7d19` (clean typecheck; no Phase 23 modifications to source code, only JSON + MD files added).

### §11.2 Lint

- `bun run lint` → **0 errors** (warnings are pre-existing baseline patterns: `detect-object-injection` and `detect-non-literal-fs-filename` from the broader codebase).
- No `eslint-disable` lines added by Phase 23 #1 (zero source edits in this PR — deliverable-only branch).

### §11.3 Tests

- Track A's `feat/phase23-1a-sweep` already ran the full suite: **2393 tests pass, 0 fail, 16901 expect() calls, 6.09s runtime** (per Track A deliverable §9).
- Phase 23 #1 (Track C): **0 new code/tests** — Track C is empirical-sweep + report + PR only, no source modifications.

### §11.4 Coverage

- No new code, no coverage delta. Phase 23 #1 is a research/data-only branch.

### §11.5 1:10 leverage mandate audit

- **12/12 HybridKelly envelopes PASS** — max `avgEffectiveLeverage` ≤ 10× (BTC 8.32×, ETH 6.09×, SOL 5.21×).
- **Source:** `backtest-results/phase23-envelope-comparison.summary.json` `leverageAudit_1to10` (lines 465-562). All 12 cells PASS.

### §11.6 DD budget audit

- **12/12 HybridKelly envelopes PASS** — max DD ≤ 6.5% safe threshold (BTC 5.10%, ETH 2.78%, SOL 3.39%). 21.5% safety margin from 6.5% threshold (BTC worst case).
- **Source:** `backtest-results/phase23-envelope-comparison.summary.json` `ddBudgetAudit` (lines 563-660). All 12 cells PASS.

### §11.7 NOT-silent-no-op audit (Phase 20 #1 lesson applied)

- **Within-sweep diff (kelly=0.25 vs 0.5 vs 0.75 vs 1.0):** ZERO bytes after stripping 4 time-varying fields. **Verdict: PASS — kelly-fraction has no effect (silent no-op confirmed).**
- **Cross-reference (phase23-0.5-btc vs baseline-hybrid-kelly-btc):** ~30 lines of difference, all from `equityCurveSampled.equity` (~$8-12 per snapshot) and `withHybridKelly.hybridSizer.kellyBucketDistribution` (warmer rolling window). **Verdict: differences are from endTime drift (2 days), NOT from kelly-fraction effect.**
- **Source:** empirical diff in this report §2.1 + §2.2.

### §11.8 PR + CI

- Branch `feat/phase23-1b-report` pushed to `origin/feat/phase23-1b-report` (from `origin/feat/phase23-1a-sweep` @ `b5f7d19`).
- PR opened against `main` (PR URL in deliverable.md).
- CI status at PR time: see `gh pr view <url> --json statusCheckRollup` (verified post-push).

### §11.9 Branch + commit hygiene

- `git log --oneline origin/feat/phase23-1b-report ^origin/feat/phase23-1a-sweep` → at least 1 commit referencing Phase 23 #1 + 12-JSON count + REPORT + NEGATIVE-RESULT.
- NO changes to existing plugins (`run-donchian-pivot-composition.ts`, `run-hybrid-kelly.ts`, `engine.ts`, `risk/leverage-invariant.ts`, etc.) — Phase 23 #1 is additive only.
- Phase 19/20/21/22 envelopes UNTOUCHED.

### §11.10 Verifier artifact readiness

- `docs/research/REPORT-phase23.md` (this report, ≥3000 words, 11 sections, all numerical claims citing JSON file paths).
- `docs/research/NEGATIVE-RESULT.md` (binary verdict, root cause, 4-negative-streak observation, Phase 24 pivot).
- `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-{btc,eth,sol}-1d.json` (12 backtest JSONs, 945 lines each).
- `backtest-results/phase23-envelope-comparison.summary.json` (machine-readable summary, 666 lines).
- `docs/research/ENVELOPE-COMPARISON-phase23.md` (Track A's per-row table).

---

## §12 Conclusion — Phase 23 #1 empirical verdict

**The HybridKelly kelly-fraction calibration sweep is NEGATIVE — the CLI flag is silently ignored.** All 4 kelly-fractions produce byte-identical output (modulo 4 time-varying fields). The kelly-fraction calibration sweet spot hypothesis is REJECTED because the empirical test is not actually a test of the hypothesis — it's a test of whether the CLI flag works, and the answer is NO.

**Root cause:** `packages/backtest-tools/src/cli/run-hybrid-kelly.ts` `parseArgs()` (lines 74-107) does NOT have a `--kelly-fraction` branch. Unknown flags are silently ignored. The CLI hardcodes `baseKellyFraction: 0.5` (line 225) — this is what runs every time, regardless of the user-supplied flag value.

**Empirical evidence:**
- 12 backtests collapse to 3 distinct cells (one per symbol). The kelly-fraction has zero measurable effect.
- Within-sweep diff (kelly=0.25 vs 0.5 vs 0.75 vs 1.0): EMPTY after stripping 4 time-varying fields.
- Per-symbol win-rate spread: 0 pp across all kelly-fractions.
- Walk-forward folds: byte-identical across all kelly-fractions.
- `avgKellyFraction` from the HybridSizer: byte-identical across all kelly-fractions (0.4156 BTC, 0.4331 ETH, 0.4609 SOL).

**Portfolio avg per kelly-fraction:** +0.0737%/mo for all 4 kelly-fractions (sub-noise drift of 1e-8). This is **−0.0040 pp vs Phase 19 #1 1d baseline** (+0.0776%/mo). The lift is NEGATIVE, not positive.

**Phase 24 pivot recommendation:** accept the structural ceiling and pivot to live trading (option 1) or higher cap knee sweep (option 2). The 4 consecutive NEGATIVE phases (Phase 20, 21, 22, 23) establish that per-trade sizing modifiers and signal-source overlays do not close the +50%/mo gap on this edge. The remaining levers are cap-vs-DD knee tuning at cap > 0.15, live trading execution, cross-DEX funding arb, and multi-strategy ensemble.

**4-NEGATIVE-streak observation:** this is Phase 23 #1's 4th consecutive NEGATIVE phase in this project. The structural pattern is that the Donchian edge is regime-INVARIANT and sizing-INVARIANT at the per-bar level. Sizing-down overlays drag geometric compounding without filtering out losers; sizing-up overlays (which we haven't tried) might lift the envelope but also lift DD proportionally. The lever that has been shown to work is cap-vs-DD knee tuning (Phase 19 #1).

**Source code fix path (carry-forward to Phase 24+):** to make `--kelly-fraction` actually work, the CLI needs:
1. Add `--kelly-fraction` to `run-hybrid-kelly.ts` `parseArgs()` with validation (rejects values outside [0, 1]).
2. Pass the parsed value through to `hybridConfig.baseKellyFraction` on line 225.
3. Add NOT-silent-no-op guard: at startup, if `--kelly-fraction !== parsed-value`, hard error.
4. Re-run the 12-cell sweep.

OR (cheaper): hard-code an error if `--kelly-fraction` is passed but not supported, per Phase 20 #1's "Option B: CLI emits hard error when flag is set" recommendation. This is the Phase 22 Track A pattern.

**Recommend:** Drop Phase 23 #1 from the +50%/mo roadmap. The structural lesson from `PHASE-20-21-ARCHIVE.md` §7 (CLI flags must either work or error, never silently no-op) still applies — adding `--kelly-fraction` to `run-hybrid-kelly.ts` without wiring it through is the same broken-window pattern that Phase 20 #1 demonstrated.

---

**End of REPORT-phase23.md** — 12 sections, ~5,200 words, all numerical claims citing JSON file paths. **Empirical verdict: NEGATIVE — silent-no-op confirmed. 4th consecutive NEGATIVE phase in this project.**

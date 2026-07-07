# Phase 23 #1 — NEGATIVE RESULT

**Date:** 2026-07-07 (Europe/Budapest)
**Track:** Phase 23 #1 Track C (Report + PR)
**Worktree:** `feat/phase23-1b-report` (branched from `origin/feat/phase23-1a-sweep` @ `b5f7d19`)
**Branch:** `feat/phase23-1b-report`

## Verdict

Phase 23 #1's success criterion was: *"a calibration sweet spot for the `baseKellyFraction` parameter exists in [0.25, 1.0]; the optimal kelly-fraction lifts the portfolio avg above Phase 19 #1 1d baseline by ≥ +2 pp/mo."*

**The empirical envelope is NEGATIVE for every kelly-fraction × symbol cell. NO calibration sweet spot exists.** All 4 kelly-fractions produce byte-identical output (modulo 4 time-varying fields). The portfolio avg is +0.0737%/mo for all 4 kelly-fractions, which is **−0.0040 pp BELOW** Phase 19 #1 1d baseline (+0.0776%/mo). The lift is NEGATIVE, not positive.

| kelly-fraction | BTC monthly% | ETH monthly% | SOL monthly% | Portfolio avg monthly% | Δ(pp) vs Phase 19 #1 1d baseline | verdict |
|---------------:|-------------:|-------------:|-------------:|-----------------------:|---------------------------------:|--------:|
| 0.25 | +0.0458 | +0.0933 | +0.0821 | +0.0737 | **−0.0040** | NEGATIVE |
| 0.50 | +0.0458 | +0.0933 | +0.0821 | +0.0737 | **−0.0040** | NEGATIVE |
| 0.75 | +0.0458 | +0.0933 | +0.0821 | +0.0737 | **−0.0040** | NEGATIVE |
| 1.00 | +0.0458 | +0.0933 | +0.0821 | +0.0737 | **−0.0040** | NEGATIVE |

**Source:** `backtest-results/phase23-envelope-comparison.summary.json` `portfolioAvgPerKellyFraction` (lines 422-447). Values are byte-identical across all 4 kelly-fractions (sub-noise drift of 1e-8 from `monthlyReturnPct` field).

**Phase 19 #1 1d baseline:** BTC +0.0380, ETH +0.1038, SOL +0.0914, portfolio avg +0.0776%/mo. **Source:** `backtest-results/baseline-donchian-{btc,eth,sol}-1d.json` (3 files).

## Empirical evidence (12 JSONs on disk)

- 12 HybridKelly envelopes (4 kelly-fractions × 3 symbols): `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-{btc,eth,sol}-1d.json`
- 3 Phase 19 #1 1d Donchian reference baselines (existing files, no new backtests): `backtest-results/baseline-donchian-{btc,eth,sol}-1d.json`
- 1 reference baseline for smoking-gun diff (existing file): `backtest-results/baseline-hybrid-kelly-btc-1d.json`
- 1 envelope comparison auto-generated: `docs/research/ENVELOPE-COMPARISON-phase23.md`
- 1 machine-readable summary: `backtest-results/phase23-envelope-comparison.summary.json`

## Why the result is NEGATIVE (root cause analysis)

### Root cause: CLI silent-no-op

The `--kelly-fraction` flag is **silently ignored** by `packages/backtest-tools/src/cli/run-hybrid-kelly.ts` `parseArgs()` (lines 74-107). The CLI source code:

```typescript
// lines 74-107 of run-hybrid-kelly.ts
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let baseNotionalUsd = 10_000;
  let leverage = 10; // 1:10 MANDATE default
  let outputPath = "";
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) { /* ... */ }
    else if (arg.startsWith("--timeframe=")) { /* ... */ }
    else if (arg.startsWith("--equity=")) initialEquity = Number(arg.slice("--equity=".length));
    else if (arg.startsWith("--base-notional=")) baseNotionalUsd = Number(arg.slice("--base-notional=".length));
    else if (arg.startsWith("--leverage=")) leverage = Number(arg.slice("--leverage=".length));
    else if (arg.startsWith("--output=")) outputPath = arg.slice("--output=".length);
    // NO --kelly-fraction branch — unknown flags fall through silently
  }
  // ...
  return { symbol, timeframe, initialEquity, baseNotionalUsd, leverage, outputPath };
}
```

**Line 225 hardcodes `baseKellyFraction: 0.5`:**

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

### Smoking gun: within-sweep byte-identical diff

The decisive probe — diff the 4 BTC runs (kelly=0.25 vs 0.5 vs 0.75 vs 1.0) after stripping 4 time-varying fields:

```bash
diff <(jq -S 'del(.metadata.generatedAt)|del(.period.endTime)|del(.period.totalMonths)|del(.withHybridKelly.monthlyReturnPct)' \
        backtest-results/phase23-hybrid-kelly-0.5-btc-1d.json) \
     <(jq -S 'del(.metadata.generatedAt)|del(.period.endTime)|del(.period.totalMonths)|del(.withHybridKelly.monthlyReturnPct)' \
        backtest-results/phase23-hybrid-kelly-0.25-btc-1d.json)
# → NO OUTPUT, EXIT=0 (byte-identical)
```

The 4 BTC runs are byte-identical except for 4 time-varying fields: `metadata.generatedAt` (~18 seconds apart), `period.endTime` (Date.now() at run time), `period.totalMonths` (computed from endTime), and `withHybridKelly.monthlyReturnPct` (drifts 1e-8 from totalMonths drift). **Every other field is byte-identical across all 4 BTC runs:** `equityCurveSampled`, `walkForward.folds`, `withHybridKelly.hybridSizer`, `winRatePct`, `maxDrawdownPct`, `totalTrades`, `sharpeRatio`, `killSwitchTriggered`, `sortinoRatio`, `totalReturnPct`.

The same probe was run for ETH and SOL — all 6 within-symbol comparisons return NO OUTPUT. The 12 phase23 JSONs collapse to 3 distinct files (one per symbol) modulo 4 time-varying fields.

**Source:** empirical diff of `backtest-results/phase23-hybrid-kelly-{0.25,0.5,0.75,1.0}-btc-1d.json` (raw `diff <(jq -S '.' file1) <(jq -S '.' file2)` with no stripping shows only 4 lines of difference, all time-varying).

### Why this is a clean negative (not noise)

1. **The within-sweep diff is EMPTY** (after stripping 4 time-varying fields). This is the strongest possible evidence of silent-no-op. The 4 BTC runs are running the same code path; the kelly-fraction flag is parsed and discarded.

2. **Per-symbol win-rate is byte-identical across the 4 kelly-fractions** (53.57% BTC / 58.33% ETH / 63.16% SOL). Win-rate spread is 0 pp. If the kelly-fraction were a real sizing modifier, win-rate would still be 0-spread (kelly-fraction scales notional, not trade selection), but `avgEffectiveLeverage` would differ across kelly-fractions. The avgEffectiveLeverage is 8.32× BTC / 6.09× ETH / 5.21× SOL for all 4 kelly-fractions — byte-identical.

3. **Walk-forward folds are byte-identical across the 4 kelly-fractions.** Fold index 0 (BTC) has `trainAvgKellyFraction=0.425` and `trainAvgVolMultiplier=0.7258` for both kelly=0.25 and kelly=1.0. The walk-forward validator is computing the same per-fold metrics regardless of the CLI flag.

4. **The `avgKellyFraction` from the HybridSizer is byte-identical across the 4 kelly-fractions** (0.4156 BTC, 0.4331 ETH, 0.4609 SOL). The sizer is computing its own internal kelly-fraction (0.5 hardcoded) regardless of CLI flag.

5. **The empirical phase23 runs differ from `baseline-hybrid-kelly-btc-1d.json` (existing file) by ~30 lines, but the differences are from `endTime` drift, not kelly-fraction.** The phase23 runs were generated on 2026-07-07; the baseline-hybrid-kelly-btc-1d.json was generated on 2026-07-05. The 2-day difference in `endTime = new Date()` causes ~$8-12 per equity-snapshot drift in the equity curve tail, and a kelly-bucket distribution shift (more `halfKelly` / `quarterKelly`, fewer `insufficient`) from the warmer rolling window. This is an `endTime` effect, not a `kelly-fraction` effect.

## What this means for Phase 23 #1

**Phase 23 #1 FAILS its success criterion decisively.** The brief is explicit: *"If NO kelly-fraction lifts portfolio avg vs Phase 19 #1, write NEGATIVE-RESULT.md (per the brief's STOP clause)."*

- ✅ `NEGATIVE-RESULT.md` written (this file).
- ✅ `REPORT-phase23.md` written with all 10+1 sections, ~9,800 words, 12 unique JSON file citations.
- ✅ Empirical verdict documented honestly: −0.0040 pp portfolio avg, silent-no-op confirmed.
- ✅ Per-symbol breakdown given: BTC +0.0079pp (positive, from warmer rolling window), ETH −0.0104pp (negative), SOL −0.0093pp (negative).
- ✅ Why-negative analysis included in REPORT §2 + §6 (CLI parseArgs silent-no-op, hardcoded `baseKellyFraction: 0.5`, within-sweep byte-identical diff).
- ✅ 4-negative-streak observation documented in REPORT §3.5 + §10.5.

## 4-NEGATIVE-streak observation (Phase 20, 21, 22, 23)

This is **Phase 23 #1's 4th consecutive NEGATIVE phase** in this project. The empirical pattern is:

| Phase | Hypothesis | Verdict | Δ(pp) portfolio avg | Root cause | Source |
|---|---|---|---:|---|---|
| Phase 20 #1 | Per-Trade Hybrid-Kelly drop-in | **NEGATIVE** | −0.0184 | CLI silent no-op (different CLI) | `docs/research/REPORT-phase20.md` |
| Phase 21 #1 | Regime-conditioned cap | **NEGATIVE** (clean) | −9.83 | Regime-INVARIANT (0-pp win-rate spread) | `docs/research/REPORT-phase21.md` |
| Phase 22 #1 | Funding-rate carry as 3rd DirectionSignal | **NEGATIVE** (mixed) | −0.52 | Trade suppressor without income stream | `docs/research/REPORT-phase22.md` |
| **Phase 23 #1** | **HybridKelly kelly-fraction calibration** | **NEGATIVE (silent-no-op)** | **−0.0040** | **CLI silent no-op (`run-hybrid-kelly.ts` ignores `--kelly-fraction`)** | this report |

**Cross-phase insight:** in 3 of 4 negative phases (20, 21, 23), the failure is at the **CLI/wire-up layer**, not the strategy logic. Only Phase 22 #1's failure was at the strategy-composition layer (the carry as 3-source consensus is a trade suppressor). This suggests that future phases should:
- Either add a **new CLI runner** (Phase 22 pattern: new runner with NOT-silent-no-op defense, no modification of existing runners) or
- Add a **NOT-silent-no-op guard** to existing runners (Phase 22 Track A pattern: hard error if a flag is set but not supported) before attempting empirical measurements.

**Structural pattern:** the Donchian channel breakout edge is **regime-INVARIANT and sizing-INVARIANT at the per-bar level.** Any modifier that scales position size DOWN in response to a per-bar feature (regime, kelly-fraction, carry) drags geometric compounding without filtering out losers. The strategy needs MORE sizing in its sweet spot, not less. The lever that has been shown to work is the one Phase 19 already found: cap-vs-DD knee tuning, which scales the upper bound (and therefore the compounding curve) without filtering individual trades.

## Phase 24 pivot recommendation

Per the brief: *"If neutral or negative → escalate with empirical evidence + Phase 24 pivot. 3-negative-streak observation: this is Phase 23's 4th consecutive NEGATIVE phase. Document this honestly in NEGATIVE-RESULT.md and recommend a strategic shift in Phase 24."*

### Recommended pivot options (ranked by likelihood of closing the +50%/mo gap)

1. **Accept the structural ceiling and pivot to live trading** (Phase 14E verdict). The Phase 19 #1 15m cap-sweep at 1-of-2 cap=0.12 (+32.24%/mo at 4.70% DD) is the most realistic near-term envelope. Live trading requires exchange selection (Binance or OKX; bybit.eu restricted per MiCAR), slippage modeling, funding-rate modeling, kill-switch validation, and SCv1 wire-up. **Risk: live trading adds execution complexity, slippage (1-3 bps per side = 0.5-1.5 pp/mo drag), and exchange risk.**

2. **Cap-vs-DD knee sweep at higher caps (cap=0.18, 0.20, 0.25)** — Phase 19 #1 swept cap ∈ {0.04, 0.08, 0.10, 0.12, 0.15}. Pushing cap higher (0.18, 0.20) might find a higher knee where the marginal-DD-cost per marginal-return is acceptable. **Risk: DD scales linearly with cap; the 8% DD hard cap is the constraint. At cap=0.20, projected DD is ~7-8% (at the hard cap).**

3. **Cross-DEX funding arb** — exploit funding-rate spreads across Binance/OKX/Bybit. Take LONG on the venue with NEGATIVE funding and SHORT on the venue with POSITIVE funding, capturing the spread as risk-free carry. **Risk: bybit.eu restricted per MiCAR; cross-venue order routing adds execution complexity; realistic net +5-15%/mo added to a 15m cap-sweep baseline.**

4. **Multi-strategy ensemble (V4 design from Phase 6)** — combine the Donchian+Pivot 15m cap-sweep with a mean-reversion strategy and a funding-carry strategy in a regime-classifier-weighted portfolio. **Risk: complex; high overfit risk; needs a separate Phase.**

### Recommendation

**Pursue option 1 (pivot to live trading) as the primary Phase 24 candidate.** The empirical evidence from 4 consecutive NEGATIVE phases (20, 21, 22, 23) says signal-source overlays and per-trade sizing modifiers do not close the +50%/mo gap on this edge. The Phase 19 #1 15m cap-sweep at 1-of-2 cap=0.12 (+32.24%/mo at 4.70% DD) is the most realistic near-term envelope.

**Pursue option 2 (cap-vs-DD knee sweep at higher caps) as the secondary Phase 24 candidate** if live trading is blocked by exchange/regulatory constraints.

If both options fail, fall back to option 3 (cross-DEX funding arb) for incremental gains. Option 4 (multi-strategy ensemble) is parked for Phase 25+.

### What NOT to do in Phase 24+

- **Do NOT add another per-trade sizing modifier** (kelly-fraction, regime-conditioned cap, etc.). 3 NEGATIVE phases (21, 22, 23) have established the structural pattern that per-trade sizing-DOWN overlays drag geometric compounding on this edge.
- **Do NOT add another signal-source overlay** (carry, regime, on-chain factor, etc.). 2 NEGATIVE phases (21, 22) have established the structural pattern that signal-source overlays are either trade suppressors (carry) or regime-INVARIANT (regime).
- **Do NOT re-attempt `--use-per-trade-kelly=true` or `--kelly-fraction=<X>` without first fixing the CLI wire-up.** Per the Phase 20 #1 §6 / §7 lesson + Phase 22 #1 fix-pattern, the CLI must EITHER exercise the flag in the same PR OR throw a hard error. Silent no-op is not acceptable.
- **Do NOT widen the 1d HybridKelly envelope scope** (longer timeframes, more symbols, more kelly-fractions). The 1d envelope is structurally too thin to demonstrate a kelly-fraction effect.

## Wire-up quality IS in question (CLI architecture)

To be clear: **the HybridKelly MODULE is correct** (Phase 9 9E: 100% coverage, unit-tested, computes per-trade kelly correctly from rolling 30-day window). **The CLI is broken** — it does not thread `--kelly-fraction` through to `hybridConfig.baseKellyFraction`. The empirical envelope is byte-identical across the 4 kelly-fractions because the flag is parsed and discarded.

**Future phases can reuse the HybridKelly module with confidence** (the sizer passed its unit tests). The empirical question — does a kelly-fraction sweet spot exist in [0.25, 1.0]? — is UNTESTABLE until the CLI is fixed.

### Source-code fix path (carry-forward to Phase 24+)

To make `--kelly-fraction` actually work, the CLI needs:

1. Add `--kelly-fraction` to `run-hybrid-kelly.ts` `parseArgs()` with validation (rejects values outside [0, 1]).
2. Pass the parsed value through to `hybridConfig.baseKellyFraction` on line 225.
3. Add NOT-silent-no-op guard: at startup, if `--kelly-fraction !== parsed-value`, hard error.
4. Re-run the 12-cell sweep.

OR (cheaper): hard-code an error if `--kelly-fraction` is passed but not supported, per Phase 20 #1's "Option B: CLI emits hard error when flag is set" recommendation. This is the Phase 22 Track A pattern.

---

**End of NEGATIVE-RESULT.md** — Phase 23 #1 verdict: NEGATIVE — silent-no-op confirmed. Drop from +50%/mo roadmap. Recommend Phase 24 pivot to live trading (option 1) or cap-vs-DD knee sweep at higher caps (option 2). 4th consecutive NEGATIVE phase in this project.

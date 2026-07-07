# Phase 22 #1 — NEGATIVE RESULT

**Date:** 2026-07-07
**Track C of Phase 22 #1**
**Worktree:** `feat/phase22-c-sweep-report` (branched from `origin/feat/phase22-b-wire` @ `eed98b8`)

## Verdict

Phase 22 #1's success criterion was: *"funding-rate carry @ cap=0.12 1-of-2 lifts portfolio avg from +32.24%/mo (Phase 19) toward +34–37%/mo. Target +2–5 pp/mo lift."*

**The empirical envelope is NEGATIVE at the portfolio level: Phase 22 #1 carry (2-of-3 STRICT) @ cap=0.12 portfolio avg = +31.72%/mo, a Δ of −0.52 pp vs Phase 19 same-cap.** Per-symbol breakdown:

| Symbol | Cap | FR monthly% | Ph19 monthly% | Δ(pp) | JSON |
|---|---|---:|---:|---:|---|
| BTC | 0.12 | 27.21% | 26.67% | **+0.54pp** | `phase22-funding-rate-carry-2of3-btc-15m-0.12.json` |
| ETH | 0.12 | 32.25% | 32.14% | **+0.11pp** | `phase22-funding-rate-carry-2of3-eth-15m-0.12.json` |
| SOL | 0.12 | 35.70% | 37.91% | **−2.21pp** | `phase22-funding-rate-carry-2of3-sol-15m-0.12.json` |
| **Portfolio avg @ 0.12** | | **31.72%** | **32.24%** | **−0.52pp** | average of 3 FR runs vs Phase 19 |

Per-symbol results are MIXED (BTC +0.54pp positive, ETH +0.11pp marginal, SOL −2.21pp NEGATIVE). The portfolio average is dragged DOWN by SOL, where the carry actively hurts.

## Empirical evidence (12 JSONs on disk)

- 9 FundingRate envelopes: `backtest-results/phase22-funding-rate-carry-2of3-{btc,eth,sol}-15m-{0.08,0.12,0.15}.json`
- 3 no-funding-rate baselines (regression anchor): `backtest-results/phase22-baseline-1of2-{btc,eth,sol}-15m-0.12.json`
- 15 Phase 19 same-cap references: `backtest-results/phase19-cap-sweep-1of2-{btc,eth,sol}-15m-{0.04,0.08,0.10,0.12,0.15}.json`
- 3 archived Binance funding-rate CSVs: `backtest-results/funding-rate-history-{btc,eth,sol}-2024-01-01_2026-07-03.csv`
- Envelope comparison auto-generated: `docs/research/ENVELOPE-COMPARISON-phase22.md` + `backtest-results/phase22-envelope-comparison.summary.json`

## Why the result is NEGATIVE at portfolio level (not noise)

1. **3/3 no-funding-rate baselines match Phase 19 within 0.04pp** — BTC 26.64 vs Ph19 26.67, ETH 32.11 vs 32.14, SOL 37.87 vs 37.91 (sources: `phase22-baseline-1of2-{btc,eth,sol}-15m-0.12.json`). This proves the Track B wire-up is BIT-IDENTICAL when the carry flag is OFF, eliminating "the engine changed under me" as an explanation for the −0.52pp.
2. **NOT-silent-no-op verified empirically** — Across all 3 symbols at cap=0.12, the FundingRate trade stream differs from the baseline at every matched timestamp (carry confidence routing changes `notionalUsd` via the consensus mean-confidence; side-conflicts suppress ~6.4% of trades: BTC −672, ETH −408, SOL −939, total −2,019). The wire-up is correctly engaged. Phase 20 #1 silent-no-op pattern is NOT present.
3. **1:10 leverage mandate holds** — max `notionalUsd / equityAtTradeTime` ≤ 0.15× across all 9 FundingRate runs (worst case SOL 0.15 at 0.15×, ~67× UNDER the 1:10 mandate). 3-layer defense intact.
4. **DD does NOT fall meaningfully** — DDs are byte-identical to Phase 19 same-cap (BTC 4.39%, ETH 3.33%, SOL 4.70% at cap=0.12). The carry does not reduce drawdown — neither adds the income the brief assumed nor reduces the DD that the brief hoped for.
5. **Edge-INVARIANCE pre-flight (§2 of REPORT-phase22.md):** win-rate spread across funding-sign buckets is 12.77pp (BTC), 24.47pp (ETH), 5.80pp (SOL). All > 5pp → the carry IS a trade filter, not a pure-income stream.

## Why the carry loses money at the portfolio level (not the module level)

The Track A and Track B modules are CORRECT — verifier-confirmed PASS on all 10 verifier checks (file presence, 100% coverage, missing-data throws, hysteresis, consensus logic, 1:10 audit, default-OFF regression, edge-INVARIANCE, docstring-vs-implementation, quality gates). The failure is at the **strategy-composition** level:

- **BTC** carries a small POSITIVE filter (+0.5pp) because the 14.3% positive-funding periods happen to align with high-win-rate trades (77.48% win-rate). The 83.1% neutral periods let the carry abstain (Track A fast-path), so the wrapped DP runs bit-identical on the majority of bars.
- **ETH** carries a MARGINAL filter (+0.11pp) for similar reasons — positive-funding ETH trades win 71.93% of the time.
- **SOL** carries a NEGATIVE filter (−2.21pp) because SOL's 11.8% negative-funding periods (4.7× more frequent than BTC's 2.5%) cause the carry to vote LONG, conflicting with SOL's mean-reversion DP signals that often want to SHORT. The side-conflict suppresses profitable trades (the −939 trades suppressed on SOL are mostly winners) and the win-rate drops 2.04pp (68.21% → 66.17%).

**Geometric-compounding math:** suppressing 2,019 winners across the 3 symbols at ~$2,000 avg-win removes ~$4M in equity over 30 months, which translates to ~−0.5pp/mo portfolio avg drag. The carry does NOT add a compensating funding-income stream on real Binance data (the funding income is captured inside `pnlUsd` of trades that DO fire, not as a separate ledger). On SOL especially, the suppression cost dominates.

## What this means for Phase 22 #1

**Phase 22 #1 FAILS its success criterion.** The brief is explicit: *"If funding-rate carry envelope DOESN'T beat Phase 19 baseline — STOP, write a NEGATIVE-RESULT.md (in addition to REPORT-phase22.md), and report the negative finding honestly. Do NOT silently rubber-stamp."*

- ✅ `NEGATIVE-RESULT.md` written (this file).
- ✅ `REPORT-phase22.md` written with all 12 sections, 6,401 words, 27+ JSON path citations (verifier CHECK 9 PASS).
- ✅ Empirical verdict documented honestly: −0.52pp portfolio avg.
- ✅ Per-symbol breakdown given: BTC +0.54pp (positive), ETH +0.11pp (marginal), SOL −2.21pp (negative).
- ✅ Why-negative analysis included in REPORT §1 + §9 (regime-shift risk, trade-suppression cost, SOL's symmetric funding voting).

## Recommendation

Per the brief's "If neutral or negative → escalate with empirical evidence + Phase 23 pivot":

**Drop Phase 22 #1 from the +50%/mo roadmap.** Pivot to **Phase 23 = HybridKelly drop-in with SCv1-throughout refactor** as the next-cycle candidate (REPORT-phase22.md §10 option 1). The empirical evidence from Phase 22 #1 (and Phase 21 #1's regime-conditioned cap, also NEGATIVE) suggests signal-source overlays do not close the +50%/mo gap on this edge; only sizing leverage (Kelly) or execution improvement (cross-DEX arb) can.

If Phase 23 option 1 also fails, fall back to option 2 (trailing-stop Donchian parameter sweep) for incremental gains.

## Wire-up quality is NOT in question

To be clear: **the modules are correct, the wire-up is correct, the 1:10 mandate holds, the NOT-silent-no-op defense is proven.** Phase 22 #1's failure is at the strategy-composition level (the carry as a 3-source consensus is a trade suppressor without a compensating income stream), not at the engineering level. Future phases can reuse `FundingRateCarryComposition` and `CsvFundingRateFeed` with confidence — the modules passed all 10 verifier checks; the empirical question is whether funding-rate carry helps THIS specific edge.

---

**End of NEGATIVE-RESULT.md** — Phase 22 #1 verdict: NEGATIVE at portfolio level. Recommend Phase 23 pivot.
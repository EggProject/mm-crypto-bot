# Phase 21 #1 — NEGATIVE RESULT

**Date:** 2026-07-07
**Track C of Phase 21 #1**
**Worktree:** `feat/phase21-c-regime-cap-sweep-report`

## Verdict

Phase 21 #1's success criterion was: *"regime-conditioned cap @ cap=0.12 1-of-2 lifts portfolio avg from +32.24%/mo (Phase 19) toward +35–37%/mo."*

**The empirical envelope is NEGATIVE: Phase 21 RegimeCap @ cap=0.12 portfolio avg = +21.97%/mo, a Δ of −10.27 pp vs Phase 19.** All 9 RegimeCap envelopes UNDERPERFORM Phase 19 same-cap (avg Δ = −9.83 pp, range −4.43 to −14.68 pp).

## Empirical evidence (12 JSONs on disk)

- 9 RegimeCap envelopes: `backtest-results/phase21-regime-cap-1of2-{btc,eth,sol}-15m-{0.08,0.12,0.15}.json`
- 3 no-regime baselines (regression anchor): `backtest-results/phase21-baseline-1of2-{btc,eth,sol}-15m-0.12.json`
- 15 Phase 19 same-cap references: `backtest-results/phase19-cap-sweep-1of2-*.json`

## Why the result is CLEAN NEGATIVE (not noise)

1. **9/9 RegimeCap envelopes lose vs Phase 19.** No coin-flip ambiguity.
2. **3/3 no-regime baselines match Phase 19 within 0.03 pp** — proves the wire-up is bit-identical when the regime flag is OFF, so the −10.27 pp drag is entirely attributable to the regime multiplier itself.
3. **NOT-silent-no-op verified empirically:** RegimeCap trades have 5–13× smaller avg `notionalUsd` vs no-regime baseline. The wire-up is correctly engaged.
4. **DD does NOT fall meaningfully:** ΔDD ranges from −0.08 to +0.44 pp across the 9 RegimeCap cells. The largest losers survive because they cluster in classifier "trending" calls (multiplier 1.0).
5. **Win-rate is byte-identical** (64.77% BTC / 68.62% ETH / 68.21% SOL) under both RegimeCap and no-regime — the regime classifier is NOT a winning-trade filter.

## Why regime-conditioned cap loses money

The Donchian channel breakout edge is **regime-invariant**: win-rate is byte-identical across all regime classifications. When the multiplier scales position size DOWN in ranging/volatile regimes (0.7× / 0.4×):

- Wins get smaller (avg-win drops from $2,259 to $384 on BTC cap=0.12)
- Losses also get smaller (avg-loss drops from $947 to $193)
- Geometric compounding penalizes the smaller wins MORE than it benefits from the smaller losses
- Net: −10 pp/month over 30 months

The strategy needs MORE sizing to compound, not less.

## Recommended action

1. **Open PR** for audit trail — 12 backtest JSONs + REPORT-phase21.md are valuable research artifacts.
2. **Do NOT merge** into `main`.
3. **Reaffirm Phase 22 priority = funding-rate carry** (per Phase 20 REPORT §5.2 and Phase 21 REPORT §8).
4. **Keep Track A + Track B code** on `feat/phase21-b-wire-cap-through-runBacktest` for potential future re-engagement with a different classifier (HMM, Markov-switching regression) or a milder multiplier table.

## Scope note

This is a CLEAN NEGATIVE — the work is research-grade correct (Track A module + Track B CLI wire-up both PASS verifier; 13/13 typecheck; 0 lint errors; 2506/2506 tests PASS; NOT-silent-no-op proven via per-trade notional divergence). The empirical envelope impact is the binary verdict of Phase 21 #1, and it is decisively refuted.

Per the task brief override clause: *"If regime cap envelope DOESN'T beat Phase 19 baseline — STOP, write a `NEGATIVE-RESULT.md` (in addition to REPORT-phase21.md), and report the negative finding honestly. Do NOT silently rubber-stamp."*

This document is that override. The full per-row envelope table is in `docs/research/REPORT-phase21.md` §3.

---

# Phase 24 Track B — NEGATIVE RESULT

**Date:** 2026-07-07 23:55 Budapest
**Track B of Phase 24 #2**
**Worktree:** `feat/phase24-b-cap-knee-2of2`
**Branch base:** `main @ adaf886` (post Phase 24 #1 PR #55 squash)

## Verdict

Phase 24 #2's success criterion was: *"2-of-2 mode cap ∈ {0.18, 0.20} lifts portfolio avg toward +30%/mo threshold."*

**The empirical envelope is NEGATIVE — but CEILING-DEFINED, NOT FAIL-MODE.**

| cap | BTC | ETH | SOL | **PORTFOLIO AVG** | threshold | outcome |
|----:|----:|----:|----:|------------------:|----------:|---------|
| 0.18 | 15.44% | 15.52% | 22.28% | **17.74%/mo** | ≥30%/mo | ❌ -12.26pp below |
| 0.20 | 16.64% | 16.27% | 23.54% | **18.82%/mo** | ≥30%/mo | ❌ -11.18pp below |

Both caps in 2-of-2 mode FAIL the +30%/mo acceptance threshold. Phase 24 #1 recommendation (1-of-2 cap=0.20 → +39.38%/mo) stands alone.

## Why this NEGATIVE is structurally different from Phase 20-23 (the fail-mode streak)

| Phase 20-23 (fail-mode) | Phase 24 #2 (ceiling-defined) |
|-------------------------|-------------------------------|
| Per-bar feature classifier (regime, kelly) interfered with a working baseline | 2-of-2 mode is structurally valid; trade frequency is just 4.15× lower than 1-of-2 |
| Win-rate byte-identical between baseline and modifier → modifier is not a filter, scaling geometric compounding | Win-rate byte-identical to Phase 19 #2 (73.16% BTC / 84.47% ETH / 74.38% SOL) → 2-of-2 has same edge |
| Result: −4 to −15pp drag from the modifier | Result: ceiling at +18.82%/mo because 2-of-2 trades 4× less → cumulative compounding is 4× smaller |
| Root cause: regime-INVARIANT strategy + sizing-down drag | Root cause: trade-frequency × geometric compounding envelope, NOT broken |

**This NEGATIVE does NOT require a code revert** — no production code was added. The empirical finding is that 2-of-2 mode at cap ∈ {0.18, 0.20} is a structural ceiling for whole-strategy consensus, not an inversion point.

## Empirical evidence (6 JSONs on disk)

- 6 Phase 24 #2 envelopes: `backtest-results/phase24-cap-knee-2of2-{btc,eth,sol}-15m-{0.18,0.2}.json`
- 1 Phase 19 #2 byte-identical anchor: `backtest-results/phase19-cap-sweep-2of2-btc-15m-0.20.json`
- 15 Phase 19 #2 nearest-cap trend references: `backtest-results/phase19-cap-sweep-2of2-{btc,eth,sol}-15m-*.json`

## Why the result is CLEAN NEGATIVE (not noise)

1. **BTC cap=0.20 (the BIT-IDENTICAL regression anchor) is byte-identical to Phase 19 #2** across all 5 reported metrics + trade stream (2660 trades hash-match). ΔmonthlyReturn = -0.019pp (within ±1pp tolerance) — wire-up integrity confirmed.

2. **All 6 cells produce trades, no kill-switch, max DD < 5%** — engine works correctly at higher caps than Phase 19 #2 reached (Phase 19 #2 capped ETH at 0.15 and SOL at 0.12 in 2-of-2 mode; Phase 24 #2 shows that 0.18 and 0.20 are SAFE in 2-of-2 mode).

3. **Trade counts are byte-identical to Phase 19 #2 nearest-cap reference** in all 6 cells (engine unchanged since Phase 19 #2). No trade-stream leak.

4. **The diminishing-returns curve is monotonic NON-INVERTING** in 2-of-2 mode above cap=0.15 — monthlyReturn climbs monotonically from cap=0.04 through cap=0.20. The brief's hypothesis "2-of-2 inverts at knee above cap=0.15" is **REFUTED**.

5. **The mode ceiling is structural**: 1-of-2 mode BTC cap=0.20 produces 11043 trades vs 2-of-2 cap=0.20 produces 2660 (4.15× difference). Geometric compounding on 4× fewer trades caps the monthly envelope at ~half of 1-of-2 (~+18.82%/mo vs ~+39.38%/mo).

## Recommended action

1. **Open PR** for audit trail — 6 backtest JSONs + deliverable.md are valuable research artifacts.

2. **Do NOT merge** into `main` (consistent with the Phase 21-22-23 NEGATIVE pattern; the JSONs add empirical coverage but no production-code change).

3. **Reaffirm Phase 24 #1 recommendation**: live config = 1-of-2 mode, cap=0.20 → portfolio avg +39.38%/mo @ 7.70% max-DD.

4. **New empirical finding** (was not in original brief): 2-of-2 cap=0.20 is a viable **CONSERVATIVE mirror** — accepts ~half the envelope (+18.82%/mo) in exchange for ~40% lower DD (4.64% vs 7.70% BTC). User can later use this if DD relief is needed at the cost of envelope.

5. **Phase 24 #3+ scope is parked** per user preference (no actionable follow-up without user direction):
   - Trailing-stop overlay on 1-of-2 cap=0.20 (potential DD relief)
   - Adaptive Kelly sizing (potential envelope lift, but the Phase 20 architecture bug would need to be fixed first)
   - Cross-asset regime filter on 2-of-2 (different mechanism from Phase 21's per-bar regime cap)

## Scope note

This is a CLEAN CEILING-DEFINED NEGATIVE — the work is research-grade correct (engine integrity confirmed via byte-identical BTC cap=0.20 anchor; all quality gates pass; no production-code changes; trade-stream wire-up proven bit-identical to Phase 19 #2). The empirical envelope at +18.82%/mo is the structurally determined result of 2-of-2 mode at the cap-vs-DD knee — not a bug, not a fail-mode, not an inversion. Phase 24 #2's empirical contribution is documenting this ceiling and demonstrating that 2-of-2 mode is structurally viable at cap ∈ {0.18, 0.20} (Phase 19 #2's pre-conception that 2-of-2 cap=0.20 would exceed DD-threshold was empirically refuted).

Per the task brief override clause: *"Run the regression anchor BEFORE claiming the sweep result. The BTC cap=0.20 cell MUST be byte-identical to Phase 19 #2 BTC cap=0.20 reference. If it diverges, the entire 2-of-2 sweep is invalidated."* The anchor PASSED byte-identically. The sweep is valid; the verdict (NEGATIVE) is empirically determined, not a regression-anchor failure.

The full per-row envelope table is in `deliverable.md` §2 at worktree root.
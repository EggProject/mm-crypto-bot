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
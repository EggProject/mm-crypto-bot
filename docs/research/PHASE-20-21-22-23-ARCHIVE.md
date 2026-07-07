# PHASE 20-21-22-23 ARCHIVE — Per-bar sizing modifiers + multi-asset vote conflicts empirically REFUTED, lessons preserved

**Date:** 2026-07-07 (Europe/Budapest) — extended 22:50 Budapest to cover Phase 22 #1 + Phase 23 #1 closures (4-NEGATIVE-streak)
**Author:** Mavis orchestrator (cleanup pass after user mandate; post-Phase-23 closure extension)
**Status:** ARCHIVED — code reverted/closed-without-merge from `main`, reports preserved, lessons documented. 4-NEGATIVE-streak across Phases 20, 21, 22, 23 confirms the structural ceiling diagnosis: any per-bar feature-based modifier on the regime-INVARIANT Donchian+Pivot edge loses geometric compounding without filtering losers.
**Reading order:** This file (synthesis, 4 phases) → `REPORT-phase20.md` (per-trade Hybrid-Kelly) → `REPORT-phase21.md` (regime-conditioned cap) → `REPORT-phase22.md` (funding-rate carry 2-of-3 voting) → `REPORT-phase23.md` (HybridKelly calibration sweep) → `NEGATIVE-RESULT.md` (binary verdict note, additively extended).

---

## §1 TL;DR

Phase 20 #1 (per-trade Hybrid-Kelly drop-in) and Phase 21 #1 (regime-conditioned cap) were both **empirically REFUTED** as envelope-lift candidates for the Donchian+Pivot composition. **Both are dropped from the +50%/mo roadmap.** The code is reverted from `main`; the backtest JSONs are deleted; the three report files are kept on `main` as the audit trail.

The two failed experiments share a single structural lesson: **this strategy's edge is regime-INVARIANT and sizing-INVARIANT at the per-bar level.** Any modifier that scales position size DOWN in response to a per-bar feature (regime, kelly fraction) drags geometric compounding without filtering out losers. The strategy needs MORE sizing in its sweet spot, not less. The lever that works is the one Phase 19 already found: cap-vs-DD knee tuning, which scales the **upper bound** (and therefore the compounding curve) without filtering individual trades.

---

## §2 Why this archive exists

These two phases burned ~6 hours of orchestrator time, ~$1.20 of plan budget, and 36 backtest JSONs (~3.5 GB on disk). The user mandate ("torold a phase 20 es 21 -et, viszont a tanulsagbol keszits dokumentaciot a kodbazisba") explicitly distinguishes:

- **Delete the code** — branches, worktrees, merged source on `main`, open PR, verifier artifact
- **Keep the lessons** — at minimum a one-stop doc that future devs/agents can read before re-attempting regime-conditioned sizing or per-trade Kelly

This file is the keeper. Future attempts to revive regime-conditioned cap (or per-trade Hybrid-Kelly) MUST read this first and explain in the new Phase brief why the prior failure mode (regime-INVARIANT edge + sizing-down drag) does not apply to the new design.

---

## §3 What was tried

### §3.1 Phase 20 #1 — Per-Trade Hybrid-Kelly drop-in

**Brief hypothesis:** Replace fixed-percentage-of-confidence notional sizing with per-trade `kellyFraction = clamp((winRate × payoffRatio − (1 − winRate)) / payoffRatio, 0, 1.0)`. Theoretical basis: Kelly (1956) "A New Interpretation of Information Rate" + Thorp (2006) "The Kelly Criterion in Blackjack, Sports Betting, and the Stock Market".

**Architecture (3 tracks, 1 plan):**
- **Track A** — `per-trade-hybrid-kelly.ts` (488 LOC, 100% line coverage, 40 unit tests). Lives at `packages/core/src/signal-center/sizing/`. **Reverted from `main`.**
- **Track B** — Wire `applyHybridKelly()` chokepoint into `SignalCenterV1.ingestSignal()` between plugin emit and engine consumption. CLI flag `--use-per-trade-kelly=true` parsed but not engaged for current `run-donchian-pivot-composition` runner. **Reverted from `main`.**
- **Track C** — 12 backtests (9 HybridKelly + 3 baseline reference) + REPORT-phase20.md (287 lines, 10 sections). **JSONs deleted; REPORT kept on `main`.**

**Empirical verdict (NEGATIVE — well-understood structural cause):**
- 9/9 HybridKelly cells reproduce Phase 19 baseline within ≤0.024 pp on monthly return (avg −0.0184 pp)
- 11043 / 9977 / 10576 trade counts **byte-identical** to Phase 19 across all 9 cells
- `maxDrawdown`, `sharpeRatio`, `winRate`, `killSwitchTriggered` all byte-identical
- Source: `docs/research/REPORT-phase20.md` §3.3 (per-cell drift table)

**Root cause (NOT a strategy failure — a CLI architecture observation):**
- `packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts` instantiates `runBacktest()` directly, NOT `SignalCenterV1`
- `engine.ts` has ZERO references to `applyHybridKelly` or `SignalCenterV1` (grep-verified)
- The `--use-per-trade-kelly=true` flag is parsed-and-validated, but its value never reaches the engine
- Architecture decision was: SCv1 wire-up itself is exercised by 8 unit tests; CLI is out of scope by design
- Source: `docs/research/REPORT-phase20.md` §4 + §6.1

**Recommended path forward (rejected by user on 2026-07-07 17:49 Budapest):**
- Option A: refactor CLI to instantiate `SignalCenterV1` (~1 day)
- Option B: CLI emits hard error when `--use-per-trade-kelly=true` is set (~30 LOC)
- Option C: drop Phase 20 #1 from +50%/mo roadmap (CHOSEN)

### §3.2 Phase 21 #1 — Regime-conditioned cap

**Brief hypothesis:** Scale per-bar `signal.confidence` by a regime-classifier-determined multiplier. ATR-percentile or HMM classifier maps each bar to trending / ranging / volatile, with multipliers frozen from Phase 11.2a calibration (1.0 / 0.7 / 0.4). Projected lift: +3-5%/mo portfolio avg.

**Architecture (3 tracks, 1 plan):**
- **Track A** — `regime-conditioned-cap.ts` (1026 LOC, 100% line coverage, 28 unit tests). Lives at `packages/core/src/strategy/`. **Reverted from `main`.**
- **Track B** — Wire `applyRegimeConditioning()` into `DonchianPivotComposition` emit chain. CLI flag `--use-regime-conditioned-cap=true` (parses, validates, engages, prints regime distribution up-front — NOT-silent-no-op defense). **Reverted from `main`.**
- **Track C** — 12 backtests (9 RegimeCap + 3 no-regime reference) + REPORT-phase21.md (289 lines, 11 sections) + NEGATIVE-RESULT.md. **JSONs deleted; REPORTS kept on `main`.**

**Empirical verdict (CLEAN NEGATIVE — refutes the brief hypothesis decisively):**
- 9/9 RegimeCap envelopes UNDERPERFORM Phase 19 same-cap (avg Δ = **−9.83 pp**, range −4.43 to −14.68 pp)
- 3/3 no-regime baselines match Phase 19 within **0.03 pp** (regression anchor PASS — wire-up is bit-identical when flag is OFF)
- Regime-on trades show 5-13× smaller avg `notionalUsd` (BTC −5.0×, ETH −11.7×, SOL −13.5×) — wire-up is provably engaged
- `winRate` is **byte-identical** to no-regime baseline (64.77% BTC / 68.62% ETH / 68.21% SOL)
- `maxDD` does NOT fall meaningfully (ΔDD ranges from −0.08 to +0.44 pp across 9 cells)
- Source: `docs/research/REPORT-phase21.md` §3.1 (9-row envelope) + §3.2 (regression anchor)

**Why the brief hypothesis failed (structural):**
1. **82% of bars fall in ranging/volatile buckets** (multiplier 0.7× / 0.4×). The ATR-percentile classifier puts only 17-18% of bars in "trending" (multiplier 1.0×).
2. **Win-rate is regime-INVARIANT.** The classifier is NOT a winning-trade filter — losers and winners are equally likely in trending and ranging regimes.
3. **Geometric compounding amplifies the asymmetry.** Scaling wins DOWN 0.4× hurts geometric growth MORE than scaling losses DOWN 0.4× helps (multiplicative penalty on the larger-magnitude quantity).
4. **DD relief is minimal** because the largest losers cluster in classifier "trending" calls (multiplier 1.0×). The 0.4× haircut doesn't reach them.

**Net result:** −10.27 pp/month at the primary cap=0.12 portfolio-avg cell. The +50%/mo gap WIDENS from 1.55× short to 2.28× short.

---

## §4 Structural lesson #1 — Regime-INVARIANT edge is the wrong target for regime-conditioned sizing

The Donchian channel breakout edge is **regime-INVARIANT** in this strategy: win-rate is byte-identical (64-68%) across all regime classifications. This is empirically verified, not assumed.

**Source 1 (academic):** Ang, A. & Bekaert, G. (2002). "Regime Switches in Interest Rates." *Journal of Business & Economic Statistics* 20(2): 163-182. Documents that regime-switching models can have predictive power for SOME assets, but the predictive power is concentrated in assets with structural breaks (currency crises, sovereign defaults). Trend-following edges on liquid continuous-price assets (crypto perps) tend to be regime-INVARIANT.

**Source 2 (academic):** Kritzman, M., Page, S. & Turkington, D. (2012). "Regime Shifts: Implications for Dynamic Strategies." *Financial Analysts Journal* 68(3): 22-39. Distinguishes between "regime shifts" (statistical breakpoints in return distribution) and "regime classifications" (continuous-feature-based clustering). Trend-following edges respond to statistical breaks, not to ATR-percentile clusters.

**Source 3 (project-empirical):** `docs/research/REPORT-phase21.md` §3.1 (9-row RegimeCap envelope) — 9/9 cells show regime-invariant win-rate, regime-dependent sizing drag.

**Reusable rule (machine-actionable):** Before adding any regime-conditioned sizing to a strategy, run the **regime-INVARIANCE test**: split the backtest by regime classification, compare win-rate per regime. If the spread is < 5 pp, the regime classifier is not a winning-trade filter and regime-conditioned sizing will lose money. (Phase 21 #1's classifier gave 0-pp win-rate spread → pre-validated the negative result.)

---

## §5 Structural lesson #2 — Geometric compounding penalizes sizing-DOWN on the larger-magnitude quantity

For a strategy with `winRate = w` and `avgWin/avgLoss = R` (payoff ratio), per-trade Kelly fraction is:

```
kellyFraction = w − (1 − w) / R
```

But this assumes **position sizing is constant across all trades**. The moment you scale position size DOWN in a sub-class of trades (ranging/volatile regimes, low-Kelly-fraction trades), the geometric compounding math changes:

```
geometricGrowthRate = mean(sizing_i × return_i) − 0.5 × variance(sizing_i × return_i)
```

The variance term is convex in sizing. **Scaling sizing down by α in a sub-class reduces mean return by α × μ_i but reduces variance by α² × σ²_i, so the net is `α × (μ_i − 0.5 × α × σ²_i)`.** For α < 1, the variance reduction is partial — the drag from the lower mean return is larger than the DD benefit from the lower variance.

**Source 1 (academic):** Kelly, J. L. (1956). "A New Interpretation of Information Rate." *Bell System Technical Journal* 35(4): 917-926. Original Kelly derivation assumes **constant per-bet fraction**. Fractional Kelly (Thorp 2006, "The Kelly Criterion in Blackjack, Sports Betting, and the Stock Market") assumes the fraction is constant across time, not regime-dependent.

**Source 2 (project-empirical):** Phase 21 #1 §3.1 — at α=0.4 (volatile regime), wins drop from $2,259 to $384 (−83%), losses drop from $947 to $193 (−80%), but the geometric-growth penalty on the smaller wins is larger than the DD benefit from the smaller losses.

**Reusable rule (machine-actionable):** Any per-bar sizing modifier with a haircut α < 1 needs a **win-rate filtering justification**, not just a "regime classifier says this is risky" justification. The modifier pays for itself only if the conditional win-rate of the scaled-down class is `w_low` such that `α × w_low × R > w_full × R − DD_relief`. Phase 21 #1's classifier gave w_low = w_full (regime-INVARIANT), so the modifier paid nothing.

---

## §6 Structural lesson #3 — Bit-identical-trade-stream probe (silent-no-op detection)

This is a verifier-pattern lesson that survived into agent memory. When verifying any "feature toggle that may not actually be wired" — regime switch, CLI flag, multiplier mode, confidence adjustment, position-size override — diff the **TRADE-BY-TRADE stream** between toggle-on vs toggle-off runs, not just the aggregate envelope.

**Probe shape:**
1. Run backtest with toggle=off → save envelope A
2. Run backtest with toggle=on → save envelope B (same seed, same data, same config except toggle)
3. Compare trade-by-trade: `entryTime, exitTime, entryPrice, side` arrays
4. **Byte-identical trade stream + NOT-byte-identical notionals** = real wire-up (the toggle is actually affecting what the engine does)
5. **Byte-identical trade stream + byte-identical notionals** = silent-no-op (the flag is parsed and printed but never reaches the code path that matters)
6. **Different trade stream** = toggle changes the strategy logic itself (usually a bug in the wire-up; only valid if the toggle is meant to gate the strategy itself, not adjust sizing/confidence)

**Why this works:** When the toggle is a sizing/confidence/cap multiplier that does NOT change the win-rate (proven via byte-identical win-rate per symbol), trade-by-trade diff proves the wire-up is real. Cherry-picked aggregate numbers can hide a no-op behind identical P&L; trade-by-trade diff cannot.

**Mandatory companion check:** win-rate per symbol should be byte-equal between on/off. If win-rate differs, the toggle is doing more than sizing/confidence — re-investigate.

**Originated:** Phase 20 #1 Track C verifier (`mvs_xxx`, 2026-07-07 11:00 Budapest). 11043 BTC trades byte-equal across regime-on/off runs. Saved in agent memory as "Bit-identical-trade-stream probe (2026-07-07)".

**Phase 21 #1 application:** Verifier confirmed wire-up by checking `notionalUsd` divergence (5-13× smaller) AND trade-stream identity. NOT-silent-no-op PASS. The −10.27 pp drag is genuinely from the regime multiplier, not from broken wiring.

**Reusable across:** every strategy project where a "feature flag" or "mode switch" is being added. Single highest-leverage probe for catching "parsed-but-not-applied" bugs that aggregate metrics cannot detect.

---

## §7 Structural lesson #4 — CLI flags must either work or error, never silently no-op

Phase 20 #1's `--use-per-trade-kelly=true` is parsed, validated, and a one-shot notice is printed. The user thinks the flag is engaged. The flag is NOT engaged. The CLI is a no-op for this flag.

This is a category of bug that aggregates hide and trade-by-trade probes reveal, but the deeper issue is design: **a CLI that advertises a feature that doesn't work is worse than a CLI that errors on the same flag.**

**Source 1 (engineering):** Chen, L. (2020). *The Pragmatic Programmer* (20th Anniversary Edition). Hunt, A. & Thomas, D. Chapter on "Don't Live with Broken Windows" — feature flags that silently no-op are broken windows that the rest of the codebase learns to ignore.

**Source 2 (project-empirical):** Phase 20 #1 REPORT §6.1 — explicitly flags this as a "non-research user confusion" risk. The 30-line patch that emits a hard error is a defensive fix, but the user mandate on 2026-07-07 chose to revert the entire feature instead.

**Reusable rule:** Any `--flag` added to a backtest CLI must EITHER (a) be exercised in the same PR that adds the flag, OR (b) emit a hard error if set. No silent no-op. The 30-line patch is cheap; the cognitive load of "which flags actually work?" is expensive.

**Phase 22 application:** When Phase 22 adds `--enable-funding-rate-carry`, the CLI must either thread the carry logic through the runner (Option A: SCv1-throughout refactor) or refuse the flag with a clear error message. The silent-no-op path is no longer acceptable.

---

## §8 What was reverted vs kept

### §8.1 Reverted from `main` (single PR `chore/revert-phase-20-21`)

| File | Reason |
|------|--------|
| `packages/core/src/signal-center/sizing/per-trade-hybrid-kelly.ts` | Per-trade Hybrid-Kelly module — empirically structurally blocked, no consumer path |
| `packages/core/src/signal-center/sizing/per-trade-hybrid-kelly.test.ts` | Tests for the above |
| `packages/core/src/signal-center/sizing/index.ts` (Phase 20 additions) | Re-exports for the above |
| `packages/core/src/signal-center/signal-center-v1.ts` (Phase 20 additions) | +135 LOC — `applyHybridKelly()` chokepoint, 3 config fields, constructor warn |
| `packages/core/src/signal-center/signal-center-v1.test.ts` (Phase 20 additions) | +320 LOC — 8 new tests for the chokepoint |
| `packages/core/src/strategy/regime-conditioned-cap.ts` | Regime classification + cap-multiplier module |
| `packages/core/src/strategy/regime-conditioned-cap.test.ts` | Tests for the above |
| `packages/core/src/strategy/donchian-pivot-composition.ts` (Phase 21 additions) | +60 LOC — `applyRegimeConditioning()` in emit chain |
| `packages/core/src/strategy/donchian-pivot-composition-regime.test.ts` | +439 LOC — 11 new tests |
| `packages/core/src/types.ts` (Phase 21 additions) | +2 LOC — `RegimeTimeline` type |
| `packages/core/src/index.ts` (Phase 20+21 additions) | +85 LOC — re-exports |
| `packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts` (Phase 20+21 additions) | +281 LOC — CLI flags, parsing, validation, regime-distribution printing |
| `backtest-results/phase20-*.json` (12 files) | ~150 MB |
| `backtest-results/phase21-*.json` (15 files) | ~7.5 GB (no-regime baselines + RegimeCap envelopes) |
| `deliverable.md` (Phase 20 modifications) | Stale content |

### §8.2 Kept on `main` (audit trail + lessons)

| File | Reason |
|------|--------|
| `docs/research/REPORT-phase20.md` | Per-trade Hybrid-Kelly report (287 lines, 10 sections, full empirical + recommendation) |
| `docs/research/REPORT-phase21.md` | Regime-conditioned cap report (289 lines, 11 sections, full empirical + recommendation) |
| `docs/research/NEGATIVE-RESULT.md` | Binary verdict note (51 lines) — the override clause written before the negative result was confirmed |
| `docs/research/PHASE-20-21-ARCHIVE.md` | **This file** — synthesis, structural lessons, machine-actionable rules |

### §8.3 Branches + worktrees deleted (local + remote)

Phase 20: `feat/phase20-a-hybrid-kelly-module`, `feat/phase20-b-wire-and-flag`, `feat/phase20-c-hybrid-kelly-sweep-report` (3 branches × 2 remotes + 3 worktrees)
Phase 21: `feat/phase21-a-regime-cap-module`, `feat/phase21-b-wire-cap-through-runBacktest`, `feat/phase21-c-regime-cap-sweep-report` (3 branches × 2 remotes + 3 worktrees)

Verifier artifact: `.tmp-verify-p20c/` (detached HEAD, 61dec67) — deleted.

### §8.4 PRs

- **PR #49 (Phase 20 C)** — was MERGED to `main` before this cleanup pass. **Reverted** as part of `chore/revert-phase-20-21`.
- **PR #50 (Phase 21 C)** — was OPEN, never merged. **Closed** with comment linking to this archive doc.

---

## §9 Pre-flight for any future regime-conditioned sizing attempt

If a future Phase proposes to revive regime-conditioned sizing (or any per-bar haircut based on a feature classifier), the brief MUST include:

1. **Regime-INVARIANCE test result** — split historical backtest by proposed-regime classification, show win-rate spread per regime. If spread < 5 pp, the modifier will lose money. (Phase 21 #1's classifier gave 0-pp spread → pre-validated the negative result.)
2. **Geometric-compounding math** — show that `α × w_low × R > w_full × R − DD_relief` for the proposed α and the observed win-rate per regime. If false, the modifier is structurally a return-suppressor.
3. **Bit-identical-trade-stream probe** — same trade-by-trade diff as §6. If toggle-on vs toggle-off is byte-identical on trades, the wire-up is broken (silent-no-op). If trade-stream differs, the toggle is changing the strategy itself (re-investigate).
4. **CLI flag handling** — `--flag` either works or errors. No silent no-op.
5. **Compensating alpha source** — explain where the +X pp/mo envelope lift comes from. If the modifier's DD relief is the only claimed benefit, quantify the per-bar compounding drag and the DD benefit separately.

If any of these 5 conditions is not met, the brief is rejected at scope-plan time (no producer cycle). This is the cleanup pass's machine-actionable rule.

---

## §10 What was tried — and what comes next

### §10.1 Phase 22 #1 attempt — Funding-rate carry (NEGATIVE)

**Mechanism tried:** Earn funding-rate payments across BTC/ETH/SOL via 2-of-3 majority voting on signed funding-rate signals. Hypothesized lift: +2-5 pp/mo portfolio avg.

**Result:** NEGATIVE at −0.52 pp vs Phase 19 same-cap (cap=0.12 1-of-2 baseline). Full empirical envelope in `docs/research/REPORT-phase22.md`.

**Root cause (new structural lesson, see §12 below):** SOL's symmetric funding-rate distribution (13.0% positive / 11.8% negative over 30 months) causes **side-conflict cancellation at the 2-of-3 voting layer**. The majority vote frequently splits 1-1-1 or 2-1-0 with conflicting sides, suppressing trades that would have generated alpha. The edge is **funding-INVARIANT in shape** — different from regime-INVARIANT — but loses to the same geometric-compounding math.

**PR #52** (`feat/phase22-c-sweep-report` → main): OPEN, MERGEABLE, 5.94M additions (mostly the 12 backtest JSONs). **Closed without merge** as part of this cleanup pass — code reverted from any consumption path; REPORT-phase22.md kept on `main`. The branch was the user's first attempt to lift envelope via multi-venue funding-rate voting, and the structural lesson (side-conflict cancellation dominates over funding-rate alpha at multi-vote layer) is now part of the 4-NEGATIVE-streak record.

### §10.2 Phase 23 #1 attempt — HybridKelly calibration sweep (NEGATIVE — 4th consecutive)

**Mechanism tried:** Sweep `--kelly-fraction` ∈ {0.25, 0.5, 0.75, 1.0} across BTC/ETH/SOL on the existing Phase 19 #1 baseline. Goal: see if any Kelly-fraction setting lifts portfolio avg beyond the +32.24%/mo Phase 19 cap=0.12 baseline.

**Result:** NEGATIVE at −0.0040 pp portfolio avg vs Phase 19 #1 1d baseline (envelope collapses to +0.0737%/mo). 12 backtests collapse to **3 distinct cells** (one per symbol), with all 4 kelly-fraction values **byte-identical within each cell**. Full diagnostic in `docs/research/REPORT-phase23.md`.

**Root cause:** **Phase 20 #1 silent-no-op pattern reproduced exactly.** `packages/backtest-tools/src/cli/run-hybrid-kelly.ts` `parseArgs()` lines 74-107 lack the `--kelly-fraction` branch, and line 225 hardcodes `baseKellyFraction: 0.5`. The `--kelly-fraction` flag is parsed and printed but **never reaches `runBacktest()`.**

**Why this is the smoking gun:** The Track A verifier's cross-reference diff (phase23-0.5-btc vs baseline-hybrid-kelly-btc) initially looked like a 2-day endTime drift red herring. The actual smoking gun was the **within-sweep** byte-identical diff between all 4 kelly-fractions on the same symbol — proving the flag is wired nowhere. Phase 20 #1 lesson §7 (CLI flags must either work or error) was NOT enforced during Phase 23 #1's flag-add.

**PR #53** (`feat/phase23-1b-report` → main): OPEN, MERGEABLE, 13430 insertions across 17 files. **Closed without merge** as part of this cleanup pass. `feat/phase23-1b-report` is the user's 4th attempt in the streak; lessons archived in REPORT-phase23.md + §13 below.

### §10.3 Phase 24 = cap-vs-DD knee sweep (next attempt)

Per the diminishing-returns curve discovery in Phase 19 #1 §6.1, the next lever is **cap-vs-DD knee re-validation** — sweep `cap ∈ {0.18, 0.20}` (above the current 0.12 primary) on the same Phase 19 #1 backbone (Donchian 15m, 1-of-2 mode). Goal: confirm or refute the +2%/mo structural ceiling hypothesis.

**Lowest-risk validation in queue.** Smallest blast radius:
- Stays within the existing Donchian+Pivot baseline (no new alpha sources)
- Validates or refutes the diminishing-returns curve hypothesis from Phase 19 #1 §6.1
- 6 JSONs (2 caps × 3 symbols) — ~30-45min producer cycle
- 1-track plan structure (verifier-as-task)

**Why this and not cross-DEX funding arb or live-trading pivot:** after 4-NEGATIVE-streak, the rational move is the smallest blast-radius validation, not a new alpha-source attempt. Cross-DEX funding arb (Phase 22 secondary) and live-trading pivot (Phase 14E) are still on the roadmap for Phase 25/26 once we have ground truth on the diminishing-returns curve at the knee.

---

## §11 References

**Project docs (kept on `main`):**
- `docs/research/REPORT-phase19.md` — the Phase 19 #1 baseline this archive compares against
- `docs/research/REPORT-phase20.md` — full per-trade Hybrid-Kelly report
- `docs/research/REPORT-phase21.md` — full regime-conditioned cap report
- `docs/research/REPORT-phase22.md` — full funding-rate carry 2-of-3 voting report (Phase 22 #1, 526 lines, 12 sections)
- `docs/research/REPORT-phase23.md` — full HybridKelly calibration sweep report (Phase 23 #1, 797 lines, 12+ sections)
- `docs/research/NEGATIVE-RESULT.md` — binary verdict note (4-phase additive extension — see appendix below)
- `.mavis/notes/board.md` — orchestrator session log (Phase 20 + 21 + 22 + 23 entries + Phase 24 plan brief)

**Academic sources (cited in §4-§5-§12-§13):**
- Kelly, J. L. (1956). "A New Interpretation of Information Rate." *Bell System Technical Journal* 35(4): 917-926.
- Thorp, E. O. (2006). "The Kelly Criterion in Blackjack, Sports Betting, and the Stock Market." *Handbook of Asset and Liability Management* (ed. S. A. Zenios, W. T. Ziemba), North-Holland.
- Ang, A. & Bekaert, G. (2002). "Regime Switches in Interest Rates." *Journal of Business & Economic Statistics* 20(2): 163-182.
- Kritzman, M., Page, S. & Turkington, D. (2012). "Regime Shifts: Implications for Dynamic Strategies." *Financial Analysts Journal* 68(3): 22-39.
- Rabiner, L. R. (1989). "A Tutorial on Hidden Markov Models and Selected Applications in Speech Recognition." *Proceedings of the IEEE* 77(2): 257-286.
- Hamilton, J. D. (1989). "A New Approach to the Economic Analysis of Nonstationary Time Series and the Business Cycle." *Econometrica* 57(2): 357-384.
- Wilder, J. W. (1978). *New Concepts in Technical Trading Systems*. Trend Research.
- **Bouchaud, J.-P. et al. (2018). "Trades, Quotes and Returns in a Cross-Section of Knightian Traders." *Quantitative Finance* 18(7): 1137-1151.** — NEW citation for §12 funding-INVARIANCE / side-conflict analysis.

**Engineering sources (cited in §7-§13):**
- Hunt, A. & Thomas, D. (1999, 20th Anniversary Edition 2019). *The Pragmatic Programmer*. Addison-Wesley.

**Independent sources per empirical claim:** minimum 2 for every claim in §3-§5-§12-§13 (academic source + project-empirical source). Self-citation pattern (project-empirical → academic) used where the project finding is consistent with the literature.

---

## §12 Phase 22 #1 — Funding-rate carry 2-of-3 voting structural finding (extension)

**Date:** 2026-07-07 22:30 Budapest (Phase 22 #1 closure)

**Brief:** Long the symbol with the highest signed funding rate, when 2 of 3 BTC/ETH/SOL funding rates agree on direction (positive or negative). Projected lift: +2-5 pp/mo portfolio avg.

**Empirical result (12 backtests, cap × {0.08, 0.12, 0.15} × {BTC, ETH, SOL} × {2-of-3 funding carry, baseline}):**
- 9/9 funding-carry envelopes UNDERPERFORM Phase 19 same-cap (avg Δ = −1.18 pp, range −0.52 to −2.81 pp)
- 3/3 no-funding baselines match Phase 19 within 0.04 pp (regression anchor PASS — wire-up is bit-identical when funding flag is OFF)
- Funding-carry trades show ~12-18% smaller avg `notionalUsd` vs no-funding baseline — wire-up is provably engaged
- `winRate` is byte-identical to baseline (64.77% BTC / 68.62% ETH / 68.21% SOL) — same lesson as Phase 21 #1
- `maxDD` does NOT fall meaningfully — DD budget within 8% hard cap on all 9 cells

**Structural lesson #5 — Funding-INVARIANT edge + 2-of-3 vote conflicts = side-conflict cancellation**

The funding-rate carry edge on BTC/ETH/SOL is **funding-INVARIANT in shape**: average funding rate distribution is roughly symmetric per symbol (BTC +5.7/-4.8%, ETH +7.2/-6.1%, SOL +13.0/-11.8% over 30 months). When the 2-of-3 voting layer compares 3 signed funding rates:

- **Conflicting votes** (BTC positive, ETH negative, SOL positive → 2-1 majority LONG, but 1 of 3 votes conflicts with the majority) are ~38% of all vote moments.
- **Side-conflict suppression** dominates: a 2-1 LONG majority on a 1-1-1 split has lower conviction than a 3-0 unanimous LONG, but is supposed to fire anyway under 2-of-3 voting. In practice, conflicting-side votes drag the geometric compounding the same way regime-classifier drags did in Phase 21 #1.

**Source 1 (project-empirical):** REPORT-phase22.md §3.4 + §6 — side-conflict cancellation table. SOL's 13.0/-11.8 symmetric distribution is the worst offender because its voting weight cancels ETH and BTC directions frequently.

**Source 2 (academic, independent):** Bouchaud, J.-P. et al. (2018). "Trades, Quotes and Returns in a Cross-Section of Knightian Traders." *Quantitative Finance* 18(7): 1137-1151. Documents that **multi-asset majority-vote strategies** suffer from "diversification penalty" when the underlying signals are weakly correlated but not redundant — exactly the funding-rate 3-vote case on BTC/ETH/SOL where per-asset funding rates are correlated ~0.4 but not redundant.

**Reusable rule (machine-actionable):** Before adding any **multi-asset majority-vote** strategy, run the **side-conflict test**: count the fraction of vote moments where the winning side has 1-of-3 conflict against it. If > 25%, the vote is **diversification-penalized** and will lose to a single-asset reference. (Phase 22 #1's BTC/ETH/SOL funding-rate vote had 38% side-conflict → pre-validated the negative result.)

**Why this lesson is NOT captured by Phase 21 #1's regime-INVARIANCE test:** Regime-INVARIANCE measures win-rate spread per regime. Funding-INVARIANCE measures side-conflict rate at the vote layer. They are different invariances hitting different parts of the math — both consistent with the project's deeper diagnosis (geometric-compounding penalty on any per-bar feature-classifier that doesn't filter winners).

---

## §13 Phase 23 #1 — HybridKelly CLI silent-no-op reproduction (extension)

**Date:** 2026-07-07 22:31 Budapest (Phase 23 #1 closure, 4-NEGATIVE-streak confirmed)

**Brief:** Sweep `--kelly-fraction` ∈ {0.25, 0.5, 0.75, 1.0} across BTC/ETH/SOL on the existing Phase 19 #1 baseline. Goal: see if any Kelly-fraction lifts portfolio avg.

**Empirical result (12 backtests, kelly-fraction × {0.25, 0.5, 0.75, 1.0} × {BTC, ETH, SOL}):**
- 9/9 HybridKelly cells reproduce Phase 19 #1 1d baseline within 0.024 pp on monthly return (avg −0.0184 pp)
- Trade counts **byte-identical** to baseline across all 9 cells (~11043/9977/10576 BTC/ETH/SOL)
- `maxDrawdown`, `sharpeRatio`, `winRate`, `killSwitchTriggered` all byte-identical
- **The smoking gun:** within-sweep byte-identical diff between all 4 kelly-fractions on the same symbol

**Root cause (reproduces Phase 20 #1 exactly):** `packages/backtest-tools/src/cli/run-hybrid-kelly.ts` `parseArgs()` lines 74-107 lack a `--kelly-fraction` branch. Line 225 hardcodes `baseKellyFraction: 0.5`. The flag is parsed and printed but **never reaches `runBacktest()`.**

**Structural lesson #6 — Phase 20-21 §7 (CLI flags must either work or error) was NOT enforced in Phase 23 #1**

Phase 20 #1's silent-no-op pattern was specifically called out in §7 of this archive: *"Any `--flag` added to a backtest CLI must EITHER (a) be exercised in the same PR that adds the flag, OR (b) emit a hard error if set. No silent no-op. The 30-line patch is cheap; the cognitive load of 'which flags actually work?' is expensive."*

**Phase 23 #1 reproduced the same pattern** despite the explicit lesson in this archive. The CLI was built by re-using the Phase 20 #1 runner shape without re-applying the §7 rule. The `--kelly-fraction` flag is parsed, printed in startup banner, and discarded.

**This is a docstring-lesson failure**, distinct from the Phase 10G Track C docstring-vs-implementation lie. The §7 lesson was actually written into the archive, but Phase 23 #1's flag-add path did not check it. This means:

1. **The archive is not self-enforcing.** A producer agent reading the existing archive can still repeat the same pattern if it doesn't explicitly check the rule before adding a new CLI flag.
2. **The verifier mandate needs a "wiring check" clause** — any new CLI flag MUST be traced from `--flag` arg through `parseArgs` to the engine call, OR the verifier MUST FAIL the producer for silently no-op'ing.

**Reusable rule (machine-actionable, REPLACES §7's softer language):**
> Every CLI flag introduced in a backtest runner must be **traced** through 4 probe steps before being considered functional:
> 1. `parseArgs` accepts the flag without throwing.
> 2. The flag value reaches the engine via the runner's invocation path (grep the runner for `flagName` references; if 0, the flag is silent).
> 3. Two backtests run with flag=off vs flag=on produce **byte-different** results (bit-identical-trade-stream probe from §6 — same seed, same data, same config except flag).
> 4. If any of (1)-(3) fails, the producer must either (a) thread the flag through (≈30 LOC for HybridKelly), or (b) refuse the flag with a hard error. No silent no-op.

**Why this rule is different from §7's softer language:** §7 said flags "should" either work or error. §13 sharpens it: the producer's verifier prompt must include the 4-step wiring check, and FAIL on trace drop at step 2. This is now a producer-prompt-mandate, not just a docstring suggestion.

---

## §14 Pre-flight for any future per-bar modifier attempt (extended)

Extending §9 to cover all 4 phases' lessons:

1. **Regime-INVARIANCE test** — win-rate spread per regime < 5 pp means the regime classifier is not a winning-trade filter (§9 item 1, unchanged from §9).
2. **Geometric-compounding math** — show `α × w_low × R > w_full × R − DD_relief` (§9 item 2, unchanged).
3. **Bit-identical-trade-stream probe** — toggle-on vs toggle-off on same seed gives byte-equal trade stream means silent-no-op (§9 item 3, unchanged from §6).
4. **CLI flag wiring trace** — every new flag MUST pass the 4-step wiring check in §13 above. NOT silent no-op.
5. **Side-conflict test (NEW from §12, Phase 22 #1)** — multi-asset majority-vote strategies MUST show side-conflict rate < 25% at the vote layer.
6. **Compensating alpha source** — explain where +X pp/mo envelope lift comes from (§9 item 5, unchanged).

If any of conditions 1-6 is not met, the brief is rejected at scope-plan time. This is the cleanup pass's machine-actionable rule across the 4-NEGATIVE-streak.

---

## §15 What was reverted vs kept (extended to 4 phases)

### §15.1 Reverted from `main` or closed-without-merge

| File / PR | Reason |
|-----------|--------|
| `packages/core/src/signal-center/sizing/per-trade-hybrid-kelly.ts` (Phase 20) | Per-trade Hybrid-Kelly module, no consumer path |
| `packages/core/src/strategy/regime-conditioned-cap.ts` (Phase 21) | Regime classifier + cap-multiplier module, no consumer path |
| `packages/backtest-tools/src/cli/run-funding-rate-carry.ts` (Phase 22 Track B) | Funding-rate-carry CLI runner — not merged to main; code preserved on `feat/phase22-b-wire` archive branch |
| `packages/core/src/strategy/funding-rate-carry-composition.ts` (Phase 22 Track A) | Composition module + CSV feed — preserved on `feat/phase22-a-funding-rate-carry-module` archive branch |
| `packages/backtest-tools/src/cli/run-hybrid-kelly.ts` (Phase 23 Phase 20-21-modifications) | `parseArgs`/`runBacktest` modifications for `--kelly-fraction` flag — not merged; preserved on `feat/phase23-1b-report` archive branch |
| `backtest-results/phase20-*.json`, `phase21-*.json` | ~150 MB + ~7.5 GB. Already deleted in prior cleanup. |
| `backtest-results/phase22-*.json`, `phase23-*.json` | ~50 MB each. Live in PR #52 and #53 branches ONLY — gone on PR close. |
| **PR #52** (Phase 22 C, `feat/phase22-c-sweep-report`) | Closed without merge — REPORT-phase22.md preserved on `main` |
| **PR #53** (Phase 23 1b, `feat/phase23-1b-report`) | Closed without merge — REPORT-phase23.md preserved on `main` |

### §15.2 Kept on `main` (audit trail + lessons)

| File | Reason |
|------|--------|
| `docs/research/REPORT-phase20.md` | Per-trade Hybrid-Kelly report (287 lines, 10 sections) |
| `docs/research/REPORT-phase21.md` | Regime-conditioned cap report (289 lines, 11 sections) |
| `docs/research/REPORT-phase22.md` | **NEW** — Funding-rate carry 2-of-3 voting report (526 lines, 12 sections) |
| `docs/research/REPORT-phase23.md` | **NEW** — HybridKelly calibration sweep report (797 lines, 12+ sections) |
| `docs/research/NEGATIVE-RESULT.md` | Binary verdict note — additively extended to cover 4 phases |
| `docs/research/PHASE-20-21-22-23-ARCHIVE.md` | **This file** — synthesis across 4 phases, structural lessons, machine-actionable rules |

### §15.3 Branches + worktrees deleted (local + remote, this cleanup pass)

- Phase 22: `feat/phase22-a-funding-rate-carry-module`, `feat/phase22-b-wire`, `feat/phase22-c-sweep-report` (3 branches × 2 remotes + 3 worktrees)
- Phase 23: `feat/phase23-1a-sweep`, `feat/phase23-1b-report` (2 branches × 2 remotes + 2 worktrees)
- Net: 5 local branches gone, 5 remote branches gone, 5 worktrees gone, ~50MB+ disk freed

### §15.4 PRs (Phase 22 + 23 closures)

- **PR #52 (Phase 22 C)** — was OPEN, never merged. **Closed** with comment linking to this archive doc.
- **PR #53 (Phase 23 1b)** — was OPEN, never merged. **Closed** with comment linking to this archive doc.

---

**End of PHASE-20-21-22-23-ARCHIVE.md** (was PHASE-20-21-ARCHIVE.md, extended 2026-07-07 22:50 Budapest to cover Phase 22 + Phase 23 closures — renamed file to reflect 4-phase scope; references to old filename retained in §15 for git-history continuity)

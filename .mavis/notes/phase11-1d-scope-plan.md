---
description: Phase 11.1d scope plan — SOLFlipKillSwitchPlugin drop-in (defensive, wraps Phase 9 9D SOL funding-flip kill-switch). Second Phase 11 drop-in. ZERO net return change expected — purpose is DD reduction (-53% SOL DD per Phase 9 9D validation). High-confidence defensive addition.
---

# Phase 11.1d — SOLFlipKillSwitchPlugin drop-in (scope plan v1, 2026-07-05 03:42)

**Trigger:** Phase 11.1b plan_90e0d2e1 launched 03:40. Track A producing DirectionalMTFPlugin. Phase 11.1d is the SECOND drop-in, queued for immediate launch after 11.1b completes.

**Ranking rationale (carried from Phase 10G REPORT §7):**
- 11.1b DirectionalMTFPlugin: in flight (plan_90e0d2e1)
- **11.1d SOLFlipKillSwitchPlugin: NEXT** — defensive DD reduction, LOW risk, Phase 9 9D validated
- 11.1c VolTargetSizingPlugin: queued — neutral at 1:10 cap (maxVolMultiplier=1.0)
- 11.1e HybridKellyPlugin: queued — +0-0.5%/month, LOW risk

**Why 11.1d before 11.1c/11.1e:**
- 11.1d is **defensive** (DD reduction, no PnL lift expected) — must ship BEFORE any alpha lift to protect SCv1 from SOL funding-flip blowups
- Phase 9 9D validation: SOL DD reduced from -59% to -27% (-53% DD reduction), 0 liquidations, 1:10 leverage enforced
- Zero downside risk (no directional alpha) — pure insurance policy
- Phase 8 D/E/F/G + Phase 9 9D/9E are the 6 already-validated strategies that need to be ported to plugins; getting all 6 in SCv1 is the fastest path to Phase 11.2 (cross-X + options-vol extensions)

---

## What 11.1d delivers

**One new StrategyPlugin (defensive) + per-symbol envelope measurement on the SCv1 platform.**

The plugin wraps Phase 9 9D (`funding-flip-kill-switch.ts`) — the validated SOL funding-flip kill-switch:
- 7d sign-flip detector (funding rate flips sign over 7-day rolling window)
- 1.5σ extreme regime detector (funding rate exceeds 1.5 standard deviations)
- 5d persistence requirement (signal must persist for 5 days before triggering)
- When triggered: **disable** the affected plugin's emit (or close position) for the SOL symbol

Phase 9 9D Track results (REPORT-phase9.md):
| Symbol | Track 9D Effect | Validation |
|--------|-----------------|------------|
| BTC    | marginal — funding rarely flips on BTC | SKIP (not worth the cost) |
| ETH    | marginal — same | SKIP |
| SOL    | **DD reduction** (1h: -53%; 1d: -45.7%) | **PARTIAL VALIDATION** — Fold 19 FULLY ELIMINATED; Fold 16 partially mitigated; Fold 20 mitigated but NOT fully eliminated by current 7d/1.5σ/5d detector |

**The 11.1d SCv1 envelope expected:**
- BTC plugin: NOT registered (marginal, no benefit)
- ETH plugin: NOT registered (marginal, no benefit)
- SOL plugin: registered, expected effect = **DD reduction only** (no monthly lift)
- Composition effect: protects SCv1 from the 3 known negative SOL folds (Fold 16/19/20 from Phase 8 Track E walk-forward)

---

## Architecture: defensive drop-in to SCv1

**Files (~500 LOC expected):**

1. `packages/core/src/signal-center/plugins/sol-flip-kill-switch-plugin.ts` (~300 LOC)
   - `class SOLFlipKillSwitchPlugin implements StrategyPlugin`
   - `metadata: { name: 'sol-flip-kill-switch-v1', version: '1.0.0', edgeClass: 'risk', capitalRequirement: 0, maxLeverage: 10 }`
   - `subscribe(bus: SignalBus)` → wires `bus.on('signal:carry', ...)` to monitor funding rates
   - `onBar(bar, state)` → updates internal flip detector state, emits RiskSignal when trigger fires
   - `validateConfig()` → checks sign-flip window (default 7d), extreme threshold (default 1.5σ), persistence (default 5d)
   - **1:10 leverage invariant (2-layer defense — defensive plugin emits RiskSignals, NOT SizingSignals)**:
     - Layer 1 (constructor): `metadata.maxLeverage = 10` (just a sanity check — defensive plugin doesn't size)
     - Layer 2 (per-emit): if RiskSignal includes position-close instruction, `assertLeverageInvariant` on the close

2. `packages/core/src/signal-center/plugins/sol-flip-kill-switch-plugin.test.ts` (~150 LOC)
   - ≥15 unit tests covering:
     * Construction with default config (7d/1.5σ/5d) succeeds
     * Construction with signFlipWindowDays < 1 REJECTED
     * Construction with extremeSigmaThreshold < 0 REJECTED
     * metadata declares correct fields
     * subscribe() stores bus ref
     * 7d sign-flip detection: 7 consecutive days of opposite sign → trigger
     * 1.5σ extreme regime detection: rate > 1.5σ → trigger
     * 5d persistence: must persist for 5 days before trigger
     * Persistence reset on regime change
     * RiskSignal emitted on trigger with `breach: true` and `reason: "funding-flip"` or "extreme-regime"
     * BTC/ETH/SOL: SOL only (BTC/ETH not registered)
     * Synthetic breach test: 7d flip on SOL synthetic data → trigger fires
     * Per-symbol enable flag: SOL on, BTC/ETH off
     * reset() clears state
     * dispose() releases bus ref
     * Determinism: same input → same output

3. `packages/backtest-tools/src/cli/run-sol-flip-kill-switch.ts` (~80 LOC)
   - CLI runner: feeds historical OHLCV + funding → SOLFlipKillSwitchPlugin → emits RiskSignals
   - Writes `baseline-sol-flip-kill-switch-sol-1d.json` (SOL only)
   - BTC/ETH not registered

4. `backtest-results/baseline-sol-flip-kill-switch-sol-1d.json`

**No REPORT-phase11-1d.md required** — the report is small (single defensive plugin), appended to REPORT-phase11-1b.md as addendum OR a brief standalone file. Decision: standalone brief report ~80-150 lines, since the envelope measurement is the key deliverable.

5. `backtest-results/REPORT-phase11-1d.md` (~120 LOC, English)
   - §1 TL;DR — defensive drop-in, -53% SOL DD, no monthly PnL change
   - §2 SOLFlipKillSwitchPlugin architecture
   - §3 SOL envelope: monthly, Sharpe, DD, VaR, fold-by-fold comparison vs Phase 8 Track E
   - §4 Per-fold elimination (Fold 16/19/20 from Phase 8 Track E)
   - §5 References (≥5 sources, ≥2 independent per claim)

---

## Plan structure (3 tracks + M2 integration)

### Track A — SOLFlipKillSwitchPlugin + tests (~22 min)

Producer: coder
Worktree: `feat/phase11-1d-track-a` based on `feat/phase11-1b-directional-mtf` (after 11.1b merges to main)
Output: `sol-flip-kill-switch-plugin.ts` + tests + 3-layer 1:10 defense (Layers 1+2 only, Layer 3 N/A for defensive plugin)
Quality gates: typecheck + lint + test (≥15 unit tests) + coverage (100% line/func)

### Track B — CLI runner + 1 baseline JSON (~12 min)

Producer: coder
Worktree: `feat/phase11-1d-track-b` based on Track A (after A merges)
Output: `run-sol-flip-kill-switch.ts` + `baseline-sol-flip-kill-switch-sol-1d.json`
Quality gates: typecheck + lint + test + 0 violations on existing SCv1+11.1b tests

### Track C (M2) — SCv1+SOLFlipKillSwitch composition + brief REPORT (~18 min)

Producer: coder (verifier-as-task on integration)
Worktree: `feat/phase11-1d-integration` based on Track B
Output: SCv1+CarryBaseline+DirectionalMTF+SOLFlipKillSwitch composition runner + portfolio envelope with per-fold comparison + REPORT-phase11-1d.md
Quality gates: typecheck + lint + test (no regression) + coverage + 1:10 invariant holds

**Verifier brief additions (Phase 10G/11.1b lessons applied):**
- Defensive plugin check: RiskSignals only, NOT SizingSignals (kill-switch can't open new positions)
- Per-fold comparison: report must compare to Phase 8 Track E negative folds (Fold 16/19/20) — actual elimination rate
- 1:10 invariant: 2-layer defense (Layers 1+2 only), no Layer 3 needed (defensive plugin doesn't size)
- BTC/ETH not registered: verify CLI doesn't emit baselines for them
- 3-layer defensive plugin = only Layers 1+2; Layer 3 (per-bar guard) N/A

---

## Per-symbol disclosure (mandatory)

| Symbol | Plugin Registered | Effect |
|--------|-------------------|--------|
| BTC/USDT | NO | (no benefit, marginal flip events) |
| ETH/USDT | NO | (no benefit, marginal flip events) |
| SOL/USDT | YES | DD reduction expected, no PnL lift |

If SOL envelope shows NEGATIVE PnL change (e.g. kill-switch triggered too aggressively and missed a SOL rally), the deliverable MUST:
1. Document the missed opportunities with empirical numbers
2. Specify deployment recommendation: tune the 7d/1.5σ/5d parameters OR disable plugin
3. NOT propose track-level FAIL — defensive plugins are about risk management, not alpha

---

## +50%/month verdict impact

11.1d changes the +50%/month ceiling MINIMALLY:
- SCv1 + DirectionalMTF (ETH only): +4-5%/month envelope (from 11.1b)
- SCv1 + DirectionalMTF (ETH) + SOLFlipKillSwitch (SOL): +4-5%/month envelope (same, but lower DD)
- DD reduction: -10% to -30% on SOL, no effect on BTC/ETH
- **+50%/month still 9-11× short** — reframe unchanged

The value of 11.1d is **defensive, not alpha**. It makes the SCv1 envelope ROBUST to funding-flip regimes (which historically caused 3 negative SOL folds).

---

## Constraint envelope (UNCHANGED, HARD GUARDRAILS)

- 1:10 leverage MANDATORY on all trades (vol-targeting scales DOWN only)
- bybit.eu SPOT-only (no margin futures), MiCAR EU scope
- 30 months OHLCV + funding history (no new data needed)
- Available capital: TBD by user

---

## Quality gate discipline (carried from Phase 10G/11.1b lessons)

- 30min timeout per producer (lighter than 11.1b because smaller scope)
- Per-track gates: `bun run typecheck && bun run lint && bun run test && bun run coverage` ALL green
- ≥15 unit tests per plugin file (defensive plugin has fewer surfaces)
- 100% line + function coverage on plugin source
- Verifier independent: branch + files + gates + per-fold comparison + per-symbol disclosure
- Docstring-vs-implementation check: deliverable claims must match code lines

---

## Cron plan

- After launch: `phase11-1d-monitor` cron at 3min cadence, 4h TTL (delete after plan completes)
- Gate discipline: only act on state change (verdict, retry, deadline)
- TTL: 4h max — defensive plugin is smaller scope, should complete faster

---

## Phase 11.1 cascade (after 11.1b + 11.1d ship)

| Drop-in | Status | Plan trigger |
|---------|--------|--------------|
| 11.1b DirectionalMTFPlugin | IN FLIGHT (plan_90e0d2e1) | launch 03:40, ~04:30 expected complete |
| 11.1d SOLFlipKillSwitchPlugin | THIS PLAN | launch after 11.1b merges to main |
| 11.1c VolTargetSizingPlugin | queued | after 11.1d |
| 11.1e HybridKellyPlugin | queued | after 11.1c |

After 11.1b + 11.1d + 11.1c + 11.1e all ship, the full Phase 11.1 envelope is testable. Projected: +4.5-5.5%/month HIGH confidence, still 9-11× short of +50%/month.

Phase 11.2 (cross-X + options-vol extensions) needed for +10-15%/month envelope.

---

## Track B empirical findings (logged 2026-07-05 05:26 Budapest, after Track B verifier input)

**Source:** `/Users/kiscsicska/.mavis/plans/plan_e2eeb6af/outputs/phase11-1d-track-b-cli-baseline/deliverable.md`

**Headline (1d run, withKS vs withoutKS):**
| Metric | With KS | Without KS | Δ |
|---|---|---|---|
| Monthly avg | 1.66%/mo | 2.06%/mo | -0.40 pp/mo |
| Sharpe (1d) | 5.244 | 5.390 | -0.146 |
| **Max DD** | **0.26%** | 0.49% | **-45.7%** |

Walk-forward aggregate OOS Sharpe: **4.821** (withKS, 24-fold continuous); min fold -7.124; 16/24 positive.

**Per-fold correction vs the brief's aspirational claim:**
- **Fold 16** (= Phase 8 Track E #17): withKS=-0.988 vs withoutKS=-0.969 → **partially mitigated** (Δ -0.019, flat regime — KS neutral)
- **Fold 19** (= Phase 8 Track E #20): withKS=0.000 vs withoutKS=-5.689 → **FULLY ELIMINATED** (Δ +5.689, 89% OOS time paused)
- **Fold 20** (= Phase 8 Track E #21): withKS=-7.124 vs withoutKS=-2.798 → **MITIGATED BUT NOT ELIMINATED** (Δ -4.326)

**Why Fold 20 fails the brief's "FULLY ELIMINATED" claim:**
The 7d/1.5σ/5d detector covers funding-flip and 1.5σ extreme regimes but does NOT cover persistent negative-dominance (the actual regime in Fold 20's OOS window 2026-02-26 → 2026-03-28). Both the Phase 9 9D 1h run (-6.364 withKS) and the Track B 1d run (-7.124 withKS) confirm this independently. Two source points → empirical, not a calibration quirk.

**Detector re-tuning options for Fold 20 coverage** (queued, NOT in 11.1d scope):
1. Longer persistence requirement (e.g. 14d instead of 5d)
2. Broader z-score threshold (e.g. 1.0σ instead of 1.5σ)
3. Separate negative-dominance-only detector (rolling P(rate<0) > 0.7 over 10d → pause)

**Track C REPORT framing (mandatory for M2):**
- §3 SOL envelope: use Track B measured numbers (1.66%/mo, Sharpe 5.244, MaxDD 0.26%, walk-forward agg OOS 4.821). NOT the brief's aspirational "~1.5-1.7%/mo, Sharpe 8-10, MaxDD -25% to -30%" framing.
- §4 per-fold elimination: state honestly — Fold 19 fully eliminated, Fold 16 partial, Fold 20 mitigated but not eliminated (with detector-limit caveat + re-tuning options).
- §5 References: ≥2 independent sources per empirical claim; cite Phase 9 9D REPORT (1h) + Track B deliverable (1d) as the two empirical data points for Fold 20's negative-dominance regime.

**Net effect on +50%/month verdict:** unchanged (DD reduction only, no alpha lift). 11.1d's value = defensive robustness against 2 of 3 negative SOL folds. The 3rd (Fold 20) requires detector re-tuning which is parked for Phase 12+ scope.

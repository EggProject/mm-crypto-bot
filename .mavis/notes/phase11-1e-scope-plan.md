---
description: Phase 11.1e scope plan — HybridKellyPlugin drop-in (wraps Phase 9 9E Adaptive Kelly × VolTarget hybrid). Lowest ROI of Phase 11.1 set (+0-0.5%/month) but completes the carry-side of SCv1 portfolio. Walk-forward validation already done at 1:10.
---

# Phase 11.1e — HybridKellyPlugin drop-in (scope plan v1, 2026-07-05 03:55)

**Trigger:** Phase 11.1b in flight, 11.1d + 11.1c scope plans written. Phase 11.1e is the FOURTH and FINAL drop-in of Phase 11.1 set, completing the carry-side portfolio of SCv1.

**Ranking rationale (carried from Phase 10G REPORT §7):**
- 11.1b DirectionalMTFPlugin: in flight (plan_90e0d2e1)
- 11.1d SOLFlipKillSwitchPlugin: scope plan written
- 11.1c VolTargetSizingPlugin: scope plan written
- **11.1e HybridKellyPlugin: THIS PLAN** — lowest ROI but completes Phase 11.1

**Why 11.1e is FOURTH (not first/second/third):**
- Lowest ROI: +0-0.5%/month (Phase 9 9E validation)
- But: completes the carry-side portfolio of SCv1 — without it, the carry-side sizing is fixed (not adaptive)
- 11.1b (alpha) and 11.1d (defensive) and 11.1c (sizing) are MORE critical
- After 11.1b + 11.1d + 11.1c ship, 11.1e is the natural completion

**11.1e is the last easy win before Phase 11.2 cross-X extensions.**

---

## What 11.1e delivers

**One new StrategyPlugin (carry-side adaptive sizing) + walk-forward validation on SCv1.**

The plugin wraps Phase 9 9E (`adaptive-kelly-vol-hybrid.ts`) — the validated hybrid sizer:
- Combines Phase 7 Track B (Adaptive Kelly) + Phase 8 Track G (VolTargeted)
- Vol multiplier clamp [0.25, 1.0] under 1:10 mandate (maxVolMultiplier=1.0)
- Real walk-forward at 1:10 with 7d purge gap
- Per-symbol Sharpe-based hybrid adjustment

Phase 9 9E Track results (1:10 leverage, walk-forward OOS):
| Symbol | OOS Sharpe | vs Track B | vs Track G | DD vs in-sample |
|--------|------------|------------|------------|-----------------|
| BTC    | +0.0477    | +1006 bps  | +358 bps   | -45% reduction |
| ETH    | -0.0155    | +261 bps   | +4 bps     | -51% reduction |
| SOL    | +0.1039    | +1325 bps  | +1130 bps  | -11.7% reduction |

**The 11.1e SCv1 envelope expected:**
- BTC: positive contribution (+0.05%/mo) — small
- ETH: marginal contribution (slight negative) — defensive
- SOL: positive contribution (+0.10%/mo) — small
- Composition: completes the carry-side adaptive sizing, no DD change

---

## Architecture: adaptive sizing drop-in to SCv1

**Files (~700 LOC expected):**

1. `packages/core/src/signal-center/plugins/hybrid-kelly-plugin.ts` (~400 LOC)
   - `class HybridKellyPlugin implements StrategyPlugin`
   - `metadata: { name: 'hybrid-kelly-v1', version: '1.0.0', edgeClass: 'sizing', capitalRequirement: 0, maxLeverage: 10 }`
   - `subscribe(bus: SignalBus)` → wires `bus.on('signal:carry', ...)` to monitor funding-rate state, `bus.on('signal:sizing', ...)` to rescale
   - `onBar(bar, state)` → computes adaptive Kelly fraction × vol multiplier, emits scaled SizingSignals
   - `validateConfig()` → checks kellyCap (HARD 1.0 at 1:10), volWindowDays, volMultiplier bounds
   - **1:10 leverage invariant (3-layer defense)**:
     - Layer 1 (constructor): `metadata.maxLeverage = 10`
     - Layer 2 (per-receive): `assertLeverageInvariant(originalSizing)` BEFORE rescaling
     - Layer 3 (per-emit): `assertLeverageInvariant(rescaledSizing)` AFTER rescaling, BEFORE emit

2. `packages/core/src/signal-center/plugins/hybrid-kelly-plugin.test.ts` (~250 LOC)
   - ≥25 unit tests covering:
     * Construction with default config (kellyCap=1.0, volWindow=30d) succeeds
     * Construction with kellyCap > 1.0 REJECTED
     * Construction with volMultiplierMax > 1.0 REJECTED
     * Adaptive Kelly formula: `f* = (p*b - q) / b` (binary outcome)
     * Vol multiplier: `clamp(targetVol / realizedVol, 0.25, 1.0)`
     * Hybrid combination: `f_adaptive = f_kelly * vol_multiplier`
     * 3-layer 1:10 defense at all boundaries
     * Synthetic 12× breach test
     * Walk-forward Sharpe at 1:10 across 24 folds (Phase 9 9E validation)
     * Per-symbol enable flag (BTC/ETH/SOL all on)
     * Volmageddon edge case (vol spikes → multiplier → 0.25 floor)
     * Funding rate signal subscription
     * Realized vol from price bars (rolling 30d)
     * reset() clears state
     * dispose() releases bus ref
     * Determinism: same input → same output
     * 0 liquidations in 30mo backtest
     * VaR 95% daily < 0.10% per symbol

3. `packages/backtest-tools/src/cli/run-hybrid-kelly.ts` (~80 LOC)
   - CLI runner: feeds historical OHLCV + funding → HybridKellyPlugin → emits scaled SizingSignals
   - Writes `baseline-hybrid-kelly-{btc,eth,sol}-1d.json` (3 files)
   - Validates 1:10 leverage at CLI parser

4. `backtest-results/baseline-hybrid-kelly-btc-1d.json`
5. `backtest-results/baseline-hybrid-kelly-eth-1d.json`
6. `backtest-results/baseline-hybrid-kelly-sol-1d.json`

7. `backtest-results/REPORT-phase11-1e.md` (~200 LOC, English)
   - §1 TL;DR — lowest ROI of Phase 11.1 set, completes carry-side portfolio
   - §2 HybridKellyPlugin architecture
   - §3 Per-symbol walk-forward Sharpe at 1:10
   - §4 Phase 9 9E validation re-confirmed
   - §5 Composition with 11.1b + 11.1d + 11.1c
   - §6 References (≥10 sources, ≥3 independent per claim)

---

## Plan structure (3 tracks + M2 integration)

### Track A — HybridKellyPlugin + tests (~25 min)

Producer: coder
Worktree: `feat/phase11-1e-track-a` based on `feat/phase11-1c-track-c-integration` (after 11.1c merges)
Output: `hybrid-kelly-plugin.ts` + tests + 3-layer 1:10 defense
Quality gates: typecheck + lint + test (≥25 unit tests) + coverage (100% line/func)

### Track B — CLI runner + 3 baseline JSONs (~18 min)

Producer: coder
Worktree: `feat/phase11-1e-track-b` based on Track A (after A merges)
Output: `run-hybrid-kelly.ts` + 3 baseline JSONs
Quality gates: typecheck + lint + test + 0 violations

### Track C (M2) — SCv1+11.1b+11.1d+11.1c+11.1e composition + REPORT (~22 min)

Producer: coder (verifier-as-task on integration)
Worktree: `feat/phase11-1e-integration` based on Track B
Output: SCv1 + ALL 4 DROP-INS composition runner + final portfolio envelope + REPORT-phase11-1e.md
Quality gates: typecheck + lint + test (no regression) + coverage + 1:10 invariant holds

**Verifier brief additions:**
- 3-layer 1:10 defense verification (same as 11.1b/11.1c — 3 layers required)
- maxVolMultiplier = 1.0 hard cap (carry-over from 11.1c)
- Walk-forward Sharpe comparison vs Phase 9 9E baseline (must match within 0.01)
- Per-symbol envelope: BTC/ETH/SOL all run
- Composition overhead ≤ 1% of in-scope baseline

---

## Per-symbol disclosure (mandatory)

| Symbol | Plugin Registered | Expected Effect | Honest Risk |
|--------|-------------------|-----------------|-------------|
| BTC    | YES | +0.05%/mo, DD -45% | small |
| ETH    | YES | -0.02%/mo, DD -51% | small |
| SOL    | YES | +0.10%/mo, DD -11.7% | small |

If ANY symbol envelope deviates > 0.5%/mo from Phase 9 9E baseline, the deliverable MUST:
1. Document the deviation with empirical numbers
2. Specify deployment recommendation: tune the kellyCap or volMultiplier
3. NOT propose track-level FAIL — adaptive sizing is tunable

---

## +50%/month verdict impact

11.1e changes the +50%/month ceiling MINIMALLY:
- SCv1 + 11.1b + 11.1d + 11.1c: +4-5%/month envelope, -40% to -60% DD reduction
- SCv1 + 11.1b + 11.1d + 11.1c + 11.1e: +4.5-5.5%/month envelope, -40% to -60% DD reduction
- **+50%/month still 9-11× short** — reframe unchanged
- BUT: Phase 11.1 set is now COMPLETE — all 4 drop-ins ported from validated Phase 8/9 strategies

---

## Constraint envelope (UNCHANGED, HARD GUARDRAILS)

- 1:10 leverage MANDATORY on all trades (sizing scales DOWN only)
- maxVolMultiplier = 1.0 (HARD CAP at 1:10)
- kellyCap = 1.0 (HARD CAP at 1:10)
- bybit.eu SPOT-only (no margin futures), MiCAR EU scope

---

## Quality gate discipline (carried from Phase 10G/11.1b lessons)

- 30min timeout per producer (carry-side adaptive sizing is medium scope)
- Per-track gates: `bun run typecheck && bun run lint && bun run test && bun run coverage` ALL green
- ≥25 unit tests per plugin file (most among Phase 11.1 set — adaptive sizing has most surface)
- 100% line + function coverage on plugin source
- Verifier independent: branch + files + gates + 3-layer defense + walk-forward Sharpe
- Docstring-vs-implementation check: deliverable claims must match code lines

---

## Cron plan

- After launch: `phase11-1e-monitor` cron at 3min cadence, 4h TTL
- Gate discipline: only act on state change (verdict, retry, deadline)

---

## Phase 11.1 cascade (after 11.1b + 11.1d + 11.1c + 11.1e ship)

| Drop-in | Status | Plan trigger |
|---------|--------|--------------|
| 11.1b DirectionalMTFPlugin | IN FLIGHT (plan_90e0d2e1) | launch 03:40 |
| 11.1d SOLFlipKillSwitchPlugin | scope plan written | after 11.1b merges |
| 11.1c VolTargetSizingPlugin | scope plan written | after 11.1d merges |
| 11.1e HybridKellyPlugin | THIS PLAN | after 11.1c merges |

**After all 4 drop-ins ship, Phase 11.1 is COMPLETE.**

Projected envelope: +4.5-5.5%/month HIGH confidence, -40% to -60% DD reduction, still 9-11× short of +50%/month.

**Next phase: Phase 11.2** — Cross-X funding arb + Options-vol extensions needed for +10-15%/month envelope. Each requires new data sources:
- 11.2b CrossExchangeFundingArb: requires multi-venue OHLCV (bybit.eu + binance + okx)
- 11.2c DeribitDVOLShortVol: requires Deribit options data
- 11.2d OptionsRiskReversal: requires Deribit options data
- 11.2e BasisTradePlugin: requires spot+perp basis data

These are deferred to Phase 12+ (out of retail envelope OR require capital scale).

---
description: Phase 11.2e scope plan — BasisTradePlugin (wraps existing carry logic into a dedicated basis-trade drop-in). Single venue (bybit.eu), no new data sources, MEDIUM risk. +0.5-1%/month expected per symbol, defensive (basis convergence is mean-reverting).
---

# Phase 11.2e — BasisTradePlugin drop-in (scope plan, 2026-07-05 04:10)

**Trigger:** Phase 11.1 set launching now. Phase 11.2e is the SECOND sub-phase of Phase 11.2, after 11.2a (regime meta). This is the FIRST ALPHA sub-phase of Phase 11.2 (11.2a is defensive meta).

**Why 11.2e is the FIRST ALPHA sub-phase of 11.2:**
- Single venue (bybit.eu) — no new data sources required (carry + basis already in existing data)
- Lower risk than 11.2b (cross-X, multi-venue) and 11.2c/d (Deribit options)
- Retail-viable at $10k capital (basis convergence is small edge, doesn't need scale)
- Composes with all 5 Phase 11.1 plugins + 11.2a meta-defensive

**Why 11.2e is AFTER 11.2a:**
- 11.2a is defensive meta — must ship first to protect against regime shifts
- 11.2e is alpha — needs defensive layer to be robust
- Order: 11.2a (defensive) → 11.2e (alpha) → 11.2b (cross-X) → 11.2c/d (options)

---

## What 11.2e delivers

**One new StrategyPlugin (alpha, basis trade) + per-symbol envelope measurement on SCv1.**

The plugin trades spot-vs-perp basis when it diverges from "carry-neutral" equilibrium:
- `basis = (perp_mark - spot_index) / spot_index` (percentage)
- `carry_neutral_basis = funding_rate / 365 / funding_interval_hours`
- When `basis > carry_neutral_basis + threshold` (basis too high): SHORT basis (long spot, short perp)
- When `basis < carry_neutral_basis - threshold`: LONG basis (short spot, long perp)
- Basis converges to neutral over hours-days (mean-reverting)

Phase 1-9 partial validation:
- Phase 6 Track A: funding-rate carry (basis trade component)
- Phase 8 Track E: funding timing (basis trade enhancement)
- Phase 9 9D: SOL funding-flip kill-switch (defensive overlay for basis trades)

**The 11.2e SCv1 envelope expected:**
- BTC: +0.7%/month, Sharpe 3-4
- ETH: +0.6%/month, Sharpe 3-4
- SOL: +0.5%/month, Sharpe 2-3 (SOL has more basis volatility)
- AVG: +0.6%/month per symbol
- Defensive: basis converges, low tail risk, low DD

---

## Architecture: basis trade drop-in to SCv1

**Files (~700 LOC expected):**

1. `packages/core/src/signal-center/plugins/basis-trade-plugin.ts` (~450 LOC)
   - `class BasisTradePlugin implements StrategyPlugin`
   - `metadata: { name: 'basis-trade-v1', version: '1.0.0', edgeClass: 'mixed', capitalRequirement: 10000, maxLeverage: 10 }`
   - `subscribe(bus)` → wires `bus.on('signal:carry', ...)` to monitor funding state, reads spot+perp price data
   - `onBar(bar, state)` → computes current basis, compares to carry-neutral, emits SizingSignal
   - `validateConfig()` → checks basisEntryThresholdBps (default 10 bps), basisExitThresholdBps (default 5 bps), maxHoldHours (default 72h)
   - **1:10 leverage invariant (3-layer defense — basis trade is a SizingSignal emitter)**:
     - Layer 1 (constructor): `metadata.maxLeverage = 10`
     - Layer 2 (per-emit): `assertLeverageInvariant(notional, equity)` before emit
     - Layer 3 (per-emit clamp): `notional ≤ baseNotionalUsd × 10`, clamp before emit

2. `packages/core/src/signal-center/plugins/basis-trade-plugin.test.ts` (~250 LOC)
   - ≥20 unit tests covering:
     * Construction with default config (10 bps entry, 5 bps exit, 72h hold) succeeds
     * Construction with basisEntryThresholdBps < 0 REJECTED
     * Construction with basisExitThresholdBps < 0 REJECTED
     * Construction with maxHoldHours < 1 REJECTED
     * Basis computation: `(perp_mark - spot_index) / spot_index`
     * Carry-neutral basis: `funding_rate / 365 / funding_interval_hours`
     * Entry condition: `basis > carry_neutral + threshold`
     * Exit condition: `basis < carry_neutral - threshold` OR `hold_time > maxHoldHours`
     * SizingSignal emitted on entry with long/short basis direction
     * 3-layer 1:10 defense at all boundaries
     * Synthetic 12× breach test (Layer 2 throws)
     * Per-symbol enable (BTC/ETH/SOL all on)
     * Walk-forward Sharpe at 1:10 (24 folds, 180d IS / 30d OOS)
     * reset() clears state
     * dispose() releases bus ref
     * Determinism: same input → same output
     * 0 liquidations in 30mo backtest
     * VaR 95% daily <0.10% per symbol
     * Edge case: basis stays diverged > maxHoldHours → force exit

3. `packages/backtest-tools/src/cli/run-basis-trade.ts` (~100 LOC)
   - CLI runner: feeds historical OHLCV + funding → BasisTradePlugin → emits SizingSignals
   - Writes `baseline-basis-trade-{btc,eth,sol}-1d.json` (3 files)
   - Validates 1:10 leverage at CLI parser
   - Reports: monthly, walk-forward Sharpe, basis convergence time, max basis divergence, VaR 95% daily

4. `backtest-results/baseline-basis-trade-btc-1d.json`
5. `backtest-results/baseline-basis-trade-eth-1d.json`
6. `backtest-results/baseline-basis-trade-sol-1d.json`

7. `backtest-results/REPORT-phase11-2e.md` (~250 LOC, English)
   - §1 TL;DR — basis trade alpha, +0.5-1%/month per symbol, defensive
   - §2 BasisTradePlugin architecture
   - §3 Per-symbol envelope (BTC/ETH/SOL)
   - §4 Basis convergence time analysis
   - §5 Composition with 11.1 + 11.2a set (7 plugins total)
   - §6 References (≥10 sources, ≥3 independent per claim — basis trade academic, perp-spot arbitrage)

---

## Plan structure (3 tracks + M2 integration)

### Track A — BasisTradePlugin + tests (~25 min)

Producer: coder
Worktree: `feat/phase11-2e-track-a` based on `feat/phase11-2a-integration` (after 11.2a merges)
Output: `basis-trade-plugin.ts` + tests + 3-layer 1:10 defense
Quality gates: typecheck + lint + test (≥20 unit tests) + coverage (100% line/func)

### Track B — CLI runner + 3 baseline JSONs (~18 min)

Producer: coder
Worktree: `feat/phase11-2e-track-b` based on Track A (after A merges)
Output: `run-basis-trade.ts` + 3 baseline JSONs
Quality gates: typecheck + lint + test + 0 violations

### Track C (M2) — SCv1+all 7 plugins composition + REPORT (~25 min)

Producer: coder (verifier-as-task on integration)
Worktree: `feat/phase11-2e-integration` based on Track B
Output: SCv1+Carry+MTF+SFK+VolTarget+HybridKelly+RegimeDetector+BasisTrade composition runner + portfolio envelope + REPORT-phase11-2e.md
Quality gates: typecheck + lint + test (no regression) + coverage + 1:10 invariant holds

**Verifier brief additions:**
- 3-layer 1:10 defense verification (Layers 1+2+3 — basis plugin emits SizingSignals)
- Walk-forward Sharpe comparison vs Phase 6 Track A + Phase 8 Track E (must match within 0.02)
- Per-symbol envelope: BTC/ETH/SOL all run
- Composition overhead ≤ 1% of in-scope baseline

---

## Per-symbol disclosure (mandatory)

| Symbol | Plugin Registered | Expected Effect | Honest Risk |
|--------|-------------------|-----------------|-------------|
| BTC    | YES | +0.7%/mo, Sharpe 3-4 | low (basis converges) |
| ETH    | YES | +0.6%/mo, Sharpe 3-4 | low |
| SOL    | YES | +0.5%/mo, Sharpe 2-3 | medium (SOL basis volatility) |

If any symbol shows > 0.5%/month deviation from expected envelope, the deliverable MUST:
1. Document the deviation with empirical numbers
2. Specify deployment recommendation: tune the basisEntryThresholdBps or disable for that symbol
3. NOT propose track-level FAIL — basis trade is tunable

---

## +50%/month verdict impact

11.2e changes the +50%/month ceiling MINIMALLY (small alpha):
- Phase 11.1: +4.5-5.5%/month envelope
- Phase 11.1 + 11.2a: +4.5-5.5%/month envelope, -50% to -70% DD reduction
- Phase 11.1 + 11.2a + 11.2e: +5.1-6.3%/month envelope, -50% to -70% DD reduction
- **+50%/month still 8-10× short** — reframe unchanged

**After 11.2e: Phase 11.1 + 11.2a + 11.2e is the COMPLETE retail-viable single-venue phase.**

---

## Constraint envelope (UNCHANGED, HARD GUARDRAILS)

- 1:10 leverage MANDATORY on all trades
- bybit.eu SPOT-only (single venue, no new data)
- MiCAR EU scope
- 30 months OHLCV + funding history (existing data sufficient)
- Per-second mark price: need to verify bybit.eu API provides it (or use minute-level as approximation)

---

## Quality gate discipline (carried from Phase 10G/11.1 lessons)

- 30min timeout per producer
- Per-track gates: `bun run typecheck && bun run lint && bun run test && bun run coverage` ALL green
- ≥20 unit tests per plugin file
- 100% line + function coverage on plugin source
- Verifier independent: branch + files + gates + 3-layer defense + walk-forward Sharpe
- Docstring-vs-implementation check: deliverable claims must match code lines

---

## Cron plan

- After launch: `phase11-2e-monitor` cron at 3min cadence, 4h TTL
- Gate discipline: only act on state change (verdict, retry, deadline)

---

## Phase 11.2e launch sequence

After Phase 11.1 + 11.2a lands:
1. Write plan.yaml for Phase 11.2e (similar to 11.1b/c/d/e plan.yamls)
2. Launch `mavis team plan run /tmp/phase11-2e-plan.yaml --no-wait`
3. Monitor via cron
4. After 11.2e lands: Phase 11.2a + 11.2e is COMPLETE (single-venue retail-viable)
5. Decide: launch 11.2b (cross-X, requires new data) or stop here

---

## Phase 11.2 sequence (updated)

| Sub-phase | Plugin | Status | Trigger |
|-----------|--------|--------|---------|
| 11.2a | RegimeDetectorMetaPlugin | scope plan written | after 11.1 lands |
| 11.2e | BasisTradePlugin | THIS PLAN | after 11.2a lands |
| 11.2b | CrossExchangeFundingArbPlugin | roadmap only, DEFERRED | after 11.2e + capital decision |
| 11.2c | DeribitDVOLShortVolPlugin | roadmap only, DEFERRED | DEFER (Deribit) |
| 11.2d | OptionsRiskReversalPlugin | roadmap only, DEFERRED | DEFER (Deribit) |

**Phase 11.2a + 11.2e = retail-viable single-venue completion.**
**Phase 11.2b/c/d = capital scale + options extension, deferred.**

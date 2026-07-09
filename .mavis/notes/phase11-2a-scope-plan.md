---
description: Phase 11.2a scope plan — RegimeDetectorMetaPlugin (defensive meta-plugin that detects market regime and adjusts other plugins' parameters). Single venue, no new data sources, MEDIUM risk. Launchable immediately after Phase 11.1 lands.
---

# Phase 11.2a — RegimeDetectorMetaPlugin drop-in (scope plan, 2026-07-05 04:05)

**Trigger:** Phase 11.1 set launching now (plan_90e0d2e1 → 11.1d → 11.1c → 11.1e). Phase 11.2a is the FIRST sub-phase of Phase 11.2, the natural next step after 11.1 lands.

**Why 11.2a is FIRST (before 11.2b/c/d/e):**
- 11.2a is DEFENSIVE meta — must ship BEFORE any new alpha plugin
- Single venue (bybit.eu) — no new data sources required
- Lower risk than 11.2b/c/d (which require new venues or options data)
- Composes with all 5 Phase 11.1 plugins (Carry + MTF + SFK + VolTarget + HybridKelly)

**Why META plugin:**
- Reads ALL other plugins' signals
- Detects regime: trending / ranging / volatile
- Adjusts other plugins' parameters dynamically (e.g. reduce position size in high-vol regime)
- Acts as a "smart circuit breaker" — more sophisticated than simple kill-switch (11.1d)

---

## What 11.2a delivers

**One new StrategyPlugin (meta-defensive) + cross-plugin effect measurement on SCv1.**

The plugin uses:
- Hidden Markov Model (HMM) with 3 states: trending / ranging / volatile
- Transition probabilities learned from 30mo OHLCV + funding data
- Real-time regime probability from forward algorithm
- Per-regime parameter recommendations: position size multiplier, max DD cap, hold time

Phase 1-9 partial validation:
- Phase 6 multi-class baseline: HMM regime filter used as component
- Phase 7 Track C: regime-filtered walk-forward +8% improvement
- Phase 8 Track F: regime context for MTF entry timing (validated)

**The 11.2a SCv1 envelope expected:**
- BTC: defensive — DD reduction in volatile regimes
- ETH: defensive — DD reduction in volatile regimes
- SOL: defensive — DD reduction in funding-flip regimes
- Composition effect: -20% to -30% DD reduction across all 3 symbols, no PnL change

---

## Architecture: meta-plugin in SCv1

**Files (~700 LOC expected):**

1. `packages/core/src/signal-center/plugins/regime-detector-meta-plugin.ts` (~450 LOC)
   - `class RegimeDetectorMetaPlugin implements StrategyPlugin`
   - `metadata: { name: 'regime-detector-v1', version: '1.0.0', edgeClass: 'risk', capitalRequirement: 0, maxLeverage: 10 }`
   - `subscribe(bus)` → wires `bus.on('signal:direction', ...)`, `bus.on('signal:carry', ...)`, `bus.on('signal:sizing', ...)` to read all other plugins
   - `onBar(bar, state)` → updates HMM probabilities, emits RiskSignal + position size multiplier
   - `validateConfig()` → checks HMM states (default 3), transition learning window (default 30d), regime thresholds
   - **1:10 leverage invariant (2-layer defense — meta-plugin emits RiskSignals, NOT SizingSignals)**:
     - Layer 1 (constructor): `metadata.maxLeverage = 10`
     - Layer 2 (per-emit): if RiskSignal includes size-modifier instruction, `assertLeverageInvariant` on the close

2. `packages/core/src/signal-center/plugins/regime-detector-meta-plugin.test.ts` (~250 LOC)
   - ≥20 unit tests covering:
     * HMM forward algorithm correctness
     * 3-state regime classification (trending/ranging/volatile)
     * Transition probability learning
     * Real-time regime probability output
     * Per-regime size multiplier (trending: 1.0, ranging: 0.7, volatile: 0.4)
     * RiskSignal emission on regime transition
     * 2-layer 1:10 defense verification
     * Per-symbol enable (BTC/ETH/SOL all on)
     * Edge cases: regime change mid-trade, regime persistence vs transition
     * Determinism: same input → same output
     * Walk-forward regime detection (24 folds)
     * reset() clears state
     * dispose() releases bus ref

3. `packages/backtest-tools/src/cli/run-regime-detector.ts` (~100 LOC)
   - CLI runner: feeds historical OHLCV + cross-plugin signals → RegimeDetectorMetaPlugin
   - Writes `baseline-regime-detector-{btc,eth,sol}-1d.json` (3 files)
   - Validates 1:10 leverage at CLI parser

4. `backtest-results/baseline-regime-detector-btc-1d.json`
5. `backtest-results/baseline-regime-detector-eth-1d.json`
6. `backtest-results/baseline-regime-detector-sol-1d.json`

7. `backtest-results/REPORT-phase11-2a.md` (~250 LOC, English)
   - §1 TL;DR — defensive meta-plugin, -20% to -30% DD across all 3 symbols
   - §2 RegimeDetectorMetaPlugin architecture
   - §3 HMM 3-state regime classification
   - §4 Per-symbol regime distribution (trending/ranging/volatile %)
   - §5 Composition with 11.1 set (6 plugins total)
   - §6 References (≥10 sources, ≥3 independent per claim — HMM academic, regime detection in quant)

---

## Plan structure (3 tracks + M2 integration)

### Track A — RegimeDetectorMetaPlugin + tests (~25 min)

Producer: coder
Worktree: `feat/phase11-2a-track-a` based on `feat/phase11-1e-integration` (after 11.1e merges)
Output: `regime-detector-meta-plugin.ts` + tests + 2-layer 1:10 defense
Quality gates: typecheck + lint + test (≥20 unit tests) + coverage (100% line/func)

### Track B — CLI runner + 3 baseline JSONs (~18 min)

Producer: coder
Worktree: `feat/phase11-2a-track-b` based on Track A (after A merges)
Output: `run-regime-detector.ts` + 3 baseline JSONs
Quality gates: typecheck + lint + test + 0 violations

### Track C (M2) — SCv1+all 6 plugins composition + REPORT (~22 min)

Producer: coder (verifier-as-task on integration)
Worktree: `feat/phase11-2a-integration` based on Track B
Output: SCv1+Carry+MTF+SFK+VolTarget+HybridKelly+RegimeDetector composition runner + portfolio envelope + REPORT-phase11-2a.md
Quality gates: typecheck + lint + test (no regression) + coverage + 1:10 invariant holds

**Verifier brief additions:**
- 2-layer 1:10 defense verification (Layers 1+2 only — meta-plugin emits RiskSignals, not SizingSignals)
- HMM forward algorithm correctness (deterministic + backward-compatible with prior data)
- Per-symbol regime distribution documented
- Composition overhead ≤ 1% of in-scope baseline

---

## Per-symbol disclosure (mandatory)

| Symbol | Plugin Registered | Expected Effect |
|--------|-------------------|-----------------|
| BTC    | YES | DD reduction in volatile regimes, no PnL change |
| ETH    | YES | DD reduction in volatile regimes, no PnL change |
| SOL    | YES | DD reduction in funding-flip regimes, no PnL change |

If any symbol shows POSITIVE PnL change (>0.5%/mo above 11.1 set baseline), this is unexpected (meta-plugin should be defensive, not alpha). The deliverable MUST:
1. Document the unexpected PnL with empirical numbers
2. Specify whether to attribute to regime-detection edge (alpha) or noise
3. NOT propose track-level FAIL — meta-plugin is exploratory, not strict

---

## +50%/month verdict impact

11.2a changes the +50%/month ceiling MINIMALLY (defensive, not alpha):
- Phase 11.1 + 11.2a: +4.5-5.5%/month envelope, -50% to -70% DD reduction (cumulative)
- **+50%/month still 9-11× short** — reframe unchanged
- BUT: defensive layer adds robustness to regime shifts

---

## Constraint envelope (UNCHANGED, HARD GUARDRAILS)

- 1:10 leverage MANDATORY on all trades
- bybit.eu SPOT-only (single venue, no new data)
- MiCAR EU scope
- 30 months OHLCV + funding history (existing data sufficient)

---

## Quality gate discipline (carried from Phase 10G/11.1 lessons)

- 30min timeout per producer
- Per-track gates: `bun run typecheck && bun run lint && bun run test && bun run coverage` ALL green
- ≥20 unit tests per plugin file
- 100% line + function coverage on plugin source
- Verifier independent: branch + files + gates + 2-layer defense + HMM correctness
- Docstring-vs-implementation check: deliverable claims must match code lines

---

## Cron plan

- After launch: `phase11-2a-monitor` cron at 3min cadence, 4h TTL
- Gate discipline: only act on state change (verdict, retry, deadline)

---

## Phase 11.2a launch sequence

After Phase 11.1 set lands (all 4 PRs merged to main):
1. Write plan.yaml for Phase 11.2a (similar to 11.1b/c/d/e plan.yamls)
2. Launch `mavis team plan run /tmp/phase11-2a-plan.yaml --no-wait`
3. Monitor via cron, auto-launch next sub-phase (11.2e) when 11.2a completes

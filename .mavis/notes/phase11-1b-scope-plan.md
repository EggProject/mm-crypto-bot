---
description: Phase 11.1b scope plan — DirectionalMTFPlugin drop-in (wraps Phase 8 F validated MTF Donchian). First concrete Phase 11 drop-in shipping on SCv1 platform. Per-symbol PARTIAL PASS disclosure required (ETH positive, BTC/SOL likely negative per Phase 8 F Track results).
---

# Phase 11.1b — DirectionalMTFPlugin drop-in (scope plan v1, 2026-07-05 03:00)

**Trigger:** Phase 10G SCv1 platform SHIPPED (15f4c70, PR #18 OPEN). First Phase 11 drop-in queued. **Highest-ROI drop-in from REPORT-phase10.md §7 prioritized list.**

**Ranking rationale:**
- 11.1b DirectionalMTFPlugin: +0.5-3%/month, **LOW** risk (Phase 8 F ETH validated +137% backtest, WF OOS +2.63%/30d, per-symbol disclosure required)
- 11.1d SOLFlipKillSwitchPlugin: defensive DD reduction, LOW risk (Phase 9 9D)
- 11.1c VolTargetSizingPlugin: neutral under 1:10 cap, LOW risk (Phase 8 G)
- 11.1e HybridKellyPlugin: +0.0-0.5%/month, LOW risk (Phase 9 9E)
- 11.2a-e: deferred to Phase 11.2 (medium-high risk)

**Decision style:** Agent ranks. 11.1b is the FIRST drop-in. 11.1d second. 11.1c third. 11.1e fourth.

---

## What 11.1b delivers

**One new StrategyPlugin + per-symbol envelope measurement on the SCv1 platform.**

The plugin wraps Phase 8 Track F (`donchian-mtf.ts`) — the **validated** MTF Donchian long-only strategy:
- LTF (1h) entry trigger on MTF (4h) Donchian(20) upper
- MTF trend filter (4h close > 4h Donchian upper)
- HTF (1d) Supertrend confirmation
- ATR-based SL/TP (1.5× stop, 3.0× TP)
- 168h max-hold via `onOpenPositionUpdate` hook

Phase 8 F Track results (REPORT-phase8.md §4):
| Symbol | Track F PnL | Validation |
|--------|-------------|------------|
| BTC    | -$475       | NEGATIVE — directional alone loses on BTC at 1:10 |
| ETH    | +$386 (+137% backtest) +2.63%/30d WF OOS | **VALIDATED** — only positive direction alpha |
| SOL    | -$524       | NEGATIVE — Track F intentionally excludes SOL |

**The 11.1b SCv1 envelope expected:**
- ETH plugin: +2-3%/month contribution to SCv1 carry-only baseline (+2.22%/month) → +4-5%/month ETH envelope
- BTC plugin: per-symbol PARTIAL PASS — empirical truth wins. If SCv1+MTF BTC underperforms carry-only BTC, document composition effect honestly (per "Per-symbol PARTIAL PASS pattern" memory)
- SOL plugin: NOT REGISTERED in 11.1b (Phase 8 F Track intentionally excluded SOL). 11.1d SOLFlipKillSwitchPlugin (Phase 9 9D) ships first as defensive; 11.1b SOL variant deferred.

---

## Architecture: drop-in to SCv1

**Files (~700 LOC expected):**
1. `packages/core/src/signal-center/plugins/directional-mtf-plugin.ts` (~450 LOC)
   - `DirectionalMTFPlugin implements StrategyPlugin`
   - `metadata { name: 'directional-mtf-v1', version: '1.0.0', edgeClass: 'directional', capitalRequirement: 10000, maxLeverage: 10 }`
   - `subscribe(bus)` → wires `bus.on('signal:direction', ...)` for state updates
   - `onBar(bar, state)` → calls inner `DonchianMtfStrategy.onCandle()` → emits `DirectionSignal`
   - `validateConfig()` → checks maxLeverage ≤ 10, valid HTF/MTF/LTF window params
   - 1:10 layer defense: per-emit `assertLeverageInvariant` on SizingSignal + constructor check

2. `packages/core/src/signal-center/plugins/directional-mtf-plugin.test.ts` (~250 LOC)
   - Unit tests on plugin interface contract (≥20 tests)
   - Mock SignalBus, verify DirectionSignal emission pattern
   - Per-symbol: ETH positive, BTC negative, SOL skipped
   - Leverage invariant: synthetic 12× breach fires Layer 3 guard
   - Walk-forward OOS test (12mo IS / 3mo OOS / 1mo step)

3. `packages/backtest-tools/src/cli/run-directional-mtf.ts` (~80 LOC)
   - CLI runner: feeds historical OHLCV → DirectionalMTFPlugin → emits DirectionSignals + SizingSignals
   - Writes `baseline-directional-mtf-{btc,eth}-1d.json` (SOL NOT registered in 11.1b)

4. `backtest-results/baseline-directional-mtf-btc-1d.json`
5. `backtest-results/baseline-directional-mtf-eth-1d.json`
6. `backtest-results/REPORT-phase11-1b.md` (~300 LOC)

**REPORT-phase11-1b.md sections:**
- §0 Phase 10G SCv1 platform recap (1 paragraph)
- §1 TL;DR — drop-in architecture validated, ETH +X%/month, BTC -Y%/month, SOL NOT registered
- §2 DirectionalMTFPlugin architecture (interface, SignalBus wiring, 1:10 defense)
- §3 Per-symbol envelope: ETH vs BTC vs SOL (with per-symbol PARTIAL PASS disclosure if any)
- §4 SCv1 + DirectionalMTF composition effect (does the bus mediate well? correlation matrix?)
- §5 Portfolio-level Sharpe, DD, VaR (compute via existing PortfolioRiskEngine)
- §6 Phase 11.1c-e roadmap updates (after 11.1b ships)
- §7 References (≥15 sources, ≥3 independent per claim — MTF academic, plugin-pattern, bybit.eu docs)

---

## Plan structure (3 tracks + M2 integration)

### Track A — DirectionalMTFPlugin + reference impl + tests (~22 min)

Producer: coder
Worktree: `feat/phase11-1b-track-a` based on `feat/phase10g-scv1-integration`
Output: `directional-mtf-plugin.ts` + `directional-mtf-plugin.test.ts` + per-symbol unit tests
Quality gates: typecheck + lint + test (≥20 unit tests) + coverage (100% line/func on new file)

### Track B — CLI runner + 2 baseline JSONs (~18 min)

Producer: coder
Worktree: `feat/phase11-1b-track-b` based on Track A (after A merges)
Output: `run-directional-mtf.ts` + 2 baseline JSONs (BTC + ETH)
Quality gates: typecheck + lint + test + 0 violations on existing SCv1 tests

### Track C (M2) — Portfolio integration + REPORT (~22 min)

Producer: coder (verifier-as-task on integration)
Worktree: `feat/phase11-1b-integration` based on Track B
Output: SCv1 + DirectionalMTFPlugin composition runner + portfolio-level envelope (3 symbols with per-symbol disclosure) + REPORT-phase11-1b.md
Quality gates: typecheck + lint + test (SCv1 suite unchanged + new composition tests ≥10) + coverage + 1:10 invariant holds

**Verifier brief additions (Phase 10G lessons applied):**
- Architecture-parity check: 11.1b is a NEW drop-in (not a refactor), so check #9 reframes as "drop-in cost overhead ≤ 1% of drop-in baseline (ETH only — BTC/SOL not registered)"
- Per-symbol PARTIAL PASS pattern: if BTC envelope < SCv1 carry-only baseline, classify as PASS-with-caveats + per-symbol deployment disclosure in REPORT
- 3-layer 1:10 defense: same as Phase 10G (Layer 1 constructor, Layer 2 start assertion, Layer 3 per-bar guard)
- Citation laundering guard: any prior-phase numbers cited MUST be at 1:10 leverage (not 1:3, not Phase 5/6 different mandates)
- Docstring-vs-implementation: when deliverable claims "X runs Y", verify Y is actually imported and called in X's scope

---

## Per-symbol PARTIAL PASS disclosure (mandatory)

Per memory "Per-symbol PARTIAL PASS pattern":
> "Symbol-dependent ensemble edges (Track F works for ETH, fails for SOL/BTC at 1:10) → per-symbol PARTIAL PASS with documented composition, NOT track-level FAIL. Verifier classifies PASS-with-caveats conditional on per-symbol deployment disclosure."

**11.1b expected verdict:**
- ETH sub-track: PASS (validated by Phase 8 F Track)
- BTC sub-track: PARTIAL PASS with caveat — register plugin but document negative directional contribution; SCv1's 1:10 + portfolio correlation may make BTC plugin net-negative
- SOL sub-track: NOT REGISTERED in 11.1b. Plugin source code may exist for future use, but SCv1 only loads ETH (and optionally BTC with caveat).

If BTC composition fails (SCv1+MTF BTC < SCv1 carry-only BTC), the deliverable MUST:
1. Document the negative directional contribution with empirical numbers
2. Specify deployment recommendation: "register plugin for ETH only, suppress BTC via metadata.disabled flag"
3. NOT propose track-level FAIL — propose per-symbol PARTIAL PASS

---

## +50%/month verdict impact

11.1b changes the +50%/month ceiling empirically:
- SCv1 baseline: +2.22%/month AVG (carry-only)
- SCv1 + DirectionalMTF (ETH only): +4-5%/month envelope
- SCv1 + DirectionalMTF (ETH + BTC PARTIAL): +3-4%/month envelope (BTC drag)
- Phase 11.1 ceiling (after 11.1c + 11.1d + 11.1e ship): +4.5-5.5%/month HIGH confidence
- **+50%/month still 9-11× short.** Reframe stays: "ceiling TBD after Phase 11+ drop-ins ship; Phase 11.2 cross-X + options-vol extensions needed for +10-15%/month envelope"

---

## Constraint envelope (UNCHANGED, HARD GUARDRAILS)

- 1:10 leverage MANDATORY on all trades (vol-targeting scales DOWN only) — Phase 10G 3-layer defense re-applied
- bybit.eu SPOT-only (no margin futures), MiCAR EU scope
- 30 months OHLCV + funding history available (no new data needed)
- Available capital: TBD by user

---

## Open decisions

**One user input needed: launch timing.**

Options ranked:
1. **Launch tomorrow morning (~10:00 Budapest).** Plan completes ~12:00-13:00. User awake for verifier verdicts.
2. **Launch NOW (03:00 Budapest).** Plan completes ~05:00-06:00. User asleep for most of it; wakes to verdicts or kill-and-retry.
3. **Defer to Phase 11.1 bundle (11.1b + 11.1d parallel, single multi-track plan).** Slightly slower to first drop-in, but bundles the LOW-risk Phase 8/9 ports as one plan.

**Agent recommendation: option 1 — tomorrow morning.**
- Reason: user awake for verifier verdicts and decision points
- Reason: $0.65 cost per plan × 2-3 plans/night is wasteful if user can't react to failures
- Reason: cold-start clarity is better with 8h sleep

If user picks option 2 (launch NOW), I'll spawn immediately and stay awake monitoring the cron.

---

## Quality gate discipline (carried from Phase 10G lessons)

- 45min timeout per producer (Phase 8 lesson applied to Phase 11+)
- Per-track gates: `bun run typecheck && bun run lint && bun run test && bun run coverage` ALL green
- ≥20 unit tests per plugin file (≥10 for CLI runner)
- 100% line + function coverage on plugin source files
- Verifier independent: branch + files + gates + logic correctness + per-symbol envelope + ≥3 sources per claim
- Refactor cost overhead ≤ 1% of in-scope baseline (architecture-parity pattern applied to drop-in scope)
- Docstring-vs-implementation check: deliverable claims must match code lines

---

## Cron plan

- After launch: `phase11-1b-monitor` cron at 5min cadence, 4h TTL (delete after plan completes)
- Gate discipline: only act on state change (verdict, retry, deadline)
- Verifier session IDs to monitor: 3 verifier-as-task sessions spawned per cycle
- Producer escalation: if a producer dies mid-task with ≥50% code on disk → manual_retry per "Resume-from-disk on timeout" pattern

---

## Phase 11.1 cascade (after 11.1b ships)

| Drop-in | Status | Plan trigger |
|---------|--------|--------------|
| 11.1b DirectionalMTFPlugin | THIS PLAN | — |
| 11.1d SOLFlipKillSwitchPlugin | queued | after 11.1b |
| 11.1c VolTargetSizingPlugin | queued | after 11.1d |
| 11.1e HybridKellyPlugin | queued | after 11.1c |

Phase 11.1c-e each ~30-40min producer work; bundle-able into single 3-track plan OR sequential single-track plans. Agent rank when 11.1b ships.
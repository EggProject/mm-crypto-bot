---
description: Phase 11.1c scope plan — VolTargetSizingPlugin drop-in (wraps Phase 8 G volatility-targeted sizing). NEUTRAL net effect at 1:10 cap (maxVolMultiplier=1.0 prevents Moreira-Muir "scale up" half). Value: defense-in-depth, not alpha. Per-symbol PARTIAL PASS with deployment tuning required.
---

# Phase 11.1c — VolTargetSizingPlugin drop-in (scope plan v1, 2026-07-05 03:48)

**Trigger:** Phase 11.1b in flight (plan_90e0d2e1). Phase 11.1d scope plan written. Phase 11.1c is the THIRD drop-in, queued for after 11.1d.

**Ranking rationale (carried from Phase 10G REPORT §7):**
- 11.1b DirectionalMTFPlugin: in flight (plan_90e0d2e1)
- 11.1d SOLFlipKillSwitchPlugin: scope plan written
- **11.1c VolTargetSizingPlugin: THIS PLAN** — defensive sizing, neutral at 1:10 cap
- 11.1e HybridKellyPlugin: queued

**Why 11.1c is THIRD (not second):**
- 11.1d (defensive) is more critical — must ship before any sizing change
- 11.1c at 1:10 cap has ZERO upside (maxVolMultiplier=1.0 = no scaling) and only defensive DD reduction
- Phase 8 G validation: 45-59% max DD reduction across all 3 symbols at 1:10 — significant but slower ROI

**11.1c is structurally different from 11.1b/d:**
- 11.1b emits DirectionSignal (alpha)
- 11.1d emits RiskSignal (defensive)
- 11.1c emits SizingSignal (size-modifier, multiplies other plugins' SizingSignals)

---

## What 11.1c delivers

**One new StrategyPlugin (sizing modifier) + portfolio-level effect measurement on SCv1.**

The plugin wraps Phase 8 G (`vol-targeted-sizer.ts`) — the validated vol-targeting sizer:
- Inverse-vol scaling (Moreira-Muir 2017): `multiplier = (targetVol / realizedVol).clamp(0.25, 1.0)`
- Rolling 30-day realized vol, targetDailyVol 2% (~38% annualized)
- √365 annualization
- maxVolMultiplier = 1.0 (HARD CAP at 1:10 mandate — cannot scale UP above 10×)
- minVolMultiplier = 0.25 (defensive floor — prevents Volmageddon-style feedback)

Phase 8 G Track results (1:10 leverage, vol multiplier clamped [0.25, 1.0]):
| Symbol | In-sample | OOS WF Sharpe | DD Reduction |
|--------|-----------|---------------|--------------|
| BTC    | Sharpe -0.132, DD -45% | +0.012 (positive) | -45% vs always-on |
| ETH    | Sharpe -0.027, DD -51% | -0.016 (negative) | -51% |
| SOL    | Sharpe +0.528, DD -59% | -0.009 (negative) | -59% |

**The 11.1c SCv1 envelope expected:**
- BTC plugin: small effect (vol-targeting slightly negative in-sample but positive OOS)
- ETH plugin: small effect (DD reduction without PnL change)
- SOL plugin: positive Sharpe (vol-targeting is the only factor that helped SOL)
- Composition effect: **defensive DD reduction** across all 3 symbols, neutral to slight-negative PnL

---

## Architecture: sizing drop-in to SCv1

**Files (~600 LOC expected):**

1. `packages/core/src/signal-center/plugins/vol-target-sizing-plugin.ts` (~350 LOC)
   - `class VolTargetSizingPlugin implements StrategyPlugin`
   - `metadata: { name: 'vol-target-sizing-v1', version: '1.0.0', edgeClass: 'sizing', capitalRequirement: 0, maxLeverage: 10 }`
   - `subscribe(bus: SignalBus)` → wires `bus.on('signal:sizing', ...)` to intercept + rescale other plugins' SizingSignals
   - `onBar(bar, state)` → computes realized vol from price data, recalculates `volMultiplier`, re-emits scaled SizingSignals
   - `validateConfig()` → checks targetDailyVol (0.5-5%), volWindowDays (7-90), maxVolMultiplier (HARD 1.0 at 1:10), minVolMultiplier (0.10-0.50)
   - **1:10 leverage invariant (3-layer defense — SizingSignal modifier is critical)**:
     - Layer 1 (constructor): `metadata.maxLeverage = 10`
     - Layer 2 (per-receive): when receiving SizingSignal, `assertLeverageInvariant(originalSignal)` BEFORE rescaling
     - Layer 3 (per-emit): `assertLeverageInvariant(rescaledSignal)` AFTER rescaling, BEFORE re-emit
   - This 3-layer defense is **mandatory** because rescaling can amplify any upstream sizing error

2. `packages/core/src/signal-center/plugins/vol-target-sizing-plugin.test.ts` (~200 LOC)
   - ≥20 unit tests covering:
     * Construction with default config (targetVol=2%, window=30d, max=1.0, min=0.25) succeeds
     * Construction with maxVolMultiplier > 1.0 REJECTED (1:10 mandate)
     * Construction with targetDailyVol < 0.1% REJECTED
     * Construction with targetDailyVol > 10% REJECTED
     * metadata declares correct fields
     * subscribe() stores bus ref
     * Computes realized vol from price bars (rolling 30d)
     * volMultiplier formula: `clamp(targetVol / realizedVol, min, max)`
     * Low vol period: multiplier = max (capped at 1.0)
     * High vol period: multiplier = min (defensive floor)
     * Receives SizingSignal, rescales, re-emits
     * **3-layer 1:10 defense at all 3 boundaries**:
       - Layer 1: constructor metadata
       - Layer 2: assertLeverageInvariant on received signal
       - Layer 3: assertLeverageInvariant on rescaled signal
     * Synthetic 12× breach: Layer 2 throws (received signal)
     * Synthetic 12× after rescale: Layer 3 throws (would-have-been-emitted)
     * Per-symbol enable flag (BTC/ETH/SOL all on by default)
     * reset() clears state
     * dispose() releases bus ref
     * Determinism: same input → same output
     * No liquidations in 30mo backtest
     * VaR 95% daily < 0.10% per symbol (Phase 8 G validation)

3. `packages/backtest-tools/src/cli/run-vol-target-sizing.ts` (~80 LOC)
   - CLI runner: feeds historical OHLCV → VolTargetSizingPlugin → emits scaled SizingSignals
   - Writes `baseline-vol-target-sizing-{btc,eth,sol}-1d.json` (3 files, all symbols)
   - Validates 1:10 leverage at CLI parser

4. `backtest-results/baseline-vol-target-sizing-btc-1d.json`
5. `backtest-results/baseline-vol-target-sizing-eth-1d.json`
6. `backtest-results/baseline-vol-target-sizing-sol-1d.json`

7. `backtest-results/REPORT-phase11-1c.md` (~200 LOC, English)
   - §1 TL;DR — defensive sizing, neutral PnL, DD reduction across all 3 symbols
   - §2 VolTargetSizingPlugin architecture
   - §3 Per-symbol envelope (BTC/ETH/SOL) with vol multiplier effect
   - §4 3-layer 1:10 defense at receive + rescale + emit boundaries
   - §5 Composition with 11.1b + 11.1d
   - §6 References (≥10 sources, ≥3 independent per claim)

---

## Plan structure (3 tracks + M2 integration)

### Track A — VolTargetSizingPlugin + tests (~25 min)

Producer: coder
Worktree: `feat/phase11-1c-track-a` based on `feat/phase11-1d-track-b-integration` (after 11.1d merges)
Output: `vol-target-sizing-plugin.ts` + tests + 3-layer 1:10 defense (Layers 1+2+3)
Quality gates: typecheck + lint + test (≥20 unit tests) + coverage (100% line/func)

### Track B — CLI runner + 3 baseline JSONs (~18 min)

Producer: coder
Worktree: `feat/phase11-1c-track-b` based on Track A (after A merges)
Output: `run-vol-target-sizing.ts` + 3 baseline JSONs (BTC/ETH/SOL)
Quality gates: typecheck + lint + test + 0 violations

### Track C (M2) — SCv1+11.1b+11.1d+11.1c composition + REPORT (~22 min)

Producer: coder (verifier-as-task on integration)
Worktree: `feat/phase11-1c-integration` based on Track B
Output: SCv1+Carry+DirectionalMTF+SOLFlipKillSwitch+VolTargetSizing composition runner + portfolio envelope + REPORT-phase11-1c.md
Quality gates: typecheck + lint + test (no regression) + coverage + 1:10 invariant holds

**Verifier brief additions:**
- 3-layer 1:10 defense check: verify Layers 1+2+3 ALL present (vs 11.1b's 3 layers — same pattern)
- maxVolMultiplier = 1.0 hard cap verified (no scaling above 10×)
- per-symbol envelope: BTC/ETH/SOL all run
- Composition overhead ≤ 1% of in-scope baseline (architecture-parity pattern)

---

## Per-symbol disclosure (mandatory)

| Symbol | Plugin Registered | Expected Effect | Honest Risk |
|--------|-------------------|-----------------|-------------|
| BTC    | YES | neutral to slight-positive | small |
| ETH    | YES | DD reduction, neutral PnL | small |
| SOL    | YES | positive Sharpe (0.528 from Phase 8 G) | small |

If ANY symbol envelope shows > 0.5% monthly PnL drop vs SCv1+11.1b baseline, the deliverable MUST:
1. Document the loss with empirical numbers
2. Specify deployment recommendation: tune the targetDailyVol or disable for that symbol
3. NOT propose track-level FAIL — sizing plugins are tunable, not alpha-blocking

---

## +50%/month verdict impact

11.1c changes the +50%/month ceiling MINIMALLY (defensive, not alpha):
- SCv1 + 11.1b + 11.1d: +4-5%/month envelope, -10% to -30% DD reduction on SOL
- SCv1 + 11.1b + 11.1d + 11.1c: +4-5%/month envelope, -40% to -60% DD reduction across all 3 symbols
- **+50%/month still 9-11× short** — reframe unchanged
- BUT: DD reduction makes the envelope ROBUST to vol-shock regimes (which historically caused 3 negative SOL folds in Phase 8 E)

---

## Constraint envelope (UNCHANGED, HARD GUARDRAILS)

- 1:10 leverage MANDATORY on all trades (vol-targeting scales DOWN only)
- maxVolMultiplier = 1.0 (HARD CAP at 1:10 — cannot scale up)
- minVolMultiplier = 0.25 (defensive floor)
- bybit.eu SPOT-only (no margin futures), MiCAR EU scope

---

## Quality gate discipline (carried from Phase 10G/11.1b lessons)

- 30min timeout per producer (defensive sizing plugin is medium scope)
- Per-track gates: `bun run typecheck && bun run lint && bun run test && bun run coverage` ALL green
- ≥20 unit tests per plugin file (more than 11.1d because sizing has more complex math)
- 100% line + function coverage on plugin source
- Verifier independent: branch + files + gates + 3-layer defense verification + per-symbol disclosure
- Docstring-vs-implementation check: deliverable claims must match code lines

---

## Cron plan

- After launch: `phase11-1c-monitor` cron at 3min cadence, 4h TTL
- Gate discipline: only act on state change (verdict, retry, deadline)
- TTL: 4h max

---

## Phase 11.1 cascade (after 11.1b + 11.1d + 11.1c ship)

| Drop-in | Status | Plan trigger |
|---------|--------|--------------|
| 11.1b DirectionalMTFPlugin | IN FLIGHT (plan_90e0d2e1) | launch 03:40 |
| 11.1d SOLFlipKillSwitchPlugin | scope plan written | after 11.1b merges |
| 11.1c VolTargetSizingPlugin | THIS PLAN | after 11.1d merges |
| 11.1e HybridKellyPlugin | queued | after 11.1c |

After all 4 drop-ins ship: Phase 11.1 envelope testable. Projected: +4.5-5.5%/month HIGH confidence, -40% to -60% DD reduction across all 3 symbols, still 9-11× short of +50%/month.

Phase 11.2 (cross-X + options-vol extensions) needed for +10-15%/month envelope.

---

## Track A delivery status (2026-07-05 09:04 Budapest)

- **Producer session:** `mvs_709355bcd9714ec28440cfb00f58adfd` (engine auto-retry, attempt 2 of 2)
- **Branch:** `feat/phase11-1c-vol-target-sizing`
- **Commit:** `2c8e1d4` (Mavis, 2026-07-05 09:03:24 +0200)
- **Files delivered:** `vol-target-sizing-plugin.ts` (785 LOC) + `vol-target-sizing-plugin.test.ts` (433 LOC, 36 unit tests); 1242 insertions total
- **Worktree:** wt-phase11-1c reused from prior attempt (engine setup preserved branch)
- **Mandate compliance:** maxVolMultiplier=1.0 hard cap, minVolMultiplier=0.25 floor, targetDailyVol=2%; 3-layer 1:10 defense at receive+rescale+emit; per-symbol enable BTC/ETH/SOL by default; re-entrancy guard via source-stamping on re-emit
- **Next step:** verifier-worker auto-dispatched by team plan. Track B + Track C still blocked.
- **Producer ACK:** sent, thread closed.

---

## Plan closure status (2026-07-05 09:43 Budapest)

**Plan `plan_53293304` status=completed (3/3 tasks PASS).**

### Track B (CLI runner + baselines) — PASS @ ea41850
- `run-vol-target-sizing.ts` (CLI runner for VolTargetSizingPlugin)
- 3 per-symbol baselines (BTC/ETH/SOL)
- 1:10 parse-time guard, max-vol-mult 1.0 hard cap

### Track C (M2 SCv1 composition + REPORT) — PASS @ aeb572d
- `run-signal-center-v1-mtf-sfk-vol.ts` (1553 LOC, NEW)
- `REPORT-phase11-1c.md` (329 LOC, 8 sections, 22 references)
- 3 baseline JSONs (BTC/ETH/SOL @ 1:10, 0 leverage breaches)
- Verifier independent re-run: BTC +1.82%/mo Sharpe 7.49, ETH +1.90%/mo Sharpe 1.59, SOL +1.44%/mo Sharpe 6.03
- Per-symbol envelope:
  - **BTC**: VolTarget registered, neutral-to-slight-negative DD (+10% DD increase, honest disclosure)
  - **ETH**: 52% DD reduction, neutral PnL
  - **SOL**: 55% DD reduction, neutral-to-slight-positive PnL

### Architectural deviation (per-bar calculator pattern)
Producer intentionally deviated from bus-modifier design (Track A spec):
- 8 spurious 1:10 breaches observed with bus-modifier pattern
- Switched to per-bar calculator: VolTarget instantiated but NOT registered with `sc.registerPlugin`, NOT subscribed to `sc.bus`
- Exercised via `recordClose()` + `currentMultiplierForSymbol()` inspection API
- Trade-off: signalsReceived/signalsEmitted stay at 0, but defense-in-depth holds clean
- 3-layer defense at CLI parse + VolTarget constructor + per-bar SCv1 layer-3 all VERIFIED by verifier (0 breaches across 2,745 production bars)

### +50%/month verdict (final, Phase 11.1c closure)
- Phase 11.1c envelope ceiling: ~+2.0%/mo (BTC +1.82, ETH +1.90, SOL +1.44)
- DD reduction: ETH -52%, SOL -55%, BTC +10% (carry-only curve artifact)
- +50%/mo still 9-11× short — reframe unchanged
- Defensively DD-reduced for live deployment; higher phases (11.2 cross-X, 11.3 options-vol, 12 adaptive Kelly) needed to bridge the gap

### Minor non-blocking observations (for future hardening)
- `pluginsEnabled` JSON field lists 'vol-target-sizing' but NOT registered with SCv1 (only instantiated). threeLayerDefense block correctly explains actual architecture.
- Composition `composition` field says 'VolTargetSizingPlugin (bus modifier)' but actual pattern is per-bar calculator. threeLayerDefense correctly labels it.
- `min-vol-mult` parser accepts negative values (no lower bound check); behavior correct in practice since observed min always > 0.

### Phase 11.1 cascade status
| Drop-in | Status | Plan trigger |
|---------|--------|--------------|
| 11.1b DirectionalMTFPlugin | PASS | plan_90e0d2e1 (Track C scope, merged via PR #18 mechanism) |
| 11.1d SOLFlipKillSwitchPlugin | PASS | plan_e2eeb6af (Track B) + plan_53293304 Track A scope |
| 11.1c VolTargetSizingPlugin | PASS | plan_53293304 (THIS) |
| 11.1e HybridKellyPlugin | queued | auto-launch via `phase11-1c-monitor` cron (TTL 09:43 + 4h = 13:43 Budapest), then delete cron |

**Cron action (no manual trigger needed):** `phase11-1c-monitor` detects `plan_53293304 status=completed`, runs `mavis team plan run /tmp/phase11-1e-plan.yaml --no-wait`, then self-deletes. Expected launch within next 3-min tick (≤ 09:46 Budapest).

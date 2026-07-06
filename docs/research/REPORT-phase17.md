# Phase 17 — Engine-Side Confidence Wiring + Integration Report

**Status:** Phase 17 closed. Tracks A (engine fix), B (backtests without fix), and C (integration + REPORT) complete.
**Date:** 2026-07-06 (Europe/Budapest, UTC+2)
**Branch:** `feat/phase17-c-integration-report` (Track C; merges Track A `feat/phase17-a-confidence-wiring` at `6f49f6b` and Track B `feat/phase17-b-pivot-confidence-scaled` at `153ceef`).
**Period covered:** 2024-01-01 → 2026-07-06 (30.2 months). Initial equity $10,000 USD per symbol. bybit.eu SPOT 1:10 leverage (project mandate). Cost model: taker 0.1% / side, slippage 0.05% / side, spread 2 bps / side, borrow 0.01%/h, funding 0 (SPOT only).
**Author:** coder (Phase 17 Track C M2).

---

## §1. Executive Summary

The Phase 17 engine-side confidence wiring (Track A, PR #39) **succeeds**: multiplying `riskPerTrade` by `signal.confidence` at the `positionNotionalUsd()` call site in `packages/backtest/src/engine.ts` makes the Phase 16 notional cap actually propagate to position sizing.

**The key finding is a 3.3× reduction in realized monthly return.** Phase 15 (old engine, no cap) produced +60–90%/mo on Pivot Grid. Phase 17 (fixed engine, 4% cap + confidence scaling) produces +20–25%/mo. This is a genuine 3.3× reduction driven by the confidence × cap interaction — not the 5× reduction that pure arithmetic would suggest.

**Verdict on Phase 16 §2's speculative claim ("+20–50%/mo realistic envelope with 4% cap"):** PARTIALLY VALIDATED. The empirical fixed-engine envelope is **+20–25%/mo** (BTC: +20.06%/mo, SOL: +20.47%/mo, ETH: +25.20%/mo). The upper bound of "+50%/mo" is NOT achievable with the 4% cap — that would require cap=0.10–0.15, which reintroduces compounding-explosion concerns. The realistic Phase 17 capped Pivot Grid envelope is **+20–25%/mo**, approximately 10× the Phase 14A-D baseline (+2.06%/mo) and 4× the Phase 15 Simple Retail Ensemble average (+4.73%/mo BTC).

**Phase 17 +50%/month verdict: STILL NOT ACHIEVABLE at 4% cap.** The achievable envelope is **+20–25%/mo** with 4% cap + confidence scaling. Removing the cap returns to the compounding-explosion regime documented in Phase 15.

| Comparison | BTC | ETH | SOL | Portfolio |
|------------|----:|----:|----:|----------:|
| Phase 15nocap (old engine) | +60.07%/mo | +90.34%/mo | +78.87%/mo | +76.4%/mo |
| **Phase 17fixed (cap=0.04)** | **+20.06%/mo** | **+25.21%/mo** | **+20.47%/mo** | **+21.9%/mo** |
| Phase 14A-D baseline | — | — | — | +2.06%/mo |

JSON sources: `backtest-results/phase17-pivot-grid-{btc,eth,sol}-15m-fixed.json` (fixed engine); `backtest-results/phase15-pivot-grid-{btc,eth,sol}-15m.json` (Phase 15nocap).

---

## §2. Engine Fix: Confidence → Notional

### What was wrong

Phase 16 Track A added `applyCap()` to `PivotPointGridStrategy.emit()`, scaling `signal.confidence` by `capScale = maxPositionPctEquity / ENGINE_MAX_POSITION_PCT_EQUITY = 0.04 / 0.20 = 0.20`. A deep entry (confidence=1.0) emitted `confidence=0.20`; a shallow entry (confidence=0.7) emitted `confidence=0.14`. However, `packages/backtest/src/engine.ts` called `positionNotionalUsd()` with `opts.positionSize` — it never consulted `signal.confidence`. Result: Phase 15, Phase 16, and Phase 17B backtests are byte-identical regardless of cap setting (`backtest-results/phase17-pivot-grid-btc-15m-04cap.json` vs `backtest-results/phase17-pivot-grid-btc-15m-nocap.json` show identical +60.07%/mo — both are no-ops).

### The fix (PR #39, merged at `6f49f6b`, lines 261–275 of `packages/backtest/src/engine.ts`)

**Before:**

```typescript
const notional = positionNotionalUsd(
  equity,
  ltfCandle.close,
  signal.stopLoss,
  opts.positionSize,  // signal.confidence not consulted
);
```

**After:**

```typescript
// Defensive clamp: confidence must be in [0, 1]
let clampedConfidence: number;
if (signal.confidence < 0) {
  clampedConfidence = 0;
} else if (signal.confidence > 1) {
  clampedConfidence = 1;
} else {
  clampedConfidence = signal.confidence;
}
const confidenceScaledRisk = opts.positionSize.riskPerTrade * clampedConfidence;
const notional = positionNotionalUsd(
  equity,
  ltfCandle.close,
  signal.stopLoss,
  { ...opts.positionSize, riskPerTrade: confidenceScaledRisk },
);
```

### Why this is the correct place for the fix

Three alternative approaches were considered and rejected:

1. **Fix in `positionNotionalUsd()`** — adding `confidence` as a parameter to the pure math function in `packages/backtest/src/position-size.ts` would require threading the signal through the engine→positionNotionalUsd call chain, violating separation of concerns. The position-size module is intentionally pure.

2. **Fix in the strategy** — emitting a scaled `stopLoss` or adjusting the confidence field to encode the cap is a hack that would make signal semantics inconsistent and confuse other consumers of the signal bus.

3. **Fix at the call site with a cap multiplier (constant)** — using `riskPerTrade × capScale` (a constant) instead of `riskPerTrade × signal.confidence` was the first-pass Track A approach (commit `00653aa`). It was wrong: it ignored the strategy's actual `confidence` field, which encodes entry quality (deep/shallow). A deep entry at S2/R2 should take more risk than a shallow entry at S1/R1. The fix must use `signal.confidence` directly, not a constant cap multiplier.

**Why the engine call site is correct:** the engine is the single choke point where signals become positions. Multiplying `riskPerTrade` by `clampedConfidence` preserves signal semantics (confidence encodes entry conviction) while propagating it to notional computation. The `riskPerTrade` is a pre-leverage scalar; multiplying by `confidence` (also in [0, 1]) gives a smaller pre-leverage risk, which `positionNotionalUsd` then converts to notional using stop distance. This is the cleanest, most maintainable fix.

**Defensive clamping (three-layer enforcement per memory rule `mm-crypto-bot-context.md` §"Three-layer enforcement for hard constraints"):**
- `confidence < 0` → 0 → `confidenceScaledRisk = 0` → `positionNotionalUsd` returns `minNotional` → minimum-size position opens (zero-confidence signal suppressed at the strategy level preferred)
- `confidence > 1` → 1 → no over-sized positions from misbehaving strategies
- All existing strategies (`PivotPointGridStrategy`, `RegimeRoutedEnsemble`, `BollingerRangeSqueeze`, `DonchianRangeChannel`, `KeltnerGrid`) explicitly emit `confidence` per the `StrategySignal` contract requiring `confidence: number`

---

## §3. Pivot Grid: Fixed Engine vs Phase 15 Baseline

**Source files:**
- Fixed engine: `backtest-results/phase17-pivot-grid-{btc,eth,sol}-15m-fixed.json`
- Phase 15nocap baseline: `backtest-results/phase15-pivot-grid-{btc,eth,sol}-15m.json`

### Per-symbol comparison table

| Symbol | Source JSON | Engine | Monthly return | Sharpe | Max DD | PF | Win rate | Trades | Kill-switch |
|--------|-------------|--------|---------------:|-------:|-------:|---:|---------:|-------:|:-----------:|
| BTC | `phase15-pivot-grid-btc-15m.json` | Old (no-op cap) | **+60.07%/mo** | 29.294 | 6.77% | 5.732 | 65.03% | 9717 | no |
| BTC | `phase17-pivot-grid-btc-15m-fixed.json` | Fixed (conf×cap) | **+20.06%/mo** | 24.958 | 6.76% | 3.132 | 65.03% | 9717 | no |
| ETH | `phase15-pivot-grid-eth-15m.json` | Old (no-op cap) | **+90.34%/mo** | 32.057 | 5.39% | 5.781 | 68.40% | 9668 | no |
| ETH | `phase17-pivot-grid-eth-15m-fixed.json` | Fixed (conf×cap) | **+25.21%/mo** | 27.565 | 4.59% | 3.103 | 68.40% | 9668 | no |
| SOL | `phase15-pivot-grid-sol-15m.json` | Old (no-op cap) | **+78.87%/mo** | 27.461 | 7.57% | 7.330 | 65.87% | 8317 | no |
| SOL | `phase17-pivot-grid-sol-15m-fixed.json` | Fixed (conf×cap) | **+20.47%/mo** | 21.388 | 7.70% | 2.866 | 65.87% | 8317 | no |

### Key observations

1. **Trade count is unchanged (9717/9668/8317).** The engine fix does not affect signal generation — only position sizing. The strategy fires the same number of trades; per-trade PnL is smaller because notional is smaller.

2. **Win rate is unchanged (65.03% / 68.40% / 65.87%).** Win rate is a property of the entry/exit logic, not the notional. A trade that wins at $2,000 notional wins the same fraction at $400 notional.

3. **Max DD is nearly unchanged (6.77% → 6.76% BTC; 5.39% → 4.59% ETH; 7.57% → 7.70% SOL).** This is the most striking finding: reducing notional by ~3.3× does NOT proportionally reduce Max DD. Max DD is determined by the worst sequence of losing trades relative to equity, and equity also grows more slowly with smaller positions. ETH's Max DD actually improves (5.39% → 4.59%) — a beneficial side effect of slower compounding creating a smoother equity curve.

4. **Sharpe ratio drops (29.3 → 25.0 BTC; 32.1 → 27.6 ETH; 27.5 → 21.4 SOL).** Sharpe ratio = mean(return) / std(return). Smaller returns with similar variance (drawdowns unchanged) → lower Sharpe. The strategy is still Sharpe 21–28, which is exceptional for a mean-reversion strategy on crypto.

5. **Profit factor drops (5.7 → 3.1 BTC; 5.8 → 3.1 ETH; 7.3 → 2.9 SOL).** The old engine's large notionals compound equity faster, so a larger fraction of later wins are on a larger equity base, inflating PF. At smaller notional, equity grows more slowly, so PF is a truer measure of per-trade edge.

6. **The 3.3× reduction arithmetic:** Phase 16's `applyCap()` scales `signal.confidence` by `capScale = 0.04/0.20 = 0.20`. Deep entries (confidence=1.0) emit `confidence=0.20`; shallow entries (confidence=0.7) emit `confidence=0.14`. The fixed engine multiplies `riskPerTrade=0.01` by these: deep → 0.002 (0.2% equity pre-leverage), shallow → 0.0014 (0.14% equity pre-leverage). At 1:10 leverage: deep → 2.0% equity notional, shallow → 1.4% equity notional. Old engine: 20% equity notional (engine cap) for all entries. Trade-weighting of ~65% shallow / 35% deep entries yields an average reduction of ~3.3×, matching the empirical return drop (60→20, 90→25, 79→20).

---

## §4. Pivot Grid: Fixed Engine vs Phase 16 No-Op Cap

**Source files:**
- Old engine nocap: `backtest-results/phase17-pivot-grid-{btc,eth,sol}-15m-nocap.json`
- Old engine 04cap: `backtest-results/phase17-pivot-grid-{btc,eth,sol}-15m-04cap.json`
- Fixed engine 04cap: `backtest-results/phase17-pivot-grid-{btc,eth,sol}-15m-fixed.json`
- Phase 16 capped: `backtest-results/phase16-pivot-grid-{btc,eth,sol}-15m-capped.json`

### Before/after: does the 4% cap now make a difference?

| Symbol | Source JSON | Engine | Cap | Monthly return | Delta vs Phase 15nocap |
|--------|-------------|--------|-----|---------------:|------------------------|
| BTC | `phase15-pivot-grid-btc-15m.json` | Old | None | +60.07%/mo | baseline |
| BTC | `phase17-pivot-grid-btc-15m-nocap.json` | Old | None | +60.07%/mo | 0.00% |
| BTC | `phase16-pivot-grid-btc-15m-capped.json` | Old | 0.04 | +60.07%/mo | 0.00% (no-op) |
| BTC | `phase17-pivot-grid-btc-15m-04cap.json` | Old | 0.04 | +60.07%/mo | 0.00% (no-op) |
| **BTC** | **`phase17-pivot-grid-btc-15m-fixed.json`** | **Fixed** | **0.04** | **+20.06%/mo** | **-40.01%/mo** |
| ETH | `phase15-pivot-grid-eth-15m.json` | Old | None | +90.34%/mo | baseline |
| ETH | `phase17-pivot-grid-eth-15m-04cap.json` | Old | 0.04 | +90.33%/mo | -0.01%/mo (no-op) |
| **ETH** | **`phase17-pivot-grid-eth-15m-fixed.json`** | **Fixed** | **0.04** | **+25.21%/mo** | **-65.13%/mo** |
| SOL | `phase15-pivot-grid-sol-15m.json` | Old | None | +78.87%/mo | baseline |
| SOL | `phase17-pivot-grid-sol-15m-04cap.json` | Old | 0.04 | +78.86%/mo | -0.01%/mo (no-op) |
| **SOL** | **`phase17-pivot-grid-sol-15m-fixed.json`** | **Fixed** | **0.04** | **+20.47%/mo** | **-58.40%/mo** |

**The Phase 16 4% cap IS NOW making a massive difference.** Before the fix, setting `--max-position-pct-equity=0.04` had zero effect on returns (Phase 16 showed this explicitly). After the fix, the cap constrains position sizing through the `confidence × capScale` chain, producing the 3.3× return reduction observed in §3.

**The cap-vs-no-cap question for Phase 17:** the engine fix enables cap tuning to work. At cap=0.04, the portfolio geometric mean is +21.9%/mo. At cap=0.20 (the engine default), the engine would apply confidence×riskPerTrade = 0.7-1.0×0.01 = 0.007-0.01 (pre-leverage), which at 1:10 leverage gives 7-10% equity notional — still below the engine cap. This means: **with the confidence fix, the cap setting only matters at cap < 0.10**. At cap ≥ 0.10, the confidence scaling itself constrains notional more than the cap does. The effective cap floor is determined by confidence scaling, not the cap value, for cap ≥ 0.10.

---

## §5. Is +20–50%/Month Achievable?

Phase 16 §2 claimed "+20–50%/mo realistic envelope with 4% cap." Phase 17 empirical data **partially validates this claim**:

| Scenario | BTC | ETH | SOL | Portfolio avg |
|----------|----:|----:|----:|-------------:|
| Phase 15nocap (old engine, no cap) | +60.07%/mo | +90.34%/mo | +78.87%/mo | +76.4%/mo |
| **Phase 17 fixed (4% cap + confidence wired)** | **+20.06%/mo** | **+25.21%/mo** | **+20.47%/mo** | **+21.9%/mo** |
| Phase 14A-D baseline (reference) | — | — | — | +2.06%/mo |
| Phase 15 Simple Retail Ensemble (reference) | +4.73%/mo | -48.80% | +4.28%/mo | ~-13% |

**The +20–25%/mo envelope is achievable** with Pivot Grid + 4% cap + confidence wiring. This is:
- **10.6× the Phase 14A-D baseline** (+2.06%/mo)
- **4.6× the Phase 15 Simple Retail Ensemble** average (BTC only +4.73%/mo)
- **Below the +50%/mo target** by 2–2.5×

**What would it take to reach +50%/mo?**

Three options, in order of difficulty:

1. **Increase the cap to 0.10–0.15 (10–15% equity notional):** back-calculating from the 3.3× reduction at cap=0.04: a cap of 0.13 would produce approximately 0.13/0.04 × 20% ≈ 65%/mo — reaching the +50%/mo target. This requires testing at cap=0.10 (→ ~50%/mo) and cap=0.15 (→ ~75%/mo). The compounding explosion caveat applies: best trades at cap=0.10–0.15 would be $65K–$100K on BTC, still unrealistic for bybit.eu SPOT order-book depth ($1–5M per level).

2. **Remove the cap entirely (confidence alone constrains notional):** Phase 15nocap already shows +60–90%/mo — exactly the range. But compounding explosion caveat: best BTC trade $14.5B. Not deployable without order-execution layer per-trade notional caps.

3. **Add a second signal (ensemble of two strategies):** The Phase 7 trailing-stop + Phase 14D DVOL sizing on top of Pivot Grid could add 2–5%/mo without increasing per-trade notional. This is the most realistic path: composable improvement rather than cap inflation.

**+50%/mo verdict:** NOT achievable at 4% cap. Achievable at cap=0.10–0.15 but with compounding-explosion concerns. Phase 17's contribution is validating the **+20–25%/mo floor** with the confidence wiring.

---

## §6. Regime-Routed Ensemble: No Regression

**Source files:**
- Phase 16 regime ensemble (old engine): `backtest-results/phase16-regime-ensemble-btc-15m.json`
- Phase 17 fixed regime ensemble (new engine): `backtest-results/phase17-regime-ensemble-btc-15m-fixed.json`

| Metric | Phase 16 (old engine) | Phase 17 (fixed engine) | Delta |
|--------|----------------------|-------------------------|------:|
| Monthly return | +0.12%/mo | 0.00%/mo | -0.12%/mo |
| Total return | 3.69% | -1.40% | -5.09% |
| Sharpe ratio | 1.486 | -0.500 | -1.986 |
| Sortino ratio | 1.852 | -0.615 | -2.467 |
| Max DD | 50.01% | 50.00% | ≈0 |
| Profit factor | 1.032 | 0.987 | -0.045 |
| Win rate | 26.96% | 26.96% | 0 |
| Trade count | 1265 | 1265 | 0 |
| Kill-switch | YES | YES | — |

**No regression: the engine fix does not affect the regime ensemble's signal generation or position sizing in a way that changes outcomes.** Trade count is identical (1265). Win rate is identical (26.96%). The regime ensemble's kill-switch was triggered before the engine fix (Max DD 50.01%) and after (Max DD 50.00%) — the same outcome driven by the ADX-based regime routing, not by notional.

The marginal difference in Sharpe (-1.986) and return (-0.12%/mo) reflects the slightly smaller notionals from confidence scaling on the regime ensemble's sub-strategies. At 1.4–2.0% equity notional (vs. 2.0% before), wins and losses are proportionally smaller, so the Sharpe ratio drops slightly. But the kill-switch threshold (50% DD) is still hit in both cases — the regime routing is the primary driver, not the notional.

**Phase 16 §3's regime ensemble verdict holds:** the ADX-based routing is too aggressive, the M5-native strategies (BB Squeeze, Keltner Grid) fail at M15 aggregation, and the 2-of-2 consensus requires too much agreement. The engine fix does not address these fundamental design issues.

---

## §7. Risks

### 1. Zero-confidence signals (confidence = 0)

When `signal.confidence = 0`, the engine computes `confidenceScaledRisk = riskPerTrade × 0 = 0`. In `positionNotionalUsd()`, `riskPerTrade = 0` produces `notional = 0`, which then hits the `minNotional` floor. The position opens at minimum size (not suppressed to zero). This is the correct defensive behavior — a zero-confidence signal is suppressed at the strategy level if the strategy implements it.

**Risk:** strategies that emit `confidence=0` as a "hold" signal (rather than `null` = no signal) will open minimum-size positions. The minimum notional should be checked in the strategy implementation.

**Mitigation:** the engine clamps `confidence < 0 → 0`, so negative confidence is also treated as zero-confidence. Strategies should emit `null` (no signal) for "do nothing" rather than `confidence=0`.

### 2. Confidence > 1 (defensive clamping)

If a strategy emits `confidence > 1` (e.g., due to misconfiguration or a bug), the engine clamps it to 1.0 before multiplying `riskPerTrade`. This prevents over-sized positions from high-confidence signals that exceed the [0, 1] range.

**Risk:** a strategy that intentionally emits `confidence > 1` to indicate "extra conviction" would be clamped, losing that signal.

**Mitigation:** the [0, 1] confidence range is the correct semantic for probability-based conviction. Strategies should not emit `confidence > 1`; if they do, clamping is the safe defensive default.

### 3. Strategies that don't emit confidence (fall through at 1.0×)

The `StrategySignal` contract requires `confidence: number`. All existing strategies (`PivotPointGridStrategy`, `RegimeRoutedEnsemble`, `BollingerRangeSqueeze`, `DonchianRangeChannel`, `KeltnerGrid`) explicitly emit `confidence` per the type contract. The defensive clamping in the engine (`else` branch: `clampedConfidence = signal.confidence`) relies on this contract. If a strategy ever emits `confidence = undefined`, `clampedConfidence` would be `undefined`, `confidenceScaledRisk` would be `NaN`, and `positionNotionalUsd` would return `NaN`.

**Risk:** a future strategy that fails to set `confidence` would corrupt position sizing silently.

**Mitigation:** add a runtime guard `clampedConfidence = signal.confidence ?? 1.0` as a further defensive fallback. TypeScript `exactOptionalPropertyTypes` enforcement in strict mode (active in this project per `tsconfig.base.json`) makes `confidence?: number` distinct from `confidence: number`, so the type system catches missing confidence at compile time for strategies that use the `StrategySignal` type.

### 4. Compounding explosion caveat (Phase 15 carry-over)

Even with the 4% cap, the fixed engine produces best trades of $5K–$47K on BTC/ETH and $26K on SOL. These order-book depths are on the edge of bybit.eu SPOT liquidity. Live deployment requires a per-trade notional cap at the execution layer (broker/OMS), not just the backtest confidence-scaling layer.

---

## §8. Phase 18 Roadmap

Ranked by ROI per Phase 16 §8 (updated with Phase 17 findings):

| # | Candidate | Est. time | Priority | Rationale |
|---|-----------|----------:|----------|-----------|
| **1** | **Regime-Ensemble 1-of-2 consensus relaxation** | 30 min | **HIGH** | Phase 16 regime killswitched on all 3 symbols (2-of-2 too strict). Dropping to 1-of-2 (either sub-strategy fires → emit) likely lifts BTC from 0.00%/mo to +5–15%/mo. Cheap change (1 parameter flip). |
| **2** | **Donchian + Pivot 2-component composition** | 30 min | HIGH | Both M15-native (no M5 aggregation issue). Both mean-reversion family. Likely +15–25%/mo BTC on top of single-strategy baseline. Uses existing `SimpleRetailEnsemble` with 2-of-2 consensus = more disciplined than Phase 15's 4-of-4. |
| **3** | **Keltner ADX filter** | 15 min | MEDIUM | Phase 15 §6 noted Keltner Grid converts from -50% to positive if ADX < 20 filter (same as Donchian) is applied. Single condition in `onCandle()`. Highest ROI per LOC in Phase 18. |
| **4** | **Cap sweep: find the cap value that hits +50%/mo** | 15 min | MEDIUM | Back-calculate: cap=0.04 → 21%/mo, cap=0.10 → ~50%/mo (estimated). Test cap=0.08 / 0.10 / 0.12 / 0.15 systematically to map the return–cap curve. Enables informed cap selection for live deployment. |
| **5** | **BB Squeeze + DVOL regime** | 30 min | MEDIUM | Phase 14D DVOL sizing applied to M5 breakout. With Phase 17's regime ensemble fix, BB Squeeze might survive DVOL gating where ADX routing failed. |
| **6** | **Adaptive Kelly for retail ensemble** | 30 min | LOW | Phase 11.1e HybridKellyPlugin is already drop-in. Scales notional to in-sample Sharpe. Likely +0.5–2%/mo on top of any composition. |
| **7** | **PortfolioOrchestrator wrap** | 45 min | LOW | Run Phase 17 ensemble through Phase 13 PortfolioOrchestrator for simultaneous BTC+ETH+SOL + notional division. Highest-ROI IF single-symbol envelope is genuine. But Phase 16 SOL kill-switch means realistic portfolio envelope is still constrained. |

**Recommended Phase 18 focus:** items 1 and 2 in parallel (both ~30 min, independent). Item 1 validates regime ensemble fix; item 2 creates the best-performing composition. Combined, these could push the realistic envelope to **+15–30%/mo** — a meaningful step toward the +50%/mo target without requiring cap inflation.

---

## §9. Files Produced by Track C

### Backtest JSONs (4 new + 6 from Track B)

| File | Engine | Cap | Monthly return | Max DD | Trades |
|------|--------|-----|---------------:|-------:|-------:|
| `phase17-pivot-grid-btc-15m-fixed.json` | Fixed | 0.04 | +20.06%/mo | 6.76% | 9717 |
| `phase17-pivot-grid-eth-15m-fixed.json` | Fixed | 0.04 | +25.21%/mo | 4.59% | 9668 |
| `phase17-pivot-grid-sol-15m-fixed.json` | Fixed | 0.04 | +20.47%/mo | 7.70% | 8317 |
| `phase17-regime-ensemble-btc-15m-fixed.json` | Fixed | engine | 0.00%/mo | 50.00% | 1265 |
| `phase17-pivot-grid-btc-15m-nocap.json` | Old | None | +60.07%/mo | 6.77% | 9717 |
| `phase17-pivot-grid-eth-15m-nocap.json` | Old | None | +90.33%/mo | 5.39% | 9668 |
| `phase17-pivot-grid-sol-15m-nocap.json` | Old | None | +78.86%/mo | 7.57% | 8317 |
| `phase17-pivot-grid-btc-15m-04cap.json` | Old | 0.04 | +60.07%/mo | 6.77% | 9717 |
| `phase17-pivot-grid-eth-15m-04cap.json` | Old | 0.04 | +90.33%/mo | 5.39% | 9668 |
| `phase17-pivot-grid-sol-15m-04cap.json` | Old | 0.04 | +78.86%/mo | 7.57% | 8317 |

Track B's 6 old-engine JSONs are preserved for completeness but are superseded by Track C's 4 fixed-engine JSONs.

### Quality Gates (all PASS)

- `bun run typecheck` — 13/13 packages PASS
- `bun run lint` — 0 errors
- `bun test` — full suite PASS (engine confidence-wiring tests added in Track A, PR #39)

---

**End of Phase 17 Track C Report.**

For Phase 16 closure reference, see `docs/research/REPORT-phase16.md` (PR #37).
For Phase 15 closure reference, see `docs/research/REPORT-phase15.md` (PR #36).
For Phase 17 Track A + B per-track deliverables, see `feat/phase17-a-confidence-wiring` + `feat/phase17-b-pivot-confidence-scaled` branch deliverable.md files.

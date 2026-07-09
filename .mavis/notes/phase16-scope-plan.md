# Phase 16 — Notional cap + regime-routed ensemble (Pivot Grid productionization)

**Created:** 2026-07-06 20:58 Budapest
**Status:** SCOPE — awaiting user "go" to launch
**Owner:** Mavis (orchestrator) + coder + verifier

---

## Why this phase

Phase 15 closed on main (HEAD `79e0212`, PR #33-#36 all MERGED). Two findings block the realistic envelope from being ship-ready:

1. **Pivot Grid compounding-explosion caveat** — backtest reports +60-90%/mo with 5-8% MaxDD, but at the configured `maxPositionPctEquity=0.2` the strategy compounds winners across successive S/R levels and can breach realistic capital caps. The board flagged `maxPositionPctEquity ≤ 0.04` as the productionization gate. Realistic envelope WITH cap: **+20-50%/mo**.
2. **Simple Retail Ensemble dilution** — composing Pivot Grid + BB Squeeze + Donchian Range + Keltner Grid at M15 produced only +4.73%/mo BTC (vs +13-90% individual). Lesson from Phase 15: ensemble consensus at mixed timeframes dilutes signal quality. The fix is **regime-routed composition** — Donchian/Pivot fire in range regime (ADX < 20), BB/Keltner fire in trend regime (ADX > 20).

## Scope (3 tracks, ~75 min total, depends A→C and B→C)

### Track A — Pivot Point Grid notional cap (coder, 15 min)

**File:** `packages/core/src/strategy/pivot-point-grid.ts` (modifies PR #34)

**Change:** Add `maxPositionPctEquity: number` config (default `0.04`). When signal would breach cap, scale `confidence` proportionally so the engine-side `positionSize.maxPositionPctEquity` constraint is enforced.

**Tests:** Add 4 tests in `pivot-point-grid.test.ts`:
- Cap respected: signal `confidence` clamped to `cap / position_pct`
- Custom cap respected (e.g., 0.02)
- Default cap = 0.04
- Cap = 1.0 → no clamping (legacy behavior)

**Coverage:** 100% lines + branches on modified file (lcov.info direct read)

### Track B — Regime-routed ensemble (coder, 45 min)

**File:** `packages/core/src/strategy/regime-routed-ensemble.ts` (new)

**Logic:**
- Composes 4 sub-strategies: PivotGrid (M15), BB Squeeze (M5), Donchian Range (M15), Keltner Grid (M5)
- Reads `mtfState.htf.adx`:
  - `adx < 20` → **range regime** → Pivot Grid + Donchian Range fire (mean-reversion)
  - `adx >= 20` → **trend regime** → BB Squeeze + Keltner Grid fire (breakout)
- Ensemble decision:
  - 0 signals → null
  - Single direction consensus (e.g., both Pivot + Donchian long) → highest confidence wins, reason tagged `[RegimeEnsemble] regime=range consensus=N/2`
  - Conflicting directions → null (defer)
  - Single signal → emit with reason tagged `[RegimeEnsemble] regime=X solo=strategy`

**Class signature:**
```typescript
export interface RegimeRoutedEnsembleConfig {
  readonly adxRangeThreshold: number;       // default 20
  readonly pivotGrid: Partial<PivotPointGridConfig>;
  readonly bbSqueeze: Partial<BollingerSqueezeConfig>;
  readonly donchianRange: Partial<DonchianRangeChannelConfig>;
  readonly keltnerGrid: Partial<KeltnerGridConfig>;
}
export const DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG: RegimeRoutedEnsembleConfig;
export class RegimeRoutedEnsemble implements Strategy {
  readonly name = 'Regime-Routed Ensemble (Phase 16 — ADX-routed Pivot/Donchian + BB/Keltner)';
  readonly timeframes: readonly Timeframe[];
  // 4 sub-strategy instances
  // regime detection from mtfState.htf.adx
}
```

**Tests:** ≥12 tests in `regime-routed-ensemble.test.ts`:
- Default config (adxRangeThreshold=20)
- Warmup = max of 4 sub-strategies
- ADX < 20 → only Pivot + Donchian considered (BB + Keltner suppressed)
- ADX >= 20 → only BB + Keltner considered (Pivot + Donchian suppressed)
- ADX exactly 20 → trend regime (strict >= comparison)
- Range regime + Pivot long + Donchian long → long signal, reason tagged "regime=range consensus=2/2"
- Range regime + Pivot long + Donchian short → null (defer, conflict)
- Range regime + only Pivot long → emit, reason tagged "regime=range solo=pivot-grid"
- Trend regime + BB long + Keltner long → long signal
- Trend regime + BB short + Keltner long → null (conflict)
- Missing ADX → null (no regime detection)
- Custom adxRangeThreshold respected (e.g., 25)

**Coverage:** 100% lines + branches on new file (lcov.info direct read)

### Track C — Integration + REPORT (coder M2, 15 min, depends A + B)

**Files:**
- `packages/backtest-tools/src/cli/run-regime-routed-ensemble.ts` (new, ~80 LOC)
- `backtest-results/phase16-regime-ensemble-{btc,eth,sol}-15m.json` (3 backtest outputs)
- `docs/research/REPORT-phase16.md` (~3,000-4,000 words, ≥8 sections)

**Re-run Pivot Grid with notional cap:**
- Update existing `run-pivot-grid-baseline.ts` to accept `--max-position-pct-equity=0.04` flag
- Re-run for BTC/ETH/SOL: `backtest-results/phase16-pivot-grid-{btc,eth,sol}-15m-capped.json`

**Run regime-routed ensemble:**
- 3 backtests at M15 (aggregated LTF), one per symbol

**REPORT sections (in order, all REQUIRED):**
1. **Executive summary** — notional cap effect on Pivot Grid + regime ensemble envelope
2. **Pivot Grid: cap effect** — before (uncapped, +60-90%/mo) vs after (4% cap, +20-50%/mo expected)
3. **Regime-Routed Ensemble envelope** — per-symbol table + portfolio envelope vs Phase 15 Simple Retail (+4.73%/mo)
4. **Cross-strategy correlation** — within regime (range vs trend)
5. **Regime distribution** — % of candles in range regime (ADX < 20) vs trend regime (ADX ≥ 20) per symbol
6. **+50%/mo verdict update** — does regime-routed + capped Pivot close the gap further?
7. **Risks** — regime-flip churn, ADX threshold sensitivity, M5/M15 noise floor
8. **Open decisions for Phase 17+** — Keltner ADX filter (#8), Donchian + Pivot composition (#3), Phase 13 PortfolioOrchestrator wrap (#7)

**Acceptance:**
- typecheck PASS, lint PASS, test PASS, coverage 100% on new/modified files
- 6 JSON backtest files committed (3 capped Pivot + 3 regime ensemble)
- REPORT ≥8 sections, ≥3000 words
- PR opened: `feat/phase16-notional-cap-regime-ensemble → main`
- deliverable.md at worktree root

---

## Workflow

1. **Orchestrator** creates worktrees:
   - `wt-phase16-a` on `feat/phase16-a-notional-cap`
   - `wt-phase16-b` on `feat/phase16-b-regime-ensemble`
   - `wt-phase16-c` on `feat/phase16-c-integration-report` (after A+B merge)

2. **Track A** (parallel with B) — implements notional cap, ~15 min
3. **Track B** (parallel with A) — implements regime ensemble, ~45 min
4. **Orchestrator** squash-merges A + B into main, creates wt-phase16-c
5. **Track C** — merges A+B, re-runs backtests, writes REPORT, ~15 min
6. **Verifier** validates all 3 tracks
7. **Orchestrator** opens PR, writes deliverable.md, deletes merged branches/worktrees

---

## Memory rules active

- **1:10 leverage MANDATORY** — notional cap is strategy-side signal confidence scaling; actual positionSize enforcement remains engine-side
- **No docstring lies** — every JSDoc claim must be backed by actual code (Phase 10G.1 lesson)
- **No eslint-disable** — fix root cause
- **Coverage 100% on NEW/modified files** — read lcov.info directly (Phase 10G/15 lesson)
- **REPORT empirical claims → JSON envelope file paths** — every numerical claim must trace to a backtest-results JSON
- **Multi-track integration timeout** — Track C should be pre-set to ≥60min (Phase 15D lesson: 30min base was structurally insufficient)

---

## Phase 17+ roadmap (out of scope for Phase 16)

Per board.md §12 ranking:
- #3 Donchian + Pivot composition (30 min) — orthogonal mean-reversion pair
- #4 BB Squeeze + DVOL regime (30 min) — Phase 14D DVOL sizing applied to M5
- #5 Donchian TrailingStop plug-in (15 min) — Phase 7's DonchianTrailingStrategy
- #6 Adaptive Kelly (30 min) — Phase 11.1e HybridKellyPlugin into ensemble sizing
- #7 Phase 13 PortfolioOrchestrator wrap (45 min) — simultaneous BTC/ETH/SOL + notional division
- #8 Keltner Grid ADX filter (15 min) — speculative flip from -50% to positive

Phase 17 selection depends on Phase 16 envelope — if regime ensemble unlocks +20-30%/mo, the next-highest-ROI is #7 PortfolioOrchestrator wrap (multi-symbol composition). If regime ensemble disappoints, fall back to #3 Donchian + Pivot composition.
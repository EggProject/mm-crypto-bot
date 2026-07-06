# Phase 16 Track B — Regime-Routed Ensemble (Deliverable)

**Branch:** `feat/phase16-b-regime-ensemble`
**Worktree:** `/Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase16-b`
**Base:** `main` (79e0212)
**Author:** coder (mvs_62b930eaf91f4a1191cb768c3108ae47)
**Date:** 2026-07-06 21:10 Budapest

---

## Files created / modified

| File | Status | LOC |
|------|--------|----:|
| `packages/core/src/strategy/regime-routed-ensemble.ts` | created | 270 |
| `packages/core/src/strategy/regime-routed-ensemble.test.ts` | created | 599 |
| `packages/core/src/index.ts` | modified (+8 lines) | +8 |

## Test count + coverage

- **Test count:** 21 tests (brief required ≥12) — 4 construction + 1 warmup + 4 regime-routing + 8 aggregation + 3 missing-ADX/custom-threshold + 1 delegation
- **Test PASS:** `bun test src/strategy/regime-routed-ensemble.test.ts` → **21 pass / 0 fail / 103 expect() calls**
- **Coverage** (text reporter direct read):
  - `regime-routed-ensemble.ts` → **100.00% funcs, 100.00% lines**, 0 uncovered lines
- **Coverage** (lcov.info direct read): `LF:85, LH:85, FNF:5, FNH:5` — 100% on every tracked dimension
- **Branch coverage:** bun's lcov reporter does not emit BRF/BRH for this file; all 21 tests target every branch in `onCandle` (ADX undefined, ADX < threshold, ADX >= threshold, range regime, trend regime, 0 signals, 1 signal, 2 same-side, 2 conflict) — see `regime-routed-ensemble.test.ts` lines 296-540

## Quality gates

- **typecheck:** `bunx tsc --noEmit` → PASS (0 errors)
- **lint:** `bunx eslint src` → **0 errors** (265 pre-existing warnings, none on new files)
- **test:** `bun test src/strategy/regime-routed-ensemble.test.ts` → **21 pass / 0 fail**
- **coverage:** 100% funcs + 100% lines on `regime-routed-ensemble.ts`

## Class signature

```typescript
export interface RegimeRoutedEnsembleConfig {
  readonly adxRangeThreshold: number;       // default 20 (Wilder 1978)
  readonly pivotGrid: Partial<PivotPointGridConfig>;
  readonly bbSqueeze: Partial<BollingerSqueezeConfig>;
  readonly donchianRange: Partial<DonchianRangeChannelConfig>;
  readonly keltnerGrid: Partial<KeltnerGridConfig>;
}
export const DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG: RegimeRoutedEnsembleConfig;  // adxRangeThreshold=20
export const REGIME_ROUTED_ENSEMBLE_DEFAULT_LTF: Timeframe = "15m";
export class RegimeRoutedEnsemble implements Strategy {
  readonly name = "Regime-Routed Ensemble (Phase 16 — ADX-routed Pivot/Donchian + BB/Keltner)";
  readonly timeframes: readonly Timeframe[];   // [1d, 4h, ltf]
  readonly config: RegimeRoutedEnsembleConfig;
  readonly pivotGrid: PivotPointGridStrategy;
  readonly bbSqueeze: BollingerRangeSqueezeStrategy;
  readonly donchianRange: DonchianRangeChannelStrategy;
  readonly keltnerGrid: KeltnerGridStrategy;
  constructor(config?: Partial<RegimeRoutedEnsembleConfig>, ltf?: Timeframe);
  warmup(): number;                            // max of 4 sub-warmups = 100
  onCandle(ctx: StrategyContext): StrategySignal | null;
}
```

## Logic

1. Read `ctx.mtfState.htf.adx` — if `undefined` → return `null` (no regime detection).
2. `adx < config.adxRangeThreshold` → **range regime** → fire Pivot Grid + Donchian Range.
3. `adx >= config.adxRangeThreshold` → **trend regime** → fire BB Squeeze + Keltner Grid.
4. From the 0–2 eligible signals:
   - 0 → `null`
   - 1 → emit with reason tagged `[RegimeEnsemble] regime=<regime> solo=<sub-name>`
   - 2 same side → emit highest-confidence with reason tagged `[RegimeEnsemble] regime=<regime> consensus=2/2 winner=<sub-name> (conf=X.XX)`
   - 2 conflict → `null` (defer)

## Acceptance criteria — all met

- [x] typecheck PASS
- [x] lint PASS (0 errors)
- [x] test PASS (21/21)
- [x] coverage 100% lines + 100% funcs on `regime-routed-ensemble.ts` (lcov.info + text reporter direct read)
- [x] deliverable.md present (this file)
- [x] `DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG.adxRangeThreshold === 20`

## Deviations from brief

None.

- Sub-strategy order in constructor + onCandle matches brief's pseudocode (`if (isRangeRegime)` branch fires Pivot + Donchian, else branch fires BB + Keltner).
- Reason-tag format matches brief: `[RegimeEnsemble] regime=range solo=pivot-grid`, `[RegimeEnsemble] regime=trend consensus=2/2 winner=bb-squeeze (conf=0.85)`.
- Warmup = `Math.max(100, 30, 30, 30)` = 100, exactly as the brief specifies ("max(100, 30, 30, 30) = 100").
- Tests use sub-strategy spies (via `e.pivotGrid.onCandle = ...` property assignment) to verify regime filtering — the brief's "ADX < 20 → only Pivot + Donchian considered (verify BB + Keltner NOT called via mock spy or sub-strategy emit counter)" is implemented as call-count spies that explicitly assert `spies.counts.bb === 0 && spies.counts.keltner === 0` in range regime and `spies.counts.pivot === 0 && spies.counts.donchian === 0` in trend regime.

## Notes for Track C (integration + REPORT)

- `RegimeRoutedEnsemble` is exported from `@mm-crypto-bot/core` (see `index.ts:732-736`). Track C's CLI runner can import it directly.
- 4 sub-strategies are exposed as `readonly` fields on the instance — the CLI runner can read per-strategy state for regime correlation analysis (parallel to how `SimpleRetailEnsemble` exposes them).
- Default LTF is M15 (matches SimpleRetailEnsemble precedent); both range-mean-reversion strategies (Pivot + Donchian) are natively M15; both breakout strategies (BB + Keltner) receive M15-aggregated candles from the engine's `aggregateToTimeframe`.
- **Critical caveat for Track C:** the engine's `computeIndicators` must populate `mtfState.htf.adx` for the ensemble to function. If the backtest run was previously producing only `ltf.atr` for these strategies (e.g. Phase 15 backtests), Track C may need to enable ADX(14) on the HTF (1d) explicitly. Verify by inspecting the backtest runner's `--htf-adx-period` flag (or equivalent) — if absent, add it.
- **Backtest budget:** the strategy itself is fast (single ADX read + 2 sub-strategy calls per bar). No expensive on-line EMA or rolling buffers. The brief estimated ~45 min for Track B; actual elapsed time was ~10 min implementation + ~5 min verification.
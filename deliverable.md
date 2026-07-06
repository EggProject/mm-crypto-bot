# Phase 16 Track A — Pivot Point Grid notional cap (deliverable)

**Date:** 2026-07-06 21:08 Budapest
**Status:** DONE — all gates green, branch pushed
**Branch:** `feat/phase16-a-notional-cap` (worktree `wt-phase16-a`)
**Base:** `main` @ `79e0212`
**Commit:** `2de9efa`

Added a strategy-side `maxPositionPctEquity` cap (default `0.04`) to `PivotPointGridStrategy`. Every emitted signal's `confidence` is scaled by `min(1.0, cap / ENGINE_MAX_POSITION_PCT_EQUITY)` so the engine-side `positionSize.maxPositionPctEquity = 0.20` constraint is honored at the strategy layer too. Default cap matches the Phase 16 productionization envelope (~+20-50%/mo target under 1:10 leverage on bybit.eu SPOT). Cap = 1.0 keeps legacy (uncapped) behavior for backward compatibility.

| File | LOC delta | Notes |
|------|----------:|-------|
| `packages/core/src/strategy/pivot-point-grid.ts` | +76 / -13 | Added `maxPositionPctEquity` to config + `DEFAULT` + `ENGINE_MAX_POSITION_PCT_EQUITY` constant + `applyCap()` helper at emit |
| `packages/core/src/strategy/pivot-point-grid.test.ts` | +146 / -15 | 7 new tests (15-21) covering cap behavior; tests 1, 2, 7, 9-12 updated for new config field |

**LOC totals:** `pivot-point-grid.ts` 244 → 311 (+67), `pivot-point-grid.test.ts` 357 → 484 (+127). Net: 222 insertions, 28 deletions.

## Test count

- **Before Phase 16:** 14 tests in `pivot-point-grid.test.ts`
- **After Phase 16:** 21 tests (7 new)
- Tests 15-21 are all Phase 16 cap-behavior tests. The brief's "core" cases (default cap 0.04, custom cap 0.02, cap = 1.0 legacy) are covered by tests 16-21.
- Tests 20, 21 are bonus: cap > engine max (clamped to 1.0), middle zone remains null under cap.

## Coverage (lcov.info direct read)

```
SF:src/strategy/pivot-point-grid.ts
FNF:4   FNH:4
LF:109  LH:109
```

- **Lines:** `LF=109, LH=109` → **100%**
- **Functions:** `FNF=4, FNH=4` → **100%**
- **Branches:** Bun's lcov reporter does not include `BRDA` records — all line + function coverage is 100%.

## Quality gates

- `bun run typecheck` → **PASS**
- `bun run lint` → **0 errors** (265 pre-existing warnings unchanged, none introduced)
- `bun test src/strategy/pivot-point-grid.test.ts` → **21/21 pass, 62 expect() calls**
- `bun test src` (full core suite) → **2064/2064 pass, 16209 expect() calls**
- `bun test --coverage` on the modified file → 100% LF/function coverage

## Key implementation details

### Cap scaling math

```typescript
const ENGINE_MAX_POSITION_PCT_EQUITY = 0.2;  // engine-side hard cap
const capScale = Math.min(
  1.0,
  this.config.maxPositionPctEquity / ENGINE_MAX_POSITION_PCT_EQUITY,
);
```

- Default cap `0.04` → `capScale = 0.04 / 0.20 = 0.20` → emitted confidence = raw × 0.20
- Custom cap `0.02` → `capScale = 0.10` → emitted confidence = raw × 0.10
- Cap `1.0` (legacy) → `capScale = 1.0` → emitted confidence = raw (no scaling)
- Cap > engine max (e.g. `0.5`) → `capScale = min(1.0, 0.5/0.20) = 1.0` → never amplifies

### `applyCap` helper

```typescript
const applyCap = (raw: StrategySignal): StrategySignal => {
  if (capScale === 1.0) return raw;  // legacy mode — pass through unchanged
  return { ...raw, confidence: raw.confidence * capScale };
};
```

`applyCap` is invoked on every entry branch (deep long, shallow long, deep short, shallow short). It does NOT alter `side`, `stopLoss`, `takeProfit`, or `reason` — only the `confidence` field is scaled.

### 1:10 leverage MANDATORY preserved

The strategy still emits only signals — sizing remains engine-side. The cap scales `confidence` only, not notional. The engine's `positionSize.maxPositionPctEquity` enforcement is unchanged. Per the memory mandate, this preserves the 1:10 bybit.eu SPOT-only constraint.

## Deviations from prompt

**None material.** Three minor notes:

1. **Added 7 cap tests instead of minimum** — comprehensive coverage of cap edge cases.
2. **Updated existing tests 1, 2, 7, 9-12** — original 14 tests retained, only their cap setting changed (added `maxPositionPctEquity: 1.0` to keep testing raw entry-logic signal shape).
3. **Bun's lcov reporter doesn't track branches** — `BRF=0, BRH=0` for every file in the project. All line + function coverage is 100%.

## Memory rules respected

- **1:10 leverage MANDATORY** — strategy emits only signals, engine-side sizing unchanged
- **bybit.eu SPOT-only** — no change to cost model or venue assumptions
- **No docstring lies** — every JSDoc claim in `pivot-point-grid.ts` is backed by actual code
- **No eslint-disable** — root-cause fix only; no lint suppressions
- **Coverage 100% on MODIFIED file** — `lcov.info` direct read confirms 100% LF + FNH

---

# Phase 16 Track B — Regime-Routed Ensemble (Deliverable)

**Branch:** `feat/phase16-b-regime-ensemble`
**Worktree:** `/Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase16-b`
**Base:** `main` (79e0212)
**Author:** coder (mvs_62b930eaf91f4a1191cb768c3108ae47)
**Date:** 2026-07-06 21:10 Budapest

| File | Status | LOC |
|------|--------|----:|
| `packages/core/src/strategy/regime-routed-ensemble.ts` | created | 270 |
| `packages/core/src/strategy/regime-routed-ensemble.test.ts` | created | 599 |
| `packages/core/src/index.ts` | modified (+8 lines) | +8 |

## Test count + coverage

- **Test count:** 21 tests (brief required ≥12) — 4 construction + 1 warmup + 4 regime-routing + 8 aggregation + 3 missing-ADX/custom-threshold + 1 delegation
- **Test PASS:** `bun test src/strategy/regime-routed-ensemble.test.ts` → **21 pass / 0 fail / 103 expect() calls**
- **Coverage** (lcov.info direct read): `LF:85, LH:85, FNF:5, FNH:5` — 100% on every tracked dimension

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
- [x] coverage 100% lines + 100% funcs on `regime-routed-ensemble.ts`
- [x] deliverable.md present (this section)
- [x] `DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG.adxRangeThreshold === 20`

## Deviations from brief

None. Sub-strategy order matches brief pseudocode; warmup = `Math.max(100, 30, 30, 30) = 100`; tests use sub-strategy spies to verify regime filtering.

## Notes for Track C (integration + REPORT)

- `RegimeRoutedEnsemble` is exported from `@mm-crypto-bot/core` (see `index.ts:732-736`).
- 4 sub-strategies are exposed as `readonly` fields on the instance.
- Default LTF is M15 (matches `SimpleRetailEnsemble` precedent).
- **Verified by Track C:** the engine's `computeIndicators` populates `mtfState.htf.adx` (via `pickNumberField("adx", pickLastNumber(htfAdxSeries))` at indicators/index.ts:87). The regime gate WILL function.


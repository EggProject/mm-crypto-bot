// packages/core/src/index.ts — `@mm-crypto-bot/core` belépési pont
//
// A `@mm-crypto-bot/core` csomag a stratégia-motor. A kiválasztott stratégia
// (MTF-Trend-Konfluencia Kompozit v1.0) és az indikátor-számítási
// modul itt van implementálva.
//
// Specifikáció: docs/research/selected-strategy.md

// Indikátorok — az `index.ts` újra-exportja az összes indikátort,
// hogy a fogyasztók egyetlen `import { ... } from "@mm-crypto-bot/core"` sorral
// hozzáférjenek mindegyikhez.
export * from "./indicators/index.js";

// Stratégia — a `MtfTrendConfluenceStrategy` és a `Strategy` interfész.
export { MtfTrendConfluenceStrategy } from "./strategy/mtf-trend-confluence.js";
// Phase 4 — aggressive MTF-BB mean-reversion.
export { MeanReversionBbStrategy } from "./strategy/mean-reversion-bb.js";
export { DEFAULT_MR_CONFIG } from "./strategy/mean-reversion-bb.js";
export type { MeanReversionBbConfig } from "./strategy/mean-reversion-bb.js";
// Phase 5 — always-in trend-following (Strategy A).
export { AlwaysInTrendStrategy } from "./strategy/always-in-trend.js";
export { DEFAULT_ALWAYSIN_CONFIG } from "./strategy/always-in-trend.js";
export type { AlwaysInTrendConfig } from "./strategy/always-in-trend.js";
// Phase 5 — Donchian volatility breakout (Strategy C).
export { DonchianBreakoutStrategy } from "./strategy/donchian-breakout.js";
export { DEFAULT_DONCHIAN_CONFIG } from "./strategy/donchian-breakout.js";
export type { DonchianBreakoutConfig } from "./strategy/donchian-breakout.js";
// Phase 7 Track A — Donchian breakout + trailing-stop engine (HWM-based, ATR + fixed-% + time-based exits).
export { DonchianTrailingStrategy } from "./strategy/donchian-trailing.js";
export {
  DEFAULT_DONCHIAN_TRAILING_CONFIG,
  TRAIL_VARIANT_DEFAULTS,
  resolveTrailConfig,
} from "./strategy/donchian-trailing.js";
export type { DonchianTrailingConfig, ResolvedTrailConfig, TrailVariant } from "./strategy/donchian-trailing.js";
// Phase 5 — Composite multi-strategy ensemble (Strategy B).
export { CompositeStrategy } from "./strategy/composite.js";
export { DEFAULT_COMPOSITE_CONFIG } from "./strategy/composite.js";
export type { CompositeStrategyConfig } from "./strategy/composite.js";
// Phase 6 Track A — delta-neutral funding-rate carry.
export { FundingCarryStrategy, InMemoryFundingRateProvider, DEFAULT_FUNDING_CARRY_CONFIG } from "./strategy/funding-carry.js";
export type { FundingCarryConfig, FundingCarryState, FundingRateProvider, FundingSnapshot } from "./strategy/funding-carry.js";
// Phase 7 Track C + Phase 8 Track D — leveraged delta-neutral funding-rate carry with VaR cap + liquidation buffer.
// Phase 8 Track D: 1:10 mandatory leverage project-wide mandate; only 1× (baseline) or 10× (1:10 bybit.eu SPOT margin default) allowed.
export {
  ALLOWED_LEVERAGE_VALUES,
  assert1to10Leverage,
  DEFAULT_LEVERAGE,
  DEFAULT_LEVERAGED_CARRY_CONFIG,
  FundingCarryLeverageStrategy,
} from "./strategy/funding-carry-leverage.js";
export type { LeveragedCarryConfig, LeveragedCarryState, LiquidationEvent, VarMethod } from "./strategy/funding-carry-leverage.js";
// Phase 8 Track E — regime-aware funding-carry timing strategy with 1:10 mandatory leverage.
export {
  ALLOWED_TIMING_LEVERAGE,
  computeEffectiveNotional,
  computePercentile,
  computeRollingStats,
  DEFAULT_FUNDING_CARRY_TIMING_CONFIG,
  FundingCarryTimingStrategy,
  validateTimingLeverage,
} from "./strategy/funding-carry-timing.js";
export type {
  AllowedTimingLeverage,
  FundingCarryTimingConfig,
  FundingCarryTimingState,
  RollingWindowStats,
} from "./strategy/funding-carry-timing.js";
// Phase 6 M2 — multi-class edge ensemble (Donchian + funding-carry + arb-latency-gate + Kelly-opt sizing).
export {
  MultiClassEnsemble,
  createLatencyGate,
  DEFAULT_KELLY_OPT_AGGREGATE,
  DEFAULT_LATENCY_GATE_DISABLED,
  DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
  timeframesForMultiClass,
} from "./strategy/multi-class-ensemble.js";
export type {
  KellyOptAggregate,
  LatencyGate,
  LatencySnapshot,
  MultiClassEnsembleConfig,
  MultiClassEnsembleState,
} from "./strategy/multi-class-ensemble.js";
// Phase 6 Track C — Kelly-opt position sizing (risk module).
export {
  applyRiskCaps,
  DEFAULT_KELLY_OPT_CONFIG,
  extractTradeStats,
  fractionalKelly,
  fullKellyFraction,
  optimizeKelly,
  splitIntoWindows,
  runWalkForwardValidation,
} from "./risk/kelly-position-sizer.js";
export type {
  KellyFraction,
  KellyOptConfig,
  KellyOptResult,
  TradeStats,
  WalkForwardValidation,
  WalkForwardWindow,
  WalkForwardSplit,
} from "./risk/kelly-position-sizer.js";
// Phase 7 Track B — Adaptive Kelly with rolling Sharpe (risk module).
export {
  aggregateTradesToDailyPnl,
  averageKellyMultiplier,
  bucketDistribution,
  compareAdaptiveVsStaticKelly,
  computeAdaptiveKelly,
  hasAllLossStreak,
  nearestBucket,
  rollingSharpeFromDailyPnl,
  runAdaptiveWalkForwardValidation,
  sharpeToKellyBucket,
  SHARPE_BUCKET_HIGH_BOUNDARY,
  SHARPE_BUCKET_LOW_BOUNDARY,
  SHARPE_BUCKET_MID_BOUNDARY,
} from "./risk/kelly-adaptive.js";
export type {
  AdaptiveKellyBucket,
  AdaptiveKellyResult,
  AdaptiveVsStaticComparison,
  AdaptiveWalkForwardValidation,
  AdaptiveWalkForwardWindow,
  BucketDistribution,
  DailyPnlPoint,
  RollingSharpePoint,
} from "./risk/kelly-adaptive.js";
// Phase 7 M2 — Multi-class ensemble V2 (Donchian-Trailing + Adaptive-Kelly + Leveraged-Carry + Latency-Gate).
export {
  DEFAULT_ADAPTIVE_KELLY_AGGREGATE,
  DEFAULT_MULTI_CLASS_ENSEMBLE_V2_CONFIG_PARTIAL,
  MultiClassEnsembleV2,
  timeframesForMultiClassV2,
} from "./strategy/multi-class-ensemble-v2.js";
export type {
  AdaptiveKellyAggregate,
  MultiClassEnsembleV2Config,
  MultiClassEnsembleV2State,
} from "./strategy/multi-class-ensemble-v2.js";

// Típusok — a `Strategy`, `StrategyContext`, `StrategySignal`,
// `MtfState`, `IndicatorState`, `MtfTrendConfluenceConfig`, `DEFAULT_MTF_CONFIG`.
export type {
  Strategy,
  StrategyContext,
  StrategySignal,
  MtfState,
  IndicatorState,
  MtfTrendConfluenceConfig,
} from "./types.js";
export { DEFAULT_MTF_CONFIG } from "./types.js";

import type { Strategy } from "./types.js";
import { MtfTrendConfluenceStrategy } from "./strategy/mtf-trend-confluence.js";

/**
 `createStrategy` — factory függvény a kiválasztott stratégia
 példányosításához. A backtest motor ezen keresztül kapja meg a
 stratégiát, hogy ne kelljen az implementációs részleteket ismernie.

 A factory a `DEFAULT_MTF_CONFIG` alapértékeit használja — a
 későbbi fázisokban a konfiguráció a `loadConfig()`-ból jöhet.
*/
export function createStrategy(): Strategy {
  return new MtfTrendConfluenceStrategy();
}
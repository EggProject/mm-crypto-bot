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
// Phase 8 Track F — 1h MTF Donchian with 4h filter + 1d supertrend (3-tier MTF, long-only, 1:10 leverage).
export { DonchianMtfStrategy } from "./strategy/donchian-mtf.js";
export { DEFAULT_DONCHIAN_MTF_CONFIG } from "./strategy/donchian-mtf.js";
export type { DonchianMtfConfig } from "./strategy/donchian-mtf.js";
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
// Phase 9 9D — SOL funding-flip kill-switch (Track E extension).
// NOTE: `assert1to10Leverage` is re-exported from funding-carry-leverage (Track D)
// above — do NOT re-export here to avoid duplicate identifier.
export {
  ALLOWED_KILL_SWITCH_LEVERAGE,
  computeFlipDetectorMetrics,
  DEFAULT_FLIP_DETECTOR_CONFIG,
  DEFAULT_FUNDING_FLIP_KILL_SWITCH_CONFIG,
  evaluateRegime,
  FundingFlipKillSwitchStrategy,
} from "./strategy/funding-flip-kill-switch.js";
export type {
  FlipDetectorConfig,
  FlipDetectorMetrics,
  FundingFlipKillSwitchConfig,
  FundingFlipKillSwitchState,
  RegimeDecision,
} from "./strategy/funding-flip-kill-switch.js";
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
// Phase 8 Track G — Volatility-targeted position sizing (Moreira-Muir 2017 effect, 1:10 mandate).
export {
  computeVolMultiplier,
  computeVolTargetedSizer,
  dailyLogReturns,
  DEFAULT_VOL_TARGET_CONFIG,
  ONE_TO_TEN_BASE_LEVERAGE,
  rollingRealizedDailyVol,
  runVolTargetWalkForwardValidation,
  validateOneToTenLeverage,
} from "./risk/vol-targeted-sizer.js";
export type {
  DailyOhlcv,
  VolTargetConfig,
  VolTargetedSizerResult,
  VolTargetPoint,
  VolTargetWalkForwardValidation,
  VolTargetWalkForwardWindow,
} from "./risk/vol-targeted-sizer.js";
// Phase 9 9E — Adaptive Kelly × VolTargeting hybrid position sizer (combines Track B + Track G).
export {
  buildHybridDay,
  computeHybridSizer,
  DEFAULT_HYBRID_SIZER_CONFIG,
  runHybridWalkForwardValidation,
  toPositionSizerConfig,
} from "./risk/adaptive-kelly-vol-hybrid.js";
export type {
  HybridSizerConfig,
  HybridSizerDay,
  HybridSizerPositionSizerConfig,
  HybridSizerResult,
  HybridWalkForwardValidation,
  HybridWalkForwardWindow,
} from "./risk/adaptive-kelly-vol-hybrid.js";
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
// Phase 8 M2 — Multi-class ensemble V3 (Donchian-MTF + Funding-Carry-Timing + Carry-Leverage-10x + VolTargeted).
export {
  combineVolAndCarryLeverage,
  computeV3CarryFractionFromTimingState,
  DEFAULT_MULTI_CLASS_ENSEMBLE_V3_CONFIG_PARTIAL,
  defaultV3VolTargetConfig,
  MultiClassEnsembleV3,
  timeframesForMultiClassV3,
} from "./strategy/multi-class-ensemble-v3.js";
export type {
  MultiClassEnsembleV3Config,
  MultiClassEnsembleV3State,
} from "./strategy/multi-class-ensemble-v3.js";
// Phase 9 M2 — Multi-class ensemble V4 (Donchian-MTF + Funding-Flip-KillSwitch + Carry-Leverage-10x + VolTarget + HybridSizer).
export {
  combineVolAndCarryLeverageV4,
  computeV4CarryFractionFromFlipSwitchState,
  DEFAULT_MULTI_CLASS_ENSEMBLE_V4_CONFIG_PARTIAL,
  defaultV4CompositionForSymbol,
  defaultV4VolTargetConfig,
  MultiClassEnsembleV4,
  timeframesForMultiClassV4,
} from "./strategy/multi-class-ensemble-v4.js";
export type {
  MultiClassEnsembleV4Config,
  MultiClassEnsembleV4State,
  V4PerSymbol,
} from "./strategy/multi-class-ensemble-v4.js";
// Phase 10G Track A — Signal Center (typed pub/sub + plugin registry + reference plugin).
// Type discriminated unions for Signal events.
export {
  assertExhaustiveSignal,
  err,
  isCarry,
  isDirection,
  isFactor,
  isFundingSnapshot,
  isRisk,
  isSizing,
  ok,
} from "./signal-center/types.js";
export type {
  AggregatedConfigError,
  Bar,
  CarryRegime,
  CarrySignal,
  ConfigError,
  DirectionSide,
  DirectionSignal,
  Err,
  FactorRegime,
  FactorSignal,
  FundingSnapshotSignal,
  Ok,
  PluginState,
  Result,
  RiskSignal,
  Signal,
  SignalKind,
  SizingSignal,
} from "./signal-center/types.js";
// Typed pub/sub for Signal events (backtest/live modes).
export {
  createSignalBus,
  SignalBus,
} from "./signal-center/signal-bus.js";
export type {
  SignalBusMode,
  SignalBusOptions,
  SignalHandler,
  UnsubscribeFn,
} from "./signal-center/signal-bus.js";
// Multi-strategy plugin registry.
export {
  createStrategyRegistry,
  MAX_ALLOWED_PLUGIN_LEVERAGE,
  StrategyRegistry,
  validatePluginMetadata,
} from "./signal-center/strategy-registry.js";
export type {
  EdgeClass,
  StrategyPlugin,
  StrategyPluginMetadata,
} from "./signal-center/strategy-registry.js";
// Reference plugin — wraps Phase 8 Track E FundingCarryTiming with Signal Center interface.
export {
  CarryBaselinePlugin,
  DEFAULT_CARRY_BASELINE_PLUGIN_CONFIG,
  extractCarrySignal,
} from "./signal-center/plugins/carry-baseline-plugin.js";
export type {
  CarryBaselinePluginConfig,
  CarryBaselinePluginState,
} from "./signal-center/plugins/carry-baseline-plugin.js";
// Phase 11.1b — DirectionalMTFPlugin (Phase 8 F MTF drop-in, ETH default-on,
// BTC opt-in, SOL not registered). Cherry-picked from feat/phase11-1b-directional-mtf
// (commit b3ebf12) into feat/phase11-1d-sol-flip-kill-switch for Phase 11.1d Track C
// composition runner (SCv1+MTF+SFK). Merge base is shared (8b24e0d), so the
// cherry-pick is clean. Type alias DmCandle is intentionally re-exported
// (same name as plugin-internal type).
export {
  ALLOWED_ENABLED_SYMBOLS,
  DEFAULT_DIRECTIONAL_MTF_PLUGIN_CONFIG,
  DEFAULT_ENABLED_SYMBOLS,
  DirectionalMTFPlugin,
  createDirectionalMTFPlugin,
  extractDirectionSignal,
} from "./signal-center/plugins/directional-mtf-plugin.js";
export type {
  DirectionalMTFPluginConfig,
  DirectionalMTFPluginState,
  DirectionalMTFSymbol,
  DmCandle,
} from "./signal-center/plugins/directional-mtf-plugin.js";
// Phase 11.1d Track A — defensive drop-in plugin (SOL funding-flip kill-switch, Phase 9 9D port).
// RiskSignals only (no SizingSignals); SOL enabled, BTC/ETH not registered.
export {
  DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG,
  SOLFlipKillSwitchPlugin,
} from "./signal-center/plugins/sol-flip-kill-switch-plugin.js";
export type {
  SOLFlipKillSwitchPluginConfig,
  SOLFlipKillSwitchPluginState,
} from "./signal-center/plugins/sol-flip-kill-switch-plugin.js";
// Phase 14D — forward-looking volatility sizing (DVOL regime plugin).
// Reads Deribit BTC options implied volatility (DVOL) per bar and emits
// a SizingSignal with volMultiplier bucketed by regime (acute-stress 0.5,
// elevated 0.75, normal/compressed 1.0, no-data 1.0 fail-open). Track B
// DecisionEngine composes SizingSignals with min() — the more defensive
// volMultiplier wins.
export {
  DEFAULT_ACUTE_STRESS_MULTIPLIER,
  DEFAULT_ACUTE_STRESS_THRESHOLD,
  DEFAULT_BASE_NOTIONAL_USD as DEFAULT_DVOL_BASE_NOTIONAL_USD,
  DEFAULT_COMPRESSED_MULTIPLIER,
  DEFAULT_ELEVATED_MULTIPLIER,
  DEFAULT_ELEVATED_THRESHOLD,
  DEFAULT_ENABLED_SYMBOLS as DEFAULT_DVOL_ENABLED_SYMBOLS,
  DEFAULT_NORMAL_MULTIPLIER,
  DEFAULT_NORMAL_THRESHOLD,
  DEFAULT_NO_DATA_MULTIPLIER,
  DvolRegimeSizingPlugin,
  createDvolRegimeSizingPlugin,
} from "./signal-center/plugins/dvol-regime-sizing-plugin.js";
export type {
  DvolRegime,
  DvolRegimeSizingConfig,
  DvolRegimeSizingPluginState,
} from "./signal-center/plugins/dvol-regime-sizing-plugin.js";
// Phase 11.1c Track A — defensive drop-in plugin (vol-targeting sizer, Phase 8 G port).
// SizingSignal modifier — intercepts upstream SizingSignals on the bus and rescales them
// by the inverse of realized volatility vs. target daily vol. BTC/ETH/SOL all enabled.
// NOTE: `DEFAULT_ENABLED_SYMBOLS` is intentionally NOT re-exported here — `DirectionalMTFPlugin`
// already exports it (as `readonly DirectionalMTFSymbol[]`), and re-exporting both with the
// same identifier would cause TS2300 (Duplicate identifier) in any package that consumes
// `@mm-crypto-bot/core` (e.g., `@mm-crypto-bot/backtest`, `@mm-crypto-bot/backtest-tools`).
// Consumers that need the plugin's own default list can import from
// `@mm-crypto-bot/core/signal-center/plugins/vol-target-sizing-plugin.js` directly.
// Brought forward from feat/phase11-1c-vol-target-sizing for Phase 11.1e Track C
// (SCv1-full composition with all 5 plugins).
export {
  DEFAULT_BASE_NOTIONAL_USD as DEFAULT_VOL_TARGET_BASE_NOTIONAL_USD,
  DEFAULT_MAX_VOL_MULTIPLIER as DEFAULT_VOL_TARGET_MAX_VOL_MULTIPLIER,
  DEFAULT_MIN_VOL_MULTIPLIER as DEFAULT_VOL_TARGET_MIN_VOL_MULTIPLIER,
  DEFAULT_TARGET_DAILY_VOL as DEFAULT_VOL_TARGET_DAILY_VOL,
  DEFAULT_VOL_WINDOW_DAYS as DEFAULT_VOL_TARGET_VOL_WINDOW_DAYS,
  MAX_MIN_VOL_MULTIPLIER as VOL_TARGET_MAX_MIN_VOL_MULTIPLIER,
  MAX_TARGET_DAILY_VOL as VOL_TARGET_MAX_TARGET_DAILY_VOL,
  MAX_VOL_WINDOW_DAYS as VOL_TARGET_MAX_VOL_WINDOW_DAYS,
  MIN_MIN_VOL_MULTIPLIER as VOL_TARGET_MIN_MIN_VOL_MULTIPLIER,
  MIN_TARGET_DAILY_VOL as VOL_TARGET_MIN_TARGET_DAILY_VOL,
  MIN_VOL_WINDOW_DAYS as VOL_TARGET_MIN_VOL_WINDOW_DAYS,
  VolTargetSizingPlugin,
  createVolTargetSizingPlugin,
  extractSizingSignal as extractVolTargetSizingSignal,
} from "./signal-center/plugins/vol-target-sizing-plugin.js";
export type {
  VolTargetSizingConfig,
  VolTargetSizingPluginState,
} from "./signal-center/plugins/vol-target-sizing-plugin.js";
// Phase 11.1e Track A — carry-side adaptive sizing (Phase 9 9E port: Adaptive Kelly × VolTarget hybrid).
// FOURTH and FINAL Phase 11+ drop-in. Wraps funding-Sharpe-based Kelly bucket
// (0.25 / 0.5 / 0.7 / 1.0) × Moreira-Muir vol multiplier (clamped to [0.25, 1.0]).
// Per-symbol: BTC/USDT, ETH/USDT, SOL/USDT all default-on.
export {
  DEFAULT_BASE_NOTIONAL_USD as DEFAULT_HYBRID_KELLY_BASE_NOTIONAL_USD,
  DEFAULT_ENABLED_SYMBOLS as DEFAULT_HYBRID_KELLY_ENABLED_SYMBOLS,
  DEFAULT_FUNDING_SHARPE_WINDOW_DAYS,
  DEFAULT_KELLY_CAP,
  DEFAULT_MAX_VOL_MULTIPLIER,
  DEFAULT_MIN_VOL_MULTIPLIER,
  DEFAULT_TARGET_DAILY_VOL as DEFAULT_HYBRID_KELLY_TARGET_DAILY_VOL,
  DEFAULT_VOL_WINDOW_DAYS as DEFAULT_HYBRID_KELLY_VOL_WINDOW_DAYS,
  HybridKellyPlugin,
  MAX_FUNDING_SHARPE_WINDOW_DAYS,
  MAX_TARGET_DAILY_VOL as MAX_HYBRID_KELLY_TARGET_DAILY_VOL,
  MAX_VOL_WINDOW_DAYS as MAX_HYBRID_KELLY_VOL_WINDOW_DAYS,
  MIN_FUNDING_SHARPE_WINDOW_DAYS,
  MIN_TARGET_DAILY_VOL as MIN_HYBRID_KELLY_TARGET_DAILY_VOL,
  MIN_VOL_WINDOW_DAYS as MIN_HYBRID_KELLY_VOL_WINDOW_DAYS,
  ONE_TO_TEN_LEVERAGE as HYBRID_KELLY_ONE_TO_TEN_LEVERAGE,
  createHybridKellyPlugin,
  extractSizingSignal as extractHybridKellySizingSignal,
  inferSymbol as inferHybridKellySymbol,
} from "./signal-center/plugins/hybrid-kelly-plugin.js";
export type {
  HybridKellyConfig,
  HybridKellyPluginState,
} from "./signal-center/plugins/hybrid-kelly-plugin.js";
// Phase 11.2a Track A — defensive meta-plugin (HMM 3-state regime detection).
// FIFTH Phase 11+ drop-in — reads DirectionSignals + CarrySignals + SizingSignals
// from the bus + OHLCV closes via `recordClose`. Emits RiskSignals with per-regime
// `sizeModifier` and implied `closeNotionalUsd` (trending=1.0, ranging=0.7, volatile=0.4).
// BTC/ETH/SOL default-on. `RiskSignal.sizeModifier` field added in types.ts (Phase 11.2a+).
// NOTE: `DEFAULT_BASE_NOTIONAL_USD` and `DEFAULT_ENABLED_SYMBOLS` are aliased
// (REGIME_DETECTOR_-prefixed) to avoid TS2300 (Duplicate identifier) collisions
// with the vol-target, hybrid-kelly, and directional-mtf re-exports above.
// Follows the same aliasing pattern as `DEFAULT_HYBRID_KELLY_*`.
export {
  DEFAULT_BASE_NOTIONAL_USD as DEFAULT_REGIME_DETECTOR_BASE_NOTIONAL_USD,
  DEFAULT_ENABLED_SYMBOLS as DEFAULT_REGIME_DETECTOR_ENABLED_SYMBOLS,
  DEFAULT_MIN_OBSERVATIONS,
  DEFAULT_NUM_STATES,
  DEFAULT_REGIME_SIZE_MULTIPLIER_RANGING,
  DEFAULT_REGIME_SIZE_MULTIPLIER_TRENDING,
  DEFAULT_REGIME_SIZE_MULTIPLIER_VOLATILE,
  DEFAULT_STATE_EMISSION_STDDEV,
  DEFAULT_TRANSITION_LEARNING_DAYS,
  DEFAULT_TRANSITION_MATRIX,
  DEFAULT_INITIAL_STATE_PROBS,
  MAX_MIN_OBSERVATIONS as REGIME_DETECTOR_MAX_MIN_OBSERVATIONS,
  MAX_NUM_STATES as REGIME_DETECTOR_MAX_NUM_STATES,
  MAX_REGIME_SIZE_MULTIPLIER,
  MAX_STATE_STDDEV as REGIME_DETECTOR_MAX_STATE_STDDEV,
  MAX_TRANSITION_LEARNING_DAYS as REGIME_DETECTOR_MAX_TRANSITION_LEARNING_DAYS,
  MIN_MIN_OBSERVATIONS as REGIME_DETECTOR_MIN_MIN_OBSERVATIONS,
  MIN_NUM_STATES as REGIME_DETECTOR_MIN_NUM_STATES,
  MIN_REGIME_SIZE_MULTIPLIER,
  MIN_STATE_STDDEV as REGIME_DETECTOR_MIN_STATE_STDDEV,
  MIN_TRANSITION_LEARNING_DAYS as REGIME_DETECTOR_MIN_TRANSITION_LEARNING_DAYS,
  RegimeDetectorMetaPlugin,
  argmaxRegime,
  createRegimeDetectorMetaPlugin,
  gaussianLogPdf,
  logSumExp,
  regimeLabelToIndex,
  regimeToSizeMultiplier,
} from "./signal-center/plugins/regime-detector-meta-plugin.js";
export type {
  RegimeDetectorConfig,
  RegimeDetectorMetaPluginState,
  RegimeLabel,
  HMMStateIndex,
} from "./signal-center/plugins/regime-detector-meta-plugin.js";
// Phase 12 Track A — factor-layer read-only drop-in (Phase 11.5 Track D §H1 + §P1).
// SEVENTH Phase 11+ drop-in (read-only FACTOR signal — continuous tanh-mapped
// z-score in [-1, +1]). Pearson r = 0.47 with BTC daily volatility empirically
// (arXiv 2501.05232 + Glassnode + CryptoQuant + CoinGlass). Per-symbol
// accumulation / neutral / distribution regime classification at z = ±1.5
// (Phase 11.5 §P1 thresholds). FREE-tier data adapters (Coinglass /
// CryptoQuant / CoinGlass) with graceful degradation — skip emit, log warn,
// do NOT crash the bus on outage. ZERO notional impact by construction;
// 1:10 leverage cap is structurally unviolated (3-layer defense: L1 metadata,
// L2 subscribe-bus, L3 per-emit zero-notional assertion).
// `FactorSignal` interface + `FactorRegime` type + `isFactor` type guard +
// `"factor"` SignalKind variant added to `types.ts` (Phase 12+).
// New `EdgeClass = "factor"` variant added to `strategy-registry.ts`.
// NOTE: `DEFAULT_ENABLED_SYMBOLS` is intentionally NOT re-exported here —
// aliased to `CEX_NET_FLOW_ENABLED_SYMBOLS` to avoid TS2300 (Duplicate
// identifier) collisions with hybrid-kelly/directional-mtf re-exports above.
// Follows the same aliasing pattern as `DEFAULT_HYBRID_KELLY_*`.
export {
  CexNetFlowRegimePlugin,
  CoinglassNetflowAdapter,
  CoinGlassExchangeBalanceAdapter,
  CryptoQuantNetflowAdapter,
  DEFAULT_BASE_NOTIONAL_USD as DEFAULT_CEX_NET_FLOW_BASE_NOTIONAL_USD,
  DEFAULT_ENABLED_SYMBOLS as CEX_NET_FLOW_ENABLED_SYMBOLS,
  DEFAULT_FACTOR_SCALING_Z,
  DEFAULT_MAX_STALE_MS,
  DEFAULT_MIN_OBSERVATIONS as DEFAULT_CEX_NET_FLOW_MIN_OBSERVATIONS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_REGIME_LOWER_Z,
  DEFAULT_REGIME_UPPER_Z,
  DEFAULT_WINDOW_DAYS,
  MAX_MAX_STALE_MS as CEX_NET_FLOW_MAX_MAX_STALE_MS,
  MAX_MIN_OBSERVATIONS as CEX_NET_FLOW_MAX_MIN_OBSERVATIONS,
  MAX_POLL_INTERVAL_MS as CEX_NET_FLOW_MAX_POLL_INTERVAL_MS,
  MAX_WINDOW_DAYS as CEX_NET_FLOW_MAX_WINDOW_DAYS,
  MAX_FACTOR_SCALING_Z as CEX_NET_FLOW_MAX_FACTOR_SCALING_Z,
  MAX_REGIME_UPPER_Z as CEX_NET_FLOW_MAX_REGIME_UPPER_Z,
  MAX_REGIME_LOWER_Z_UPPER_BOUND as CEX_NET_FLOW_MAX_REGIME_LOWER_Z_UPPER_BOUND,
  MIN_MAX_STALE_MS as CEX_NET_FLOW_MIN_MAX_STALE_MS,
  MIN_MIN_OBSERVATIONS as CEX_NET_FLOW_MIN_MIN_OBSERVATIONS,
  MIN_POLL_INTERVAL_MS as CEX_NET_FLOW_MIN_POLL_INTERVAL_MS,
  MIN_WINDOW_DAYS as CEX_NET_FLOW_MIN_WINDOW_DAYS,
  MIN_FACTOR_SCALING_Z as CEX_NET_FLOW_MIN_FACTOR_SCALING_Z,
  MIN_REGIME_UPPER_Z as CEX_NET_FLOW_MIN_REGIME_UPPER_Z,
  MIN_REGIME_LOWER_Z_LOWER_BOUND as CEX_NET_FLOW_MIN_REGIME_LOWER_Z_LOWER_BOUND,
  NullNetflowAdapter,
  classifyRegime,
  computeFactor,
  computeZScore,
  createCexNetFlowRegimePlugin,
} from "./signal-center/plugins/cex-netflow-regime-plugin.js";
export type {
  CexNetFlowRegimeConfig,
  CexNetFlowRegimePluginState,
  IExchangeNetflowAdapter,
  NetflowSample,
} from "./signal-center/plugins/cex-netflow-regime-plugin.js";
// Phase 12 Track B / Phase 11.5 Track E §H1 — read-only signal plugin.
// EIGHTH Phase 11+ drop-in. Polls HL + Binance + Bybit + OKX funding,
// normalizes to 8h-equivalent basis points, emits per-asset
// `FundingSnapshotSignal` (new 6th SignalKind variant added in types.ts).
// Foundation for downstream execution plugins (Phase 12 E2
// CrossDexDeltaNeutralArb). 6 default assets: BTC/ETH/SOL/HYPE/DOGE/JUP.
// `FundingSnapshotSignal` is the new Signal union member — also re-exported
// from `./signal-center/types.js` below. `isFundingSnapshot` type guard
// added to types.ts.
// `DEFAULT_ASSETS` / `DEFAULT_POLL_INTERVAL_SEC` / etc. are unique to
// cross-dex-funding-watcher so no aliasing needed.
export {
  CrossDexFundingWatcherPlugin,
  DEFAULT_ASSETS,
  DEFAULT_MAX_PREDICTED_GAP_BPS,
  DEFAULT_MAX_SPREAD_BPS_THRESHOLD,
  DEFAULT_POLL_INTERVAL_SEC,
  createCrossDexFundingWatcherPlugin,
  parseBzMarkPrice,
  parseBzMarkPriceBatch,
  parseByTicker,
  parseByTickerBatch,
  parseHlMetaAndAssetCtxs,
  parseHlPredictedFundings,
  parseOkFundingRate,
  parseOkFundingRateBatch,
  toBinanceSymbol,
  toBybitSymbol,
  toOkxSymbol,
} from "./signal-center/plugins/cross-dex-funding-watcher-plugin.js";
export type {
  BinanceMarkPrice,
  BybitTicker,
  CrossDexFundingWatcherConfig,
  CrossDexFundingWatcherPluginState,
  HlAssetCtx,
  HlPredictedFunding,
  OkxFundingRate,
  VenueId,
} from "./signal-center/plugins/cross-dex-funding-watcher-plugin.js";
// Phase 12 Track C — defensive read-only RiskSignal plugin (Phase 11.5 Track D §E1+§E5).
// NINTH Phase 11+ drop-in. Tick-level liquidation cascade detector (0xArchive +
// HypurrScan + GoldRush + CoinGlass + HyperTracker feeds) → emits RiskSignal
// with `closeNotionalUsd` when OI drop + LSR deadlock + thin book + paper-tiger
// all trigger. Throttled 24h cooldown per symbol. Layer 3 per-emit assertion
// fires `closeNotionalUsd ≤ baseNotionalUsd × 10` (1:10 cap). Defensive
// overlay: orthogonally complements Phase 11.2a RegimeDetector.
export {
  CoinGlassLiquidationAdapter,
  DEFAULT_OI_DROP_THRESHOLD_PCT,
  DEFAULT_LSR_DEADLOCK_LOWER,
  DEFAULT_LSR_DEADLOCK_UPPER,
  DEFAULT_THIN_BOOK_TOP5_DEPTH_PCT,
  DEFAULT_PAPER_TIGER_WALL_INSERTION_MIN,
  DEFAULT_PAPER_TIGER_CLUSTER_MIN_SIZE,
  DEFAULT_POLL_INTERVAL_SEC as DEFAULT_PERPDEX_POLL_INTERVAL_SEC,
  DEFAULT_THROTTLE_COOLDOWN_MS,
  DEFAULT_BASE_NOTIONAL_USD as DEFAULT_PERPDEX_BASE_NOTIONAL_USD,
  DEFAULT_SIZE_MODIFIER,
  DEFAULT_ENABLED_SYMBOLS as DEFAULT_PERPDEX_ENABLED_SYMBOLS,
  GoldRushLiquidationAdapter,
  HypurrScanLiquidationAdapter,
  HyperTrackerLiquidationAdapter,
  MAX_OI_DROP_THRESHOLD_PCT,
  MAX_POLL_INTERVAL_SEC as MAX_PERPDEX_POLL_INTERVAL_SEC,
  MIN_OI_DROP_THRESHOLD_PCT,
  MIN_PAPER_TIGER_CLUSTER_MIN_SIZE,
  MIN_PAPER_TIGER_WALL_INSERTION_MIN,
  MIN_POLL_INTERVAL_SEC as MIN_PERPDEX_POLL_INTERVAL_SEC,
  MockLiquidationAdapter,
  NullLiquidationAdapter,
  PerpDexLiquidationSignalsPlugin,
  ZeroArchiveLiquidationAdapter,
  evaluateCascadeHeuristic,
} from "./signal-center/plugins/perpdex-liquidation-signals-plugin.js";
export type {
  CascadeHeuristicResult,
  ILiquidationFeedAdapter,
  LiquidationSnapshot,
  PaperTigerSignal,
  PerpDexLiquidationSignalsPluginConfig,
  PerpDexLiquidationSignalsPluginState,
  SymbolCascadeState,
} from "./signal-center/plugins/perpdex-liquidation-signals-plugin.js";
// Phase 13 Track C — Cross-symbol hedge plugins (3 NEW plugins: BTC-ETH spread reversion, BTC-driven momentum overlay, cross-symbol funding-rate arb).
export {
  CrossSymbolSpreadReversionPlugin,
} from "./signal-center/plugins/cross-symbol-spread-reversion-plugin.js";
export type {
  CrossSymbolSpreadReversionConfig,
  CrossSymbolSpreadReversionPluginState,
  SymbolPair,
} from "./signal-center/plugins/cross-symbol-spread-reversion-plugin.js";
export {
  CrossSymbolMomentumOverlayPlugin,
} from "./signal-center/plugins/cross-symbol-momentum-overlay-plugin.js";
export type {
  CrossSymbolMomentumOverlayConfig,
  CrossSymbolMomentumOverlayPluginState,
} from "./signal-center/plugins/cross-symbol-momentum-overlay-plugin.js";
export {
  CrossSymbolFundingDifferentialPlugin,
} from "./signal-center/plugins/cross-symbol-funding-differential-plugin.js";
export type {
  CrossSymbolFundingDifferentialConfig,
  CrossSymbolFundingDifferentialPluginState,
} from "./signal-center/plugins/cross-symbol-funding-differential-plugin.js";
// Phase 10G Track C — Signal Center V1 composition root (bus + registry + risk + telemetry).
export {
  createSignalCenterV1,
  DEFAULT_SIGNAL_CENTER_V1_CONFIG,
  SignalCenterV1,
  toRiskEngineSignal,
} from "./signal-center/signal-center-v1.js";
export type {
  SignalCenterV1Config,
} from "./signal-center/signal-center-v1.js";
// Phase 10G Track B — Leverage invariant hard guardrail (1:10 MANDATORY leverage 3rd defense-in-depth layer).
export {
  assertLeverageInvariant,
  assertPositionsInvariant,
  checkLeverageApproach,
  computeEffectiveLeverage,
  DEFAULT_LEVERAGE_INVARIANT_CONFIG,
  LeverageBreachError,
  ONE_TO_TEN_LEVERAGE,
  ONE_X_LEVERAGE,
} from "./risk/leverage-invariant.js";
export type {
  LeverageInvariantConfig,
  Position,
} from "./risk/leverage-invariant.js";
// Phase 10G Track B — Cross-strategy portfolio risk engine (VaR + correlation + drawdown + leverage guard).
// NOTE: This engine accepts Track B's internal signal shapes (see risk/portfolio-risk-engine.ts).
// Track A's SignalBus signal shapes are translated by SignalCenterV1 (Track C integration layer).
export {
  DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
  PortfolioRiskEngine,
} from "./risk/portfolio-risk-engine.js";
export type {
  AggregateDrawdownState,
  CorrelationMatrix,
  ExposureBySymbol,
  PortfolioRiskEngineConfig,
  RiskSnapshot,
  VaRPoint,
  // Aliases for Track B's internal signal types (Track A's types in ./signal-center/types.ts are canonical).
  CarrySignal as RiskEngineCarrySignal,
  DirectionSignal as RiskEngineDirectionSignal,
  SizingSignal as RiskEngineSizingSignal,
  RiskSignal as RiskEngineRiskSignal,
  Signal as RiskEngineSignal,
} from "./risk/portfolio-risk-engine.js";
// Phase 10G Track B — Per-strategy telemetry (PnL attribution + Sharpe + kill-switch + export).
export {
  DEFAULT_STRATEGY_TELEMETRY_CONFIG,
  StrategyTelemetry,
} from "./telemetry/strategy-telemetry.js";
export type {
  KillSwitchEvent,
  PerStrategyStats,
  StrategyTelemetryConfig,
  TelemetrySnapshot,
  TradeRecord,
} from "./telemetry/strategy-telemetry.js";

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

// Phase 13 Track B — Portfolio Orchestrator (multi-symbol BTC+ETH+SOL simultaneous).
// Re-exports the portfolio module's public surface: PortfolioOrchestrator + PositionDecision +
// related types. Backed by per-symbol SignalCenterV1 + DecisionEngine + shared PortfolioRiskEngine.
export * from "./portfolio/index.js";

// Phase 15 Track B — Pivot Point Grid (M15 mean-reversion, pivot-anchored range).
export {
  PivotPointGridStrategy,
  DEFAULT_PIVOT_GRID_CONFIG,
} from "./strategy/pivot-point-grid.js";
export type { PivotPointGridConfig } from "./strategy/pivot-point-grid.js";

// Phase 15 Track B — Bollinger Range Squeeze (M5 breakout after bbWidth squeeze).
export {
  BollingerRangeSqueezeStrategy,
  DEFAULT_BB_SQUEEZE_CONFIG,
} from "./strategy/bollinger-range-squeeze.js";
export type { BollingerSqueezeConfig } from "./strategy/bollinger-range-squeeze.js";

// Phase 15 Track C — Donchian Range Channel (M15 range-mean-reversion).
export {
  DonchianRangeChannelStrategy,
  DEFAULT_DONCHIAN_RANGE_CONFIG,
} from "./strategy/donchian-range-channel.js";
export type { DonchianRangeChannelConfig } from "./strategy/donchian-range-channel.js";

// Phase 15 Track C — Keltner Volatility-Adaptive Grid (M5 grid in Keltner channel).
export {
  KeltnerGridStrategy,
  DEFAULT_KELTNER_GRID_CONFIG,
} from "./strategy/keltner-grid.js";
export type { KeltnerGridConfig } from "./strategy/keltner-grid.js";

// Phase 15 Track D — Simple Retail Ensemble (composes the 4 Phase 15 retail strategies).
export {
  SimpleRetailEnsemble,
  DEFAULT_SIMPLE_RETAIL_ENSEMBLE_CONFIG,
  ENSEMBLE_DEFAULT_LTF,
} from "./strategy/simple-retail-ensemble.js";
export type { SimpleRetailEnsembleConfig } from "./strategy/simple-retail-ensemble.js";

// Phase 16 Track B — Regime-Routed Ensemble (ADX-routed composition: Pivot+Donchian in range, BB+Keltner in trend).
export {
  RegimeRoutedEnsemble,
  DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG,
  REGIME_ROUTED_ENSEMBLE_DEFAULT_LTF,
} from "./strategy/regime-routed-ensemble.js";
export type { RegimeRoutedEnsembleConfig } from "./strategy/regime-routed-ensemble.js";

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
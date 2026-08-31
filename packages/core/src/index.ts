export * from "./indicators/index.js";
export { assertSelectedLeverageUnchanged, freezeSelectedLeverage } from "./risk/session-selected-leverage.js";
export type { FrozenSelectedLeverage } from "./risk/session-selected-leverage.js";
export { CompositeStrategy } from "./strategy/composite.js";
export { DEFAULT_COMPOSITE_CONFIG } from "./strategy/composite.js";
export type { CompositeStrategyConfig } from "./strategy/composite.js";
export type { FundingSnapshot } from "./strategy/funding-snapshot.js";
export {
  ALLOWED_KILL_SWITCH_LEVERAGE,
  assert1to10Leverage,
  computeFlipDetectorMetrics,
  DEFAULT_FLIP_DETECTOR_CONFIG,
  evaluateRegime,
  type FlipDetectorConfig,
  type FlipDetectorMetrics,
  type RegimeDecision,
} from "./strategy/funding-flip-kill-switch.js";
export {
  createLatencyGate,
  DEFAULT_KELLY_OPT_AGGREGATE,
  DEFAULT_LATENCY_GATE_DISABLED,
} from "./strategy/multi-class-ensemble.js";
export type { KellyOptAggregate, LatencyGate, LatencySnapshot } from "./strategy/multi-class-ensemble.js";
export {
  applyRiskCaps,
  DEFAULT_KELLY_OPT_CONFIG,
  extractTradeStats,
  fractionalKelly,
  fullKellyFraction,
  optimizeKelly,
  splitIntoWindows,
  runWalkForwardValidation,
  type KellyFraction,
  type KellyOptConfig,
  type KellyOptResult,
  type TradeStats,
  type WalkForwardValidation,
  type WalkForwardWindow,
  type WalkForwardSplit,
} from "./risk/kelly-position-sizer.js";
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
  type AdaptiveKellyBucket,
  type AdaptiveKellyResult,
  type AdaptiveVsStaticComparison,
  type AdaptiveWalkForwardValidation,
  type AdaptiveWalkForwardWindow,
  type BucketDistribution,
  type DailyPnlPoint,
  type RollingSharpePoint,
} from "./risk/kelly-adaptive.js";
export {
  computeVolMultiplier,
  computeVolTargetedSizer,
  dailyLogReturns,
  DEFAULT_VOL_TARGET_CONFIG,
  ONE_TO_TEN_BASE_LEVERAGE,
  rollingRealizedDailyVol,
  runVolTargetWalkForwardValidation,
  validateOneToTenLeverage,
  type DailyOhlcv,
  type VolTargetConfig,
  type VolTargetedSizerResult,
  type VolTargetPoint,
  type VolTargetWalkForwardValidation,
  type VolTargetWalkForwardWindow,
} from "./risk/vol-targeted-sizer.js";
export {
  buildHybridDay,
  computeHybridSizer,
  DEFAULT_HYBRID_SIZER_CONFIG,
  runHybridWalkForwardValidation,
  toPositionSizerConfig,
  type HybridSizerConfig,
  type HybridSizerDay,
  type HybridSizerPositionSizerConfig,
  type HybridSizerResult,
  type HybridWalkForwardValidation,
  type HybridWalkForwardWindow,
} from "./risk/adaptive-kelly-vol-hybrid.js";
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
export { createSignalBus, SignalBus } from "./signal-center/signal-bus.js";
export type {
  SignalBusMode,
  SignalBusOptions,
  SignalHandler,
  UnsubscribeFn,
} from "./signal-center/signal-bus.js";
export {
  createStrategyRegistry,
  MAX_ALLOWED_PLUGIN_AGGREGATE_EFFECTIVE_LEVERAGE,
  StrategyRegistry,
  validatePluginMetadata,
} from "./signal-center/strategy-registry.js";
export type { EdgeClass, StrategyPlugin, StrategyPluginMetadata } from "./signal-center/strategy-registry.js";
export {
  DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG,
  SOLFlipKillSwitchPlugin,
  type SOLFlipKillSwitchPluginConfig,
  type SOLFlipKillSwitchPluginState,
} from "./signal-center/plugins/sol-flip-kill-switch-plugin.js";
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
  type DvolRegime,
  type DvolRegimeSizingConfig,
  type DvolRegimeSizingPluginState,
} from "./signal-center/plugins/dvol-regime-sizing-plugin.js";
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
  type VolTargetSizingConfig,
  type VolTargetSizingPluginState,
} from "./signal-center/plugins/vol-target-sizing-plugin.js";
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
  createHybridKellyPlugin,
  extractSizingSignal as extractHybridKellySizingSignal,
  inferSymbol as inferHybridKellySymbol,
} from "./signal-center/plugins/hybrid-kelly-plugin.js";
export type {
  HybridKellyConfig,
  HybridKellyPluginState,
} from "./signal-center/plugins/hybrid-kelly-plugin.js";
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
export { CrossSymbolSpreadReversionPlugin } from "./signal-center/plugins/cross-symbol-spread-reversion-plugin.js";
export type {
  CrossSymbolSpreadReversionConfig,
  CrossSymbolSpreadReversionPluginState,
  SymbolPair,
} from "./signal-center/plugins/cross-symbol-spread-reversion-plugin.js";
export { CrossSymbolMomentumOverlayPlugin } from "./signal-center/plugins/cross-symbol-momentum-overlay-plugin.js";
export type {
  CrossSymbolMomentumOverlayConfig,
  CrossSymbolMomentumOverlayPluginState,
} from "./signal-center/plugins/cross-symbol-momentum-overlay-plugin.js";
export { CrossSymbolFundingDifferentialPlugin } from "./signal-center/plugins/cross-symbol-funding-differential-plugin.js";
export type {
  CrossSymbolFundingDifferentialConfig,
  CrossSymbolFundingDifferentialPluginState,
} from "./signal-center/plugins/cross-symbol-funding-differential-plugin.js";
export {
  createSignalCenterV1,
  DEFAULT_SIGNAL_CENTER_V1_CONFIG,
  SignalCenterV1,
  toRiskEngineSignal,
} from "./signal-center/signal-center-v1.js";
export type { SignalCenterV1Config } from "./signal-center/signal-center-v1.js";
export {
  assertAggregateEffectiveExposureLimit,
  assertAggregatePositionsEffectiveExposureLimit,
  isAggregateEffectiveExposureApproachingLimit,
  computeEffectiveLeverage,
  DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
  AggregateEffectiveExposureLimitBreachError,
  DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
  MINIMUM_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
  ONE_TO_TEN_LEVERAGE,
} from "./risk/leverage-invariant.js";
export type { AggregateEffectiveExposureLimit, Position } from "./risk/leverage-invariant.js";
export { DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG, PortfolioRiskEngine } from "./risk/portfolio-risk-engine.js";
export type {
  AggregateDrawdownState,
  CorrelationMatrix,
  ExposureBySymbol,
  PortfolioRiskEngineConfig,
  RiskSnapshot,
  VaRPoint,
  CarrySignal as RiskEngineCarrySignal,
  DirectionSignal as RiskEngineDirectionSignal,
  SizingSignal as RiskEngineSizingSignal,
  RiskSignal as RiskEngineRiskSignal,
  Signal as RiskEngineSignal,
} from "./risk/portfolio-risk-engine.js";
export { DEFAULT_STRATEGY_TELEMETRY_CONFIG, StrategyTelemetry } from "./telemetry/strategy-telemetry.js";
export type {
  KillSwitchEvent,
  PerStrategyStats,
  StrategyTelemetryConfig,
  TelemetrySnapshot,
  TradeRecord,
} from "./telemetry/strategy-telemetry.js";
export type {
  Strategy,
  StrategyContext,
  StrategySignal,
  OpenPositionSnapshot,
  PositionManagementContext,
  PositionUpdate,
  MtfState,
  IndicatorState,
} from "./types.js";
export * from "./portfolio/index.js";
export { PivotPointGridStrategy, DEFAULT_PIVOT_GRID_CONFIG } from "./strategy/pivot-point-grid.js";
export type { PivotPointGridConfig } from "./strategy/pivot-point-grid.js";
export {
  DonchianRangeChannelStrategy,
  DEFAULT_DONCHIAN_RANGE_CONFIG,
} from "./strategy/donchian-range-channel.js";
export type { DonchianRangeChannelConfig } from "./strategy/donchian-range-channel.js";
export { OhlcTrendStrategy, DEFAULT_OHLC_TREND_CONFIG } from "./strategy/ohlc-trend.js";
export type { OhlcTrendConfig, OhlcTrendSignal } from "./strategy/ohlc-trend.js";
export {
  DonchianPivotComposition,
  DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
  DONCHIAN_PIVOT_COMPOSITION_DEFAULT_LTF,
} from "./strategy/donchian-pivot-composition.js";
export type { DonchianPivotCompositionConfig } from "./strategy/donchian-pivot-composition.js";
export {
  CascadeFadeDetector,
  CascadeFadeStrategy,
  DEFAULT_CASCADE_FADE_CONFIG,
  replayCascadeEvent,
  simulateBybitEuPaperFill,
  syntheticBybitEuSlippageBps,
} from "./strategy/cascade-fade.js";
export type {
  CascadeEntry,
  CascadeEvent,
  CascadeExit,
  CascadeFadeConfig,
  CascadeReplayObservation,
  CascadeReplayResult,
  CascadeState,
  CascadeWindowInput,
  CrossConfirmationInput,
  ElrInput,
  FundingRateInput,
  OpenInterestInput,
} from "./strategy/cascade-fade.js";
export {
  DydxCexCarryStrategy,
  DEFAULT_DYDX_CEX_CARRY_CONFIG,
  DEFAULT_KILL_SWITCH_CONFIG,
  DEFAULT_PRECONDITION_CONFIG,
  DEFAULT_CARRY_MARKET,
  DEFAULT_CARRY_DIRECTION,
  ALL_KILL_SWITCHES,
  evaluateKillSwitches,
  allPreconditionsSatisfied,
  newPreconditionsState,
  newTickDensityState,
  newKillSwitchVerdicts,
} from "./strategy/dydx-cex-carry.js";
export {
  DydxCexCarryPaperTrader,
  DEFAULT_PAPER_TRADE_RUNNER_CONFIG,
} from "./strategy/dydx-cex-carry.paper-trade.js";
export type {
  DydxFundingSource,
  DydxCexCarryConfig,
  DydxCexCarryState,
  KillSwitchId,
  KillSwitchConfig,
  KillSwitchInputs,
  KillSwitchVerdict,
  KillSwitchVerdicts,
  PreconditionId,
  PreconditionConfig,
  PreconditionEntry,
  PreconditionsState,
  TickDensityEntry,
  TickDensityState,
  CarryMarket,
  CarryDirection,
  LatencySource,
} from "./strategy/dydx-cex-carry.js";
export type {
  BybitEuSpotFillSimulator,
  HypotheticalFill,
  PaperTradeReport,
  PaperTradeLatencyStats,
  PaperTradeRunnerConfig,
} from "./strategy/dydx-cex-carry.paper-trade.js";
import type { Strategy } from "./types.js";
import { DonchianPivotComposition } from "./strategy/donchian-pivot-composition.js";
export function createStrategy(): Strategy {
  return new DonchianPivotComposition();
}

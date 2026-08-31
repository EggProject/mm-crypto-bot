/**
 * Creates only explicitly enabled strategy and plugin runtime instances.
 */

import { CascadeFadeStrategy, type CascadeFadeConfig } from "@mm-crypto-bot/core";
import { ExactRational } from "@mm-crypto-bot/numeric";
import {
  DEFAULT_CASCADE_FADE_CONFIG,
  DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
  DEFAULT_DYDX_CEX_CARRY_CONFIG,
  DEFAULT_INITIAL_STATE_PROBS,
  DEFAULT_MIN_OBSERVATIONS,
  DEFAULT_NUM_STATES,
  DEFAULT_REGIME_DETECTOR_BASE_NOTIONAL_USD,
  DEFAULT_REGIME_SIZE_MULTIPLIER_RANGING,
  DEFAULT_REGIME_SIZE_MULTIPLIER_TRENDING,
  DEFAULT_REGIME_SIZE_MULTIPLIER_VOLATILE,
  DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG,
  DEFAULT_STATE_EMISSION_STDDEV,
  DEFAULT_TRANSITION_LEARNING_DAYS,
  DEFAULT_TRANSITION_MATRIX,
  DonchianPivotComposition,
  DydxCexCarryStrategy,
  RegimeDetectorMetaPlugin,
  SOLFlipKillSwitchPlugin,
  type DydxFundingSource,
  type Strategy,
  type StrategyPlugin,
} from "@mm-crypto-bot/core";

import { ConfigError } from "./loader.js";
import type { BotConfig, DydxCexCarryStrategySection, StrategyName, StrategySection } from "./schema.js";

type SupportedLtf = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

const SUPPORTED_LTF = new Set<string>(["1m", "5m", "15m", "1h", "4h", "1d"]);

function isSupportedLtf(value: string | undefined): value is SupportedLtf {
  return value !== undefined && SUPPORTED_LTF.has(value);
}

/**
 * A runtime component selected from the validated strategy configuration.
 */
export type BotStrategyInstance =
  | { readonly kind: "strategy"; readonly name: StrategyName; readonly instance: Strategy }
  | { readonly kind: "plugin"; readonly name: StrategyName; readonly instance: StrategyPlugin };

/**
 * Runtime dependencies required by explicitly enabled strategies.
 */
export interface BotDependencies {
  /**
   * Required when `dydx_cex_carry` is enabled.
   */
  readonly dydxFundingSource?: DydxFundingSource | null;
}

/**
 * Builds supported Donchian runtime inputs from validated configuration.
 */
function buildDonchianPivotConfig(section: BotConfig["strategies"]["donchian_pivot_composition"]): {
  readonly minConsensus: number;
  readonly ltf: SupportedLtf;
} {
  const ltfOverride = section.timeframes?.ltf;
  const ltf = isSupportedLtf(ltfOverride) ? ltfOverride : "15m";
  const minConsensus = section.min_consensus ?? DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG.minConsensus;
  return { minConsensus, ltf };
}

/**
 * Builds the `DydxCexCarryStrategy` configuration from its closed strategy
 * section and required `DydxFundingSource`.
 *
 * The schema rejects invalid values before this adapter runs. Omitted fields
 * use only the core defaults; supplied values are never repaired or coerced.
 *
 * Kill-switch, precondition, and latency settings remain core-owned defaults.
 */
export function buildDydxCexCarryConfig(
  section: DydxCexCarryStrategySection,
  fundingSource: DydxFundingSource,
): {
  readonly market: "BTC-USD";
  readonly direction: "dydx-long-cex-short";
  readonly notionalPerLegUsd: ExactRational;
  readonly capFraction: number;
  readonly fundingSource: DydxFundingSource;
  readonly killSwitch: typeof DEFAULT_DYDX_CEX_CARRY_CONFIG.killSwitch;
  readonly precondition: typeof DEFAULT_DYDX_CEX_CARRY_CONFIG.precondition;
  readonly latencyArbThresholdMs: number;
  readonly latencySource: typeof DEFAULT_DYDX_CEX_CARRY_CONFIG.latencySource;
} {
  const capFraction = section.cap ?? DEFAULT_DYDX_CEX_CARRY_CONFIG.capFraction;
  const configuredNotionalUsd = section.notional_per_leg_usd;
  const notionalPerLegUsd =
    configuredNotionalUsd === undefined
      ? DEFAULT_DYDX_CEX_CARRY_CONFIG.notionalPerLegUsd
      : ExactRational.from(String(configuredNotionalUsd));
  return {
    market: DEFAULT_DYDX_CEX_CARRY_CONFIG.market,
    direction: DEFAULT_DYDX_CEX_CARRY_CONFIG.direction,
    notionalPerLegUsd,
    capFraction,
    fundingSource,
    killSwitch: DEFAULT_DYDX_CEX_CARRY_CONFIG.killSwitch,
    precondition: DEFAULT_DYDX_CEX_CARRY_CONFIG.precondition,
    latencyArbThresholdMs: DEFAULT_DYDX_CEX_CARRY_CONFIG.latencyArbThresholdMs,
    latencySource: DEFAULT_DYDX_CEX_CARRY_CONFIG.latencySource,
  };
}

/**
 * Maps supported cascade settings into the core strategy configuration.
 */
function buildCascadeFadeConfig(section: StrategySection): CascadeFadeConfig {
  const maxNotionalPerEventUsd =
    section.max_notional_per_event_usd ?? DEFAULT_CASCADE_FADE_CONFIG.capacityMaxPerSymbolEventUsd;
  const cooldownHours =
    section.cooldown_hours ?? DEFAULT_CASCADE_FADE_CONFIG.riskBtCooldownMs / (60 * 60 * 1000);
  return {
    ...DEFAULT_CASCADE_FADE_CONFIG,
    capacityMaxPerSymbolEventUsd: maxNotionalPerEventUsd,
    riskBtCooldownMs: cooldownHours * 60 * 60 * 1000,
  };
}

/**
 * Returns the fixed core configuration for the funding-flip plugin.
 */
function buildFundingFlipKillSwitchConfig(): typeof DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG {
  return { ...DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG };
}

/**
 * Builds the fixed regime-detector settings for enabled symbols.
 */
function buildRegimeDetectorConfig(enabledSymbols: readonly string[]): {
  readonly numStates: number;
  readonly stateEmissionStdDev: readonly [number, number, number];
  readonly transitionMatrix: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  readonly initialStateProbs: readonly [number, number, number];
  readonly perRegimeSizeMultiplier: readonly [number, number, number];
  readonly minObservations: number;
  readonly transitionLearningDays: number;
  readonly baseNotionalUsd: number;
  readonly enabledSymbols: readonly string[];
} {
  return {
    numStates: DEFAULT_NUM_STATES,
    stateEmissionStdDev: DEFAULT_STATE_EMISSION_STDDEV,
    transitionMatrix: DEFAULT_TRANSITION_MATRIX,
    initialStateProbs: DEFAULT_INITIAL_STATE_PROBS,
    perRegimeSizeMultiplier: [
      DEFAULT_REGIME_SIZE_MULTIPLIER_TRENDING,
      DEFAULT_REGIME_SIZE_MULTIPLIER_RANGING,
      DEFAULT_REGIME_SIZE_MULTIPLIER_VOLATILE,
    ],
    minObservations: DEFAULT_MIN_OBSERVATIONS,
    transitionLearningDays: DEFAULT_TRANSITION_LEARNING_DAYS,
    baseNotionalUsd: DEFAULT_REGIME_DETECTOR_BASE_NOTIONAL_USD,
    enabledSymbols: [...enabledSymbols],
  };
}

/**
 * Creates the configured Donchian strategy.
 */
function makeDonchianPivotComposition(section: StrategySection): {
  readonly kind: "strategy";
  readonly instance: Strategy;
} {
  const { minConsensus, ltf } = buildDonchianPivotConfig(section);
  const strategy = new DonchianPivotComposition({ minConsensus }, ltf);
  return { kind: "strategy", instance: strategy };
}

/**
 * Fails closed unless all required carry runtime dependencies are wired.
 */
function makeDydxCexCarry(
  section: DydxCexCarryStrategySection,
  dependencies: BotDependencies,
): { readonly kind: "strategy"; readonly instance: Strategy } {
  const fundingSource = dependencies.dydxFundingSource;
  if (fundingSource === undefined || fundingSource === null) {
    throw new ConfigError(
      "Strategy 'dydx_cex_carry' is enabled but no DydxFundingSource was provided. " +
        "Pass a `dydxFundingSource` in the `BotDependencies` to the strategy registry.",
      "strategies.dydx_cex_carry",
      [],
    );
  }
  const config = buildDydxCexCarryConfig(section, fundingSource);
  void new DydxCexCarryStrategy(config);
  throw new ConfigError(
    "Strategy 'dydx_cex_carry' requires an explicit precondition re-verifier producer " +
      "wired to recordPreconditionReverify; the bot runtime does not provide one yet.",
    "strategies.dydx_cex_carry",
    [],
  );
}

/**
 * Fails closed because the required cascade event bridge is absent.
 */
function makeCascadeFade(section: StrategySection): {
  readonly kind: "strategy";
  readonly instance: Strategy;
} {
  const config = buildCascadeFadeConfig(section);
  void new CascadeFadeStrategy(config);
  throw new ConfigError(
    "Strategy 'cascade_fade' requires a live liquidation + OI + ELR event bridge; OHLCV-only runtime would be inert.",
    "strategies.cascade_fade",
    [],
  );
}

/**
 * Fails closed because the required funding-rate producer is absent.
 */
function makeFundingFlipKillSwitch(): { readonly kind: "plugin"; readonly instance: StrategyPlugin } {
  const config = buildFundingFlipKillSwitchConfig();
  void new SOLFlipKillSwitchPlugin(config);
  throw new ConfigError(
    "Plugin 'funding_flip_kill_switch' requires an explicit SOL funding-rate producer; OHLCV does not contain funding data.",
    "strategies.funding_flip_kill_switch",
    [],
  );
}

/**
 * Creates the configured regime-detector plugin.
 */
function makeRegimeDetector(enabledSymbols: readonly string[]): {
  readonly kind: "plugin";
  readonly instance: StrategyPlugin;
} {
  const config = buildRegimeDetectorConfig(enabledSymbols);
  const plugin = new RegimeDetectorMetaPlugin(config);
  return { kind: "plugin", instance: plugin };
}

/**
 * Creates enabled components in deterministic configuration order.
 */
export function createStrategyInstances(
  config: BotConfig,
  dependencies: BotDependencies = {},
): Map<StrategyName, BotStrategyInstance> {
  const instances = new Map<StrategyName, BotStrategyInstance>();
  const strategies = config.strategies;

  if (strategies.donchian_pivot_composition.enabled) {
    instances.set("donchian_pivot_composition", {
      name: "donchian_pivot_composition",
      ...makeDonchianPivotComposition(strategies.donchian_pivot_composition),
    });
  }

  if (strategies.dydx_cex_carry.enabled) {
    instances.set("dydx_cex_carry", {
      name: "dydx_cex_carry",
      ...makeDydxCexCarry(strategies.dydx_cex_carry, dependencies),
    });
  }

  if (strategies.cascade_fade.enabled) {
    instances.set("cascade_fade", { name: "cascade_fade", ...makeCascadeFade(strategies.cascade_fade) });
  }

  if (strategies.funding_flip_kill_switch.enabled) {
    instances.set("funding_flip_kill_switch", {
      name: "funding_flip_kill_switch",
      ...makeFundingFlipKillSwitch(),
    });
  }

  if (strategies.regime_detector.enabled) {
    instances.set("regime_detector", {
      name: "regime_detector",
      ...makeRegimeDetector(strategies.regime_detector.symbols ?? config.symbols.enabled),
    });
  }

  return instances;
}

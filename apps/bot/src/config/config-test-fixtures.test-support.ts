import type { BotConfig, StrategyName } from "./schema.js";
import { ConfigError } from "./loader.js";
import { BotConfigSchema } from "./schema.js";

type StrategyOverrides = {
  readonly [Name in StrategyName]?: Partial<BotConfig["strategies"][Name]>;
};

export interface BotConfigOverrides {
  readonly bot?: Partial<BotConfig["bot"]>;
  readonly exchange?: Partial<BotConfig["exchange"]>;
  readonly compliance?: Partial<BotConfig["compliance"]>;
  readonly risk?: Partial<BotConfig["risk"]>;
  readonly symbols?: Partial<BotConfig["symbols"]>;
  readonly strategies?: StrategyOverrides;
  readonly telemetry?: Partial<BotConfig["telemetry"]>;
  readonly portfolio?: Partial<BotConfig["portfolio"]>;
}

export function requireConfigError(value: unknown): ConfigError {
  if (!(value instanceof ConfigError)) {
    throw new Error("Expected ConfigError");
  }
  return value;
}

/**
Builds a complete current-schema config, then applies typed test overrides.
*/
export function createTestBotConfig(overrides: BotConfigOverrides = {}): BotConfig {
  const defaults = BotConfigSchema.parse({});
  const strategyOverrides = overrides.strategies;

  return {
    ...defaults,
    bot: { ...defaults.bot, ...overrides.bot },
    exchange: { ...defaults.exchange, ...overrides.exchange },
    compliance: { ...defaults.compliance, ...overrides.compliance },
    risk: { ...defaults.risk, ...overrides.risk },
    symbols: { ...defaults.symbols, ...overrides.symbols },
    strategies: {
      donchian_pivot_composition: {
        ...defaults.strategies.donchian_pivot_composition,
        ...strategyOverrides?.donchian_pivot_composition,
      },
      dydx_cex_carry: {
        ...defaults.strategies.dydx_cex_carry,
        ...strategyOverrides?.dydx_cex_carry,
      },
      cascade_fade: {
        ...defaults.strategies.cascade_fade,
        ...strategyOverrides?.cascade_fade,
      },
      funding_flip_kill_switch: {
        ...defaults.strategies.funding_flip_kill_switch,
        ...strategyOverrides?.funding_flip_kill_switch,
      },
      regime_detector: {
        ...defaults.strategies.regime_detector,
        ...strategyOverrides?.regime_detector,
      },
    },
    telemetry: { ...defaults.telemetry, ...overrides.telemetry },
    portfolio: { ...defaults.portfolio, ...overrides.portfolio },
  };
}

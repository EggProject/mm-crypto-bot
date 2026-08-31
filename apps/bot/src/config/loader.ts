/**
 * Loads, closes, and validates bot configuration at the TOML boundary.
 */

import { DEFAULT_BOT_CONFIG } from "./defaults.js";
import type { BotConfig } from "./schema.js";
import { BotConfigSchema } from "./schema.js";
import { DEFAULT_CONFIG_STORE_DEPENDENCIES } from "./store-node-adapter.js";

// ============================================================================
// Public error type
// ============================================================================

/**
 * Error returned for unreadable, unparsable, or invalid configuration.
 */
export class ConfigError extends Error {
  public override readonly name = "ConfigError";

  public constructor(
    message: string,
    public readonly path: string,
    public readonly issues: readonly {
      path: string;
      message: string;
    }[],
  ) {
    super(message);
  }
}

const LIVE_ENVIRONMENT_UNAVAILABLE_MESSAGE = "BUN_ENV=live cannot activate live mode.";
const LIVE_ENVIRONMENT_UNAVAILABLE_PATH = "BUN_ENV";

// ============================================================================
// TOML parser wrapper
// ============================================================================

/**
 * Parses TOML into the raw table that the closed schema validates.
 */
function parseTomlString(text: string): RawConfigTable {
  return Bun.TOML.parse(text);
}

/**
 * Formats Zod issues with dotted field paths.
 */
function formatZodIssues(issues: readonly { path: readonly (string | number)[]; message: string }[]): string {
  return issues
    .map((issue: { path: readonly (string | number)[]; message: string }) => {
      const path = issue.path.join(".").replace(/^$/u, "<root>");
      return `  • ${path}: ${issue.message}`;
    })
    .join("\n");
}

// ============================================================================
// Environment overrides
// ============================================================================

/**
 * Applies the supported process-level overrides after schema validation.
 */
function isSupportedLogLevel(value: string): value is BotConfig["bot"]["log_level"] {
  const supportedLogLevels: Readonly<Record<BotConfig["bot"]["log_level"], true>> = {
    debug: true,
    error: true,
    info: true,
    warn: true,
  };
  return Object.hasOwn(supportedLogLevels, value);
}

function applyEnvironmentOverrides(config: BotConfig, environment: NodeJS.ProcessEnv): BotConfig {
  // BUN_ENV=live must never activate live mode.
  const bunEnvironment = environment["BUN_ENV"];
  if (bunEnvironment === "live") {
    throw new ConfigError(LIVE_ENVIRONMENT_UNAVAILABLE_MESSAGE, LIVE_ENVIRONMENT_UNAVAILABLE_PATH, [
      {
        path: LIVE_ENVIRONMENT_UNAVAILABLE_PATH,
        message: LIVE_ENVIRONMENT_UNAVAILABLE_MESSAGE,
      },
    ]);
  }
  if (bunEnvironment === "paper") {
    config.bot.mode = "paper";
  }
  // Only schema-supported log levels are applied.
  const logLevel = environment["LOG_LEVEL"];
  if (typeof logLevel === "string" && isSupportedLogLevel(logLevel)) {
    config.bot.log_level = logLevel;
  }
  return config;
}

// ============================================================================
// Main loader
// ============================================================================

/**
 * Loads defaults plus an optional TOML file and returns the validated config.
 */
export function loadBotConfig(configPath?: string, environment: NodeJS.ProcessEnv = process.env): BotConfig {
  if (configPath !== undefined) {
    let text: string;
    try {
      text = DEFAULT_CONFIG_STORE_DEPENDENCIES.readText(configPath);
    } catch (error: unknown) {
      const message = String(error);
      throw new ConfigError(`Failed to read config file at "${configPath}": ${message}`, "<file>", []);
    }

    let raw: RawConfigTable;
    try {
      raw = parseTomlString(text);
    } catch (error: unknown) {
      const message = String(error);
      throw new ConfigError(`Failed to parse TOML at "${configPath}": ${message}`, "<toml-parse>", []);
    }

    return applyEnvironmentOverrides(parseConfigWithDefaults(mergeConfigWithDefaults(raw)), environment);
  }

  return applyEnvironmentOverrides(parseConfigWithDefaults(mergeConfigWithDefaults({})), environment);
}

// ============================================================================
// Merge helper
// ============================================================================

/**
 * Merge only the schema's named object boundaries.  This retains the
 * previous recursive-default semantics without allowing untrusted TOML keys
 * to select arbitrary destination properties before Zod's strict validation.
 */
interface RawConfigTable {
  readonly bot?: unknown;
  readonly exchange?: unknown;
  readonly compliance?: unknown;
  readonly risk?: unknown;
  readonly symbols?: unknown;
  readonly strategies?: unknown;
  readonly telemetry?: unknown;
  readonly portfolio?: unknown;
  readonly trailing_stop?: unknown;
  readonly kelly?: unknown;
  readonly drawdown_scaler?: unknown;
  readonly donchian_pivot_composition?: unknown;
  readonly dydx_cex_carry?: unknown;
  readonly cascade_fade?: unknown;
  readonly funding_flip_kill_switch?: unknown;
  readonly regime_detector?: unknown;
}

function isConfigTable(value: unknown): value is RawConfigTable {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeSection(defaults: object, source: unknown): unknown {
  if (source === undefined) {
    return defaults;
  }
  return isConfigTable(source) ? { ...defaults, ...source } : source;
}

function mergeRiskSection(source: unknown): unknown {
  if (!isConfigTable(source)) {
    return mergeSection(DEFAULT_BOT_CONFIG.risk, source);
  }
  return {
    ...DEFAULT_BOT_CONFIG.risk,
    ...source,
    trailing_stop: mergeSection(DEFAULT_BOT_CONFIG.risk.trailing_stop, source.trailing_stop),
    kelly: mergeSection(DEFAULT_BOT_CONFIG.risk.kelly, source.kelly),
    drawdown_scaler: mergeSection(DEFAULT_BOT_CONFIG.risk.drawdown_scaler, source.drawdown_scaler),
  };
}

function mergeStrategiesSection(source: unknown): unknown {
  if (!isConfigTable(source)) {
    return mergeSection(DEFAULT_BOT_CONFIG.strategies, source);
  }
  return {
    ...DEFAULT_BOT_CONFIG.strategies,
    ...source,
    donchian_pivot_composition: mergeSection(
      DEFAULT_BOT_CONFIG.strategies.donchian_pivot_composition,
      source.donchian_pivot_composition,
    ),
    dydx_cex_carry: mergeSection(DEFAULT_BOT_CONFIG.strategies.dydx_cex_carry, source.dydx_cex_carry),
    cascade_fade: mergeSection(DEFAULT_BOT_CONFIG.strategies.cascade_fade, source.cascade_fade),
    funding_flip_kill_switch: mergeSection(
      DEFAULT_BOT_CONFIG.strategies.funding_flip_kill_switch,
      source.funding_flip_kill_switch,
    ),
    regime_detector: mergeSection(DEFAULT_BOT_CONFIG.strategies.regime_detector, source.regime_detector),
  };
}

function defaultBotSection(): object {
  return {
    ...DEFAULT_BOT_CONFIG.bot,
    selected_leverage: DEFAULT_BOT_CONFIG.bot.selected_leverage.canonical,
  };
}

function mergeConfigWithDefaults(source: RawConfigTable): RawConfigTable {
  return {
    ...DEFAULT_BOT_CONFIG,
    ...source,
    bot: mergeSection(defaultBotSection(), source.bot),
    exchange: mergeSection(DEFAULT_BOT_CONFIG.exchange, source.exchange),
    compliance: mergeSection(DEFAULT_BOT_CONFIG.compliance, source.compliance),
    risk: mergeRiskSection(source.risk),
    symbols: mergeSection(DEFAULT_BOT_CONFIG.symbols, source.symbols),
    strategies: mergeStrategiesSection(source.strategies),
    telemetry: mergeSection(DEFAULT_BOT_CONFIG.telemetry, source.telemetry),
    portfolio: mergeSection(DEFAULT_BOT_CONFIG.portfolio, source.portfolio),
  };
}

function parseConfigWithDefaults(raw: unknown): BotConfig {
  const parsed = BotConfigSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  throw new ConfigError(
    `Bot config validation failed:\n${formatZodIssues(parsed.error.issues)}`,
    issues.map((issue) => issue.path).join(","),
    issues,
  );
}

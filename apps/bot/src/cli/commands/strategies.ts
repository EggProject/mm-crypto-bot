/**
 * apps/bot/src/cli/commands/strategies.ts
 *
 * Direct `strategies` command.
 *
 * Lists the strategies configured in the bot config, with their on/off
 * state and per-strategy overrides. Useful for "what is this bot actually
 * going to run?" sanity checks.
 *
 * Note: this prints the *config* state, not the *runtime* state. If the
 * bot is currently running, the on/off state here is what was loaded at
 * startup. A separate direct `kill-switches` command shows the runtime state of
 * the kill-switches.
 *
 * Color usage:
 *   - `ON`  → green (the strategy is contributing to the bot's behavior)
 *   - `OFF` → dim  (the strategy is loaded but disabled; no risk surface)
 *
 * Exit codes: 0 (success) / 2 (config validation failure).
 */

import { ConfigError, loadBotConfig } from "../../config/index.js";
import type { BotConfig, StrategySection } from "../../config/schema.js";
import type { RuntimeRootResolution } from "../../config/runtime-root.js";
import { colorize } from "../color.js";
import type { SubcommandHandler } from "../router.js";

import { reportConfigPathFailure, resolveConfigPath, resolveDefaultRuntimeRoot } from "./config-path.js";

/**
 * `getConfigPath` — pull the `--config=path` flag, or `undefined`.
 */
function getConfigPath(flags: ReadonlyMap<string, string | boolean>): string | undefined {
  const v = flags.get("config");
  if (typeof v === "string" && v.length > 0) {
    return v;
  }
  return undefined;
}

/**
 * `formatStrategySection` — pretty-print a per-strategy section.
 *
 * The `ON` / `OFF` badge is colorized. The `[` / `]`
 * brackets stay plain so the column starts at a known position even
 * when color is on (ANSI codes are zero-width in the terminal).
 */
function formatStrategySection(name: string, section: StrategySection, isEnabled: boolean): string {
  const stateLabel = isEnabled ? "ON " : "OFF";
  const stateColor = isEnabled ? "green" : "dim";
  const lines = [`  [${colorize(stateLabel, stateColor)}] ${name}`];
  for (const [k, value] of Object.entries(section)) {
    if (k === "enabled" || value === undefined) continue;
    lines.push(`    ${k} = ${formatValue(value)}`);
  }
  return lines.join("\n");
}

/**
 * `formatValue` — best-effort TOML-ish value rendering for the section table.
 */
type StrategyValue = Exclude<StrategySection[keyof StrategySection], undefined> | string;

function formatValue(value: StrategyValue): string {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return "[" + value.map((item) => `"${item}"`).join(", ") + "]";
  }
  // The only remaining schema-derived value is the validated timeframes object.
  const entries = Object.entries(value)
    .map(([nestedKey, nestedValue]) => `${nestedKey} = ${formatValue(nestedValue)}`)
    .join(", ");
  return `{ ${entries} }`;
}

/**
 * `strategiesCommand` — the direct `strategies` handler.
 */
export interface StrategiesCommandDependencies {
  readonly loadConfig: (path: string | undefined) => BotConfig;
  readonly resolveRuntimeRoot: () => RuntimeRootResolution;
}

const DEFAULT_STRATEGIES_COMMAND_DEPENDENCIES: StrategiesCommandDependencies = {
  loadConfig: (configPath) => loadBotConfig(configPath),
  resolveRuntimeRoot: resolveDefaultRuntimeRoot,
};

export function createStrategiesCommand(
  overrides: Partial<StrategiesCommandDependencies> = {},
): SubcommandHandler {
  const dependencies = { ...DEFAULT_STRATEGIES_COMMAND_DEPENDENCIES, ...overrides };
  return async (arguments_) => {
    await Promise.resolve();
    const configPathResolution = resolveConfigPath(
      getConfigPath(arguments_.flags),
      dependencies.resolveRuntimeRoot,
    );
    if (!configPathResolution.ok) {
      reportConfigPathFailure(configPathResolution);
      return 2;
    }

    let config;
    try {
      config = dependencies.loadConfig(configPathResolution.configPath);
    } catch (error: unknown) {
      if (error instanceof ConfigError) {
        console.error("Config validation FAILED:");
        console.error(error.message);
        return 2;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load config: ${message}`);
      return 1;
    }

    const enabledCount = Object.values(config.strategies).filter((s) => s.enabled).length;
    const totalCount = Object.keys(config.strategies).length;

    console.log(`Strategies: ${String(enabledCount)} of ${String(totalCount)} enabled`);
    console.log("");

    for (const [name, section] of Object.entries(config.strategies)) {
      console.log(formatStrategySection(name, section, section.enabled));
    }

    return 0;
  };
}

export const strategiesCommand = createStrategiesCommand();

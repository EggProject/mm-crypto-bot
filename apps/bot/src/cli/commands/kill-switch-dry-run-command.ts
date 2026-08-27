import { ConfigError, loadBotConfig } from "../../config/index.js";
import type { BotConfig } from "../../config/schema.js";
import type { RuntimeRootResolution } from "../../config/runtime-root.js";
import type { SubcommandHandler } from "../router.js";

import { reportConfigPathFailure, resolveConfigPath, resolveDefaultRuntimeRoot } from "./config-path.js";
import { buildReport, printHumanReadable, printJson } from "./kill-switch-dry-run-report.js";
import { loadState, type LoadedDryRunState } from "./kill-switch-dry-run-state.js";

interface KillSwitchDryRunDependencies {
  readonly loadConfig: (configPath: string) => BotConfig;
  readonly loadState: (stateFilePath: string) => LoadedDryRunState;
  readonly resolveRuntimeRoot: () => RuntimeRootResolution;
}

const defaultDependencies: KillSwitchDryRunDependencies = {
  loadConfig: loadBotConfig,
  loadState,
  resolveRuntimeRoot: resolveDefaultRuntimeRoot,
};

function configPathFromFlags(flags: ReadonlyMap<string, string | boolean>): string | undefined {
  const value = flags.get("config");
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isJsonRequested(flags: ReadonlyMap<string, string | boolean>): boolean {
  const value = flags.get("json");
  return typeof value === "boolean" ? value : typeof value === "string" && value !== "false" && value !== "0";
}

function writeStateFailure(error: string, stateFilePath: string, isJsonMode: boolean): void {
  if (isJsonMode) {
    console.log(
      JSON.stringify({ error, stateFilePath, wouldTrigger: false, positions: 0, closures: [] }, undefined, 2),
    );
    return;
  }
  console.error(`State: <unavailable>  (${error})`);
}

export function createKillSwitchDryRunCommand(
  overrides: Partial<KillSwitchDryRunDependencies> = {},
): SubcommandHandler {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async (arguments_) => {
    await Promise.resolve();
    if (arguments_.flags.get("help") === true) {
      console.log("Usage: bun run apps/bot/src/index.ts kill-switch-dry-run [--config=<path>] [--json]");
      return 0;
    }
    const isJsonMode = isJsonRequested(arguments_.flags);
    const pathResolution = resolveConfigPath(
      configPathFromFlags(arguments_.flags),
      dependencies.resolveRuntimeRoot,
    );
    if (!pathResolution.ok) {
      reportConfigPathFailure(pathResolution);
      return 2;
    }
    let config: BotConfig;
    try {
      config = dependencies.loadConfig(pathResolution.configPath);
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
    const loadedState = dependencies.loadState(config.bot.state_file);
    if (loadedState.error !== undefined || loadedState.state === undefined) {
      writeStateFailure(loadedState.error ?? "state is unavailable", config.bot.state_file, isJsonMode);
      return 1;
    }
    const report = buildReport({
      state: loadedState.state,
      stateFilePath: config.bot.state_file,
      configPath: pathResolution.configPath,
      maxDrawdownPct: config.risk.max_drawdown_pct,
    });
    if (isJsonMode) printJson(report);
    else printHumanReadable(report);
    return 0;
  };
}

export const killSwitchDryRunCommand = createKillSwitchDryRunCommand();

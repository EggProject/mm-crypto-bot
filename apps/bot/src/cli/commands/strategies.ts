/**
 * apps/bot/src/cli/commands/strategies.ts
 *
 * Phase 33 Track D — `mm-bot strategies [--config=path]`.
 *
 * Lists the strategies configured in the bot config, with their on/off
 * state and per-strategy overrides. Useful for "what is this bot actually
 * going to run?" sanity checks.
 *
 * Note: this prints the *config* state, not the *runtime* state. If the
 * bot is currently running, the on/off state here is what was loaded at
 * startup. A separate `mm-bot kill-switches` shows the runtime state of
 * the kill-switches.
 *
 * Exit codes: 0 (success) / 2 (config validation failure).
 */

import { ConfigError, loadBotConfig } from "../../config/index.js";
import type { SubcommandHandler } from "../router.js";

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
 */
function formatStrategySection(name: string, section: Record<string, unknown>, enabled: boolean): string {
  const state = enabled ? "ON " : "OFF";
  const lines: string[] = [];
  lines.push(`  [${state}] ${name}`);
  for (const [k, v] of Object.entries(section)) {
    if (k === "enabled") continue;
    if (v === undefined) continue;
    lines.push(`    ${k} = ${formatValue(v)}`);
  }
  return lines.join("\n");
}

/**
 * `formatValue` — best-effort TOML-ish value rendering for the section table.
 */
function formatValue(v: unknown): string {
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return "[" + v.map((x) => (typeof x === "string" ? `"${x}"` : String(x))).join(", ") + "]";
  }
  if (typeof v === "object" && v !== null) {
    // Inline nested object (e.g. timeframes).
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .map(([k2, val]) => `${k2} = ${formatValue(val)}`)
      .join(", ");
    return `{ ${entries} }`;
  }
  return String(v);
}

/**
 * `strategiesCommand` — the `mm-bot strategies` handler.
 */
export const strategiesCommand: SubcommandHandler = async (args) => {
  await Promise.resolve();
  const configPath = getConfigPath(args.flags);

  let config;
  try {
    config = loadBotConfig(configPath);
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      console.error("Config validation FAILED:");
      console.error(err.message);
      return 2;
    }
    const message = err instanceof Error ? err.message : String(err);
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

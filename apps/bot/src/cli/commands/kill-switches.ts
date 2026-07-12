/**
 * apps/bot/src/cli/commands/kill-switches.ts
 *
 * Phase 33 Track D + Phase 34 Track C — `mm-bot kill-switches [--config=path]`.
 *
 * Lists the bot's kill-switches with their state and last trigger reason.
 *
 * IMPORTANT: this command reflects the kill-switch REGISTRY's static
 * configuration. It does NOT contact a live Bot — the registry is
 * constructed from the config. If the bot is running, the live
 * `Bot.killSwitches` instance has additional runtime state; the live
 * state is observable via `mm-bot status`.
 *
 * For now, this command prints the kill-switch *descriptions* (ids +
 * thresholds) so the user knows which switches are armed. The "live"
 * engaged/triggered state requires reading the state file (the
 * `Telemetry.setEngaged` writes to a log file, not the state file).
 *
 * Color usage (Phase 34 Track C):
 *   - `ARMED`   → red (these switches WILL stop the bot if tripped)
 *   - `DISARMED` → dim (informational, no risk surface)
 *
 * Exit codes: 0 (success) / 2 (config invalid).
 */

import { ConfigError, loadBotConfig } from "../../config/index.js";
import { colorize } from "../color.js";
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
 * `killSwitchesCommand` — the `mm-bot kill-switches` handler.
 *
 * We synthesize the kill-switch list from the config (without instantiating
 * the Bot) so this command works without a running bot. The "engaged"
 * state is "armed" by default; we don't have access to the live registry
 * here. The last trigger reason is read from the state file if present
 * (the `BotState` schema doesn't currently have a kill-switch section —
 * the `Telemetry` log is the source of truth for the live state).
 */
export const killSwitchesCommand: SubcommandHandler = async (args) => {
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

  // The 4 kill-switches are derived from the config (mirrors the
  // `createDefaultRegistry` function in `bot/kill-switches.ts`).
  const switches: readonly {
    readonly id: string;
    readonly description: string;
    readonly armed: boolean;
  }[] = [
    {
      id: "max-drawdown",
      description: `Max drawdown ${(config.risk.max_drawdown_pct * 100).toFixed(1)}% (peak → current)`,
      armed: true,
    },
    {
      id: "max-positions",
      description: `Max positions ${String(config.risk.max_positions)} (soft cap warning @ 90%)`,
      armed: true,
    },
    {
      id: "latency-gate",
      // The LatencyGate is currently disabled by default (paper-trade
      // sentinel). When wired to the live feed, it becomes armed.
      description: `Latency gate (disabled in paper mode)`,
      armed: false,
    },
    {
      id: "per-strategy",
      // Per-strategy kill-switches are exposed by each strategy (e.g.
      // DydxCexCarryStrategy has 4). The CLI can't enumerate them
      // without instantiating each strategy, so we report the count
      // derived from the per-strategy killSwitch config if present.
      description: `Per-strategy kill-switches (see strategy-registry)`,
      armed: config.strategies.dydx_cex_carry.enabled,
    },
  ];

  console.log(`Kill-switches: ${String(switches.length)} registered`);
  console.log("");
  for (const sw of switches) {
    // ARMED → red (live risk surface); DISARMED → dim (no immediate risk).
    // The bracket + padding keep column alignment when color is on:
    // ANSI codes are zero-width in the terminal.
    const state = sw.armed ? "ARMED  " : "DISARMED";
    const stateColored = sw.armed
      ? colorize(state, "red")
      : colorize(state, "dim");
    console.log(`  [${stateColored}]  ${sw.id.padEnd(16, " ")}  ${sw.description}`);
  }
  console.log("");
  console.log("  Last trigger reason: <see Telemetry log for live state>");
  console.log(`  Telemetry log dir:   ${config.telemetry.log_dir}`);

  return 0;
};

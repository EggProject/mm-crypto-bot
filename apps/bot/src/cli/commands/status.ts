/**
 * apps/bot/src/cli/commands/status.ts
 *
 * Phase 33 Track D + Phase 34 Track C — `mm-bot status [--config=path]`.
 *
 * Reads the persisted state file (no live Bot instance) and prints:
 *   - mode + state file path
 *   - savedAt timestamp + age (uptime-from-save)
 *   - open positions (count + per-position details)
 *   - closed trades count + realized P&L
 *   - aggregate counters (placed / filled / cancelled / rejected)
 *   - last error note if schema validation failed at load
 *
 * The bot does NOT need to be running. We just read the JSON file.
 *
 * Color usage (Phase 34 Track C):
 *   - `Mode:` line is green when `bot.mode === "paper"` (safe), red
 *     when `"live"` (caution the user this is real money).
 *   - `Realized PnL` is green when positive, red when negative, dim when zero.
 *   - `State: <unavailable>` is red (error), green for OK.
 *   - Per-position PnL and trade PnL follow the same color rule.
 *
 * All color is auto-stripped when `isColorEnabled()` returns false
 * (--no-color, NO_COLOR=1, or non-TTY stdout).
 *
 * Exit codes:
 *   0 — state file found and printed
 *   1 — state file not found (or any I/O error)
 */

import { existsSync, readFileSync } from "node:fs";

import { ConfigError, loadBotConfig } from "../../config/index.js";
import { BotStateSchema, type BotState } from "../../bot/state-store.js";
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
 * `formatDuration` — human-readable ms → "1h 23m 45s" / "12m 30s" / "5s".
 */
function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${String(h)}h ${String(m)}m ${String(s)}s`;
  if (m > 0) return `${String(m)}m ${String(s)}s`;
  return `${String(s)}s`;
}

/**
 * `formatTimestamp` — ISO-ish local time (no timezone offset).
 */
function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

/**
 * `colorizePnl` — green for profit, red for loss, dim for zero.
 *
 * Centralized so the rule is consistent across `status` and `trades`
 * (per the Phase 34 Track C mandate: "green for profitable, red for
 * losing"). Zero is dimmed to neutral — it's not a "win" or a "loss".
 */
function colorizePnl(value: number, formatted: string): string {
  if (value > 0) return colorize(formatted, "green");
  if (value < 0) return colorize(formatted, "red");
  return colorize(formatted, "dim");
}

/**
 * `loadState` — read + validate the state file.
 *
 * Returns `{ state, error }`:
 *   - `state` is the validated `BotState` on success.
 *   - `error` is a human-readable string if the file is missing or invalid.
 */
function loadState(
  filePath: string,
): { state: BotState | null; error: string | null } {
  if (!existsSync(filePath)) {
    return { state: null, error: `state file not found: ${filePath}` };
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { state: null, error: `failed to read ${filePath}: ${message}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { state: null, error: `invalid JSON in ${filePath}: ${message}` };
  }
  const validated = BotStateSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      state: null,
      error: `state file schema invalid: ${validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    };
  }
  return { state: validated.data, error: null };
}

/**
 * `statusCommand` — the `mm-bot status` handler.
 */
export const statusCommand: SubcommandHandler = async (args) => {
  await Promise.resolve();
  const configPath = getConfigPath(args.flags);

  // Load config to learn where the state file lives.
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

  const stateFile = config.bot.state_file;
  // Color the mode: green for paper (safe), red for live (real money).
  const modeColor = config.bot.mode === "live" ? "red" : "green";
  console.log(`Mode:        ${colorize(config.bot.mode, modeColor)}`);
  console.log(`State file:  ${stateFile}`);

  const { state, error } = loadState(stateFile);
  if (error !== null) {
    console.log(`State:       ${colorize("<unavailable>", "red")}  (${error})`);
    return 1;
  }
  if (state === null) {
    // Defensive: the `error` branch above always returns state=null with
    // a non-null error, so this is unreachable. Keep the type narrowing
    // for the compiler.
    return 1;
  }

  // The schema version is fixed at 1; if we ever bump it, this is where
  // the migration hook would live.
  const ageMs = Date.now() - state.savedAt;
  console.log(`Saved:       ${formatTimestamp(state.savedAt)}  (${formatDuration(ageMs)} ago)`);
  console.log("");
  console.log(`Equity:      $${state.equityUsd.toFixed(2)}  (initial: $${state.initialEquityUsd.toFixed(2)})`);
  // PnL is the headline number for the operator; color it green/red/dim.
  const pnlText = `$${state.realizedPnlUsd.toFixed(2)}`;
  console.log(`Realized PnL: ${colorizePnl(state.realizedPnlUsd, pnlText)}`);

  // Open positions.
  console.log("");
  console.log(`Open positions (${String(state.positions.length)}):`);
  if (state.positions.length === 0) {
    console.log("  (none)");
  } else {
    for (const p of state.positions) {
      const unrealText = `$${p.unrealizedPnl.toFixed(2)}`;
      console.log(
        `  • ${p.id}  ${p.side.toUpperCase()} ${p.quantity} ${p.symbol} @ $${p.entryPrice.toFixed(2)}` +
          `  (current $${p.currentPrice.toFixed(2)}, lev ${String(p.leverage)}x,` +
          ` unrealized ${colorizePnl(p.unrealizedPnl, unrealText)})`,
      );
    }
  }

  // Closed trades summary.
  console.log("");
  console.log(`Closed trades: ${String(state.closedTrades.length)} (history, FIFO cap 1000)`);
  if (state.closedTrades.length > 0) {
    const last3 = state.closedTrades.slice(-3);
    for (const t of last3) {
      const pnlText = `$${t.pnl.toFixed(2)} (${t.pnlPct.toFixed(2)}%)`;
      console.log(
        `  • ${formatTimestamp(t.closedAt)}  ${t.side.toUpperCase()} ${t.quantity} ${t.symbol}` +
          `  entry $${t.entryPrice.toFixed(2)} → exit $${t.exitPrice.toFixed(2)}` +
          `  PnL ${colorizePnl(t.pnl, pnlText)}`,
      );
    }
  }

  // Counters.
  console.log("");
  console.log(
    `Counters:  placed=${String(state.counters.placed)}  filled=${String(state.counters.filled)}` +
      `  cancelled=${String(state.counters.cancelled)}  rejected=${String(state.counters.rejected)}`,
  );

  return 0;
};

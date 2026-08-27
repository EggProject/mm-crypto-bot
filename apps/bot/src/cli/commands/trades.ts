/**
 * apps/bot/src/cli/commands/trades.ts
 *
 * Direct `trades` command.
 *
 * Reads the persisted state file and prints the most recent closed trades
 * (default: 20). Optionally filter by symbol.
 *
 * Color usage:
 *   - PnL column is green for profit, red for loss, dim for zero.
 *   - State-file-missing errors are red.
 *
 * Exit codes: 0 (success) / 1 (state file missing) / 2 (config invalid).
 */

import { ConfigError, loadBotConfig } from "../../config/index.js";
import type { BotConfig } from "../../config/schema.js";
import type { RuntimeRootResolution } from "../../config/runtime-root.js";
import { BotStateSchema, type BotState } from "../../bot/state-store.js";
import { colorize } from "../color.js";
import type { SubcommandHandler } from "../router.js";

import { reportConfigPathFailure, resolveConfigPath, resolveDefaultRuntimeRoot } from "./config-path.js";
import { nodeCommandStateFilePort, type CommandStateFilePort } from "./command-state-file.js";

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
 * `formatTimestamp` — ISO-ish local time.
 */
function formatTimestamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "Z");
}

function decimalRadix(): number {
  return 10;
}

/**
 * `colorizePnl` — green for profit, red for loss, dim for zero.
 *
 * Shared pattern with `status.ts`:
 * "green for profitable, red for losing"). Centralized here to keep
 * the rule consistent across commands.
 */
function colorizePnl(value: number, formatted: string): string {
  if (value > 0) return colorize(formatted, "green");
  if (value < 0) return colorize(formatted, "red");
  return colorize(formatted, "dim");
}

/**
 * `tradesCommand` — the direct `trades` handler.
 */
export interface TradesCommandDependencies {
  readonly loadConfig: (path: string | undefined) => BotConfig;
  readonly resolveRuntimeRoot: () => RuntimeRootResolution;
  readonly stateFile: CommandStateFilePort;
}

const DEFAULT_TRADES_COMMAND_DEPENDENCIES: TradesCommandDependencies = {
  loadConfig: (configPath) => loadBotConfig(configPath),
  resolveRuntimeRoot: resolveDefaultRuntimeRoot,
  stateFile: nodeCommandStateFilePort,
};

export function createTradesCommand(overrides: Partial<TradesCommandDependencies> = {}): SubcommandHandler {
  const dependencies = { ...DEFAULT_TRADES_COMMAND_DEPENDENCIES, ...overrides };
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

    // --limit
    const limitRaw = arguments_.flags.get("limit");
    const limitParsed = typeof limitRaw === "string" ? Number.parseInt(limitRaw, decimalRadix()) : NaN;
    const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : 20;

    // --symbol
    const symbolFilterRaw = arguments_.flags.get("symbol");
    const symbolFilter =
      typeof symbolFilterRaw === "string" && symbolFilterRaw.length > 0 ? symbolFilterRaw : undefined;

    // Load config to get the state file path.
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

    const stateFile = config.bot.state_file;
    if (!dependencies.stateFile.exists(stateFile)) {
      console.error(`State file not found: ${stateFile}`);
      console.error(
        "The bot has not written any state yet. Run `bun run apps/bot/src/index.ts start` to begin.",
      );
      return 1;
    }

    let raw: string;
    try {
      raw = dependencies.stateFile.readText(stateFile);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to read ${stateFile}: ${message}`);
      return 1;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error: unknown) {
      const message = String(error).replace(/^SyntaxError: /, "");
      console.error(`Invalid JSON in ${stateFile}: ${message}`);
      return 1;
    }

    const validated = BotStateSchema.safeParse(parsed);
    if (!validated.success) {
      console.error(
        `State file schema invalid: ${validated.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      );
      return 1;
    }

    // Filter + slice.
    const allTrades = [...validated.data.closedTrades];
    // The state file stores trades in arrival order (FIFO), so the last
    // entries are the most recent.
    const filtered =
      symbolFilter === undefined ? allTrades : allTrades.filter((trade) => trade.symbol === symbolFilter);
    let recent: BotState["closedTrades"][number][] = [];
    const selectedTrades = filtered.slice(-limit);
    for (const trade of selectedTrades) {
      recent = [trade, ...recent];
    }

    console.log(
      `Trades: ${String(filtered.length)} total` +
        (symbolFilter === undefined ? "" : ` (filtered by symbol="${symbolFilter}")`) +
        ` — showing most recent ${String(recent.length)} of ${String(limit)} requested`,
    );
    console.log("");
    if (recent.length === 0) {
      console.log("  (no trades)");
      return 0;
    }

    // Header
    console.log(
      "  closed_at            strategy            side   qty      symbol         entry        exit         pnl            pnl%",
    );
    for (const t of recent) {
      // Color the PnL columns; the rest stays plain for column-alignment.
      // ANSI escape codes don't affect the visible width for `padStart`/`padEnd`
      // — the string is lengthened by the escape sequences, but the cursor
      // advances by the visible character count, so the column alignment
      // is preserved by virtue of the formatter prefixing with consistent
      // 9-byte and 5-byte codes (`\x1b[32m...\x1b[39m` and `\x1b[2m...\x1b[22m`).
      // If the user disables color (`--no-color`), `colorizePnl` returns
      // the plain string, so the table is perfectly aligned.
      const pnlCell = colorizePnl(t.pnl, `$${t.pnl.toFixed(2).padStart(9, " ")}`);
      const pnlPctCell = colorizePnl(t.pnl, `${t.pnlPct.toFixed(2).padStart(6, " ")}%`);
      console.log(
        `  ${formatTimestamp(t.closedAt)}  ${t.strategy.padEnd(20, " ")}  ${t.side.padEnd(4, " ")}  ${t.quantity.toFixed(4).padStart(8, " ")}  ${t.symbol.padEnd(13, " ")}  $${t.entryPrice.toFixed(2).padStart(9, " ")}  $${t.exitPrice.toFixed(2).padStart(9, " ")}  ${pnlCell}  ${pnlPctCell}`,
      );
    }

    return 0;
  };
}

export const tradesCommand = createTradesCommand();

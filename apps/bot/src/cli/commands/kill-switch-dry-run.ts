/**
 * apps/bot/src/cli/commands/kill-switch-dry-run.ts
 *
 * Phase 37 Track 5 — the direct `kill-switch-dry-run` command.
 *
 * ===========================================================================
 * PURPOSE — DRY-RUN A KILL-SWITCH FALLBACKRA
 * ===========================================================================
 * A parancs szimulálja, hogy mi történne, ha a kill-switch TÉNYLEGESEN
 * elsülne. The direct `kill-switches` command only reports the kill-switch
 * konfigurációját mutatja — ez a parancs a STATE-FÁJLON szimulálja a
 * `KillSwitchRegistry.evaluate()` kimenetét és a "minden pozíció
 * zárul" fallback-ágat, ANÉLKÜL, hogy bármit is elküldene az
 * exchange-nek.
 *
 * A parancs NEM hívja meg a `Bot`-ot és NEM nyúl a futó
 * `PositionManager`-hez. Csak a perzisztens state-fájlból (`bot.state_file`)
 * dolgozik, és kiírja:
 *   1. Mi lenne CANCELÁLVA (per-symbol, qty, est. loss).
 *   2. Mi lenne JELENTVE a Telegram alert csatornán (alert formátum).
 *   3. Mi lenne LOGOLVA structured JSON sorokban.
 *   4. A kill-switch VERDICT-ek (melyik kapcsoló miért tüzelne).
 *
 * ===========================================================================
 * HASZNÁLAT
 * ===========================================================================
 *   bun run apps/bot/src/index.ts kill-switch-dry-run
 *   bun run apps/bot/src/index.ts kill-switch-dry-run --config=live-tokyo.toml
 *
 * A parancs a Phase 37 Track 5 pre-launch checklist része — a LIVE
 * deploy előtt a user kiadja, és megvizsgálja, hogy tényleg csak azt
 * zárná-e a bot, amit kell.
 *
 * ===========================================================================
 * EXIT CODES
 * ===========================================================================
 *   0 — siker (mindig, ha a config betölthető; az output jelzi, hogy
 *       tüzelne-e a kill-switch vagy sem).
 *   1 — runtime error (state file nem található, IO hiba, stb.).
 *   2 — config validációs hiba.
 *
 * A parancs soha nem dob kivételt a kill-switch tüzelésre — ez egy
 * SZIMULÁCIÓ, és a `mode = "live"` deploy előtti sanity check.
 */

import { ConfigError, loadBotConfig } from "../../config/index.js";
import type { BotState } from "../../bot/state-store.js";
import type { BotConfig } from "../../config/schema.js";
import type { RuntimeRootResolution } from "../../config/runtime-root.js";
import { colorize } from "../color.js";
import type { SubcommandHandler } from "../router.js";

import { reportConfigPathFailure, resolveConfigPath, resolveDefaultRuntimeRoot } from "./config-path.js";
import { getConfigPath, isJsonOutputRequested } from "./kill-switch-command-options.js";
import { loadValidatedStateSnapshot } from "./kill-switch-state-file.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * `SimulatedPositionClosure` — egy pozíció, amit a kill-switch
 * elméletileg zárna. A `notional` az `entryPrice × quantity`,
 * az `estLoss` a `unrealizedPnl` (mert a piaci close-ra számított
 * P&L a `currentPrice` és `entryPrice` különbsége).
 */
export interface SimulatedPositionClosure {
  readonly id: string;
  readonly strategy: string;
  readonly symbol: string;
  readonly side: "long" | "short";
  readonly quantity: number;
  readonly notionalUsd: number;
  readonly estLossUsd: number;
  readonly leverage: number;
}

/**
 * `DryRunReport` — a szimuláció eredménye. EXPORTÁLJUK, hogy a
 * tesztek közvetlenül assertion szinten ellenőrizhessék a
 * struktúrát (a `console.log` szöveg helyett).
 */
export interface DryRunReport {
  readonly generatedAt: number;
  readonly configPath: string | undefined;
  readonly stateFilePath: string;
  readonly killSwitchId: string;
  readonly killSwitchDescription: string;
  readonly wouldTrigger: boolean;
  readonly closures: readonly SimulatedPositionClosure[];
  readonly totalNotionalUsd: number;
  readonly totalEstLossUsd: number;
  readonly telegramAlertText: string;
  readonly jsonLogLines: readonly string[];
}

/**
 * `loadState` reads and validates the state file. Its result is exclusive:
 * a validated state is available exactly when no error exists.
 */
export type StateLoadResult =
  | {
      readonly state: BotState;
      readonly error: null;
    }
  | {
      readonly state: null;
      readonly error: string;
    };

export function loadState(filePath: string): StateLoadResult {
  const result = loadValidatedStateSnapshot(filePath);
  if (result.error !== undefined) {
    // eslint-disable-next-line unicorn/no-null -- This exported CLI contract represents unavailable state as null.
    return { state: null, error: result.error };
  }
  // eslint-disable-next-line unicorn/no-null -- This exported CLI contract represents no error as null.
  return { state: result.state, error: null };
}

// ============================================================================
// Simulation core — exported for testability
// ============================================================================

/**
 * `buildClosures` — given a `BotState`, compute the list of positions
 * that the kill-switch fallback would close.
 *
 * In the real `Bot`, the kill-switch callback iterates over
 * `PositionManager.getPositions()` and submits a market order for
 * each. We do the equivalent here: walk the persisted `positions`
 * array and produce a `SimulatedPositionClosure` per position.
 *
 * The `estLossUsd` is the `unrealizedPnl` because that's the
 * mark-to-market loss the position is currently carrying. A
 * negative number is a loss; a positive is an unrealized gain
 * (still "closed" by the kill-switch, just the closure realizes
 * a profit instead of a loss).
 */
export function buildClosures(state: BotState): readonly SimulatedPositionClosure[] {
  return state.positions.map((p) => ({
    id: p.id,
    strategy: p.strategy,
    symbol: p.symbol,
    side: p.side,
    quantity: p.quantity,
    notionalUsd: p.notionalUsd,
    estLossUsd: p.unrealizedPnl,
    leverage: p.leverage,
  }));
}

/**
 * `formatTelegramAlert` — build the Telegram alert text the real
 * `Bot` would send. Format:
 *
 *   🚨 KILL-SWITCH TRIGGERED (DRY-RUN)
 *   <timestamp> | state=<file> | positions=<N>
 *   total notional: $<X> | est. P&L: $<Y>
 *   <per-position lines>
 *
 * The dry-run variant is prefixed with "DRY-RUN" so on-call humans
 * know nothing was actually cancelled.
 */
export function formatTelegramAlert(
  closures: readonly SimulatedPositionClosure[],
  totalNotionalUsd: number,
  totalEstLossUsd: number,
  generatedAt: number,
  stateFilePath: string,
): string {
  const ts = new Date(generatedAt).toISOString();
  const lines = [
    "🚨 KILL-SWITCH TRIGGERED (DRY-RUN)",
    `${ts} | state=${stateFilePath} | positions=${String(closures.length)}`,
    `total notional: $${totalNotionalUsd.toFixed(2)} | est. P&L: $${totalEstLossUsd.toFixed(2)}`,
  ];
  for (const c of closures) {
    const sideUpper = c.side.toUpperCase();
    lines.push(
      `  • ${c.symbol} ${sideUpper} ${String(c.quantity)} (lev ${String(c.leverage)}x, notional $${c.notionalUsd.toFixed(2)}, est. P&L $${c.estLossUsd.toFixed(2)})`,
    );
  }
  return lines.join("\n");
}

/**
 * `formatJsonLogLines` — build the structured JSON log lines the real
 * `Bot` emits structured runtime records to stderr. One line per closure +
 * one summary line. The format matches the Phase 34 Track C telemetry
 * convention: `{"level":"error","tag":"kill-switch","msg":"..."}`.
 */
export function formatJsonLogLines(
  closures: readonly SimulatedPositionClosure[],
  totalNotionalUsd: number,
  totalEstLossUsd: number,
  generatedAt: number,
  stateFilePath: string,
): readonly string[] {
  const lines = [
    JSON.stringify({
      level: "error",
      tag: "kill-switch-dry-run",
      msg: "kill-switch DRY-RUN — no orders sent",
      stateFile: stateFilePath,
      positions: closures.length,
      totalNotionalUsd,
      totalEstLossUsd,
      timestamp: generatedAt,
    }),
  ];
  for (const c of closures) {
    lines.push(
      JSON.stringify({
        level: "warn",
        tag: "kill-switch-dry-run",
        msg: "would close position",
        positionId: c.id,
        strategy: c.strategy,
        symbol: c.symbol,
        side: c.side,
        quantity: c.quantity,
        leverage: c.leverage,
        notionalUsd: c.notionalUsd,
        estLossUsd: c.estLossUsd,
        timestamp: generatedAt,
      }),
    );
  }
  return lines;
}

/**
 * `shouldTrigger` — does the kill-switch WOULD have triggered,
 * given the current state? In the real `Bot`, the kill-switches
 * (max-drawdown, max-positions, latency-gate, per-strategy) are
 * evaluated each cycle. The dry-run checks a simple heuristic:
 *   - if there are NO open positions → no kill-switch would fire
 *     (nothing to close), so `wouldTrigger: false`.
 *   - if there are positions AND the equity is below the drawdown
 *     threshold → `wouldTrigger: true` (max-drawdown kill-switch).
 *   - if there are positions AND no drawdown breach → `wouldTrigger: false`
 *     (the user can still trigger manually, but nothing is on auto-fire).
 *
 * The threshold is `config.risk.max_drawdown_pct`. The "would trigger"
 * signal is conservative — it answers "would SOMETHING auto-fire?",
 * not "could the user trigger it manually".
 */
export function shouldTrigger(state: BotState, maxDrawdownPct: number): boolean {
  if (state.positions.length === 0) return false;
  const drawdown =
    state.initialEquityUsd > 0 ? (state.initialEquityUsd - state.equityUsd) / state.initialEquityUsd : 0;
  return drawdown >= maxDrawdownPct;
}

/**
 * `buildReport` — orchestrate the full dry-run report from a state +
 * config context. EXPORTED for testability — the test file drives
 * this directly with synthetic states.
 */
export function buildReport(options: {
  readonly state: BotState;
  readonly stateFilePath: string;
  readonly configPath: string | undefined;
  readonly maxDrawdownPct: number;
  readonly generatedAt?: number;
}): DryRunReport {
  const generatedAt = options.generatedAt ?? Date.now();
  const closures = buildClosures(options.state);
  const totalNotionalUsd = closures.reduce((accumulator, c) => accumulator + c.notionalUsd, 0);
  const totalEstLossUsd = closures.reduce((accumulator, c) => accumulator + c.estLossUsd, 0);
  const isWouldTrigger = shouldTrigger(options.state, options.maxDrawdownPct);
  const killSwitchId = "kill-switch-dry-run";
  const killSwitchDescription = isWouldTrigger
    ? `Max drawdown ${(options.maxDrawdownPct * 100).toFixed(1)}% breached → all positions would close`
    : `No auto-trigger (positions=${String(closures.length)}, drawdown within budget)`;
  const telegramAlertText = formatTelegramAlert(
    closures,
    totalNotionalUsd,
    totalEstLossUsd,
    generatedAt,
    options.stateFilePath,
  );
  const jsonLogLines = formatJsonLogLines(
    closures,
    totalNotionalUsd,
    totalEstLossUsd,
    generatedAt,
    options.stateFilePath,
  );
  return {
    generatedAt,
    configPath: options.configPath,
    stateFilePath: options.stateFilePath,
    killSwitchId,
    killSwitchDescription,
    wouldTrigger: isWouldTrigger,
    closures,
    totalNotionalUsd,
    totalEstLossUsd,
    telegramAlertText,
    jsonLogLines,
  };
}

// ============================================================================
// Pretty-printer — colored human-readable output
// ============================================================================

/**
 * `printHumanReadable` — print the report as a colored, human-readable
 * multi-section output. Sections:
 *   1. Header (kill-switch ID + verdict)
 *   2. Would-be closures (table)
 *   3. Telegram alert preview
 *   4. JSON log lines preview
 *   5. Summary footer
 */
export function printHumanReadable(report: DryRunReport): void {
  const verdictColor = report.wouldTrigger ? "red" : "green";
  const verdictText = report.wouldTrigger ? "WOULD TRIGGER" : "NO AUTO-TRIGGER";
  console.log(`${colorize("[kill-switch-dry-run]", "bold")} ${colorize(verdictText, verdictColor)}`);
  console.log("");
  console.log(`  Switch:         ${report.killSwitchId}`);
  console.log(`  Description:    ${report.killSwitchDescription}`);
  console.log(`  State file:     ${report.stateFilePath}`);
  if (report.configPath !== undefined) {
    console.log(`  Config:         ${report.configPath}`);
  }
  console.log(`  Generated at:   ${new Date(report.generatedAt).toISOString()}`);
  console.log("");
  console.log(
    `  Positions: ${String(report.closures.length)}  |  Total notional: $${report.totalNotionalUsd.toFixed(2)}  |  est. P&L: $${report.totalEstLossUsd.toFixed(2)}`,
  );
  console.log("");

  if (report.closures.length === 0) {
    console.log(colorize("  (no open positions → nothing would close)", "dim"));
  } else {
    console.log("  Would-be closures:");
    for (const c of report.closures) {
      const lossColor = c.estLossUsd > 0 ? "green" : c.estLossUsd < 0 ? "red" : "dim";
      const lossText = `$${c.estLossUsd.toFixed(2)}`;
      console.log(
        `    • ${c.symbol.padEnd(12, " ")} ${c.side.toUpperCase().padEnd(5, " ")}` +
          ` qty=${String(c.quantity)} lev=${String(c.leverage)}x` +
          ` notional=$${c.notionalUsd.toFixed(2)}` +
          ` est.P&L=${colorize(lossText, lossColor)}`,
      );
    }
  }

  console.log("");
  console.log(colorize("  Telegram alert preview:", "dim"));
  for (const line of report.telegramAlertText.split("\n")) {
    console.log(colorize(`    ${line}`, "dim"));
  }

  console.log("");
  console.log(colorize("  JSON log lines (telemetry):", "dim"));
  for (const line of report.jsonLogLines) {
    console.log(colorize(`    ${line}`, "dim"));
  }

  console.log("");
  console.log(colorize("  (dry-run: NO orders were sent. No exchange state was modified.)", "yellow"));
}

/**
 * `printJson` — print the report as a single JSON object on stdout.
 *
 * Used when `--json` is passed: the output is parseable by jq /
 * alertmanager-webhook-receivers / custom monitoring scripts.
 */
export function printJson(report: DryRunReport): void {
  console.log(
    JSON.stringify(
      {
        generatedAt: report.generatedAt,
        configPath: report.configPath,
        stateFilePath: report.stateFilePath,
        killSwitchId: report.killSwitchId,
        wouldTrigger: report.wouldTrigger,
        positions: report.closures.length,
        totalNotionalUsd: report.totalNotionalUsd,
        totalEstLossUsd: report.totalEstLossUsd,
        closures: report.closures,
        telegramAlert: report.telegramAlertText,
        jsonLogLines: report.jsonLogLines,
      },
      // eslint-disable-next-line unicorn/no-null -- JSON.stringify preserves the CLI's stable pretty-print contract with a null replacer.
      null,
      2,
    ),
  );
}

/**
 * `killSwitchDryRunCommand` — the direct `kill-switch-dry-run` handler.
 */
export interface KillSwitchDryRunCommandDependencies {
  readonly loadConfig: (path: string | undefined) => BotConfig;
  readonly resolveRuntimeRoot: () => RuntimeRootResolution;
}

const DEFAULT_KILL_SWITCH_DRY_RUN_COMMAND_DEPENDENCIES: KillSwitchDryRunCommandDependencies = {
  loadConfig: (configPath) => loadBotConfig(configPath),
  resolveRuntimeRoot: resolveDefaultRuntimeRoot,
};

export function createKillSwitchDryRunCommand(
  overrides: Partial<KillSwitchDryRunCommandDependencies> = {},
): SubcommandHandler {
  const dependencies = { ...DEFAULT_KILL_SWITCH_DRY_RUN_COMMAND_DEPENDENCIES, ...overrides };
  return async (arguments_) => {
  await Promise.resolve();
  const configPath = getConfigPath(arguments_.flags);
  const isJsonMode = isJsonOutputRequested(arguments_.flags);

  // Help flag — print usage + return 0 (consistent with `backtest`).
  if (arguments_.flags.get("help") === true) {
    console.log("Usage: bun run apps/bot/src/index.ts kill-switch-dry-run [options]");
    console.log("");
    console.log("Simulates the kill-switch fallback without sending any orders.");
    console.log("Reads the bot state file (per `[bot].state_file`) and prints");
    console.log("what would be cancelled, what would be alerted (Telegram), and");
    console.log("what would be logged (structured JSON). Exits 0 on success.");
    console.log("");
    console.log("Options:");
    console.log("  --config=<path>   TOML config file (optional; otherwise MM_CRYPTO_BOT_RUNTIME_ROOT is required)");
    console.log("  --json            emit a single JSON object on stdout (scripting)");
    console.log("  --help, -h        Show this help");
    return 0;
  }

  const configPathResolution = resolveConfigPath(configPath, dependencies.resolveRuntimeRoot);
  if (!configPathResolution.ok) {
    reportConfigPathFailure(configPathResolution);
    return 2;
  }

  // Load config (we need the state-file path + max-drawdown threshold).
  let config;
  try {
    config = dependencies.loadConfig(configPathResolution.configPath);
  } catch (error_: unknown) {
    if (error_ instanceof ConfigError) {
      console.error("Config validation FAILED:");
      console.error(error_.message);
      return 2;
    }
    const message = error_ instanceof Error ? error_.message : String(error_);
    console.error(`Failed to load config: ${message}`);
    return 1;
  }

  const stateFilePath = config.bot.state_file;
  const stateResult = loadState(stateFilePath);
  if (stateResult.error !== null) {
    if (isJsonMode) {
      console.log(
        JSON.stringify(
          {
            error: stateResult.error,
            stateFilePath,
            wouldTrigger: false,
            positions: 0,
            totalNotionalUsd: 0,
            totalEstLossUsd: 0,
            closures: [],
            telegramAlert: "",
            jsonLogLines: [],
          },
          // eslint-disable-next-line unicorn/no-null -- JSON.stringify preserves the CLI's stable pretty-print contract with a null replacer.
          null,
          2,
        ),
      );
    } else {
      console.error(`State: ${colorize("<unavailable>", "red")}  (${stateResult.error})`);
    }
    return 1;
  }
  const report = buildReport({
    state: stateResult.state,
    stateFilePath,
    configPath: configPathResolution.configPath,
    maxDrawdownPct: config.risk.max_drawdown_pct,
  });

  if (isJsonMode) {
    printJson(report);
  } else {
    printHumanReadable(report);
  }
  return 0;
  };
};

export const killSwitchDryRunCommand = createKillSwitchDryRunCommand();

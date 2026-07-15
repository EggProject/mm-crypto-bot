/**
 * apps/bot/src/cli/commands/kill-switch-dry-run.ts
 *
 * Phase 37 Track 5 — `mm-bot kill-switch-dry-run [--config=path]`.
 *
 * ===========================================================================
 * PURPOSE — DRY-RUN A KILL-SWITCH FALLBACKRA
 * ===========================================================================
 * A parancs szimulálja, hogy mi történne, ha a kill-switch TÉNYLEGESEN
 * elsülne. A `mm-bot kill-switches` parancs csak a kill-switchek
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
 *   mm-bot kill-switch-dry-run                       # state-file a default configból
 *   mm-bot kill-switch-dry-run --config=live-tokyo.toml  # Tokyo co-loc config
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

import { existsSync, readFileSync } from "node:fs";

import { ConfigError, loadBotConfig } from "../../config/index.js";
import { BotStateSchema, type BotState } from "../../bot/state-store.js";
import { colorize } from "../color.js";
import type { SubcommandHandler } from "../router.js";

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

// ============================================================================
// Helpers — flag parsing
// ============================================================================

/**
 * `getConfigPath` — pull the `--config=path` flag from the parsed args.
 */
function getConfigPath(flags: ReadonlyMap<string, string | boolean>): string | undefined {
  const v = flags.get("config");
  if (typeof v === "string" && v.length > 0) {
    return v;
  }
  return undefined;
}

/**
 * `getJsonFlag` — pull the `--json` boolean flag (default: false).
 *
 * Ha `true`, a riportot kizárólag JSON formátumban írja ki (a
 * `scripting` use-case-hez — pl. CI / alertmanager webhook parser).
 */
function getJsonFlag(flags: ReadonlyMap<string, string | boolean>): boolean {
  const v = flags.get("json");
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && v.length > 0) return v !== "false" && v !== "0";
  return false;
}

// ============================================================================
// State loading
// ============================================================================

/**
 * `loadState` — read + validate the state file. Returns the validated
 * `BotState` on success; throws a tagged error otherwise.
 *
 * Differentiates between "file not found" (callers can downgrade to a
 * friendly message + code 1) and other IO/parse errors.
 */
export function loadState(
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
  const lines: string[] = [];
  lines.push("🚨 KILL-SWITCH TRIGGERED (DRY-RUN)");
  lines.push(
    `${ts} | state=${stateFilePath} | positions=${String(closures.length)}`,
  );
  lines.push(
    `total notional: $${totalNotionalUsd.toFixed(2)} | est. P&L: $${totalEstLossUsd.toFixed(2)}`,
  );
  for (const c of closures) {
    const sideUpper = c.side.toUpperCase();
    lines.push(
      `  • ${c.symbol} ${sideUpper} ${c.quantity} (lev ${String(c.leverage)}x, notional $${c.notionalUsd.toFixed(2)}, est. P&L $${c.estLossUsd.toFixed(2)})`,
    );
  }
  return lines.join("\n");
}

/**
 * `formatJsonLogLines` — build the structured JSON log lines the real
 * `Bot` would write to `telemetry.log_dir`. One line per closure +
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
  const lines: string[] = [];
  lines.push(
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
  );
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
 * `computeWouldTrigger` — does the kill-switch WOULD have triggered,
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
export function computeWouldTrigger(state: BotState, maxDrawdownPct: number): boolean {
  if (state.positions.length === 0) return false;
  const drawdown = state.initialEquityUsd > 0
    ? (state.initialEquityUsd - state.equityUsd) / state.initialEquityUsd
    : 0;
  return drawdown >= maxDrawdownPct;
}

/**
 * `buildReport` — orchestrate the full dry-run report from a state +
 * config context. EXPORTED for testability — the test file drives
 * this directly with synthetic states.
 */
export function buildReport(opts: {
  readonly state: BotState;
  readonly stateFilePath: string;
  readonly configPath: string | undefined;
  readonly maxDrawdownPct: number;
  readonly generatedAt?: number;
}): DryRunReport {
  const generatedAt = opts.generatedAt ?? Date.now();
  const closures = buildClosures(opts.state);
  const totalNotionalUsd = closures.reduce((acc, c) => acc + c.notionalUsd, 0);
  const totalEstLossUsd = closures.reduce((acc, c) => acc + c.estLossUsd, 0);
  const wouldTrigger = computeWouldTrigger(opts.state, opts.maxDrawdownPct);
  const killSwitchId = "kill-switch-dry-run";
  const killSwitchDescription = wouldTrigger
    ? `Max drawdown ${(opts.maxDrawdownPct * 100).toFixed(1)}% breached → all positions would close`
    : `No auto-trigger (positions=${String(closures.length)}, drawdown within budget)`;
  const telegramAlertText = formatTelegramAlert(
    closures,
    totalNotionalUsd,
    totalEstLossUsd,
    generatedAt,
    opts.stateFilePath,
  );
  const jsonLogLines = formatJsonLogLines(
    closures,
    totalNotionalUsd,
    totalEstLossUsd,
    generatedAt,
    opts.stateFilePath,
  );
  return {
    generatedAt,
    configPath: opts.configPath,
    stateFilePath: opts.stateFilePath,
    killSwitchId,
    killSwitchDescription,
    wouldTrigger,
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
  console.log(
    `${colorize("[kill-switch-dry-run]", "bold")} ${colorize(verdictText, verdictColor)}`,
  );
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
  console.log(
    colorize("  (dry-run: NO orders were sent. No exchange state was modified.)", "yellow"),
  );
}

// ============================================================================
// JSON-only printer — for scripting
// ============================================================================

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
      null,
      2,
    ),
  );
}

// ============================================================================
// CLI handler
// ============================================================================

/**
 * `killSwitchDryRunCommand` — the `mm-bot kill-switch-dry-run` handler.
 */
export const killSwitchDryRunCommand: SubcommandHandler = async (args) => {
  await Promise.resolve();
  const configPath = getConfigPath(args.flags);
  const jsonMode = getJsonFlag(args.flags);

  // Help flag — print usage + return 0 (consistent with `backtest`).
  if (args.flags.get("help") === true) {
    console.log("Usage: mm-bot kill-switch-dry-run [options]");
    console.log("");
    console.log("Simulates the kill-switch fallback without sending any orders.");
    console.log("Reads the bot state file (per `[bot].state_file`) and prints");
    console.log("what would be cancelled, what would be alerted (Telegram), and");
    console.log("what would be logged (structured JSON). Exits 0 on success.");
    console.log("");
    console.log("Options:");
    console.log("  --config=<path>   TOML config file (optional; uses defaults if absent)");
    console.log("  --json            emit a single JSON object on stdout (scripting)");
    console.log("  --help, -h        Show this help");
    return 0;
  }

  // Load config (we need the state-file path + max-drawdown threshold).
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

  const stateFilePath = config.bot.state_file;
  const { state, error } = loadState(stateFilePath);
  if (error !== null) {
    if (jsonMode) {
      console.log(
        JSON.stringify(
          {
            error,
            stateFilePath,
            wouldTrigger: false,
            positions: 0,
            totalNotionalUsd: 0,
            totalEstLossUsd: 0,
            closures: [],
            telegramAlert: "",
            jsonLogLines: [],
          },
          null,
          2,
        ),
      );
    } else {
      console.error(`State: ${colorize("<unavailable>", "red")}  (${error})`);
    }
    return 1;
  }
  if (state === null) {
    // Defensive: the `loadState` contract guarantees `state !== null`
    // when `error === null`. This branch is only reachable if the
    // contract is violated (e.g. a test mock). We log the issue and
    // exit 1 — the same outcome as the error branch.
    if (jsonMode) {
      console.log(
        JSON.stringify(
          {
            error: "state is null (loadState contract violation)",
            stateFilePath,
            wouldTrigger: false,
            positions: 0,
            totalNotionalUsd: 0,
            totalEstLossUsd: 0,
            closures: [],
            telegramAlert: "",
            jsonLogLines: [],
          },
          null,
          2,
        ),
      );
    } else {
      console.error("State: <unavailable>  (state is null — contract violation)");
    }
    return 1;
  }

  const report = buildReport({
    state,
    stateFilePath,
    configPath,
    maxDrawdownPct: config.risk.max_drawdown_pct,
  });

  if (jsonMode) {
    printJson(report);
  } else {
    printHumanReadable(report);
  }
  return 0;
};

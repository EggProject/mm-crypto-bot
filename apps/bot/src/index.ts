#!/usr/bin/env bun
/**
 * apps/bot/src/index.ts
 *
 * Phase 33 Track D + Phase 34 Track C + Phase 44 — a `mm-bot` CLI entry pointja.
 *
 * ===========================================================================
 * SUBCOMMANDS
 * ===========================================================================
 *   - `start`           — indítja a botot (PURE HEADLESS, Phase 44 óta)
 *   - `status`          — a perzisztens state kiírása
 *   - `config`          — validate / show / init
 *   - `strategies`      — regisztrált stratégiák listája
 *   - `trades`          — utolsó N trade kiírása
 *   - `kill-switches`   — kill-switch állapot
 *   - `help`            — help
 *
 * ===========================================================================
 * HASZNÁLAT
 * ===========================================================================
 *   mm-bot                              → help
 *   mm-bot <subcommand> [--config=PATH] [--help] [--no-color] [--color]
 *
 * A `mm-bot` bináris ezt a fájlt futtatja (lásd `apps/bot/package.json` `bin`).
 *
 * ===========================================================================
 * EXIT CODES
 * ===========================================================================
 *   0 — siker
 *   1 — hiba (ismeretlen subcommand, runtime hiba, state file nem található)
 *   2 — config validációs hiba
 *
 * ===========================================================================
 * PHASE 44 — TUI REMOVAL
 * ===========================================================================
 * A `start` parancs mostantól PURE HEADLESS módban fut — nincs TUI,
 * nincs Ink, nincs React, nincs WebSocket. A bot a `runHeadless`
 * útvonalon indul el (lásd `apps/bot/src/cli/commands/start.ts`).
 *
 * A TUI törlésének oka: a user mandate (2026-07-16 16:53 Budapest) szerint
 * a bot mindig headless legyen, és egy KÜLÖN parancs indítsa a webes
 * klienst (Phase 46: `mm-bot web`). Így a bot NEM pazarol erőforrást,
 * ha csak headless akarjuk futtatni, de bármikor rá tudunk csatlakozni
 * egy másik terminálban indított `mm-bot web` paranccsal.
 *
 * A `--no-color` / `--color` flag-eket EZ a fájl dolgozza fel, a
 * subcommand handler-ek futása ELŐTT. A `NO_COLOR=1` env var-t
 * globálisan beállítjuk, hogy a subcommand-ok első `colorize()` hívása
 * már a helyes policy-t lássa.
 */

import {
  CliRouter,
  backtestCommand,
  configCommand,
  killSwitchDryRunCommand,
  killSwitchesCommand,
  makeHelpCommand,
  parseArgv,
  setColorForced,
  startCommand,
  statusCommand,
  strategiesCommand,
  tradesCommand,
} from "./cli/index.js";

// ---------------------------------------------------------------------------
// Global CLI flag handling — must run BEFORE any subcommand dispatches.
// ---------------------------------------------------------------------------
// We do an early `parseArgv` to honor `--no-color` and `--color` globally.
// This matters because:
//   1. picocolors + the CLI color helper read `NO_COLOR` + TTY state at
//      module-load time; we must set the env var before any subcommand
//      handler imports the picocolors-using code.
//   2. The user mandate: "default color output legyen, de headless módban
//      ki lehessen kapcsolni" — default IS color (TTY=ON, no env var),
//      `--no-color` flips OFF.
//
// This is a pure peek; the router will call `parseArgv` again to do
// real dispatch. The dual call is intentional and cheap (parseArgv
// is a small state machine).
const earlyFlags = parseArgv(process.argv.slice(2)).flags;

// `--no-color` (or its `--color` negation alias) → set NO_COLOR=1 globally.
// We always overwrite, not just set-if-undefined: a user that explicitly
// types `--no-color` is overriding any inherited env. Per the no-color
// spec, ANY non-empty value disables color, so "1" is the canonical signal.
if (earlyFlags.get("no-color") === true || earlyFlags.get("color") === false) {
  process.env["NO_COLOR"] = "1";
  setColorForced(false);
}

// `--color` → force color ON, even when stdout is not a TTY (e.g. piped
// to a log file or to `tee`). This bypasses the TTY auto-detect rule in
// `isColorEnabled()` so the user can intentionally colorize piped output.
if (earlyFlags.get("color") === true) {
  setColorForced(true);
}

// ---------------------------------------------------------------------------
// Router setup
// ---------------------------------------------------------------------------
const router = new CliRouter();
router.setProgramDescription("mm-bot — the mm-crypto-bot CLI");

router.register("start", "Start the bot (headless — runs until SIGINT/SIGTERM)", startCommand);
router.register("status", "Show the persisted bot state", statusCommand);
router.register("config", "Validate / show / init the bot config", configCommand);
router.register("strategies", "List registered strategies + on/off state", strategiesCommand);
router.register("trades", "Show recent closed trades", tradesCommand);
router.register("kill-switches", "Show kill-switch state", killSwitchesCommand);
router.register("kill-switch-dry-run", "Simulate the kill-switch path WITHOUT sending any orders (Phase 37 Track 5)", killSwitchDryRunCommand);
router.register("backtest", "Run a quick backtest on a deterministic OHLC fixture (Phase 37 Track 3)", backtestCommand);
router.register("help", "Show this help", makeHelpCommand(router));

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
// We use `parseArgv` here only to peek at `--help` early (so `mm-bot --help`
// works without going through the router's help path). The router calls
// `parseArgv` again internally — that's fine, it's a pure function.
//
// We export `parseArgv` for testability; the dual-call is intentional.
void parseArgv;

const code = await router.run(process.argv.slice(2));
process.exit(code);

#!/usr/bin/env bun
/**
 * apps/bot/src/index.ts
 *
 * Phase 33 Track D + Phase 34 Track A + Phase 34 Track C — a `mm-bot` CLI entry pointja.
 *
 * ===========================================================================
 * SUBCOMMANDS
 * ===========================================================================
 *   - `start`           — indítja a botot (default: Ink TUI; --headless: plain text)
 *   - `tui`             — TUI-only mód, BOT NÉLKÜL (--data-source=simulated|paper)
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
 * USER MANDATE (2026-07-12 02:00 BUDAPEST)
 * ===========================================================================
 * "TUI-t es headless-t is akarom, default color, headless kapcsolhato ki a
 *  color, default Ink TUI."
 *
 * A `start` parancs mostantól a TUI-t indítja ALAPÉRTELMEZETTEN. A
 * `--headless` / `--no-tui` flag-re plain text log módba vált (ekkor
 * a `@mm-crypto-bot/tui` csomag NEM töltődik be). A `tui` parancs
 * külön TUI-only indítást ad (bot nélkül, szimulált vagy paper
 * provider-rel).
 *
 * Phase 34 Track C (2026-07-12 02:54 Budapest) — `--no-color` / `--color`
 * flag-eket EZ a fájl dolgozza fel, a subcommand handler-ek futása
 * ELŐTT.  A `NO_COLOR=1` env var-t globálisan beállítjuk, hogy az
 * Ink (és minden más library) induláskor lássa.  A `--color` flag
 * explicit override: akkor is színes, ha a stdout nem TTY (pl. `tee`
 * egy log fájlba).
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
  tuiCommand,
} from "./cli/index.js";

// ---------------------------------------------------------------------------
// Global CLI flag handling — must run BEFORE any subcommand dispatches.
// ---------------------------------------------------------------------------
// We do an early `parseArgv` to honor `--no-color` and `--color` globally.
// This matters because:
//   1. The Ink TUI module reads `NO_COLOR` at module-load time; we must
//      set it before the dynamic `import("@mm-crypto-bot/tui")` in start.ts.
//   2. The picocolors-based CLI color helper reads `NO_COLOR` and TTY
//      state; flipping it here means every command's first `colorize()`
//      call already sees the right policy.
//   3. The user mandate: "headless mode-ban ki lehessen kapcsolni a
//      color-t, de default color output legyen" — default IS color
//      (TTY=ON, no env var), `--no-color` flips OFF.
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

router.register("start", "Start the bot (default: Ink TUI; --headless for plain text)", startCommand);
router.register("tui", "Launch the TUI without starting the bot (--data-source=simulated|paper)", tuiCommand);
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

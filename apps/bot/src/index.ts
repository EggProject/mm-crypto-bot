#!/usr/bin/env bun
/**
 * apps/bot/src/index.ts
 *
 * Phase 33 Track D + Phase 34 Track A — a `mm-bot` CLI entry pointja.
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
 *   mm-bot <subcommand> [--config=PATH] [--help]
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
 */

import {
  CliRouter,
  configCommand,
  killSwitchesCommand,
  makeHelpCommand,
  parseArgv,
  startCommand,
  statusCommand,
  strategiesCommand,
  tradesCommand,
  tuiCommand,
} from "./cli/index.js";

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

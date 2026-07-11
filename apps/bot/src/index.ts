#!/usr/bin/env bun
/**
 * apps/bot/src/index.ts
 *
 * Phase 33 Track D — a `mm-bot` CLI entry pointja.
 *
 * ===========================================================================
 * SUBCOMMANDS
 * ===========================================================================
 *   - `start`           — indítja a botot (SIGINT-re graceful shutdown)
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
 * USER MANDATE (2026-07-11 23:42 BUDAPEST)
 * ===========================================================================
 * "cli app-t se felejtsd el" — "Don't forget the CLI app."
 *
 * A korábbi Track C placeholder (amely közvetlenül `Bot.start()`-ot hívott)
 * lecserélődik erre a dispatcherre. A bot indítása mostantól:
 *
 *   bun run apps/bot/src/index.ts start [--config=path]
 *
 * vagy a `mm-bot` binárissal (miután a `bin` mező a package.json-ban rá
 * mutat erre a fájlra).
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
} from "./cli/index.js";

// ---------------------------------------------------------------------------
// Router setup
// ---------------------------------------------------------------------------
const router = new CliRouter();
router.setProgramDescription("mm-bot — the mm-crypto-bot CLI");

router.register("start", "Start the bot (SIGINT = graceful shutdown)", startCommand);
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

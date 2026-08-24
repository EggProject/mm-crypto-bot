#!/usr/bin/env bun
/**
 * Direct bot CLI entry point.
 *
 * Subcommands: start, status, config, strategies, trades, kill-switches,
 * kill-switch-dry-run, backtest, and help.
 *
 * Usage: bun run apps/bot/src/index.ts <subcommand> [--config=PATH] [--help]
 * [--no-color] [--color]. Exit codes are 0 for success, 1 for command or
 * runtime errors, and 2 for configuration validation errors.
 *
 * Color flags are processed before subcommand dispatch so every handler sees
 * the intended color policy at its first colorization call.
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
// Parse flags early to honor `--no-color` and `--color` globally. This matters because:
//   1. picocolors + the CLI color helper read `NO_COLOR` + TTY state at
//      module-load time; we must set the env var before any subcommand
//      handler imports the picocolors-using code.
//   2. Default TTY output uses color unless an explicit color flag changes it.
//
// This is a pure peek; the router will call `parseArgv` again to do
// real dispatch. The dual call is intentional and cheap (parseArgv
// is a small state machine).
const earlyFlags = parseArgv(process.argv.slice(2)).flags;

// `--no-color` (or its `--color` negation alias) → set NO_COLOR=1 globally.
// We always overwrite, not just set-if-undefined: a user that explicitly
// types `--no-color` is overriding any inherited env. Per the no-color
// spec, ANY non-empty value disables color, so "1" is the canonical signal.
if (earlyFlags.get("color") === false) {
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
router.setProgramDescription("mm-crypto-bot command-line interface");

router.register("start", "Start the bot (headless — runs until SIGINT/SIGTERM)", startCommand);
router.register("status", "Show the persisted bot state", statusCommand);
router.register("config", "Validate / show / init the bot config", configCommand);
router.register("strategies", "List registered strategies + on/off state", strategiesCommand);
router.register("trades", "Show recent closed trades", tradesCommand);
router.register("kill-switches", "Show kill-switch state", killSwitchesCommand);
router.register(
  "kill-switch-dry-run",
  "Simulate the kill-switch path without sending any orders",
  killSwitchDryRunCommand,
);
router.register("backtest", "Run a quick backtest on a deterministic OHLC fixture", backtestCommand);
router.register("help", "Show this help", makeHelpCommand(router));

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
// We use `parseArgv` here only to peek at `--help` early (so the direct command with `--help`
// works without going through the router's help path). The router calls
// `parseArgv` again internally — that's fine, it's a pure function.
//
// We export `parseArgv` for testability; the dual-call is intentional.
void parseArgv;

const code = await router.run(process.argv.slice(2));
process.exit(code);

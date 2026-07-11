#!/usr/bin/env bun
/**
 * apps/bot/src/index.ts
 *
 * A mm-crypto-bot CLI entry pointja — Phase 33 Track C (Bot runtime).
 *
 * A bot most már TÉNYLEGESEN indítható: betölti a konfigot, megnyitja
 * az exchange feed-et (paper/live), példányosítja a stratégiákat, és
 * elindítja a futási ciklust. A `mm-bot` bináris ezt a fájlt futtatja.
 *
 * Használat:
 *   bun run dev --workspace=apps/bot -- --config=path/to/config.toml
 *   bun run dev --workspace=apps/bot --        # default config
 *
 * A `process.argv`-ban:
 *   --config=<path>     TOML config file
 *   --mode=<paper|live> bot mode override
 *
 * A SIGINT/SIGTERM signalok graceful shutdown-t indítanak (a Bot
 * saját signal-handler-e a Phase 33 Track D CLI-ban kerül kiépítésre;
 * itt a process default-ja lép életbe, ami a process exit előtt a
 * `bot.stop()`-ot hívja — a Bot.stop() cleanup-ja lezárja a feed-et,
 * flush-eli a state-et, és a process kilép).
 */

import { loadBotConfig, ConfigError } from "./config/index.js";
import { Bot } from "./bot/bot.js";

function parseArgs(argv: readonly string[]): { readonly configPath?: string } {
  const args: { configPath?: string } = {};
  for (const arg of argv) {
    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (value.length > 0) {
        args.configPath = value;
      }
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let config;
  try {
    config = loadBotConfig(args.configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[bot] config error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const bot = new Bot({ config });
  // Graceful shutdown on SIGINT/SIGTERM.
  let stopping = false;
  const onSignal = (sig: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[bot] received ${sig} — initiating graceful shutdown`);
    void bot.stop().then(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  await bot.start();
}

void main();

/**
 * apps/bot/src/cli/commands/start.ts
 *
 * Phase 33 Track D — `mm-bot start [--config=path]`.
 *
 * Loads the bot config, instantiates a `Bot`, and runs it until SIGINT/SIGTERM.
 * On signal, the bot's `stop()` is called for graceful shutdown.
 *
 * Exit codes:
 *   0 — clean shutdown (after SIGINT/SIGTERM or self-completion).
 *   1 — startup error (config load, instantiation, etc).
 *   2 — config validation failure.
 *
 * NOTE on live mode: this command DOES NOT automatically refuse `--mode=live`
 * without API keys. The exchange client handles key validation. We log a
 * warning at startup if mode=live so the user has a chance to abort.
 */

import { ConfigError, loadBotConfig } from "../../config/index.js";
import { Bot } from "../../bot/bot.js";
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
 * `startCommand` — the `mm-bot start` handler.
 */
export const startCommand: SubcommandHandler = async (args) => {
  const configPath = getConfigPath(args.flags);

  // ------------------------------------------------------------------------
  // 1) Load + validate config.
  // ------------------------------------------------------------------------
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

  // ------------------------------------------------------------------------
  // 2) Warn if mode=live and no API keys are set.
  // ------------------------------------------------------------------------
  if (config.bot.mode === "live") {
    const hasKey = typeof process.env["BYBIT_API_KEY"] === "string" && process.env["BYBIT_API_KEY"].length > 0;
    if (!hasKey) {
      console.warn("[start] WARNING: bot.mode = 'live' but BYBIT_API_KEY is not set");
      console.warn("[start]          the exchange client will fail to authenticate at first request");
    }
  }

  // ------------------------------------------------------------------------
  // 3) Create Bot + wire up SIGINT/SIGTERM for graceful shutdown.
  // ------------------------------------------------------------------------
  const bot = new Bot({ config });
  let stopping = false;

  const onSignal = (sig: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[start] received ${sig} — initiating graceful shutdown`);
    void bot.stop().then(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  // ------------------------------------------------------------------------
  // 4) Start the bot. This blocks until stop() is called.
  // ------------------------------------------------------------------------
  try {
    await bot.start();
    return 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[start] bot crashed: ${message}`);
    return 1;
  }
};

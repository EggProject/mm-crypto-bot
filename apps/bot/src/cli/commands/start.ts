import { randomUUID } from "node:crypto";

import { StderrJsonSink, StructuredLogger, type Logger, type UtcClock } from "@mm-crypto-bot/logging";
import { Bot } from "../../bot/bot.js";
import { ConfigError, loadBotConfig } from "../../config/index.js";
import type { RuntimeRootResolution } from "../../config/runtime-root.js";
import type { BotConfig } from "../../config/schema.js";
import { CLI_COMMAND, type SubcommandHandler } from "../router.js";

import { reportConfigPathFailure, resolveConfigPath, resolveDefaultRuntimeRoot } from "./config-path.js";

function getConfigPath(flags: ReadonlyMap<string, string | boolean>): string | undefined {
  const value = flags.get("config");
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const START_FLAG_NAMES = new Set(["color", "config", "help"]);
const START_CONFIG_INVALID_CODE = "START_CONFIG_INVALID";
const START_LIVE_ACTIVATION_UNAVAILABLE_CODE = "START_LIVE_ACTIVATION_UNAVAILABLE";
const START_BOOTSTRAP_FAILED_CODE = "START_BOOTSTRAP_FAILED";

export interface StartCommandDependencies {
  readonly loadConfig: (path: string | undefined) => BotConfig;
  readonly createBot: (config: BotConfig, logger: Logger) => Pick<Bot, "start" | "stop">;
  readonly createRuntimeLogger: (config: BotConfig) => RuntimeLogger;
  readonly resolveRuntimeRoot: () => RuntimeRootResolution;
  readonly run: (bot: Pick<Bot, "start" | "stop">, config: BotConfig, logger: Logger) => Promise<number>;
}

export interface RuntimeLogger extends Logger {
  readonly shutdown: () => Promise<void>;
}

class SystemUtcClock implements UtcClock {
  public now(): Date {
    return new Date();
  }
}

const DEFAULT_START_COMMAND_DEPENDENCIES: StartCommandDependencies = {
  loadConfig: (path) => loadBotConfig(path),
  createBot: (config, logger) => new Bot({ config, logger }),
  createRuntimeLogger: (config) => createRuntimeLogger(config),
  resolveRuntimeRoot: resolveDefaultRuntimeRoot,
  run: (bot, config, logger) => runHeadless(bot, config, logger),
};

function createRuntimeLogger(config: BotConfig): RuntimeLogger {
  const runId = randomUUID();
  return new StructuredLogger({
    clock: new SystemUtcClock(),
    context: { component: "bot", correlationId: runId, runId },
    maximumBufferedRecords: 256,
    sink: new StderrJsonSink(),
    threshold: config.bot.log_level,
  });
}

function validateStartArguments(commandArguments: Parameters<SubcommandHandler>[0]): string | undefined {
  for (const [name, value] of commandArguments.flags) {
    if (!START_FLAG_NAMES.has(name)) {
      return `Unknown start option: --${name}. Run \`${CLI_COMMAND} start --help\` for supported options.`;
    }
    if (name === "config" && (typeof value !== "string" || value.length === 0)) {
      return "The --config option requires a non-empty path.";
    }
    if (typeof value !== "boolean" && (name === "color" || name === "help")) {
      return `The --${name} option does not accept a value.`;
    }
  }
  const positional = commandArguments.positional[0];
  return positional === undefined
    ? undefined
    : `Unexpected start argument: ${positional}. Run \`${CLI_COMMAND} start --help\` for usage.`;
}

function isNoColor(flags: ReadonlyMap<string, string | boolean>): boolean {
  return flags.get("no-color") === true || flags.get("color") === false;
}

function logSafely(writeLog: () => void): void {
  try {
    writeLog();
  } catch {
    // Diagnostic failures must not interrupt lifecycle cleanup.
  }
}

function writeStartFailure(code: string): void {
  console.error(`[start] ${code}`);
}

export function createStartCommand(overrides: Partial<StartCommandDependencies> = {}): SubcommandHandler {
  const dependencies = { ...DEFAULT_START_COMMAND_DEPENDENCIES, ...overrides };
  return async (commandArguments) => {
    const argumentError = validateStartArguments(commandArguments);
    if (argumentError !== undefined) {
      console.error(`[start] ${argumentError}`);
      return 1;
    }

    if (isNoColor(commandArguments.flags) && process.env["NO_COLOR"] === undefined) {
      process.env["NO_COLOR"] = "1";
    }

    if (commandArguments.flags.get("help") === true) {
      printStartHelp();
      return 1;
    }

    let explicitConfigPath: string | undefined;
    try {
      explicitConfigPath = getConfigPath(commandArguments.flags);
    } catch {
      writeStartFailure(START_BOOTSTRAP_FAILED_CODE);
      return 1;
    }
    const configPathResolution = resolveConfigPath(explicitConfigPath, dependencies.resolveRuntimeRoot);
    if (!configPathResolution.ok) {
      reportConfigPathFailure(configPathResolution);
      return 2;
    }

    let config: BotConfig;
    try {
      config = dependencies.loadConfig(configPathResolution.configPath);
    } catch (error: unknown) {
      if (error instanceof ConfigError) {
        writeStartFailure(START_CONFIG_INVALID_CODE);
        return 2;
      }
      writeStartFailure(START_BOOTSTRAP_FAILED_CODE);
      return 1;
    }

    if (config.bot.mode === "live") {
      writeStartFailure(START_LIVE_ACTIVATION_UNAVAILABLE_CODE);
      return 3;
    }

    let logger: RuntimeLogger;
    try {
      logger = dependencies.createRuntimeLogger(config);
    } catch {
      writeStartFailure(START_BOOTSTRAP_FAILED_CODE);
      return 1;
    }

    let exitCode = 1;
    try {
      exitCode = await dependencies.run(dependencies.createBot(config, logger), config, logger);
    } catch (error: unknown) {
      logSafely(() => {
        logger.error("bot.lifecycle.runner.failed", { error });
      });
    } finally {
      try {
        await logger.shutdown();
      } catch {
        exitCode = exitCode === 0 ? 1 : exitCode;
      }
    }
    return exitCode;
  };
}

export const startCommand = createStartCommand();

async function isStoppedAfterSignal(
  bot: Pick<Bot, "stop">,
  logger: Logger,
  signal: NodeJS.Signals,
): Promise<boolean> {
  logSafely(() => {
    logger.info("bot.lifecycle.signal.received", { signal });
  });
  try {
    await bot.stop();
    logSafely(() => {
      logger.info("bot.lifecycle.shutdown.completed", { signal });
    });
    return true;
  } catch (error: unknown) {
    logSafely(() => {
      logger.error("bot.lifecycle.shutdown.failed", { error, signal });
    });
    return false;
  }
}

export async function runHeadless(
  bot: Pick<Bot, "start" | "stop">,
  _config: BotConfig,
  logger: Logger,
): Promise<number> {
  const shutdown: { promise?: Promise<boolean> } = {};

  const onSignal = (signal: NodeJS.Signals): void => {
    if (shutdown.promise !== undefined) return;
    shutdown.promise = isStoppedAfterSignal(bot, logger, signal);
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let exitCode = 0;
  try {
    await bot.start();
    logSafely(() => {
      logger.info("bot.lifecycle.run.completed");
    });
  } catch (error: unknown) {
    logSafely(() => {
      logger.error("bot.lifecycle.run.failed", { error });
    });
    exitCode = 1;
  } finally {
    if (shutdown.promise !== undefined) {
      const isStoppedCleanly = await shutdown.promise;
      if (!isStoppedCleanly) exitCode = 1;
    }
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    logSafely(() => {
      logger.info("bot.lifecycle.run.exited", { exitCode });
    });
  }
  return exitCode;
}

function printStartHelp(): void {
  const lines: readonly string[] = [
    `Usage: ${CLI_COMMAND} start [--config=path] [--no-color] [--help]`,
    "",
    "Launch the bot and run until SIGINT/SIGTERM or a runtime failure.",
    "Runtime records are emitted as structured JSON on stderr.",
    "",
    "Options:",
    "  --config=<path>       TOML config file (optional; otherwise MM_CRYPTO_BOT_RUNTIME_ROOT is required)",
    "  --no-color            Disable ANSI color codes",
    "  --help, -h            Show this help",
    "",
    "Examples:",
    `  ${CLI_COMMAND} start`,
    `  ${CLI_COMMAND} start --no-color`,
    `  ${CLI_COMMAND} start --config=./prod.toml`,
  ];
  for (const line of lines) {
    console.error(line);
  }
}

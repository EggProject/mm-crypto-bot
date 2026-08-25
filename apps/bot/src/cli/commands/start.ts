import path from "node:path";

import { Bot } from "../../bot/bot.js";
import { ConfigError, loadBotConfig } from "../../config/index.js";
import type { BotConfig } from "../../config/schema.js";
import { CLI_COMMAND, type SubcommandHandler } from "../router.js";

function getConfigPath(flags: ReadonlyMap<string, string | boolean>): string | undefined {
  const value = flags.get("config");
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const START_FLAG_NAMES = new Set(["color", "config", "help"]);

export interface StartCommandDependencies {
  readonly loadConfig: (path: string | undefined) => BotConfig;
  readonly createBot: (config: BotConfig) => Pick<Bot, "start" | "stop">;
  readonly run: (bot: Pick<Bot, "start" | "stop">, config: BotConfig) => Promise<number>;
}

const DEFAULT_START_COMMAND_DEPENDENCIES: StartCommandDependencies = {
  loadConfig: (path) => loadBotConfig(path),
  createBot: (config) => new Bot({ config }),
  run: (bot, config) => runHeadless(bot, config),
};

function validateStartArguments(arguments_: Parameters<SubcommandHandler>[0]): string | undefined {
  for (const [name, value] of arguments_.flags) {
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
  const positional = arguments_.positional[0];
  return positional === undefined
    ? undefined
    : `Unexpected start argument: ${positional}. Run \`${CLI_COMMAND} start --help\` for usage.`;
}

function isNoColor(flags: ReadonlyMap<string, string | boolean>): boolean {
  return flags.get("no-color") === true || flags.get("color") === false;
}

export function createStartCommand(overrides: Partial<StartCommandDependencies> = {}): SubcommandHandler {
  const dependencies = { ...DEFAULT_START_COMMAND_DEPENDENCIES, ...overrides };
  return async (arguments_) => {
    const argumentError = validateStartArguments(arguments_);
    if (argumentError !== undefined) {
      console.error(`[start] ${argumentError}`);
      return 1;
    }

    if (isNoColor(arguments_.flags) && process.env["NO_COLOR"] === undefined) {
      process.env["NO_COLOR"] = "1";
    }

    if (arguments_.flags.get("help") === true) {
      printStartHelp();
      return 1;
    }

    let config: BotConfig;
    try {
      config = dependencies.loadConfig(getConfigPath(arguments_.flags));
    } catch (error: unknown) {
      if (error instanceof ConfigError) {
        console.error("Config validation FAILED:");
        console.error(error.message);
        return 2;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load config: ${message}`);
      return 1;
    }

    if (config.bot.mode === "live") {
      console.error("[start] START_LIVE_ACTIVATION_UNAVAILABLE");
      return 3;
    }

    return dependencies.run(dependencies.createBot(config), config);
  };
}

export const startCommand = createStartCommand();

export async function runHeadless(bot: Pick<Bot, "start" | "stop">, config: BotConfig): Promise<number> {
  const logFileStream = await openLogFile(resolveLogFilePath(config));
  const consoleBackup = installConsoleRedirection(logFileStream);
  const shutdown: { promise?: Promise<boolean> } = {};

  const onSignal = (signal: NodeJS.Signals): void => {
    if (shutdown.promise !== undefined) return;
    console.log(`[start] received ${signal} — initiating graceful shutdown`);
    shutdown.promise = isGracefulStopSuccessfulAfterSignal(bot);
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let exitCode = 0;
  try {
    await bot.start();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[start] bot crashed: ${message}`);
    exitCode = 1;
  } finally {
    if (shutdown.promise !== undefined) {
      const isStoppedCleanly = await shutdown.promise;
      if (!isStoppedCleanly) exitCode = 1;
    }
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    restoreConsoleRedirection(consoleBackup);
    await consoleBackup.drain();
    await closeLogFile(logFileStream);
  }
  return exitCode;
}

async function isGracefulStopSuccessfulAfterSignal(bot: Pick<Bot, "stop">): Promise<boolean> {
  try {
    await Promise.resolve();
    await Promise.try(() => bot.stop());
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[start] graceful shutdown failed: ${message}`);
    return false;
  }
}

function printStartHelp(): void {
  const lines: readonly string[] = [
    `Usage: ${CLI_COMMAND} start [--config=path] [--no-color] [--help]`,
    "",
    "Launch the bot and run until SIGINT/SIGTERM or a runtime failure.",
    "Console output is redirected to <state_file>.log.",
    "",
    "Options:",
    "  --config=<path>       TOML config file (optional; uses defaults if absent)",
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

export function resolveLogFilePath(config: BotConfig): string {
  const stateFilePath = config.bot.state_file;
  if (
    stateFilePath.length === 0 ||
    stateFilePath.includes("\0") ||
    path.normalize(stateFilePath) !== stateFilePath
  ) {
    throw new Error("[start] bot.state_file must be a non-empty normalized file path");
  }
  return `${stateFilePath}.log`;
}

interface LogFile {
  write(data: string): Promise<unknown>;
  close(): Promise<void>;
}

async function openLogFile(filePath: string): Promise<LogFile> {
  // `resolveLogFilePath` is the path-validation boundary. Importing the
  // filesystem implementation here keeps every dynamic write behind it.
  const fileSystem = await import("node:fs/promises");
  await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
  return fileSystem.open(filePath, "a");
}

export function installConsoleRedirection(stream: LogFile): {
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly drain: () => Promise<void>;
} {
  const originalLog = console.log;
  const originalError = console.error;
  const pendingWrites: Promise<unknown>[] = [];
  const writeLine = (level: "log" | "error", arguments_: readonly unknown[]): void => {
    const message = arguments_
      .map((argument) => (typeof argument === "string" ? argument : JSON.stringify(argument)))
      .join(" ");
    const timestamp = new Date().toISOString();
    pendingWrites.push(stream.write(`${timestamp} [${level}] ${message}\n`));
  };
  console.log = (...arguments_: unknown[]): void => {
    writeLine("log", arguments_);
  };
  console.error = (...arguments_: unknown[]): void => {
    writeLine("error", arguments_);
  };
  return {
    log: originalLog,
    error: originalError,
    drain: async (): Promise<void> => {
      await Promise.allSettled(pendingWrites);
    },
  };
}

export function restoreConsoleRedirection(backup: {
  readonly log: typeof console.log;
  readonly error: typeof console.error;
}): void {
  console.log = backup.log;
  console.error = backup.error;
}

async function closeLogFile(stream: LogFile): Promise<void> {
  await stream.close();
}

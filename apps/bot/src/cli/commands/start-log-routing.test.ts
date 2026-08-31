import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Bot } from "../../bot/bot.js";
import {
  CLI_CONTEXT,
  DEFAULT_BOT_CONFIG,
  parsedArguments,
  rejectWith,
  waitUntil,
} from "./start-command.test-support.js";
import { createStartCommand, startCommand, type RuntimeLogger } from "./start.js";

const RUNTIME_CONFIG_PATH = "/external-runtime-root/config/default.toml";

function resolveRuntimeRoot(): {
  readonly ok: true;
  readonly runtimeRoot: string;
  readonly configPath: string;
} {
  return { ok: true, runtimeRoot: "/external-runtime-root", configPath: RUNTIME_CONFIG_PATH };
}

describe("start command boundary", () => {
  let temporaryDirectory: string;
  let originalStart: typeof Bot.prototype.start;
  let originalStop: typeof Bot.prototype.stop;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-crypto-bot-start-command-"));
    originalStart = Bot.prototype.start.bind(Bot.prototype);
    originalStop = Bot.prototype.stop.bind(Bot.prototype);
  });

  afterEach(() => {
    Bot.prototype.start = originalStart;
    Bot.prototype.stop = originalStop;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("rejects unknown options, malformed values, and positional arguments", async () => {
    const messages: string[] = [];
    const originalError = console.error.bind(console);
    console.error = (...values: unknown[]): void => {
      messages.push(values.map(String).join(" "));
    };
    try {
      const unknownOptionCode = await startCommand(
        parsedArguments(new Map([["mystery-option", true]])),
        CLI_CONTEXT,
      );
      const emptyConfigCode = await startCommand(parsedArguments(new Map([["config", true]])), CLI_CONTEXT);
      const invalidColorCode = await startCommand(
        parsedArguments(new Map([["color", "always"]])),
        CLI_CONTEXT,
      );
      const positionalCode = await startCommand(parsedArguments(new Map(), ["extra"]), CLI_CONTEXT);
      expect(unknownOptionCode).toBe(1);
      expect(emptyConfigCode).toBe(1);
      expect(invalidColorCode).toBe(1);
      expect(positionalCode).toBe(1);
    } finally {
      console.error = originalError;
    }
    expect(messages.some((message) => message.includes("Unknown start option"))).toBe(true);
    expect(messages.some((message) => message.includes("requires a non-empty path"))).toBe(true);
    expect(messages.some((message) => message.includes("does not accept a value"))).toBe(true);
    expect(messages.some((message) => message.includes("Unexpected start argument"))).toBe(true);
  });

  it("prints help and applies the no-color policy", async () => {
    const originalNoColor = process.env["NO_COLOR"];
    const originalError = console.error.bind(console);
    const messages: string[] = [];
    delete process.env["NO_COLOR"];
    console.error = (...values: unknown[]): void => {
      messages.push(values.map(String).join(" "));
    };
    try {
      const code = await startCommand(
        parsedArguments(
          new Map<string, string | boolean>([
            ["color", false],
            ["help", true],
          ]),
        ),
        CLI_CONTEXT,
      );
      expect(code).toBe(1);
      expect(process.env["NO_COLOR"]).toBe("1");
    } finally {
      console.error = originalError;
      if (originalNoColor === undefined) delete process.env["NO_COLOR"];
      else process.env["NO_COLOR"] = originalNoColor;
    }
    expect(messages.join("\n")).toContain("Usage: bun run apps/bot/src/index.ts start");
  });

  it("returns config and defensive runtime load errors with distinct sanitized exit codes", async () => {
    const invalidPath = path.join(temporaryDirectory, "invalid.toml");
    await Bun.write(invalidPath, "[bot]\nmystery_setting = true\n");
    const messages: string[] = [];
    const originalError = console.error.bind(console);
    console.error = (...values: unknown[]): void => {
      messages.push(values.map(String).join(" "));
    };
    try {
      const invalidConfigCode = await startCommand(
        parsedArguments(new Map([["config", invalidPath]])),
        CLI_CONTEXT,
      );
      expect(invalidConfigCode).toBe(2);

      class ThrowingConfigFlags extends Map<string, string | boolean> {
        public override get(key: string): string | boolean | undefined {
          if (key === "config") throw new Error("config lookup rejected");
          return super.get(key);
        }
      }
      const rejectedConfigCode = await startCommand(
        parsedArguments(new ThrowingConfigFlags([["config", "unused.toml"]])),
        CLI_CONTEXT,
      );
      expect(rejectedConfigCode).toBe(1);
    } finally {
      console.error = originalError;
    }
    expect(messages).toContain("[start] START_CONFIG_INVALID");
    expect(messages).toContain("[start] START_BOOTSTRAP_FAILED");
    expect(messages.join("\n")).not.toContain("config lookup rejected");
  });

  it("constructs and starts the configured bot on the normal path", async () => {
    const configPath = path.join(temporaryDirectory, "paper.toml");
    const stateFile = path.join(temporaryDirectory, "paper-state.json");
    await Bun.write(configPath, `[bot]\nstate_file = "${stateFile}"\n`);
    let starts = 0;
    Bot.prototype.start = (): Promise<void> => {
      starts += 1;
      return Promise.resolve();
    };
    Bot.prototype.stop = (): Promise<void> => Promise.resolve();

    const code = await startCommand(parsedArguments(new Map([["config", configPath]])), CLI_CONTEXT);
    expect(code).toBe(0);
    expect(starts).toBe(1);
  });

  it("uses the resolved runtime config path when --config is absent", async () => {
    const observedPaths: (string | undefined)[] = [];
    const command = createStartCommand({
      loadConfig: (path) => {
        observedPaths.push(path);
        return DEFAULT_BOT_CONFIG;
      },
      resolveRuntimeRoot,
      createBot: () => ({
        start: (): Promise<void> => Promise.resolve(),
        stop: (): Promise<void> => Promise.resolve(),
      }),
      run: (): Promise<number> => Promise.resolve(0),
    });
    expect(await command(parsedArguments(), CLI_CONTEXT)).toBe(0);
    expect(observedPaths).toEqual([RUNTIME_CONFIG_PATH]);
  });

  it("awaits logger shutdown and returns a deterministic failure for a standalone shutdown error", async () => {
    const shutdownGate = Promise.withResolvers<undefined>();
    let hasShutdownCompleted = false;
    const logger: RuntimeLogger = {
      debug: (): void => undefined,
      error: (): void => undefined,
      info: (): void => undefined,
      critical: (): void => undefined,
      shutdown: async (): Promise<void> => {
        await shutdownGate.promise;
        hasShutdownCompleted = true;
      },
      warn: (): void => undefined,
    };
    const command = createStartCommand({
      createBot: () => ({
        start: (): Promise<void> => Promise.resolve(),
        stop: (): Promise<void> => Promise.resolve(),
      }),
      createRuntimeLogger: () => logger,
      loadConfig: () => DEFAULT_BOT_CONFIG,
      resolveRuntimeRoot,
      run: (): Promise<number> => Promise.resolve(0),
    });

    const running = command(parsedArguments(), CLI_CONTEXT);
    await Bun.sleep(10);
    expect(hasShutdownCompleted).toBe(false);
    shutdownGate.resolve(undefined);
    expect(await running).toBe(0);
    expect(hasShutdownCompleted).toBe(true);

    const failedShutdownCommand = createStartCommand({
      createBot: () => ({
        start: (): Promise<void> => Promise.resolve(),
        stop: (): Promise<void> => Promise.resolve(),
      }),
      createRuntimeLogger: () => ({
        debug: (): void => undefined,
        error: (): void => undefined,
        info: (): void => undefined,
        critical: (): void => undefined,
        shutdown: (): Promise<never> => rejectWith(new Error("shutdown failed")),
        warn: (): void => undefined,
      }),
      loadConfig: () => DEFAULT_BOT_CONFIG,
      resolveRuntimeRoot,
      run: (): Promise<number> => Promise.resolve(0),
    });

    expect(await failedShutdownCommand(parsedArguments(), CLI_CONTEXT)).toBe(1);

    const nonzeroRunCommand = createStartCommand({
      createBot: () => ({
        start: (): Promise<void> => Promise.resolve(),
        stop: (): Promise<void> => Promise.resolve(),
      }),
      createRuntimeLogger: () => ({
        critical: (): void => undefined,
        debug: (): void => undefined,
        error: (): void => undefined,
        info: (): void => undefined,
        shutdown: (): Promise<never> => rejectWith(new Error("shutdown failed")),
        warn: (): void => undefined,
      }),
      loadConfig: () => DEFAULT_BOT_CONFIG,
      resolveRuntimeRoot,
      run: (): Promise<number> => Promise.resolve(23),
    });

    expect(await nonzeroRunCommand(parsedArguments(), CLI_CONTEXT)).toBe(23);
  });

  it("awaits logger shutdown when failure logging throws without masking the command failure", async () => {
    const shutdownGate = Promise.withResolvers<undefined>();
    let shutdownCalls = 0;
    let hasShutdownCompleted = false;
    const command = createStartCommand({
      createBot: () => ({
        start: (): Promise<void> => Promise.resolve(),
        stop: (): Promise<void> => Promise.resolve(),
      }),
      createRuntimeLogger: () => ({
        debug: (): void => undefined,
        error: (): never => {
          throw new Error("logger error failed");
        },
        info: (): void => undefined,
        critical: (): void => undefined,
        shutdown: async (): Promise<void> => {
          shutdownCalls += 1;
          await shutdownGate.promise;
          hasShutdownCompleted = true;
        },
        warn: (): void => undefined,
      }),
      loadConfig: () => DEFAULT_BOT_CONFIG,
      resolveRuntimeRoot,
      run: (): Promise<never> => rejectWith(new Error("command failed")),
    });

    const running = command(parsedArguments(), CLI_CONTEXT);
    await waitUntil(() => shutdownCalls === 1);
    expect(hasShutdownCompleted).toBe(false);
    shutdownGate.resolve(undefined);
    expect(await running).toBe(1);
    expect(hasShutdownCompleted).toBe(true);
    expect(shutdownCalls).toBe(1);
  });
  it("blocks live activation before credentials, logger, bot, runtime, or start side effects", async () => {
    const liveConfig = {
      ...DEFAULT_BOT_CONFIG,
      bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" as const },
    };
    const messages: string[] = [];
    const originalEnvironment = process.env;
    let credentialReads = 0;
    let loggerCreations = 0;
    let botCreations = 0;
    let runCalls = 0;
    const originalError = console.error.bind(console);
    const guardedEnvironment = new Proxy(process.env, {
      get: (target, property, receiver): unknown => {
        if (property === "BYBIT_API_KEY" || property === "BYBIT_API_SECRET") {
          credentialReads += 1;
          throw new Error("credential read is forbidden");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const command = createStartCommand({
      createBot: () => {
        botCreations += 1;
        return {
          start: (): Promise<void> => Promise.resolve(),
          stop: (): Promise<void> => Promise.resolve(),
        };
      },
      createRuntimeLogger: (): never => {
        loggerCreations += 1;
        throw new Error("logger construction is forbidden");
      },
      loadConfig: () => liveConfig,
      resolveRuntimeRoot,
      run: (): Promise<number> => {
        runCalls += 1;
        return Promise.resolve(0);
      },
    });
    console.error = (...values: unknown[]): void => {
      messages.push(values.map(String).join(" "));
    };
    process.env = guardedEnvironment;
    try {
      expect(await command(parsedArguments(), CLI_CONTEXT)).toBe(3);
    } finally {
      process.env = originalEnvironment;
      console.error = originalError;
    }
    expect(messages).toEqual(["[start] START_LIVE_ACTIVATION_UNAVAILABLE"]);
    expect(credentialReads).toBe(0);
    expect(loggerCreations).toBe(0);
    expect(botCreations).toBe(0);
    expect(runCalls).toBe(0);
  });

  it("fails before loading when an implicit runtime root is unavailable", async () => {
    let loadCalls = 0;
    const command = createStartCommand({
      createRuntimeLogger: (): never => {
        throw new Error("logger creation must not occur");
      },
      loadConfig: () => {
        loadCalls += 1;
        return DEFAULT_BOT_CONFIG;
      },
      resolveRuntimeRoot: () => ({
        ok: false,
        error: { code: "runtime-root-missing", message: "Runtime configuration root is unavailable." },
      }),
    });
    const originalError = console.error;
    console.error = (): void => undefined;
    try {
      expect(await command(parsedArguments(), CLI_CONTEXT)).toBe(2);
    } finally {
      console.error = originalError;
    }
    expect(loadCalls).toBe(0);
  });
});

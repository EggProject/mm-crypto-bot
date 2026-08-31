import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Bot } from "../../bot/bot.js";
import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";
import type { ParsedArgs as StartArguments } from "../argv.js";
import type { CliContext } from "../router.js";
import { createStartCommand, startCommand } from "./start.js";

const CLI_CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };

function startArguments(
  flags: ReadonlyMap<string, string | boolean> = new Map(),
  positional: readonly string[] = [],
): StartArguments {
  return { subcommand: "start", flags, positional };
}

function successfulBot(): Pick<Bot, "start" | "stop"> {
  return { start: (): Promise<void> => Promise.resolve(), stop: (): Promise<void> => Promise.resolve() };
}

function resolvedRuntimeRoot() {
  return {
    ok: true as const,
    runtimeRoot: "/var/lib/mm-bot",
    configPath: "/var/lib/mm-bot/config/default.toml",
  };
}

describe("start command boundary", () => {
  let temporaryDirectory: string;
  let startDescriptor: PropertyDescriptor | undefined;
  let stopDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-crypto-bot-start-command-"));
    startDescriptor = Object.getOwnPropertyDescriptor(Bot.prototype, "start");
    stopDescriptor = Object.getOwnPropertyDescriptor(Bot.prototype, "stop");
  });

  afterEach(() => {
    if (startDescriptor === undefined || stopDescriptor === undefined) {
      throw new Error("Bot lifecycle descriptors are unavailable");
    }
    Object.defineProperties(Bot.prototype, { start: startDescriptor, stop: stopDescriptor });
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("rejects unknown options, malformed values, and positional arguments", async () => {
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]): void => {
      messages.push(values.map(String).join(" "));
    };
    try {
      const unknownOption = await startCommand(
        startArguments(new Map([["mystery-option", true]])),
        CLI_CONTEXT,
      );
      const malformedConfig = await startCommand(startArguments(new Map([["config", true]])), CLI_CONTEXT);
      const malformedColor = await startCommand(startArguments(new Map([["color", "always"]])), CLI_CONTEXT);
      const unexpectedPositional = await startCommand(startArguments(new Map(), ["extra"]), CLI_CONTEXT);
      expect([unknownOption, malformedConfig, malformedColor, unexpectedPositional]).toEqual([1, 1, 1, 1]);
    } finally {
      console.error = originalError;
    }
    const combinedMessages = messages.join("\n");
    expect(combinedMessages).toContain("Unknown start option");
    expect(combinedMessages).toContain("requires a non-empty path");
    expect(combinedMessages).toContain("does not accept a value");
    expect(combinedMessages).toContain("Unexpected start argument");
  });

  it("prints help and applies the no-color policy", async () => {
    const originalNoColor = process.env["NO_COLOR"];
    const originalError = console.error;
    const messages: string[] = [];
    delete process.env["NO_COLOR"];
    console.error = (...values: unknown[]): void => {
      messages.push(values.map(String).join(" "));
    };
    try {
      const code = await startCommand(
        startArguments(
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
    expect(messages.join("\n")).toContain("MM_CRYPTO_BOT_RUNTIME_ROOT");
  });

  it("returns config and defensive runtime load errors with distinct exit codes", async () => {
    const invalidPath = path.join(temporaryDirectory, "invalid.toml");
    await Bun.write(invalidPath, "[bot]\nmystery_setting = true\n");
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]): void => {
      messages.push(values.map(String).join(" "));
    };
    try {
      const invalidArguments = startArguments(new Map([["config", invalidPath]]));
      const invalidExitCode = await startCommand(invalidArguments, CLI_CONTEXT);
      expect(invalidExitCode).toBe(2);

      class ThrowingConfigFlags extends Map<string, string | boolean> {
        public override get(key: string): string | boolean | undefined {
          if (key === "config") throw new Error("config lookup rejected");
          return super.get(key);
        }
      }
      const throwingArguments = startArguments(new ThrowingConfigFlags([["config", "unused.toml"]]));
      expect(await startCommand(throwingArguments, CLI_CONTEXT)).toBe(1);
    } finally {
      console.error = originalError;
    }
    expect(messages.join("\n")).toContain("[start] START_CONFIG_INVALID");
    expect(messages.join("\n")).toContain("[start] START_BOOTSTRAP_FAILED");
  });

  it("fails closed when the public runtime-logger factory rejects", async () => {
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]): void => {
      messages.push(values.map(String).join(" "));
    };
    try {
      const command = createStartCommand({
        createRuntimeLogger: () => {
          throw new Error("logger unavailable");
        },
        loadConfig: () => DEFAULT_BOT_CONFIG,
      });
      const commandArguments = startArguments(new Map([["config", "/external/config.toml"]]));
      expect(await command(commandArguments, CLI_CONTEXT)).toBe(1);
    } finally {
      console.error = originalError;
    }
    expect(messages).toEqual(["[start] START_BOOTSTRAP_FAILED"]);
  });

  it("constructs and starts the configured bot on the normal path", async () => {
    const configPath = path.join(temporaryDirectory, "paper.toml");
    const stateFile = path.join(temporaryDirectory, "paper-state.json");
    await Bun.write(configPath, `[bot]\nstate_file = "${stateFile}"\n`);
    let startCalls = 0;
    Object.defineProperties(Bot.prototype, {
      start: {
        configurable: true,
        value: (): Promise<void> =>
          Promise.try(() => {
            startCalls += 1;
          }),
      },
      stop: {
        configurable: true,
        value: (): Promise<void> => Promise.resolve(),
      },
    });

    const normalArguments = startArguments(new Map([["config", configPath]]));
    const normalExitCode = await startCommand(normalArguments, CLI_CONTEXT);
    expect(normalExitCode).toBe(0);
    expect(startCalls).toBe(1);
    expect(await Bun.file(`${stateFile}.log`).exists()).toBe(false);
  });

  it("blocks live activation before reading credentials or starting the runtime", async () => {
    const stateFile = path.join(temporaryDirectory, "live-state.json");
    const configPath = path.join(temporaryDirectory, "live.toml");
    await Bun.write(configPath, `[bot]\nmode = "live"\nstate_file = "${stateFile}"\n`);
    const stderrLines: string[] = [];
    const originalError = console.error;
    const environmentDescriptor = Object.getOwnPropertyDescriptor(process, "env");
    if (environmentDescriptor === undefined) throw new Error("process.env descriptor is unavailable");
    let botFactoryCalls = 0;
    let runCalls = 0;
    let apiKeyReads = 0;
    let apiSecretReads = 0;
    const command = createStartCommand({
      createBot: () => {
        botFactoryCalls += 1;
        return successfulBot();
      },
      run: (): Promise<number> => {
        runCalls += 1;
        return Promise.resolve(0);
      },
    });
    console.error = (...values: unknown[]): void => {
      stderrLines.push(values.map(String).join(" "));
    };
    const guardedEnvironment = new Proxy(process.env, {
      get: (target, property, receiver): unknown => {
        if (property === "BUN_ENV") return undefined;
        if (property === "BYBIT_API_KEY") {
          apiKeyReads += 1;
          throw new Error("credential read is forbidden");
        }
        if (property === "BYBIT_API_SECRET") {
          apiSecretReads += 1;
          throw new Error("credential read is forbidden");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    Object.defineProperty(process, "env", { ...environmentDescriptor, value: guardedEnvironment });
    try {
      const liveArguments = startArguments(new Map([["config", configPath]]));
      const liveExitCode = await command(liveArguments, CLI_CONTEXT);
      expect(liveExitCode).toBe(3);
    } finally {
      Object.defineProperty(process, "env", environmentDescriptor);
      console.error = originalError;
    }

    expect(stderrLines).toEqual(["[start] START_LIVE_ACTIVATION_UNAVAILABLE"]);
    expect(apiKeyReads).toBe(0);
    expect(apiSecretReads).toBe(0);
    expect(botFactoryCalls).toBe(0);
    expect(runCalls).toBe(0);
    expect(await Bun.file(`${stateFile}.log`).exists()).toBe(false);
  });

  it("uses the resolved runtime config path when --config is absent", async () => {
    const observedPaths: string[] = [];
    const command = createStartCommand({
      loadConfig: (configPath) => {
        if (configPath !== undefined) observedPaths.push(configPath);
        return DEFAULT_BOT_CONFIG;
      },
      resolveRuntimeRoot: resolvedRuntimeRoot,
      createBot: successfulBot,
      run: (): Promise<number> => Promise.resolve(0),
    });
    expect(await command(startArguments(), CLI_CONTEXT)).toBe(0);
    expect(observedPaths).toEqual(["/var/lib/mm-bot/config/default.toml"]);
  });

  it("keeps an explicit config path without resolving the runtime root", async () => {
    let rootResolutions = 0;
    let loadedPath = "";
    const command = createStartCommand({
      loadConfig: (configPath) => {
        loadedPath = configPath ?? "";
        return DEFAULT_BOT_CONFIG;
      },
      resolveRuntimeRoot: () => {
        rootResolutions += 1;
        return {
          ok: false,
          error: { code: "runtime-root-missing", message: "Runtime configuration root is unavailable." },
        };
      },
      createBot: successfulBot,
      run: (): Promise<number> => Promise.resolve(0),
    });

    const explicitArguments = startArguments(new Map([["config", "/etc/mm-bot.toml"]]));
    const explicitExitCode = await command(explicitArguments, CLI_CONTEXT);
    expect(explicitExitCode).toBe(0);
    expect(rootResolutions).toBe(0);
    expect(loadedPath).toBe("/etc/mm-bot.toml");
  });

  it("fails before loading or starting when the runtime root is unavailable", async () => {
    let loadCalls = 0;
    let botFactoryCalls = 0;
    let runCalls = 0;
    const command = createStartCommand({
      loadConfig: () => {
        loadCalls += 1;
        return DEFAULT_BOT_CONFIG;
      },
      createBot: () => {
        botFactoryCalls += 1;
        return successfulBot();
      },
      resolveRuntimeRoot: () => ({
        ok: false,
        error: { code: "runtime-root-missing", message: "Runtime configuration root is unavailable." },
      }),
      run: (): Promise<number> => {
        runCalls += 1;
        return Promise.resolve(0);
      },
    });
    const originalError = console.error;
    console.error = (...values: unknown[]): void => {
      void values.length;
    };

    try {
      expect(await command(startArguments(), CLI_CONTEXT)).toBe(2);
    } finally {
      console.error = originalError;
    }
    expect(loadCalls).toBe(0);
    expect(botFactoryCalls).toBe(0);
    expect(runCalls).toBe(0);
  });

  it("renders Error loader failures through the command boundary", async () => {
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]): void => {
      messages.push(values.map(String).join(" "));
    };
    const command = createStartCommand({
      loadConfig: () => {
        throw new Error("loader Error");
      },
      resolveRuntimeRoot: resolvedRuntimeRoot,
    });
    try {
      expect(await command(startArguments(), CLI_CONTEXT)).toBe(1);
    } finally {
      console.error = originalError;
    }
    expect(messages.join("\n")).toContain("[start] START_BOOTSTRAP_FAILED");
  });

  it("renders non-Error config-flag and loader failures through the command boundary", async () => {
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]): void => {
      messages.push(values.map(String).join(" "));
    };
    class ThrowingConfigFlags extends Map<string, string | boolean> {
      public override get(key: string): string | boolean | undefined {
        if (key === "config") {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercises the untrusted parsed-argument boundary.
          throw "flag hostile";
        }
        return super.get(key);
      }
    }
    const command = createStartCommand({
      loadConfig: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercises the untrusted configuration dependency boundary.
        throw "loader hostile";
      },
      resolveRuntimeRoot: resolvedRuntimeRoot,
    });
    try {
      const flags = new ThrowingConfigFlags([["config", "unused"]]);
      const flagFailureCode = await command(startArguments(flags), CLI_CONTEXT);
      expect(flagFailureCode).toBe(1);
      expect(await command(startArguments(), CLI_CONTEXT)).toBe(1);
    } finally {
      console.error = originalError;
    }
    expect(messages.join("\n")).toContain("[start] START_BOOTSTRAP_FAILED");
  });
});

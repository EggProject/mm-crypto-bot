import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Bot } from "../../bot/bot.js";
import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";
import type { BotConfig } from "../../config/schema.js";
import type { ParsedArgs } from "../argv.js";
import type { CliContext } from "../router.js";
import {
  installConsoleRedirection,
  createStartCommand,
  resolveLogFilePath,
  restoreConsoleRedirection,
  runHeadless,
  startCommand,
} from "./start.js";

const CLI_CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };

function configWithStateFile(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile },
  };
}

function parsedArgs(
  flags: ReadonlyMap<string, string | boolean> = new Map(),
  positional: readonly string[] = [],
): ParsedArgs {
  return { subcommand: "start", flags, positional };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for test condition");
    await Bun.sleep(5);
  }
}

describe("headless log-path boundary", () => {
  it("derives the adjacent log path for relative and absolute state files", () => {
    expect(resolveLogFilePath(configWithStateFile("data/bot-state.json"))).toBe("data/bot-state.json.log");
    expect(resolveLogFilePath(configWithStateFile("/var/lib/mm-crypto-bot/state.json"))).toBe(
      "/var/lib/mm-crypto-bot/state.json.log",
    );
    expect(resolveLogFilePath(configWithStateFile("bot-state"))).toBe("bot-state.log");
  });

  it("rejects empty, non-normalized, and null-byte paths before filesystem access", () => {
    expect(() => resolveLogFilePath(configWithStateFile(""))).toThrow(/normalized file path/);
    expect(() => resolveLogFilePath(configWithStateFile("data/../state.json"))).toThrow(
      /normalized file path/,
    );
    expect(() => resolveLogFilePath(configWithStateFile("data/\0state.json"))).toThrow(
      /normalized file path/,
    );
  });
});

describe("headless console redirection", () => {
  it("captures strings, errors, and structured values and restores console methods", async () => {
    const writes: string[] = [];
    const stream = {
      write: async (data: string): Promise<void> => {
        writes.push(data);
      },
      close: async (): Promise<void> => undefined,
    };
    const originalLog = console.log;
    const originalError = console.error;
    const backup = installConsoleRedirection(stream);
    try {
      console.log("hello world");
      console.error("oh no");
      console.log({ structured: "object" });
    } finally {
      restoreConsoleRedirection(backup);
    }
    await backup.drain();

    expect(console.log).toBe(originalLog);
    expect(console.error).toBe(originalError);
    expect(writes.join("")).toContain("[log] hello world");
    expect(writes.join("")).toContain("[error] oh no");
    expect(writes.join("")).toContain('[log] {"structured":"object"}');
  });

  it("settles rejected writes while draining so shutdown can still close the file", async () => {
    const backup = installConsoleRedirection({
      write: async (): Promise<never> => Promise.reject(new Error("disk unavailable")),
      close: async (): Promise<void> => undefined,
    });
    try {
      console.error("cannot persist");
    } finally {
      restoreConsoleRedirection(backup);
    }
    await expect(backup.drain()).resolves.toBeUndefined();
  });
});

describe("headless lifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-crypto-bot-headless-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns zero after a normal start completion without requesting stop", async () => {
    let starts = 0;
    let stops = 0;
    const code = await runHeadless(
      {
        start: async (): Promise<void> => {
          starts += 1;
          console.log("normal completion");
        },
        stop: async (): Promise<void> => {
          stops += 1;
        },
      },
      configWithStateFile(join(tmpDir, "normal.json")),
    );

    expect(code).toBe(0);
    expect(starts).toBe(1);
    expect(stops).toBe(0);
    expect(await Bun.file(join(tmpDir, "normal.json.log")).text()).toContain("normal completion");
  });

  it("returns one and records Error and non-Error startup failures", async () => {
    for (const failure of [new Error("startup exploded"), "startup rejected"] as const) {
      const stateFile = join(tmpDir, `${typeof failure}.json`);
      const code = await runHeadless(
        {
          start: async (): Promise<never> => Promise.reject(failure),
          stop: async (): Promise<void> => undefined,
        },
        configWithStateFile(stateFile),
      );
      expect(code).toBe(1);
      expect(await Bun.file(`${stateFile}.log`).text()).toContain(
        typeof failure === "string" ? failure : failure.message,
      );
    }
  });

  it("stores one shutdown promise, ignores a second signal, and awaits cleanup before return", async () => {
    const startGate = Promise.withResolvers<undefined>();
    const stopGate = Promise.withResolvers<undefined>();
    const baselineTermListeners = process.listenerCount("SIGTERM");
    let stops = 0;
    let cleanupFinished = false;

    const running = runHeadless(
      {
        start: async (): Promise<void> => startGate.promise,
        stop: async (): Promise<void> => {
          stops += 1;
          await stopGate.promise;
          cleanupFinished = true;
        },
      },
      configWithStateFile(join(tmpDir, "signal.json")),
    );

    await waitUntil(() => process.listenerCount("SIGTERM") > baselineTermListeners);
    process.emit("SIGTERM", "SIGTERM");
    process.emit("SIGINT", "SIGINT");
    await waitUntil(() => stops === 1);
    startGate.resolve(undefined);

    let returned = false;
    void running.then(() => {
      returned = true;
    });
    await Bun.sleep(10);
    expect(returned).toBe(false);
    expect(cleanupFinished).toBe(false);

    stopGate.resolve(undefined);
    expect(await running).toBe(0);
    expect(stops).toBe(1);
    expect(cleanupFinished).toBe(true);
    expect(process.listenerCount("SIGTERM")).toBe(baselineTermListeners);
  });

  it("settles and logs a rejected shutdown before returning", async () => {
    for (const failure of [new Error("stop Error"), "stop rejected"] as const) {
      const startGate = Promise.withResolvers<undefined>();
      const baselineTermListeners = process.listenerCount("SIGTERM");
      const stateFile = join(tmpDir, `failed-stop-${typeof failure}.json`);
      const running = runHeadless(
        {
          start: async (): Promise<void> => startGate.promise,
          stop: async (): Promise<never> => Promise.reject(failure),
        },
        configWithStateFile(stateFile),
      );

      await waitUntil(() => process.listenerCount("SIGTERM") > baselineTermListeners);
      process.emit("SIGTERM", "SIGTERM");
      startGate.resolve(undefined);
      expect(await running).toBe(1);
      expect(await Bun.file(`${stateFile}.log`).text()).toContain(
        typeof failure === "string" ? failure : failure.message,
      );
    }
  });
});

describe("start command boundary", () => {
  let tmpDir: string;
  let originalStart: typeof Bot.prototype.start;
  let originalStop: typeof Bot.prototype.stop;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-crypto-bot-start-command-"));
    originalStart = Bot.prototype.start;
    originalStop = Bot.prototype.stop;
  });

  afterEach(() => {
    Bot.prototype.start = originalStart;
    Bot.prototype.stop = originalStop;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects unknown options, malformed values, and positional arguments", async () => {
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]): void => {
      messages.push(values.join(" "));
    };
    try {
      expect(await startCommand(parsedArgs(new Map([["mystery-option", true]])), CLI_CONTEXT)).toBe(1);
      expect(await startCommand(parsedArgs(new Map([["config", true]])), CLI_CONTEXT)).toBe(1);
      expect(await startCommand(parsedArgs(new Map([["color", "always"]])), CLI_CONTEXT)).toBe(1);
      expect(await startCommand(parsedArgs(new Map(), ["extra"]), CLI_CONTEXT)).toBe(1);
    } finally {
      console.error = originalError;
    }
    expect(messages).toContainEqual(expect.stringContaining("Unknown start option"));
    expect(messages).toContainEqual(expect.stringContaining("requires a non-empty path"));
    expect(messages).toContainEqual(expect.stringContaining("does not accept a value"));
    expect(messages).toContainEqual(expect.stringContaining("Unexpected start argument"));
  });

  it("prints help and applies the no-color policy", async () => {
    const originalNoColor = process.env["NO_COLOR"];
    const originalError = console.error;
    const messages: string[] = [];
    delete process.env["NO_COLOR"];
    console.error = (...values: unknown[]): void => {
      messages.push(values.join(" "));
    };
    try {
      const code = await startCommand(
        parsedArgs(
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

  it("returns config and defensive runtime load errors with distinct exit codes", async () => {
    const invalidPath = join(tmpDir, "invalid.toml");
    await Bun.write(invalidPath, "[bot]\nmystery_setting = true\n");
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]): void => {
      messages.push(values.join(" "));
    };
    try {
      expect(await startCommand(parsedArgs(new Map([["config", invalidPath]])), CLI_CONTEXT)).toBe(2);

      class ThrowingConfigFlags extends Map<string, string | boolean> {
        public override get(key: string): string | boolean | undefined {
          if (key === "config") throw "config lookup rejected";
          return super.get(key);
        }
      }
      expect(
        await startCommand(parsedArgs(new ThrowingConfigFlags([["config", "unused.toml"]])), CLI_CONTEXT),
      ).toBe(1);
    } finally {
      console.error = originalError;
    }
    expect(messages.join("\n")).toContain("Config validation FAILED");
    expect(messages.join("\n")).toContain("bot");
    expect(messages.join("\n")).toContain("config lookup rejected");
  });

  it("constructs and starts the configured bot on the normal path", async () => {
    const configPath = join(tmpDir, "paper.toml");
    const stateFile = join(tmpDir, "paper-state.json");
    await Bun.write(configPath, `[bot]\nstate_file = "${stateFile}"\n`);
    let starts = 0;
    Bot.prototype.start = async (): Promise<void> => {
      starts += 1;
    };
    Bot.prototype.stop = async (): Promise<void> => undefined;

    expect(await startCommand(parsedArgs(new Map([["config", configPath]])), CLI_CONTEXT)).toBe(0);
    expect(starts).toBe(1);
    expect(await Bun.file(`${stateFile}.log`).exists()).toBe(true);
  });

  it("warns before starting a live configuration without credentials", async () => {
    const configPath = join(tmpDir, "live.toml");
    const stateFile = join(tmpDir, "live-state.json");
    await Bun.write(configPath, `[bot]\nmode = "live"\nstate_file = "${stateFile}"\n`);
    const originalKey = process.env["BYBIT_API_KEY"];
    const originalWarn = console.warn;
    const warnings: string[] = [];
    delete process.env["BYBIT_API_KEY"];
    console.warn = (...values: unknown[]): void => {
      warnings.push(values.join(" "));
    };
    Bot.prototype.start = async (): Promise<void> => undefined;
    Bot.prototype.stop = async (): Promise<void> => undefined;
    try {
      expect(await startCommand(parsedArgs(new Map([["config", configPath]])), CLI_CONTEXT)).toBe(0);
    } finally {
      console.warn = originalWarn;
      if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
      else process.env["BYBIT_API_KEY"] = originalKey;
    }
    expect(warnings.join("\n")).toContain("BYBIT_API_KEY is not set");
  });

  it("uses the default config path when --config is absent", async () => {
    const observedPaths: (string | undefined)[] = [];
    const command = createStartCommand({
      loadConfig: (path) => {
        observedPaths.push(path);
        return DEFAULT_BOT_CONFIG;
      },
      createBot: () => ({ start: async () => undefined, stop: async () => undefined }),
      run: async () => 0,
    });
    expect(await command(parsedArgs(), CLI_CONTEXT)).toBe(0);
    expect(observedPaths).toEqual([undefined]);
  });

  it("renders Error loader failures through the command boundary", async () => {
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]): void => {
      messages.push(values.join(" "));
    };
    const command = createStartCommand({
      loadConfig: () => {
        throw new Error("loader Error");
      },
    });
    try {
      expect(await command(parsedArgs(), CLI_CONTEXT)).toBe(1);
    } finally {
      console.error = originalError;
    }
    expect(messages.join("\n")).toContain("loader Error");
  });

  it("warns only for an empty live API key", async () => {
    const originalKey = process.env["BYBIT_API_KEY"];
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...values: unknown[]): void => {
      warnings.push(values.join(" "));
    };
    const liveConfig: BotConfig = { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" } };
    const command = createStartCommand({
      loadConfig: () => liveConfig,
      createBot: () => ({ start: async () => undefined, stop: async () => undefined }),
      run: async () => 0,
    });
    try {
      process.env["BYBIT_API_KEY"] = "";
      expect(await command(parsedArgs(), CLI_CONTEXT)).toBe(0);
      expect(warnings.join("\n")).toContain("BYBIT_API_KEY is not set");
      warnings.length = 0;
      process.env["BYBIT_API_KEY"] = "present";
      expect(await command(parsedArgs(), CLI_CONTEXT)).toBe(0);
      expect(warnings).toHaveLength(0);
    } finally {
      console.warn = originalWarn;
      if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
      else process.env["BYBIT_API_KEY"] = originalKey;
    }
  });
});

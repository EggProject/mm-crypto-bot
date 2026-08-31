import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_BOT_CONFIG, loadBotConfig } from "../../config/index.js";
import type { ParsedArgs as ParsedArguments } from "../argv.js";
import type { CliContext } from "../router.js";
import { createStartCommand, type RuntimeLogger } from "./start.js";

const CLI_CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };

function startArguments(configPath?: string): ParsedArguments {
  return {
    flags: configPath === undefined ? new Map() : new Map([["config", configPath]]),
    positional: [],
    subcommand: "start",
  };
}

function runtimeLogger(): RuntimeLogger {
  return {
    critical: (): void => undefined,
    debug: (): void => undefined,
    error: (): void => undefined,
    info: (): void => undefined,
    shutdown: (): Promise<void> => Promise.resolve(),
    warn: (): void => undefined,
  };
}

function environmentRejectingCredentialReads(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const credentialName of ["BYBIT_API_KEY", "BYBIT_API_SECRET"] as const) {
    Object.defineProperty(environment, credentialName, {
      get: (): never => {
        throw new Error(`credential access is forbidden: ${credentialName}`);
      },
    });
  }
  return environment;
}

describe("start live activation boundary", () => {
  let directory: string;
  let originalApiKey: string | undefined;
  let originalApiSecret: string | undefined;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "mm-crypto-bot-live-start-"));
    originalApiKey = process.env["BYBIT_API_KEY"];
    originalApiSecret = process.env["BYBIT_API_SECRET"];
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env["BYBIT_API_KEY"];
    else process.env["BYBIT_API_KEY"] = originalApiKey;
    if (originalApiSecret === undefined) delete process.env["BYBIT_API_SECRET"];
    else process.env["BYBIT_API_SECRET"] = originalApiSecret;
    rmSync(directory, { force: true, recursive: true });
  });

  it("blocks an explicit live TOML before bot, logger, or runtime construction", async () => {
    const configPath = path.join(directory, "explicit-live.toml");
    await Bun.write(configPath, '[bot]\nmode = "live"\n');
    process.env["BYBIT_API_KEY"] = "plausible-api-key";
    process.env["BYBIT_API_SECRET"] = "plausible-api-secret";

    let botCreations = 0;
    let loggerCreations = 0;
    let runs = 0;
    const messages: string[] = [];
    const originalError = console.error.bind(console);
    const command = createStartCommand({
      createBot: () => {
        botCreations += 1;
        return {
          start: (): Promise<void> => Promise.resolve(),
          stop: (): Promise<void> => Promise.resolve(),
        };
      },
      createRuntimeLogger: () => {
        loggerCreations += 1;
        return runtimeLogger();
      },
      loadConfig: (requestedPath) => loadBotConfig(requestedPath, environmentRejectingCredentialReads()),
      run: (): Promise<number> => {
        runs += 1;
        return Promise.resolve(0);
      },
    });
    console.error = (...values: unknown[]): void => {
      messages.push(values.map(String).join(" "));
    };
    try {
      expect(await command(startArguments(configPath), CLI_CONTEXT)).toBe(3);
    } finally {
      console.error = originalError;
    }

    expect(botCreations).toBe(0);
    expect(loggerCreations).toBe(0);
    expect(runs).toBe(0);
    expect(messages).toEqual(["[start] START_LIVE_ACTIVATION_UNAVAILABLE"]);
    expect(messages.join("\n")).not.toContain("plausible-api-secret");
  });

  it("keeps paper startup dependency injection operational", async () => {
    let botCreations = 0;
    let loggerCreations = 0;
    let runs = 0;
    const command = createStartCommand({
      createBot: () => {
        botCreations += 1;
        return {
          start: (): Promise<void> => Promise.resolve(),
          stop: (): Promise<void> => Promise.resolve(),
        };
      },
      createRuntimeLogger: () => {
        loggerCreations += 1;
        return runtimeLogger();
      },
      loadConfig: () => DEFAULT_BOT_CONFIG,
      run: (): Promise<number> => {
        runs += 1;
        return Promise.resolve(0);
      },
    });

    expect(await command(startArguments(), CLI_CONTEXT)).toBe(0);
    expect(botCreations).toBe(1);
    expect(loggerCreations).toBe(1);
    expect(runs).toBe(1);
  });
});

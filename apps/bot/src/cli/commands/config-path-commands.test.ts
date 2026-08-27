import { describe, expect, it } from "bun:test";

import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";
import type { BotConfig } from "../../config/schema.js";
import { parseArgv } from "../argv.js";
import type { CliContext, SubcommandHandler } from "../router.js";

import { createKillSwitchesCommand } from "./kill-switches.js";
import { createConfigCommand } from "./config.js";
import { createStatusCommand } from "./status.js";
import { createStrategiesCommand } from "./strategies.js";
import { createTradesCommand } from "./trades.js";

const CLI_CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };

interface ConfigPathCommandDependencies {
  readonly loadConfig: (path: string | undefined) => BotConfig;
  readonly resolveRuntimeRoot: () => {
    readonly ok: false;
    readonly error: {
      readonly code: "runtime-root-missing";
      readonly message: "Runtime configuration root is unavailable.";
    };
  };
}

interface ConfigPathCommandCase {
  readonly name: "status" | "trades" | "strategies" | "kill-switches";
  readonly create: (overrides: ConfigPathCommandDependencies) => SubcommandHandler;
}

const commandCases: readonly ConfigPathCommandCase[] = [
  { name: "status", create: (overrides) => createStatusCommand(overrides) },
  { name: "trades", create: (overrides) => createTradesCommand(overrides) },
  { name: "strategies", create: (overrides) => createStrategiesCommand(overrides) },
  { name: "kill-switches", create: (overrides) => createKillSwitchesCommand(overrides) },
];

async function withMutedConsole(action: () => Promise<void>): Promise<void> {
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (): void => {
    void 0;
  };
  console.log = (): void => {
    void 0;
  };
  try {
    await action();
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
}

describe("read-only config command path admission", () => {
  for (const commandCase of commandCases) {
    it(`keeps an explicit config path for ${commandCase.name} without resolving the runtime root`, async () => {
      let loadedPath = "";
      let rootResolutions = 0;
      const command = commandCase.create({
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
      });

      await withMutedConsole(async () => {
        await command(parseArgv([commandCase.name, "--config=/etc/mm-bot.toml"]), CLI_CONTEXT);
      });

      expect(rootResolutions).toBe(0);
      expect(loadedPath).toBe("/etc/mm-bot.toml");
    });

    it(`fails ${commandCase.name} before loading config when the runtime root is unavailable`, async () => {
      let loadCalls = 0;
      const command = commandCase.create({
        loadConfig: () => {
          loadCalls += 1;
          return DEFAULT_BOT_CONFIG;
        },
        resolveRuntimeRoot: () => ({
          ok: false,
          error: { code: "runtime-root-missing", message: "Runtime configuration root is unavailable." },
        }),
      });
      let code = -1;

      await withMutedConsole(async () => {
        code = await command(parseArgv([commandCase.name]), CLI_CONTEXT);
      });

      expect(code).toBe(2);
      expect(loadCalls).toBe(0);
    });
  }
});

describe("config command runtime path admission", () => {
  it("fails show and init before either loader or writer when the runtime root is unavailable", async () => {
    let loadCalls = 0;
    let initCalls = 0;
    const command = createConfigCommand({
      loadConfig: () => {
        loadCalls += 1;
        return DEFAULT_BOT_CONFIG;
      },
      initConfig: () => {
        initCalls += 1;
        return 0;
      },
      resolveRuntimeRoot: () => ({
        ok: false,
        error: { code: "runtime-root-missing", message: "Runtime configuration root is unavailable." },
      }),
    });
    await withMutedConsole(async () => {
      expect(await command(parseArgv(["config", "validate"]), CLI_CONTEXT)).toBe(2);
      expect(await command(parseArgv(["config", "show"]), CLI_CONTEXT)).toBe(2);
      expect(await command(parseArgv(["config", "init", "--out=/tmp/config.toml"]), CLI_CONTEXT)).toBe(2);
    });
    expect(loadCalls).toBe(0);
    expect(initCalls).toBe(0);
  });
});

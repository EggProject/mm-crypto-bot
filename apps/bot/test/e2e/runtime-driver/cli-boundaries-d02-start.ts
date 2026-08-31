import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgv } from "../../../src/cli/argv.js";
import { createStartCommand, runHeadless, type RuntimeLogger } from "../../../src/cli/commands/start.js";
import type { CliContext } from "../../../src/cli/router.js";
import { ConfigError, DEFAULT_BOT_CONFIG } from "../../../src/config/index.js";

import { assertCondition, quietLogger, RecordingLogger } from "./runtime-driver-core.js";

const CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };
const ROOT = { ok: true as const, runtimeRoot: "/external", configPath: "/external/config/default.toml" };
const MISSING_ROOT = {
  ok: false as const,
  error: {
    code: "runtime-root-missing" as const,
    message: "Runtime configuration root is unavailable." as const,
  },
};
const RUNTIME_LOGGER: RuntimeLogger = {
  ...quietLogger,
  shutdown: () => Promise.resolve(),
};

class TestRuntimeLogger extends RecordingLogger implements RuntimeLogger {
  public constructor(private readonly shutdownOperation: () => Promise<void> = () => Promise.resolve()) {
    super();
  }

  public shutdown(): Promise<void> {
    return this.shutdownOperation();
  }
}

class ThrowingFlags extends Map<string, string | boolean> {
  public constructor(private readonly failure: unknown) {
    super();
  }

  public override get(key: string): string | boolean | undefined {
    if (key === "config") throw this.failure;
    return undefined;
  }
}

async function withMutedConsole(action: () => Promise<void>): Promise<void> {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (): void => undefined;
  console.error = (): void => undefined;
  try {
    await action();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

export async function runCliD02StartBoundaries(): Promise<void> {
  await withMutedConsole(async () => {
    const previousNoColor = process.env["NO_COLOR"];
    delete process.env["NO_COLOR"];
    const command = createStartCommand({
      loadConfig: () => DEFAULT_BOT_CONFIG,
      createBot: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
      createRuntimeLogger: () => RUNTIME_LOGGER,
      resolveRuntimeRoot: () => ROOT,
      run: () => Promise.resolve(0),
    });
    assertCondition(
      (await command(parseArgv(["start"]), CONTEXT)) === 0,
      "start did not invoke injected run",
    );
    assertCondition(
      (await command(parseArgv(["start", "--help", "--no-color"]), CONTEXT)) === 1,
      "start help returned wrong exit",
    );
    if (previousNoColor === undefined) delete process.env["NO_COLOR"];
    else process.env["NO_COLOR"] = previousNoColor;
    assertCondition(
      (await command(parseArgv(["start", "--unknown"]), CONTEXT)) === 1,
      "start accepted unknown option",
    );
    assertCondition(
      (await command(parseArgv(["start", "argument"]), CONTEXT)) === 1,
      "start accepted positional argument",
    );
    const missing = createStartCommand({
      createRuntimeLogger: () => RUNTIME_LOGGER,
      resolveRuntimeRoot: () => MISSING_ROOT,
    });
    assertCondition(
      (await missing(parseArgv(["start"]), CONTEXT)) === 2,
      "start accepted missing runtime root",
    );
    for (const failure of [new Error("unavailable"), "unavailable"]) {
      const hostileArguments = { subcommand: "start", flags: new ThrowingFlags(failure), positional: [] };
      assertCondition(
        (await command(hostileArguments, CONTEXT)) === 1,
        "start did not map hostile flag access",
      );
    }
    const invalid = createStartCommand({
      loadConfig: () => {
        throw new ConfigError("invalid", "bot", []);
      },
      createRuntimeLogger: () => RUNTIME_LOGGER,
      resolveRuntimeRoot: () => ROOT,
    });
    assertCondition((await invalid(parseArgv(["start"]), CONTEXT)) === 2, "start did not map config error");
    const hostile = createStartCommand({
      loadConfig: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- The injected hostile boundary may throw unknown values.
        throw "unavailable";
      },
      createRuntimeLogger: () => RUNTIME_LOGGER,
      resolveRuntimeRoot: () => ROOT,
    });
    assertCondition((await hostile(parseArgv(["start"]), CONTEXT)) === 1, "start did not map hostile error");
    const unexpected = createStartCommand({
      loadConfig: () => {
        throw new Error("unavailable");
      },
      createRuntimeLogger: () => RUNTIME_LOGGER,
      resolveRuntimeRoot: () => ROOT,
    });
    assertCondition(
      (await unexpected(parseArgv(["start"]), CONTEXT)) === 1,
      "start did not map Error failure",
    );
    const live = createStartCommand({
      loadConfig: () => ({ ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" } }),
      createRuntimeLogger: () => RUNTIME_LOGGER,
      resolveRuntimeRoot: () => ROOT,
    });
    assertCondition((await live(parseArgv(["start"]), CONTEXT)) === 3, "start did not block live activation");
    const loggerCreationFailure = createStartCommand({
      loadConfig: () => DEFAULT_BOT_CONFIG,
      createRuntimeLogger: () => {
        throw new Error("logger unavailable");
      },
      resolveRuntimeRoot: () => ROOT,
    });
    assertCondition(
      (await loggerCreationFailure(parseArgv(["start"]), CONTEXT)) === 1,
      "start accepted a logger creation failure",
    );
    for (const failure of [new Error("runner failed"), "runner failed"] as const) {
      const logger = new TestRuntimeLogger();
      const runnerFailure = createStartCommand({
        loadConfig: () => DEFAULT_BOT_CONFIG,
        createRuntimeLogger: () => logger,
        resolveRuntimeRoot: () => ROOT,
        run: async () => {
          await Promise.resolve();
          if (failure instanceof Error) throw failure;
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- The E2E boundary verifies the original non-Error rejection is logged.
          throw failure;
        },
      });
      assertCondition(
        (await runnerFailure(parseArgv(["start"]), CONTEXT)) === 1,
        "start did not map a runner failure",
      );
      assertCondition(
        logger.entries.some(
          (entry) => entry.message === "bot.lifecycle.runner.failed" && entry.meta?.["error"] === failure,
        ),
        "start did not log the original runner failure",
      );
    }
    for (const exitCode of [0, 2] as const) {
      const logger = new TestRuntimeLogger(() => Promise.reject(new Error("shutdown failed")));
      const shutdownFailure = createStartCommand({
        loadConfig: () => DEFAULT_BOT_CONFIG,
        createRuntimeLogger: () => logger,
        resolveRuntimeRoot: () => ROOT,
        run: () => Promise.resolve(exitCode),
      });
      assertCondition(
        (await shutdownFailure(parseArgv(["start"]), CONTEXT)) === (exitCode === 0 ? 1 : exitCode),
        "start did not preserve the shutdown failure exit contract",
      );
    }
    const logDirectory = mkdtempSync(path.join(tmpdir(), "mm-d02-start-"));
    try {
      const headlessConfig = {
        ...DEFAULT_BOT_CONFIG,
        bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: path.join(logDirectory, "state.json") },
      };
      for (const failure of [new Error("crashed"), "crashed"]) {
        const crash = async (): Promise<void> => {
          await Promise.resolve();
          if (failure instanceof Error) throw failure;
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- The bot boundary may reject with an unknown value.
          throw failure;
        };
        assertCondition(
          (await runHeadless(
            { start: crash, stop: () => Promise.resolve() },
            headlessConfig,
            RUNTIME_LOGGER,
          )) === 1,
          "start headless runner did not map a crash",
        );
      }
    } finally {
      rmSync(logDirectory, { recursive: true, force: true });
    }
  });
}

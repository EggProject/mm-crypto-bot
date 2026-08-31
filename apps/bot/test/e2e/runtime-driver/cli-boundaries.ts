import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgv } from "../../../src/cli/argv.js";
import { applyClose, checkSlTpHit } from "../../../src/cli/commands/backtest.js";
import {
  createConfigCommand,
  runConfigInit,
  type ConfigFileBoundary,
} from "../../../src/cli/commands/config.js";
import { createStartCommand, runHeadless } from "../../../src/cli/commands/start.js";
import { ConfigError } from "../../../src/config/loader.js";
import { DEFAULT_BOT_CONFIG } from "../../../src/config/defaults.js";
import { BotConfigSchema, type BotConfig } from "../../../src/config/schema.js";

import { quietLogger, assertCondition, expectFailure } from "./runtime-driver-core.js";

const RUNTIME_ROOT = "/external-runtime-root";
const RUNTIME_CONFIG_PATH = `${RUNTIME_ROOT}/config/default.toml`;

function resolveRuntimeRoot() {
  return { ok: true as const, runtimeRoot: RUNTIME_ROOT, configPath: RUNTIME_CONFIG_PATH };
}

function runCliBoundaries(): void {
  const cases: readonly (readonly string[])[] = [
    [],
    ["start", "--config=foo"],
    ["start", "--config", "foo"],
    ["start", "--mock"],
    ["start", "--no-mock"],
    ["start", "--help"],
    ["start", "-h"],
    ["config", "init", "--", "--not-a-flag"],
    ["start", "--no-mock", "extra"],
    ["start", "--config="],
    ["start", "-x"],
    ["-abc"],
    ["start", "-abc"],
    ["--foo!bar"],
    ["start", "--foo!bar"],
    ["start", "--no-"],
    ["start", "--no-foo!"],
    ["start", "--=value"],
    ["start", "--foo", "--bar"],
  ];
  for (const argv of cases) parseArgv(argv);
  const representative = parseArgv(["config", "validate", "--config=sample.toml"]);
  assertCondition(representative.subcommand === "config", "CLI boundary driver lost the subcommand");
  assertCondition(representative.positional[0] === "validate", "CLI boundary driver lost positional input");
}

function runBacktestBoundaries(): void {
  const longSignal = {
    side: "buy" as const,
    confidence: 1,
    reason: "driver",
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 115,
    timestamp: 1,
    fastEma: 0,
    slowEma: 0,
    rsi: 0,
    atr: 0,
  };
  const shortSignal = { ...longSignal, side: "sell" as const, stopLoss: 105, takeProfit: 85 };
  // eslint-disable-next-line unicorn/consistent-function-scoping -- The fixture closure intentionally captures the local case input.
  const candle = (high: number, low: number) => ({
    timestamp: 2,
    open: 100,
    high,
    low,
    close: 100,
    volume: 0,
  });
  assertCondition(
    checkSlTpHit(candle(102, 94), { signal: longSignal, entryPrice: 100 }) === 95,
    "long SL mismatch",
  );
  assertCondition(
    checkSlTpHit(candle(116, 99), { signal: longSignal, entryPrice: 100 }) === 115,
    "long TP mismatch",
  );
  assertCondition(
    checkSlTpHit(candle(110, 96), { signal: longSignal, entryPrice: 100 }) === null,
    "long no-hit mismatch",
  );
  assertCondition(
    checkSlTpHit(candle(106, 100), { signal: shortSignal, entryPrice: 100 }) === 105,
    "short SL mismatch",
  );
  assertCondition(
    checkSlTpHit(candle(100, 84), { signal: shortSignal, entryPrice: 100 }) === 85,
    "short TP mismatch",
  );
  assertCondition(
    checkSlTpHit(candle(103, 90), { signal: shortSignal, entryPrice: 100 }) === null,
    "short no-hit mismatch",
  );

  const state = { equity: 10_000, peakEquity: 10_000, maxDD: 0, wins: 0, losses: 0, trades: 0 };
  applyClose({ signal: longSignal, entryPrice: 100 }, 110, 0.01, state);
  applyClose({ signal: shortSignal, entryPrice: 100 }, 110, 0.01, state);
  applyClose({ signal: longSignal, entryPrice: 100 }, 100, 0.01, state);
  applyClose({ signal: { ...longSignal, stopLoss: 100 }, entryPrice: 100 }, 120, 0.01, state);
  assertCondition(
    state.wins === 1 && state.losses === 1 && state.trades === 4,
    "backtest close aggregation mismatch",
  );
}

async function runConfigCommandBoundaries(): Promise<void> {
  const context = { config: DEFAULT_BOT_CONFIG };
  const richConfig = BotConfigSchema.parse({
    ...DEFAULT_BOT_CONFIG,
    bot: {
      mode: DEFAULT_BOT_CONFIG.bot.mode,
      log_level: DEFAULT_BOT_CONFIG.bot.log_level,
      state_file: DEFAULT_BOT_CONFIG.bot.state_file,
      selected_leverage: "10",
    },
    strategies: {
      ...DEFAULT_BOT_CONFIG.strategies,
      donchian_pivot_composition: {
        ...DEFAULT_BOT_CONFIG.strategies.donchian_pivot_composition,
        enabled: true,
        cap: 0.4,
        symbols: ["BTC/USDC"],
        timeframes: { htf: "1d", mtf: "4h", ltf: "15m" },
      },
    },
  });
  const richCommand = createConfigCommand({ loadConfig: () => richConfig, resolveRuntimeRoot });
  assertCondition(
    (await richCommand(parseArgv(["config", "validate", "--config=rich.toml"]), context)) === 0,
    "injected validate failed",
  );
  assertCondition(
    (await richCommand(parseArgv(["config", "validate"]), context)) === 0,
    "injected default validate failed",
  );
  assertCondition(
    (await richCommand(parseArgv(["config", "show"]), context)) === 0,
    "injected rich show failed",
  );

  const configFailure = new ConfigError("invalid injected config", "bot.mode", []);
  for (const subcommand of ["validate", "show"] as const) {
    const command = createConfigCommand({
      loadConfig: () => {
        throw configFailure;
      },
      resolveRuntimeRoot,
    });
    assertCondition(
      (await command(parseArgv(["config", subcommand]), context)) === 2,
      `${subcommand} ConfigError exit mismatch`,
    );
    for (const failure of [new Error("loader Error"), "loader string"] as const) {
      const fault = createConfigCommand({
        loadConfig: () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E fault injection verifies normalization of non-Error failures.
          throw failure;
        },
        resolveRuntimeRoot,
      });
      assertCondition(
        (await fault(parseArgv(["config", subcommand]), context)) === 1,
        `${subcommand} runtime error exit mismatch`,
      );
    }
  }
  const directory = mkdtempSync(path.join(tmpdir(), "bot-config-boundary-"));
  const target = path.join(directory, "nested", "out.toml");
  const source = path.join(directory, "source.toml");
  const initState = { ensured: false, written: false };
  const successBoundary: ConfigFileBoundary = {
    exists: (candidatePath) =>
      candidatePath === source || (initState.ensured && candidatePath === path.join(directory, "nested")),
    read: () => '[bot]\nmode = "paper"\n',
    ensureDirectory: () => {
      initState.ensured = true;
    },
    write: () => {
      initState.written = true;
    },
  };
  assertCondition(
    runConfigInit(target, source, successBoundary) === 0 && initState.ensured && initState.written,
    "config init boundary success mismatch",
  );
  initState.written = false;
  assertCondition(
    runConfigInit(undefined, source, successBoundary) === 0 && initState.written,
    "config init default output mismatch",
  );
  const existingBoundary: ConfigFileBoundary = {
    ...successBoundary,
    exists: (path) => path === target || path === source,
  };
  assertCondition(runConfigInit(target, source, existingBoundary) === 1, "config init overwrite mismatch");
  const missingBoundary: ConfigFileBoundary = {
    ...successBoundary,
    exists: () => false,
  };
  assertCondition(
    runConfigInit(target, source, missingBoundary) === 1,
    "config init missing template mismatch",
  );
  for (const failure of [new Error("write Error"), "write string"] as const) {
    const failureBoundary: ConfigFileBoundary = {
      ...successBoundary,
      write: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E fault injection verifies normalization of non-Error failures.
        throw failure;
      },
    };
    assertCondition(runConfigInit(target, source, failureBoundary) === 1, "config init write fault mismatch");
  }
  expectFailure(() => runConfigInit(target, "\0"), "invalid config template path");
  const observedInitOutputs: (string | undefined)[] = [];
  const initCommand = createConfigCommand({
    loadConfig: () => richConfig,
    initConfig: (outPath, sourcePath) => {
      observedInitOutputs.push(outPath);
      assertCondition(
        sourcePath === RUNTIME_CONFIG_PATH,
        "config init did not receive the resolved template",
      );
      return 0;
    },
    resolveRuntimeRoot,
  });
  assertCondition(
    (await initCommand(parseArgv(["config", "init"]), context)) === 0,
    "injected default init failed",
  );
  assertCondition(
    (await initCommand(parseArgv(["config", "init", "--out=custom.toml"]), context)) === 0,
    "injected explicit init failed",
  );
  assertCondition(
    observedInitOutputs[0] === undefined && observedInitOutputs[1] === "custom.toml",
    "config init output dispatch mismatch",
  );
  rmSync(directory, { recursive: true, force: true });
}

async function runStartCommandBoundaries(): Promise<void> {
  const context = { config: DEFAULT_BOT_CONFIG };
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- This E2E logger double intentionally discards non-observable records.
  const noOpBot = { start: async () => {}, stop: async () => {} };
  const baseCommand = createStartCommand({
    loadConfig: () => DEFAULT_BOT_CONFIG,
    createBot: () => noOpBot,
    resolveRuntimeRoot,
    // eslint-disable-next-line @typescript-eslint/require-await -- This test double implements an asynchronous production port synchronously.
    run: async () => 0,
  });
  for (const argv of [
    ["start", "--unknown"],
    ["start", "--config"],
    ["start", "--color=always"],
    ["start", "extra"],
  ] as const) {
    assertCondition(
      (await baseCommand(parseArgv(argv), context)) === 1,
      `start validation accepted ${argv.join(" ")}`,
    );
  }

  const originalNoColor = process.env["NO_COLOR"];
  delete process.env["NO_COLOR"];
  assertCondition(
    (await baseCommand(parseArgv(["start", "--no-color", "--help"]), context)) === 1,
    "start help exit mismatch",
  );
  assertCondition(process.env["NO_COLOR"] === "1", "start no-color policy was not applied");
  assertCondition(
    (await baseCommand(parseArgv(["start", "--no-color", "--help"]), context)) === 1,
    "start repeated help exit mismatch",
  );
  if (originalNoColor === undefined) delete process.env["NO_COLOR"];
  else process.env["NO_COLOR"] = originalNoColor;

  const configErrorCommand = createStartCommand({
    loadConfig: () => {
      throw new ConfigError("bad config", "bot", []);
    },
    resolveRuntimeRoot,
  });
  assertCondition(
    (await configErrorCommand(parseArgv(["start"]), context)) === 2,
    "start ConfigError exit mismatch",
  );
  for (const failure of [new Error("loader Error"), "loader string"] as const) {
    const command = createStartCommand({
      loadConfig: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E fault injection verifies normalization of non-Error failures.
        throw failure;
      },
      resolveRuntimeRoot,
    });
    assertCondition(
      (await command(parseArgv(["start"]), context)) === 1,
      "start loader failure exit mismatch",
    );
  }

  const startState = { created: 0, observedPaths: [] as (string | undefined)[] };
  const normalCommand = createStartCommand({
    loadConfig: (path) => {
      startState.observedPaths.push(path);
      return DEFAULT_BOT_CONFIG;
    },
    createBot: () => {
      startState.created += 1;
      return noOpBot;
    },
    resolveRuntimeRoot,
    // eslint-disable-next-line @typescript-eslint/require-await -- This test double implements an asynchronous production port synchronously.
    run: async () => 7,
  });
  assertCondition(
    (await normalCommand(parseArgv(["start"]), context)) === 7,
    "start injected run exit mismatch",
  );
  assertCondition(
    startState.observedPaths.at(0) === RUNTIME_CONFIG_PATH && startState.created === 1,
    "start default path/create mismatch",
  );
  assertCondition(
    (await normalCommand(parseArgv(["start", "--config=config.toml"]), context)) === 7,
    "start explicit config run mismatch",
  );
  assertCondition(startState.observedPaths.at(1) === "config.toml", "start explicit config path mismatch");

  const liveConfig: BotConfig = { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" } };
  const liveStartState = { botCreations: 0, runs: 0, starts: 0 };
  const liveBot = {
    start: async (): Promise<void> => {
      liveStartState.starts += 1;
      await Promise.resolve();
    },
    stop: (): Promise<void> => Promise.resolve(),
  };
  const liveCommand = createStartCommand({
    loadConfig: () => liveConfig,
    createBot: () => {
      liveStartState.botCreations += 1;
      return liveBot;
    },
    resolveRuntimeRoot,
    run: (): Promise<number> => {
      liveStartState.runs += 1;
      return Promise.resolve(0);
    },
  });
  const liveStartErrors: string[] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]): void => {
    liveStartErrors.push(values.map(String).join(" "));
  };
  try {
    for (const liveStartAttempt of ["first", "second", "third"] as const) {
      assertCondition(
        (await liveCommand(parseArgv(["start"]), context)) === 3,
        `live ${liveStartAttempt} activation block exit mismatch`,
      );
    }
  } finally {
    console.error = originalError;
  }
  assertCondition(
    liveStartErrors.length === 3 &&
      liveStartErrors.every((message) => message === "[start] START_LIVE_ACTIVATION_UNAVAILABLE"),
    "live activation block output mismatch",
  );
  assertCondition(
    liveStartState.botCreations === 0 && liveStartState.runs === 0 && liveStartState.starts === 0,
    "live activation block had runtime side effects",
  );

  assertCondition(
    (await runHeadless(noOpBot, DEFAULT_BOT_CONFIG, quietLogger)) === 0,
    "normal headless exit mismatch",
  );
  for (const failure of [new Error("startup Error"), "startup string"] as const) {
    const code = await runHeadless(
      {
        // eslint-disable-next-line @typescript-eslint/require-await -- This test double implements an asynchronous production port synchronously.
        start: async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E fault injection verifies normalization of non-Error failures.
          throw failure;
        },
        // eslint-disable-next-line @typescript-eslint/no-empty-function -- This E2E logger double intentionally discards non-observable records.
        stop: async () => {},
      },
      DEFAULT_BOT_CONFIG,
      quietLogger,
    );
    assertCondition(code === 1, "headless startup failure exit mismatch");
  }
}

async function runCliCommandBoundaries(): Promise<void> {
  runBacktestBoundaries();
  await runConfigCommandBoundaries();
  await runStartCommandBoundaries();
}

export { runCliBoundaries, runCliCommandBoundaries };

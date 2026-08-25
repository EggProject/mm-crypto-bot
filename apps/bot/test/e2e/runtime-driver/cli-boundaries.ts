import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgv } from "../../../src/cli/argv.js";
import { applyClose, checkSlTpHit } from "../../../src/cli/commands/backtest.js";
import {
  createConfigCommand,
  runConfigInit,
  validateConfigForEdit,
  type ConfigFileBoundary,
} from "../../../src/cli/commands/config.js";
import {
  createStartCommand,
  installConsoleRedirection,
  resolveLogFilePath,
  restoreConsoleRedirection,
  runHeadless,
} from "../../../src/cli/commands/start.js";
import { DEFAULT_BOT_CONFIG } from "../../../src/config/defaults.js";
import { ConfigError } from "../../../src/config/loader.js";
import type { BotConfig } from "../../../src/config/schema.js";

import { assertCondition, expectFailure } from "./runtime-driver-core.js";

function createCandle(
  high: number,
  low: number,
): {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
} {
  return { timestamp: 2, open: 100, high, low, close: 100, volume: 0 };
}

function throwBaselineFault(failure: Error | string): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercises boundary handling when the thrown value is not an Error.
  throw failure;
}

async function noOpAsync(): Promise<void> {
  await Promise.resolve();
}

async function returnExitCode(exitCode: number): Promise<number> {
  await Promise.resolve();
  return exitCode;
}

export function runCliBoundaries(): void {
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
  const representative = parseArgv(["config", "validate", "--config=run-bot/config/default.toml"]);
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
  assertCondition(
    checkSlTpHit(createCandle(102, 94), { signal: longSignal, entryPrice: 100 }) === 95,
    "long SL mismatch",
  );
  assertCondition(
    checkSlTpHit(createCandle(116, 99), { signal: longSignal, entryPrice: 100 }) === 115,
    "long TP mismatch",
  );
  assertCondition(
    checkSlTpHit(createCandle(110, 96), { signal: longSignal, entryPrice: 100 }) === null,
    "long no-hit mismatch",
  );
  assertCondition(
    checkSlTpHit(createCandle(106, 100), { signal: shortSignal, entryPrice: 100 }) === 105,
    "short SL mismatch",
  );
  assertCondition(
    checkSlTpHit(createCandle(100, 84), { signal: shortSignal, entryPrice: 100 }) === 85,
    "short TP mismatch",
  );
  assertCondition(
    checkSlTpHit(createCandle(103, 90), { signal: shortSignal, entryPrice: 100 }) === null,
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
  const richSection = {
    ...DEFAULT_BOT_CONFIG.strategies.donchian_pivot_composition,
    enabled: true,
    cap: 0.4,
    leverage: 7,
    symbols: ["BTC/USDC"],
    timeframes: { htf: "1d" as const, mtf: "4h" as const, ltf: "15m" as const },
    custom_string: "value",
    custom_number: 42,
    custom_boolean: true,
    custom_array: ["a", 2, false],
    custom_object: { ignored: true },
  };
  const richConfig: BotConfig = {
    ...DEFAULT_BOT_CONFIG,
    strategies: {
      ...DEFAULT_BOT_CONFIG.strategies,
      donchian_pivot_composition: richSection,
    },
  };
  const richCommand = createConfigCommand({ loadConfig: () => richConfig });
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
    });
    assertCondition(
      (await command(parseArgv(["config", subcommand]), context)) === 2,
      `${subcommand} ConfigError exit mismatch`,
    );
    for (const failure of [new Error("loader Error"), "loader string"] as const) {
      const fault = createConfigCommand({
        loadConfig: () => {
          return throwBaselineFault(failure);
        },
      });
      assertCondition(
        (await fault(parseArgv(["config", subcommand]), context)) === 1,
        `${subcommand} runtime error exit mismatch`,
      );
    }
  }
  assertCondition(
    validateConfigForEdit("valid.toml", () => richConfig) === 0,
    "edit validation success mismatch",
  );
  assertCondition(
    validateConfigForEdit("run-bot/config/default.toml") === 0,
    "default edit validation success mismatch",
  );
  for (const failure of [new Error("edit Error"), "edit string"] as const) {
    assertCondition(
      validateConfigForEdit("invalid.toml", () => {
        return throwBaselineFault(failure);
      }) === 2,
      "edit validation failure mismatch",
    );
  }

  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-boundary-"));
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
        return throwBaselineFault(failure);
      },
    };
    assertCondition(runConfigInit(target, source, failureBoundary) === 1, "config init write fault mismatch");
  }
  expectFailure(() => runConfigInit(target, "\0"), "invalid config template path");
  const observedInitOutputs: (string | undefined)[] = [];
  const initCommand = createConfigCommand({
    loadConfig: () => richConfig,
    initConfig: (outPath) => {
      observedInitOutputs.push(outPath);
      return 0;
    },
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
  const noOpBot = { start: noOpAsync, stop: noOpAsync };
  const baseCommand = createStartCommand({
    loadConfig: () => DEFAULT_BOT_CONFIG,
    createBot: () => noOpBot,
    run: () => returnExitCode(0),
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
  });
  assertCondition(
    (await configErrorCommand(parseArgv(["start"]), context)) === 2,
    "start ConfigError exit mismatch",
  );
  for (const failure of [new Error("loader Error"), "loader string"] as const) {
    const command = createStartCommand({
      loadConfig: () => {
        return throwBaselineFault(failure);
      },
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
    run: () => returnExitCode(7),
  });
  assertCondition(
    (await normalCommand(parseArgv(["start"]), context)) === 7,
    "start injected run exit mismatch",
  );
  assertCondition(
    startState.observedPaths.at(0) === undefined && startState.created === 1,
    "start default path/create mismatch",
  );
  assertCondition(
    (await normalCommand(parseArgv(["start", "--config=config.toml"]), context)) === 7,
    "start explicit config run mismatch",
  );
  assertCondition(startState.observedPaths.at(1) === "config.toml", "start explicit config path mismatch");

  const liveConfig: BotConfig = { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" } };
  const liveCommand = createStartCommand({
    loadConfig: () => liveConfig,
    createBot: () => noOpBot,
    run: () => returnExitCode(0),
  });
  const originalKey = process.env["BYBIT_API_KEY"];
  delete process.env["BYBIT_API_KEY"];
  assertCondition(
    (await liveCommand(parseArgv(["start"]), context)) === 0,
    "live missing-key start mismatch",
  );
  process.env["BYBIT_API_KEY"] = "";
  assertCondition((await liveCommand(parseArgv(["start"]), context)) === 0, "live empty-key start mismatch");
  process.env["BYBIT_API_KEY"] = "present";
  assertCondition(
    (await liveCommand(parseArgv(["start"]), context)) === 0,
    "live present-key start mismatch",
  );
  if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
  else process.env["BYBIT_API_KEY"] = originalKey;

  const withStateFile = (stateFile: string): BotConfig => ({
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile },
  });
  assertCondition(
    resolveLogFilePath(withStateFile("data/state.json")) === "data/state.json.log",
    "relative log path mismatch",
  );
  for (const invalid of ["", "data/../state.json", "data/\0state.json"]) {
    expectFailure(() => resolveLogFilePath(withStateFile(invalid)), "invalid log file path");
  }

  const writes: string[] = [];
  const backup = installConsoleRedirection({
    write: async (data) => {
      writes.push(data);
      await Promise.resolve();
    },
    close: noOpAsync,
  });
  try {
    console.log("text", { structured: true });
    console.error("error");
  } finally {
    restoreConsoleRedirection(backup);
  }
  await backup.drain();
  assertCondition(writes.join("").includes("structured"), "console redirection lost structured output");
  const rejectedBackup = installConsoleRedirection({
    write: async () => {
      await Promise.resolve();
      throw new Error("disk unavailable");
    },
    close: noOpAsync,
  });
  try {
    console.error("rejected");
  } finally {
    restoreConsoleRedirection(rejectedBackup);
  }
  await rejectedBackup.drain();

  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-headless-driver-"));
  try {
    const normalState = path.join(directory, "normal.json");
    assertCondition(
      (await runHeadless(noOpBot, withStateFile(normalState))) === 0,
      "normal headless exit mismatch",
    );
    for (const failure of [new Error("startup Error"), "startup string"] as const) {
      const failedState = path.join(directory, `${typeof failure}.json`);
      const code = await runHeadless(
        {
          start: async () => {
            await Promise.resolve();
            return throwBaselineFault(failure);
          },
          stop: noOpAsync,
        },
        withStateFile(failedState),
      );
      assertCondition(code === 1, "headless startup failure exit mismatch");
      assertCondition(
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is created inside this test's fresh temporary directory.
        readFileSync(`${failedState}.log`, "utf8").includes(
          typeof failure === "string" ? failure : failure.message,
        ),
        "headless startup failure was not logged",
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function runCliCommandBoundaries(): Promise<void> {
  runBacktestBoundaries();
  await runConfigCommandBoundaries();
  await runStartCommandBoundaries();
}

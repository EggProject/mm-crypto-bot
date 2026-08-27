import { BotConfigSchema, ConfigError } from "../../../src/config/index.js";
import { parseArgv } from "../../../src/cli/argv.js";
import { createKillSwitchesCommand } from "../../../src/cli/commands/kill-switches.js";
import { createStatusCommand } from "../../../src/cli/commands/status.js";
import { createStrategiesCommand } from "../../../src/cli/commands/strategies.js";
import { createTradesCommand } from "../../../src/cli/commands/trades.js";
import type { CliContext } from "../../../src/cli/router.js";
import { DEFAULT_BOT_CONFIG } from "../../../src/config/defaults.js";

import { assertCondition } from "./runtime-driver-core.js";

const CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };
const ROOT = { ok: true as const, runtimeRoot: "/external", configPath: "/external/config/default.toml" };
const MISSING_ROOT = {
  ok: false as const,
  error: {
    code: "runtime-root-missing" as const,
    message: "Runtime configuration root is unavailable." as const,
  },
};
const STATE = {
  version: 1,
  savedAt: 1_700_000_000_000,
  equityUsd: 9000,
  initialEquityUsd: 10_000,
  realizedPnlUsd: -100,
  positions: [
    {
      id: "open-long",
      strategy: "donchian_pivot_composition",
      symbol: "BTC/USDC",
      side: "long" as const,
      quantity: 1,
      entryPrice: 10_000,
      currentPrice: 9900,
      leverage: 10,
      unrealizedPnl: -100,
      realizedPnl: 0,
      openedAt: 1_700_000_000_000,
      notionalUsd: 10_000,
    },
  ],
  closedTrades: [
    {
      strategy: "donchian_pivot_composition",
      symbol: "BTC/USDC",
      side: "long" as const,
      quantity: 1,
      entryPrice: 10_000,
      exitPrice: 9900,
      pnl: -100,
      pnlPct: -1,
      closedAt: 1_700_000_000_000,
    },
    {
      strategy: "cascade_fade",
      symbol: "ETH/USDC",
      side: "short" as const,
      quantity: 2,
      entryPrice: 2000,
      exitPrice: 1950,
      pnl: 100,
      pnlPct: 2.5,
      closedAt: 1_700_000_100_000,
    },
  ],
  inFlightOrderIds: [],
  counters: { placed: 2, filled: 2, cancelled: 0, rejected: 0 },
};

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

async function captureConsoleOutput(action: () => Promise<void>): Promise<readonly string[]> {
  const output: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const capture = (...arguments_: unknown[]): void => {
    output.push(arguments_.map(String).join(" "));
  };
  console.log = capture;
  console.error = capture;
  try {
    await action();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return output;
}

const configForState = {
  ...DEFAULT_BOT_CONFIG,
  bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: "/external/state.json" },
};
const RICH_STRATEGY_CONFIG = {
  strategies: {
    dydx_cex_carry: {
      enabled: true,
      custom_string: "value",
      custom_number: 1,
      custom_boolean: true,
      custom_array: ["value", 1],
      custom_object: { first: "value", second: 1 },
      custom_undefined: undefined,
      // eslint-disable-next-line unicorn/no-null -- A JSON/TOML-equivalent passthrough value must preserve null.
      custom_null: null,
      timeframes: { htf: "1h", mtf: "15m", ltf: "5m" },
    },
  },
};
const VALID_RICH_STRATEGY_CONFIG = BotConfigSchema.parse(RICH_STRATEGY_CONFIG);

function throwUnavailable(): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- The injected hostile boundary may throw unknown values.
  throw "unavailable";
}

async function exerciseStatus(): Promise<void> {
  const valid = createStatusCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: { exists: () => true, readText: () => JSON.stringify(STATE) },
  });
  assertCondition((await valid(parseArgv(["status"]), CONTEXT)) === 0, "status rejected valid state");
  const minuteOld = createStatusCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: {
      exists: () => true,
      readText: () => JSON.stringify({ ...STATE, savedAt: Date.now() - 61_000 }),
    },
  });
  assertCondition(
    (await minuteOld(parseArgv(["status"]), CONTEXT)) === 0,
    "status rejected a minute-old state",
  );
  const noPositions = createStatusCommand({
    loadConfig: () => ({ ...configForState, bot: { ...configForState.bot, mode: "live" } }),
    resolveRuntimeRoot: () => ROOT,
    stateFile: {
      exists: () => true,
      readText: () =>
        JSON.stringify({
          ...STATE,
          savedAt: Date.now() + 1000,
          positions: [],
          closedTrades: [],
          realizedPnlUsd: 0,
        }),
    },
  });
  assertCondition(
    (await noPositions(parseArgv(["status", "--config=/external/config.toml"]), CONTEXT)) === 0,
    "status rejected a zero-position state",
  );
  const missing = createStatusCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: { exists: () => false, readText: () => "" },
  });
  assertCondition((await missing(parseArgv(["status"]), CONTEXT)) === 1, "status accepted a missing state");
  const unreadable = createStatusCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: {
      exists: () => true,
      readText: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- The injected hostile boundary may throw unknown values.
        throw "denied";
      },
    },
  });
  assertCondition(
    (await unreadable(parseArgv(["status"]), CONTEXT)) === 1,
    "status accepted an unreadable state",
  );
  const errorUnreadable = createStatusCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: {
      exists: () => true,
      readText: () => {
        throw new Error("denied");
      },
    },
  });
  assertCondition(
    (await errorUnreadable(parseArgv(["status"]), CONTEXT)) === 1,
    "status accepted Error read failure",
  );
  const malformed = createStatusCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: { exists: () => true, readText: () => "not-json" },
  });
  assertCondition((await malformed(parseArgv(["status"]), CONTEXT)) === 1, "status accepted malformed state");
  const malformedOutput = await captureConsoleOutput(async () => {
    await malformed(parseArgv(["status"]), CONTEXT);
  });
  assertCondition(
    malformedOutput.some((line) =>
      line.includes('invalid JSON in /external/state.json: JSON Parse error: Unexpected identifier "not"'),
    ),
    "status changed its malformed JSON error",
  );
  const invalid = createStatusCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: { exists: () => true, readText: () => JSON.stringify({ version: 9 }) },
  });
  assertCondition(
    (await invalid(parseArgv(["status"]), CONTEXT)) === 1,
    "status accepted schema-invalid state",
  );
  for (const command of [
    createStatusCommand({ resolveRuntimeRoot: () => MISSING_ROOT }),
    createStatusCommand({
      loadConfig: () => {
        throw new ConfigError("invalid", "bot", []);
      },
      resolveRuntimeRoot: () => ROOT,
    }),
    createStatusCommand({ loadConfig: throwUnavailable, resolveRuntimeRoot: () => ROOT }),
    createStatusCommand({
      loadConfig: () => {
        throw new Error("unavailable");
      },
      resolveRuntimeRoot: () => ROOT,
    }),
  ]) {
    assertCondition(
      (await command(parseArgv(["status"]), CONTEXT)) > 0,
      "status accepted failed config admission",
    );
  }
}

async function exerciseTrades(): Promise<void> {
  const command = createTradesCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: { exists: () => true, readText: () => JSON.stringify(STATE) },
  });
  assertCondition(
    (await command(parseArgv(["trades", "--limit=1", "--symbol=ETH/USDC"]), CONTEXT)) === 0,
    "trades rejected valid filtered state",
  );
  assertCondition(
    (await command(parseArgv(["trades", "--limit=bad"]), CONTEXT)) === 0,
    "trades rejected default limit",
  );
  const zeroPnl = createTradesCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: {
      exists: () => true,
      readText: () =>
        JSON.stringify({ ...STATE, closedTrades: [{ ...STATE.closedTrades[0], pnl: 0, pnlPct: 0 }] }),
    },
  });
  assertCondition((await zeroPnl(parseArgv(["trades"]), CONTEXT)) === 0, "trades rejected a zero-PnL trade");
  const empty = createTradesCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: { exists: () => true, readText: () => JSON.stringify({ ...STATE, closedTrades: [] }) },
  });
  assertCondition(
    (await empty(parseArgv(["trades", "--config=/external/config.toml"]), CONTEXT)) === 0,
    "trades rejected empty history",
  );
  const missing = createTradesCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: { exists: () => false, readText: () => "" },
  });
  assertCondition((await missing(parseArgv(["trades"]), CONTEXT)) === 1, "trades accepted missing state");
  const malformed = createTradesCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: { exists: () => true, readText: () => "not-json" },
  });
  assertCondition((await malformed(parseArgv(["trades"]), CONTEXT)) === 1, "trades accepted malformed state");
  const malformedOutput = await captureConsoleOutput(async () => {
    await malformed(parseArgv(["trades"]), CONTEXT);
  });
  assertCondition(
    malformedOutput.some((line) =>
      line.includes('Invalid JSON in /external/state.json: JSON Parse error: Unexpected identifier "not"'),
    ),
    "trades changed its malformed JSON error",
  );
  const invalid = createTradesCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: { exists: () => true, readText: () => JSON.stringify({ version: 9 }) },
  });
  assertCondition(
    (await invalid(parseArgv(["trades"]), CONTEXT)) === 1,
    "trades accepted schema-invalid state",
  );
  const unreadable = createTradesCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: {
      exists: () => true,
      readText: () => {
        throw new Error("denied");
      },
    },
  });
  assertCondition(
    (await unreadable(parseArgv(["trades"]), CONTEXT)) === 1,
    "trades accepted unreadable state",
  );
  const stringUnreadable = createTradesCommand({
    loadConfig: () => configForState,
    resolveRuntimeRoot: () => ROOT,
    stateFile: { exists: () => true, readText: throwUnavailable },
  });
  assertCondition(
    (await stringUnreadable(parseArgv(["trades"]), CONTEXT)) === 1,
    "trades accepted hostile read failure",
  );
  for (const command of [
    createTradesCommand({ resolveRuntimeRoot: () => MISSING_ROOT }),
    createTradesCommand({
      loadConfig: () => {
        throw new ConfigError("invalid", "bot", []);
      },
      resolveRuntimeRoot: () => ROOT,
    }),
    createTradesCommand({ loadConfig: throwUnavailable, resolveRuntimeRoot: () => ROOT }),
    createTradesCommand({
      loadConfig: () => {
        throw new Error("unavailable");
      },
      resolveRuntimeRoot: () => ROOT,
    }),
  ]) {
    assertCondition(
      (await command(parseArgv(["trades"]), CONTEXT)) > 0,
      "trades accepted failed config admission",
    );
  }
}

async function exerciseStaticCommands(): Promise<void> {
  for (const create of [createStrategiesCommand, createKillSwitchesCommand]) {
    const valid = create({ loadConfig: () => DEFAULT_BOT_CONFIG, resolveRuntimeRoot: () => ROOT });
    assertCondition(
      (await valid(
        parseArgv([create === createStrategiesCommand ? "strategies" : "kill-switches"]),
        CONTEXT,
      )) === 0,
      "static command rejected valid config",
    );
    const noRoot = create({ resolveRuntimeRoot: () => MISSING_ROOT });
    assertCondition(
      (await noRoot(
        parseArgv([create === createStrategiesCommand ? "strategies" : "kill-switches"]),
        CONTEXT,
      )) === 2,
      "static command accepted missing root",
    );
    const configError = create({
      loadConfig: () => {
        throw new ConfigError("invalid", "bot", []);
      },
      resolveRuntimeRoot: () => ROOT,
    });
    assertCondition(
      (await configError(
        parseArgv([create === createStrategiesCommand ? "strategies" : "kill-switches"]),
        CONTEXT,
      )) === 2,
      "static command did not map config error",
    );
    const hostile = create({ loadConfig: throwUnavailable, resolveRuntimeRoot: () => ROOT });
    assertCondition(
      (await hostile(
        parseArgv([create === createStrategiesCommand ? "strategies" : "kill-switches"]),
        CONTEXT,
      )) === 1,
      "static command did not map hostile error",
    );
    const unexpected = create({
      loadConfig: () => {
        throw new Error("unavailable");
      },
      resolveRuntimeRoot: () => ROOT,
    });
    assertCondition(
      (await unexpected(
        parseArgv([create === createStrategiesCommand ? "strategies" : "kill-switches"]),
        CONTEXT,
      )) === 1,
      "static command did not map Error",
    );
    assertCondition(
      (await valid(
        parseArgv([
          create === createStrategiesCommand ? "strategies" : "kill-switches",
          "--config=/external/config.toml",
        ]),
        CONTEXT,
      )) === 0,
      "static command rejected an explicit config",
    );
    assertCondition(
      (await valid(
        parseArgv([create === createStrategiesCommand ? "strategies" : "kill-switches", "--config="]),
        CONTEXT,
      )) === 0,
      "static command rejected an empty config value",
    );
  }
  const richStrategies = createStrategiesCommand({
    loadConfig: () => VALID_RICH_STRATEGY_CONFIG,
    resolveRuntimeRoot: () => ROOT,
  });
  assertCondition(
    (await richStrategies(parseArgv(["strategies"]), CONTEXT)) === 0,
    "strategies rejected rich valid configuration",
  );
}

async function exerciseDefaultDependencies(): Promise<void> {
  const runtimeRoot = mkdtempSync(path.join(tmpdir(), "mm-d02-default-cli-"));
  const configDirectory = path.join(runtimeRoot, "config");
  const stateFilePath = path.join(runtimeRoot, "state.json");
  const configPath = path.join(configDirectory, "default.toml");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
  mkdirSync(configDirectory);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
  writeFileSync(configPath, `[bot]\nstate_file = "${stateFilePath}"\n`, "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
  writeFileSync(stateFilePath, JSON.stringify(STATE), "utf8");
  const previousRuntimeRoot = process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"];
  process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"] = runtimeRoot;
  try {
    const commands = [
      ["status", createStatusCommand()],
      ["trades", createTradesCommand()],
      ["kill-switches", createKillSwitchesCommand()],
    ] as const;
    for (const [name, command] of commands) {
      assertCondition(
        (await command(parseArgv([name]), CONTEXT)) === 0,
        `${name} default dependencies failed`,
      );
    }
  } finally {
    if (previousRuntimeRoot === undefined) delete process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"];
    else process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"] = previousRuntimeRoot;
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

export async function runCliD02ReadOnlyBoundaries(): Promise<void> {
  await withMutedConsole(async () => {
    await exerciseStatus();
    await exerciseTrades();
    await exerciseStaticCommands();
    await exerciseDefaultDependencies();
  });
}
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

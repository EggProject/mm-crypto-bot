import { describe, expect, it, spyOn } from "bun:test";

import { BotStateSchema, type BotState } from "../../bot/state-store.js";
import { ConfigError } from "../../config/index.js";
import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";
import type { BotConfig } from "../../config/schema.js";
import { parseArgv } from "../argv.js";
import type { CliContext } from "../router.js";

import type { CommandStateFilePort } from "./command-state-file.js";
import { createStatusCommand } from "./status.js";
import { createTradesCommand } from "./trades.js";

const CLI_CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };
const STATE_PATH = "/var/lib/mm-bot/state.json";
const RUNTIME_ROOT = "/var/lib/mm-bot";

const EMPTY_STATE: BotState = {
  version: 1,
  savedAt: 0,
  equityUsd: 1000,
  initialEquityUsd: 1000,
  realizedPnlUsd: 0,
  positions: [],
  closedTrades: [],
  inFlightOrderIds: [],
  counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
};

function configWithStatePath(): BotConfig {
  return { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: STATE_PATH } };
}

function liveConfigWithStatePath(): BotConfig {
  return { ...configWithStatePath(), bot: { ...configWithStatePath().bot, mode: "live" } };
}

function resolvedRuntimeRoot() {
  return { ok: true as const, runtimeRoot: RUNTIME_ROOT, configPath: `${RUNTIME_ROOT}/config/default.toml` };
}

function stateFile(text: () => string, isPresent = true): CommandStateFilePort {
  return { exists: () => isPresent, readText: text };
}

async function capture(
  action: () => Promise<number>,
): Promise<{ readonly code: number; readonly output: string }> {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...values: unknown[]) => {
    lines.push(values.map(String).join(" "));
  });
  const error = spyOn(console, "error").mockImplementation((...values: unknown[]) => {
    lines.push(values.map(String).join(" "));
  });
  try {
    return { code: await action(), output: lines.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

function populatedState(): BotState {
  return {
    ...EMPTY_STATE,
    savedAt: Date.now() - 3_661_000,
    realizedPnlUsd: -3,
    positions: [
      {
        id: "position-1",
        strategy: "mean-reversion",
        symbol: "BTC/USDT",
        side: "long",
        quantity: 2,
        entryPrice: 10,
        currentPrice: 8,
        leverage: 1,
        unrealizedPnl: -4,
        realizedPnl: 0,
        openedAt: 0,
        notionalUsd: 20,
      },
    ],
    closedTrades: [
      {
        strategy: "s1",
        symbol: "ETH/USDT",
        side: "long",
        quantity: 1,
        entryPrice: 1,
        exitPrice: 2,
        pnl: 1,
        pnlPct: 100,
        closedAt: 0,
      },
      {
        strategy: "s2",
        symbol: "BTC/USDT",
        side: "short",
        quantity: 2,
        entryPrice: 3,
        exitPrice: 3,
        pnl: 0,
        pnlPct: 0,
        closedAt: 1000,
      },
      {
        strategy: "s3",
        symbol: "BTC/USDT",
        side: "long",
        quantity: 3,
        entryPrice: 4,
        exitPrice: 3,
        pnl: -3,
        pnlPct: -25,
        closedAt: 2000,
      },
    ],
    counters: { placed: 4, filled: 3, cancelled: 1, rejected: 2 },
  };
}

describe("status command state boundary coverage", () => {
  it("renders future, minute, and hour state ages with every PnL polarity", async () => {
    const future = await capture(async () =>
      createStatusCommand({
        loadConfig: configWithStatePath,
        resolveRuntimeRoot: resolvedRuntimeRoot,
        stateFile: stateFile(() => JSON.stringify({ ...EMPTY_STATE, savedAt: Date.now() + 1000 })),
      })(parseArgv(["status"]), CLI_CONTEXT),
    );
    const populated = await capture(async () =>
      createStatusCommand({
        loadConfig: configWithStatePath,
        resolveRuntimeRoot: resolvedRuntimeRoot,
        stateFile: stateFile(() => JSON.stringify(populatedState())),
      })(parseArgv(["status"]), CLI_CONTEXT),
    );
    const minutes = await capture(async () =>
      createStatusCommand({
        loadConfig: liveConfigWithStatePath,
        resolveRuntimeRoot: resolvedRuntimeRoot,
        stateFile: stateFile(() => JSON.stringify({ ...EMPTY_STATE, savedAt: Date.now() - 61_000 })),
      })(parseArgv(["status"]), CLI_CONTEXT),
    );

    expect(future.code).toBe(0);
    expect(future.output).toContain("(0s ago)");
    expect(populated.code).toBe(0);
    expect(populated.output).toContain("1h 1m 1s ago");
    expect(populated.output).toContain("BTC/USDT");
    expect(minutes.output).toContain("1m 1s ago");
  });

  it("returns distinct config load errors without reading state", async () => {
    const failures: readonly unknown[] = [
      new ConfigError("invalid", "bot", []),
      new Error("disk error"),
      "hostile throw",
    ];
    for (const failure of failures) {
      let reads = 0;
      const result = await capture(async () =>
        createStatusCommand({
          loadConfig: () => {
            throw failure;
          },
          resolveRuntimeRoot: resolvedRuntimeRoot,
          stateFile: stateFile(() => {
            reads += 1;
            return JSON.stringify(EMPTY_STATE);
          }),
        })(parseArgv(["status"]), CLI_CONTEXT),
      );
      expect(result.code).toBe(failure instanceof ConfigError ? 2 : 1);
      expect(reads).toBe(0);
    }
  });

  it("renders Error state reads and hostile JSON parser failures", async () => {
    const readFailure = await capture(async () =>
      createStatusCommand({
        loadConfig: configWithStatePath,
        resolveRuntimeRoot: resolvedRuntimeRoot,
        stateFile: stateFile(() => {
          throw new Error("read Error");
        }),
      })(parseArgv(["status"]), CLI_CONTEXT),
    );
    const parse = spyOn(JSON, "parse").mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercises the hostile JSON parser boundary.
      throw "JSON hostile";
    });
    try {
      const parseFailure = await capture(async () =>
        createStatusCommand({
          loadConfig: configWithStatePath,
          resolveRuntimeRoot: resolvedRuntimeRoot,
          stateFile: stateFile(() => "{}"),
        })(parseArgv(["status"]), CLI_CONTEXT),
      );
      expect(parseFailure.output).toContain("JSON hostile");
    } finally {
      parse.mockRestore();
    }
    expect(readFailure.output).toContain("read Error");
  });
});

describe("trades command state boundary coverage", () => {
  it("reports every state-file failure before rendering a trade", async () => {
    const cases: readonly CommandStateFilePort[] = [
      stateFile(() => "unused", false),
      stateFile(() => {
        throw new Error("read Error");
      }),
      stateFile(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercises the untrusted dependency boundary.
        throw "read hostile";
      }),
      stateFile(() => "{"),
      stateFile(() => JSON.stringify({})),
    ];
    for (const port of cases) {
      const result = await capture(async () =>
        createTradesCommand({
          loadConfig: configWithStatePath,
          resolveRuntimeRoot: resolvedRuntimeRoot,
          stateFile: port,
        })(parseArgv(["trades"]), CLI_CONTEXT),
      );
      expect(result.code).toBe(1);
    }
  });

  it("applies default invalid limits and exact symbol limits in reverse chronological output", async () => {
    const port = stateFile(() => JSON.stringify(populatedState()));
    const command = createTradesCommand({
      loadConfig: configWithStatePath,
      resolveRuntimeRoot: resolvedRuntimeRoot,
      stateFile: port,
    });
    const defaultResult = await capture(async () =>
      command(parseArgv(["trades", "--limit=invalid"]), CLI_CONTEXT),
    );
    const filteredResult = await capture(async () =>
      command(parseArgv(["trades", "--symbol=BTC/USDT", "--limit=1"]), CLI_CONTEXT),
    );
    const emptyResult = await capture(async () =>
      command(parseArgv(["trades", "--symbol=SOL/USDT", "--limit=0"]), CLI_CONTEXT),
    );

    expect(defaultResult.code).toBe(0);
    expect(defaultResult.output).toContain("Trades: 3 total");
    expect(filteredResult.code).toBe(0);
    expect(filteredResult.output.indexOf("s3")).toBeGreaterThan(-1);
    expect(filteredResult.output).not.toContain("s2");
    expect(emptyResult.output).toContain("(no trades)");
  });

  it("keeps ConfigError and untrusted config failures distinct", async () => {
    const failures: readonly unknown[] = [
      new ConfigError("invalid", "bot", []),
      new Error("config Error"),
      "config hostile",
    ];
    for (const failure of failures) {
      const result = await capture(async () =>
        createTradesCommand({
          loadConfig: () => {
            throw failure;
          },
          resolveRuntimeRoot: resolvedRuntimeRoot,
          stateFile: stateFile(() => JSON.stringify(EMPTY_STATE)),
        })(parseArgv(["trades"]), CLI_CONTEXT),
      );
      expect(result.code).toBe(failure instanceof ConfigError ? 2 : 1);
    }
  });

  it("renders hostile JSON parser failures", async () => {
    const parse = spyOn(JSON, "parse").mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercises the hostile JSON parser boundary.
      throw "JSON hostile";
    });
    try {
      const result = await capture(async () =>
        createTradesCommand({
          loadConfig: configWithStatePath,
          resolveRuntimeRoot: resolvedRuntimeRoot,
          stateFile: stateFile(() => "{}"),
        })(parseArgv(["trades"]), CLI_CONTEXT),
      );
      expect(result.code).toBe(1);
      expect(result.output).toContain("JSON hostile");
    } finally {
      parse.mockRestore();
    }
  });
});

describe("state schema fixture", () => {
  it("keeps the populated boundary fixture valid", () => {
    expect(BotStateSchema.safeParse(populatedState()).success).toBe(true);
  });
});

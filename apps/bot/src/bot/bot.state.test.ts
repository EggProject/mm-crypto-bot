import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";

import { BotStateSchema, type BotState } from "./state-store.js";

import {
  Bot,
  buildTestConfig,
  createBotTestFixture,
  disposeBotTestFixture,
  fileSystem,
  type BotTestFixture,
} from "./bot.test-support.js";

function persistedState(overrides: Partial<BotState> = {}): BotState {
  return {
    version: 1,
    savedAt: Date.now() - 1000,
    equityUsd: 10_000,
    initialEquityUsd: 10_000,
    realizedPnlUsd: 0,
    positions: [],
    closedTrades: [],
    inFlightOrderIds: [],
    counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    ...overrides,
  };
}

function writePersistedState(stateFile: string, state: BotState): void {
  const serialized = JSON.stringify(state);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The test fixture owns the temporary state path.
  writeFileSync(stateFile, serialized, "utf8");
}

describe("Bot state", () => {
  let fixture: BotTestFixture;
  let stateFile: string;
  let feed: ReturnType<typeof createBotTestFixture>["feed"];

  beforeEach(() => {
    fixture = createBotTestFixture();
    ({ stateFile, feed } = fixture);
  });

  afterEach(() => {
    disposeBotTestFixture(fixture);
  });

  it("getState() returns a valid BotState", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    const state = bot.getState();
    const validated = BotStateSchema.safeParse(state);
    expect(validated.success).toBe(true);
    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 3) getState() equity reflects initial balance
  // ---------------------------------------------------------------------------
  it("getState() equity = 10_000 (initial balance from mock feed)", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    const state = bot.getState();
    expect(state.equityUsd).toBe(10_000);
    expect(state.initialEquityUsd).toBe(10_000);
    expect(state.positions.length).toBe(0);
    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 4) State persists on shutdown
  // ---------------------------------------------------------------------------
  it("state file exists after stop()", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    await bot.stop();
    await p;
    expect(fileSystem.existsSync(stateFile)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 5) Graceful shutdown is fast (< 2s for empty bot)
  // ---------------------------------------------------------------------------
  it("graceful shutdown completes in <2s for empty bot", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    const start = Date.now();
    await bot.stop();
    await p;
    expect(Date.now() - start).toBeLessThan(2000);
  });

  // ---------------------------------------------------------------------------
  // 6) double start() throws
  // ---------------------------------------------------------------------------
  it("double start() throws", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    await expect(bot.start()).rejects.toThrow(/already running/);
    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 7) getState() before start() throws
  // ---------------------------------------------------------------------------
  it("getState() before start() throws", () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    expect(() => bot.getState()).toThrow(/not initialized/);
  });

  // ---------------------------------------------------------------------------
  // 8) stop() before start() is no-op
  // ---------------------------------------------------------------------------
  it("stop() before start() is no-op", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    await expect(bot.stop()).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 9) getState() with open positions — covers lines 210-222
  // ---------------------------------------------------------------------------
  it("getState() includes open positions in the positions array", async () => {
    writePersistedState(
      stateFile,
      persistedState({
        positions: [
          {
            id: "test-strategy:BTC/USDC:long",
            strategy: "test-strategy",
            symbol: "BTC/USDC",
            side: "long",
            quantity: 0.01,
            entryPrice: 60_000,
            currentPrice: 60_000,
            leverage: 1,
            unrealizedPnl: 0,
            realizedPnl: 0,
            openedAt: Date.now() - 1000,
            notionalUsd: 600,
          },
        ],
      }),
    );
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));

    const state = bot.getState();
    expect(state.positions.length).toBe(1);
    expect(state.positions[0]?.strategy).toBe("test-strategy");
    expect(state.positions[0]?.side).toBe("long");
    expect(state.positions[0]?.quantity).toBe(0.01);
    expect(state.positions[0]?.entryPrice).toBe(60_000);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 10) getState() with closed trades — covers lines 224-233
  // ---------------------------------------------------------------------------
  it("getState() includes closed trades in the closedTrades array", async () => {
    writePersistedState(
      stateFile,
      persistedState({
        realizedPnlUsd: 5,
        closedTrades: [
          {
            strategy: "test-strategy",
            symbol: "BTC/USDC",
            side: "long",
            quantity: 0.01,
            entryPrice: 60_000,
            exitPrice: 60_500,
            pnl: 5,
            pnlPct: 0.83,
            closedAt: Date.now() - 1000,
          },
        ],
      }),
    );
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));

    const state = bot.getState();
    expect(state.closedTrades.length).toBe(1);
    expect(state.closedTrades[0]?.strategy).toBe("test-strategy");
    expect(state.closedTrades[0]?.entryPrice).toBe(60_000);
    expect(state.closedTrades[0]?.exitPrice).toBe(60_500);
    expect(state.closedTrades[0]?.pnl).toBeGreaterThan(0);

    await bot.stop();
    await p;
  });
});

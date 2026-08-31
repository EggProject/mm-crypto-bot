import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { BotStateSchema, type BotState } from "./state-store.js";

import {
  Bot,
  buildTestConfig,
  createBotTestFixture,
  disposeBotTestFixture,
  type BotTestFixture,
} from "./bot.test-support.js";

describe("Bot persistence", () => {
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

  it("restores a persisted position into PositionManager", async () => {
    // 1) Pre-populate the state file with 1 position (dydx_cex_carry:BTC/USDC:long @ 60000)
    const initialState: BotState = {
      version: 1,
      savedAt: Date.now() - 60_000,
      equityUsd: 9950, // 10000 - 50 unrealized
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [
        {
          id: "dydx_cex_carry:BTC/USDC:long",
          strategy: "dydx_cex_carry",
          symbol: "BTC/USDC",
          side: "long",
          quantity: 0.00016667,
          entryPrice: 60_000,
          currentPrice: 59_700,
          leverage: 10,
          unrealizedPnl: -5,
          realizedPnl: 0,
          openedAt: Date.now() - 3_600_000,
          notionalUsd: 10,
        },
      ],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 1, filled: 1, cancelled: 0, rejected: 0 },
    };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(stateFile, JSON.stringify(initialState), "utf8");

    // 2) Start the bot
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));

    // 3) Verify the position is loaded into the PositionManager
    const restored = bot.getState();
    expect(restored.positions.length).toBe(1);
    const pos = restored.positions[0];
    expect(pos).toBeDefined();
    expect(pos?.strategy).toBe("dydx_cex_carry");
    expect(pos?.symbol).toBe("BTC/USDC");
    expect(pos?.side).toBe("long");
    expect(pos?.quantity).toBeCloseTo(0.00016667, 8);
    expect(pos?.entryPrice).toBe(60_000);
    expect(pos?.leverage).toBe(10);

    // 4) Verify the equity reflects the loaded state
    // initialEquityUsd=10000 + unrealizedPnl=-5 (from the position) = 9995
    // (the saved state had equityUsd=9950, which includes the realizedPnlTotal=0 + unrealized=-5)
    // Note: equity is computed from initialEquityUsd + realizedPnl + sum(unrealizedPnl of restored positions)
    // The position's unrealizedPnl is stored in the position, so getEquity() = 10000 + 0 + (-5) = 9995
    expect(restored.equityUsd).toBeCloseTo(9995, 1);

    // 5) Stop the bot
    await bot.stop();
    await p;
  });

  it("retains a restored position after restart without averaging", async () => {
    const preState: BotState = {
      version: 1,
      savedAt: Date.now() - 60_000,
      equityUsd: 9950,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [
        {
          id: "dydx_cex_carry:BTC/USDC:long",
          strategy: "dydx_cex_carry",
          symbol: "BTC/USDC",
          side: "long",
          quantity: 0.00016667,
          entryPrice: 60_000,
          currentPrice: 59_700,
          leverage: 10,
          unrealizedPnl: -5,
          realizedPnl: 0,
          openedAt: Date.now() - 3_600_000,
          notionalUsd: 10,
        },
      ],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 1, filled: 1, cancelled: 0, rejected: 0 },
    };
    const { writeFileSync, readFileSync } = await import("node:fs");
    writeFileSync(stateFile, JSON.stringify(preState), "utf8");

    // 2) First bot instance
    const config = buildTestConfig(stateFile);
    const bot1 = new Bot({ config, feed });
    const p1 = bot1.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    const state1 = bot1.getState();
    expect(state1.positions.length).toBe(1);
    await bot1.stop();
    await p1;

    // 3) Wait a bit, then start a SECOND bot instance with the same state file
    await new Promise<void>((r) => setTimeout(r, 100));

    // The state file should have been flushed by the first bot. Read it
    // to confirm the position is still in there.
    const reloadedState = BotStateSchema.parse(JSON.parse(readFileSync(stateFile, "utf8")) as unknown);
    expect(reloadedState.positions.length).toBe(1);
    expect(reloadedState.positions[0]?.strategy).toBe("dydx_cex_carry");

    // 4) Second bot instance — should load the position from state
    const bot2 = new Bot({ config, feed });
    const p2 = bot2.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    const state2 = bot2.getState();
    expect(state2.positions.length).toBe(1);
    expect(state2.positions[0]?.strategy).toBe("dydx_cex_carry");
    expect(state2.positions[0]?.entryPrice).toBe(60_000);

    await bot2.stop();
    await p2;
  });

  it("restores realized PnL and closed trade history", async () => {
    // After restoring positions, the realizedPnlTotal must also be
    // restored, otherwise getEquity() would lose the accumulated
    // realized P&L from the previous session.

    const preState: BotState = {
      version: 1,
      savedAt: Date.now() - 60_000,
      // 10000 (initial) + 250 (realized) + (-50) (unrealized) = 10200
      equityUsd: 10_200,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 250, // ← CRITICAL: must be restored
      positions: [
        {
          id: "dydx_cex_carry:BTC/USDC:long",
          strategy: "dydx_cex_carry",
          symbol: "BTC/USDC",
          side: "long",
          quantity: 0.00016667,
          entryPrice: 60_000,
          currentPrice: 59_700,
          leverage: 10,
          unrealizedPnl: -50, // currentPrice moved down 300 from entry
          realizedPnl: 0,
          openedAt: Date.now() - 3_600_000,
          notionalUsd: 10,
        },
      ],
      closedTrades: [
        {
          strategy: "dydx_cex_carry",
          symbol: "ETH/USDC",
          side: "long",
          quantity: 0.01,
          entryPrice: 3000,
          exitPrice: 3250,
          pnl: 2.5,
          pnlPct: 8.33,
          closedAt: Date.now() - 7_200_000,
        },
      ],
      inFlightOrderIds: [],
      counters: { placed: 2, filled: 2, cancelled: 0, rejected: 0 },
    };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(stateFile, JSON.stringify(preState), "utf8");

    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));

    const state = bot.getState();
    // The realizedPnlUsd must be preserved (250 USD) AND the closed
    // trades history must be loaded (1 trade for ETH/USDC).
    expect(state.realizedPnlUsd).toBe(250);
    expect(state.closedTrades.length).toBe(1);
    expect(state.closedTrades[0]?.symbol).toBe("ETH/USDC");
    // The equity is the saved value: 10000 + 250 + (-50) = 10200
    // getEquity() computes: initialEquityUsd + realizedPnlTotal + sum(unrealizedPnl of restored positions)
    // = 10000 + 250 + (-50) = 10200
    expect(state.equityUsd).toBeCloseTo(10_200, 0);

    await bot.stop();
    await p;
  });
});

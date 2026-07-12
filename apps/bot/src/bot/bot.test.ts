/**
 * apps/bot/src/bot/bot.test.ts
 *
 * A `Bot` osztály unit tesztjei — lifecycle, signal → order flow,
 * getState konzisztencia.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockExchangeFeed, asSymbol, type Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";

import { Bot } from "./bot.js";
import { BotStateSchema } from "./state-store.js";
import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";

function buildTestConfig(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile },
    exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "mock" },
    symbols: { enabled: ["BTC/USDC"] },
    strategies: {
      donchian_pivot_composition: { enabled: false },
      dydx_cex_carry: { enabled: false },
      cascade_fade: { enabled: false },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: false },
    },
    telemetry: {
      log_dir: stateFile + ".logs",
      metrics_interval_sec: 60,
    },
  };
}

describe("Bot", () => {
  let tmpDir: string;
  let stateFile: string;
  let feed: MockExchangeFeed;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-test-"));
    stateFile = join(tmpDir, "bot-state.json");
    feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 10_000, total: 10_000 }],
    });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // 1) Start → stop lifecycle
  // ---------------------------------------------------------------------------
  it("starts and stops without error", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 2) getState() returns a valid BotState
  // ---------------------------------------------------------------------------
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
    expect(existsSync(stateFile)).toBe(true);
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
    expect(Date.now() - start).toBeLessThan(2_000);
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
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));

    // Inject an open position via the private positionManager. This is
    // a test-only access pattern — the production code path would have
    // a strategy signal → order → fill flow.
    const botAny = bot as unknown as {
      positionManager: {
        openPosition: (s: string, sym: ExchangeSymbol, side: "long" | "short", qty: number, price: number, lev: number) => unknown;
      };
    };
    botAny.positionManager.openPosition(
      "test-strategy",
      asSymbol("BTC/USDC") as unknown as ExchangeSymbol,
      "long",
      0.01,
      60_000,
      1,
    );

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
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));

    const botAny = bot as unknown as {
      positionManager: {
        openPosition: (s: string, sym: ExchangeSymbol, side: "long" | "short", qty: number, price: number, lev: number) => unknown;
        closePosition: (s: string, sym: ExchangeSymbol, exitPrice: number) => number;
      };
    };
    const sym = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    botAny.positionManager.openPosition("test-strategy", sym, "long", 0.01, 60_000, 1);
    botAny.positionManager.closePosition("test-strategy", sym, 60_500);

    const state = bot.getState();
    expect(state.closedTrades.length).toBe(1);
    expect(state.closedTrades[0]?.strategy).toBe("test-strategy");
    expect(state.closedTrades[0]?.entryPrice).toBe(60_000);
    expect(state.closedTrades[0]?.exitPrice).toBe(60_500);
    expect(state.closedTrades[0]?.pnl).toBeGreaterThan(0);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 11) snapshotForTelemetry is callable (covers the private function)
  // ---------------------------------------------------------------------------
  it("snapshotForTelemetry returns telemetry-shaped snapshot", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));

    const botAny = bot as unknown as {
      snapshotForTelemetry: () => {
        equityUsd: number;
        initialEquityUsd: number;
        realizedPnlUsd: number;
        unrealizedPnlUsd: number;
        drawdownPct: number;
        openPositions: number;
        maxPositions: number;
        counters: unknown;
        killSwitchEngaged: boolean;
        killSwitchReasons: string[];
        uptime: number;
        uptimeHuman: string;
        activeStrategies: string[];
      };
    };
    const snap = botAny.snapshotForTelemetry();
    expect(snap.equityUsd).toBe(10_000);
    expect(snap.initialEquityUsd).toBe(10_000);
    expect(snap.openPositions).toBe(0);
    expect(snap.maxPositions).toBe(config.risk.max_positions);
    expect(snap.activeStrategies).toEqual([]);

    await bot.stop();
    await p;
  });
});

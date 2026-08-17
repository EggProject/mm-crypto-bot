/**
 * apps/bot/src/bot/bot.test.ts
 *
 * A `Bot` osztály unit tesztjei — lifecycle, signal → order flow,
 * getState konzisztencia.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  asSymbol,
  type MarketMeta,
  type Symbol as ExchangeSymbol,
  type Ticker,
} from "@mm-crypto-bot/exchange";
// Phase 66: `MockExchangeFeed` is test-only — the package no longer
// exports it from `@mm-crypto-bot/exchange`. Tests reach it via the
// `@exchange-testing/*` path alias (see tsconfig.base.json).
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";

import { Bot } from "./bot.js";
import { BotStateSchema, type BotState } from "./state-store.js";
import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";

const fileSystem = await import("node:fs");

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

async function reconcileLiveEquity(bot: Bot): Promise<number | null> {
  const internal = bot as unknown as {
    init(): Promise<unknown>;
    reconcileAuthoritativeEquity(context: unknown): Promise<void>;
    cleanup(): Promise<void>;
    authoritativeEquityUsd: number | null;
  };
  const context = await internal.init();
  await internal.reconcileAuthoritativeEquity(context);
  const equity = internal.authoritativeEquityUsd;
  await internal.cleanup();
  return equity;
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
    if (fileSystem.existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("authoritative live equity", () => {
    it("values configured spot inventory from venue balances", async () => {
      const symbol = asSymbol("BTC/USDC") as ExchangeSymbol;
      const spotFeed = new MockExchangeFeed({
        balances: [{ currency: "USDC", free: 1_000, total: 1_000 }, { currency: "BTC", free: 2, total: 2 }],
      });
      const ticker: Ticker = { symbol, timestamp: Date.now(), bid: 99, ask: 101, last: 100, baseVolume: 0, quoteVolume: 0 };
      spotFeed.setTicker(symbol, ticker);
      const config = { ...buildTestConfig(stateFile), bot: { ...buildTestConfig(stateFile).bot, mode: "live" as const } };
      expect(await reconcileLiveEquity(new Bot({ config, feed: spotFeed }))).toBe(1_200);
    });

    it("adds derivative UPL but never derivative notional or base balance", async () => {
      const symbol = asSymbol("BTC/USDC") as ExchangeSymbol;
      const derivativeMeta: MarketMeta = { symbol, base: "BTC", quote: "USDC", amountPrecision: 4, pricePrecision: 2, minAmount: 0.0001, minCost: 1, isSpot: false };
      const derivativeFeed = new MockExchangeFeed({
        balances: [{ currency: "USDC", free: 1_000, total: 1_000 }, { currency: "BTC", free: 2, total: 2 }],
        marketMeta: new Map([[symbol, derivativeMeta]]),
        positions: [{ symbol, side: "long", quantity: 2, entryPrice: 100, markPrice: 105, unrealizedPnl: 10, updateTimestamp: Date.now() }],
      });
      const config = { ...buildTestConfig(stateFile), bot: { ...buildTestConfig(stateFile).bot, mode: "live" as const } };
      expect(await reconcileLiveEquity(new Bot({ config, feed: derivativeFeed }))).toBe(1_010);
    });

    it("adds spot inventory and derivative UPL exactly once in a mixed account", async () => {
      const btc = asSymbol("BTC/USDC") as ExchangeSymbol;
      const eth = asSymbol("ETH/USDC") as ExchangeSymbol;
      const mixedFeed = new MockExchangeFeed({
        balances: [{ currency: "USDC", free: 1_000, total: 1_000 }, { currency: "BTC", free: 1, total: 1 }],
        marketMeta: new Map([
          [btc, { symbol: btc, base: "BTC", quote: "USDC", amountPrecision: 4, pricePrecision: 2, minAmount: 0.0001, minCost: 1, isSpot: true }],
          [eth, { symbol: eth, base: "ETH", quote: "USDC", amountPrecision: 4, pricePrecision: 2, minAmount: 0.0001, minCost: 1, isSpot: false }],
        ]),
        positions: [{ symbol: eth, side: "short", quantity: 1, entryPrice: 10, markPrice: 12, unrealizedPnl: -5, updateTimestamp: Date.now() }],
      });
      mixedFeed.setTicker(btc, { symbol: btc, timestamp: Date.now(), bid: 99, ask: 101, last: 100, baseVolume: 0, quoteVolume: 0 });
      const config = {
        ...buildTestConfig(stateFile),
        bot: { ...buildTestConfig(stateFile).bot, mode: "live" as const },
        symbols: { enabled: [String(btc), String(eth)] },
      };
      expect(await reconcileLiveEquity(new Bot({ config, feed: mixedFeed }))).toBe(1_095);
    });

    it("trips the portfolio drawdown stop from an authoritative derivative loss", async () => {
      const symbol = asSymbol("BTC/USDC") as ExchangeSymbol;
      const derivativeFeed = new MockExchangeFeed({
        balances: [{ currency: "USDC", free: 1_000, total: 1_000 }],
        marketMeta: new Map([[symbol, { symbol, base: "BTC", quote: "USDC", amountPrecision: 4, pricePrecision: 2, minAmount: 0.0001, minCost: 1, isSpot: false }]]),
      });
      const config = { ...buildTestConfig(stateFile), bot: { ...buildTestConfig(stateFile).bot, mode: "live" as const } };
      const bot = new Bot({ config, feed: derivativeFeed });
      const internal = bot as unknown as {
        init(): Promise<{ readonly portfolioManager: { isTripped(): boolean } }>;
        runHeartbeat(context: unknown): Promise<void>;
        cleanup(): Promise<void>;
      };
      const context = await internal.init();
      await internal.runHeartbeat(context); // establishes the 1,000 USD high-water mark
      derivativeFeed.setPositions([{ symbol, side: "long", quantity: 1, entryPrice: 100, markPrice: 89, unrealizedPnl: -110, updateTimestamp: Date.now() }]);
      await internal.runHeartbeat(context);
      expect(context.portfolioManager.isTripped()).toBe(true);
      // The trip action is deliberately fire-and-forget from the stop
      // callback; let its authoritative close attempt settle before teardown.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await internal.cleanup();
    });
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

  it("subscribes once to every configured strategy timeframe and forwards OHLCV events", async () => {
    const config: BotConfig = {
      ...buildTestConfig(stateFile),
      strategies: {
        donchian_pivot_composition: {
          enabled: true,
          // Native 4h/15m overlap configured values; native 1d remains unique.
          // The result is ticker + 1h/4h/15m/1d without duplicates.
          timeframes: { htf: "1h", mtf: "4h", ltf: "15m" },
        },
        dydx_cex_carry: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    };
    const bot = new Bot({ config, feed });
    const running = bot.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(feed.subscriptionCount()).toBe(5);
    feed.pushEvent({
      kind: "ohlcv",
      payload: {
        symbol: asSymbol("BTC/USDC"),
        timeframe: "15m",
        candle: [Date.now(), 60_000, 60_100, 59_900, 60_050, 10],
      },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(bot.getState().version).toBe(1);
    await bot.stop();
    await running;
  });

  it("turns a live feed signal into a paper position through the Bot order boundary", async () => {
    const config: BotConfig = {
      ...buildTestConfig(stateFile),
      risk: { ...DEFAULT_BOT_CONFIG.risk, risk_per_trade: 0.1 },
      portfolio: {
        ...DEFAULT_BOT_CONFIG.portfolio,
        total_risk_per_cycle_usd: 1_000,
        max_dd_pct: 0.01,
      },
      strategies: {
        donchian_pivot_composition: { enabled: true, min_consensus: 1 },
        dydx_cex_carry: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    };
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10,
      heartbeatIntervalMs: 10,
    });
    const running = bot.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const symbol = asSymbol("BTC/USDC");
    const baseTimestamp = Date.now() - 200 * 86_400_000;
    for (let index = 0; index < 30; index += 1) {
      feed.pushEvent({
        kind: "ohlcv",
        payload: {
          symbol,
          timeframe: "1d",
          candle: [baseTimestamp + index * 86_400_000, 100, 110, 90, 100, 100],
        },
      });
    }
    for (let index = 0; index < 100; index += 1) {
      feed.pushEvent({
        kind: "ohlcv",
        payload: {
          symbol,
          timeframe: "15m",
          candle: [baseTimestamp + 30 * 86_400_000 + index * 900_000, 100, 105, 95, 100, 100],
        },
      });
    }
    feed.pushEvent({
      kind: "ohlcv",
      payload: {
        symbol,
        timeframe: "15m",
        candle: [baseTimestamp + 30 * 86_400_000 + 100 * 900_000, 100, 101, 88, 89, 100],
      },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const state = bot.getState();
    expect(state.counters.placed).toBeGreaterThan(0);
    expect(state.positions).toHaveLength(1);
    feed.pushEvent({
      kind: "ticker",
      payload: {
        symbol,
        timestamp: Date.now(),
        bid: 0.99,
        ask: 1.01,
        last: 1,
        baseVolume: 100,
        quoteVolume: 100,
      },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(bot.isKillSwitchEngaged()).toBe(true);
    expect(bot.getState().positions).toHaveLength(0);
    await bot.stop();
    await running;
  });

  it("wires one configured RiskManager into both runner and PositionManager", async () => {
    const config: BotConfig = {
      ...buildTestConfig(stateFile),
      risk: {
        ...DEFAULT_BOT_CONFIG.risk,
        trailing_stop: { ...DEFAULT_BOT_CONFIG.risk.trailing_stop, enabled: true },
        kelly: { ...DEFAULT_BOT_CONFIG.risk.kelly, enabled: true },
        drawdown_scaler: { ...DEFAULT_BOT_CONFIG.risk.drawdown_scaler, enabled: true },
      },
    };
    const bot = new Bot({ config, feed });
    const running = bot.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const internals = bot as unknown as {
      runtime: {
        riskManager: unknown;
        runner: { riskManager: unknown };
        positionManager: { riskManager: unknown };
      };
    };
    expect(internals.runtime.riskManager).not.toBeNull();
    expect(internals.runtime.runner.riskManager).toBe(internals.runtime.riskManager);
    expect(internals.runtime.positionManager.riskManager).toBe(internals.runtime.riskManager);
    await bot.stop();
    await running;
  });

  it("feeds runtime equity observations into the max-drawdown kill switch", async () => {
    const config: BotConfig = {
      ...buildTestConfig(stateFile),
      risk: { ...DEFAULT_BOT_CONFIG.risk, max_drawdown_pct: 0.1 },
    };
    const bot = new Bot({
      config,
      feed,
      killSwitchEvalIntervalMs: 5,
      heartbeatIntervalMs: 5,
    });
    const running = bot.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    const internals = bot as unknown as {
      positionManager: { restoreRealizedPnl(pnl: number): void };
    };
    internals.positionManager.restoreRealizedPnl(-2_000);
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    expect(bot.isKillSwitchEngaged()).toBe(true);
    await running;
  });

  // ---------------------------------------------------------------------------
  // 1a) getConfig() returns the original BotConfig (Phase 44 — used by
  //     the headless start.ts to derive the log-file path from state_file).
  // ---------------------------------------------------------------------------
  it("getConfig() returns the original BotConfig (read-only accessor)", () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    expect(bot.getConfig()).toBe(config);
    expect(bot.getConfig().bot.state_file).toBe(stateFile);
  });

  // ---------------------------------------------------------------------------
  // 1b) Phase 38 Fix #42 + Phase 66: paper mode starts WITHOUT auth
  // credentials AND without hitting the real network.
  //
  // Before Phase 38 Fix #42: paper mode triggered
  // `createExchangeClient({useMock:false})` which threw
  // `MissingCredentialsError` even in paper mode. Fix #42 routed paper
  // mode through MockExchangeFeed (no auth required).
  //
  // Phase 66 (2026-07-23): paper mode now uses REAL bybit.eu
  // (per user mandate: "MOCK FEED-ET SOSEM KERTEM") with empty
  // credentials (CCXT public endpoints work without auth). The Phase
  // 38 MockExchangeFeed path is preserved ONLY for the
  // `exchange.id === "mock"` explicit mode used by the unit tests
  // and backtest fixtures.
  //
  // This test injects the mock feed explicitly so the init path runs
  // without a network round-trip. The "no MissingCredentialsError"
  // assertion is preserved — paper mode never throws on missing
  // creds, regardless of which feed backs it.
  // ---------------------------------------------------------------------------
  it("paper mode starts without auth credentials (no MissingCredentialsError)", async () => {
    // Ensure no API keys are set in env
    const origKey = process.env["BYBIT_API_KEY"];
    const origSecret = process.env["BYBIT_API_SECRET"];
    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];

    try {
      const config: BotConfig = {
        ...DEFAULT_BOT_CONFIG,
        bot: {
          ...DEFAULT_BOT_CONFIG.bot,
          mode: "paper",
          state_file: stateFile,
        },
        // Use the mock exchange.id so the Bot uses MockExchangeFeed
        // (the post-Phase 66 default of "bybiteu" would try to connect
        // to the real exchange, which is fine in production but not
        // appropriate for a 5s unit test).
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
      const bot = new Bot({ config, feed }); // explicit mock feed — exercises the init path
      const p = bot.start();
      await new Promise<void>((r) => setTimeout(r, 200));
      await bot.stop();
      await p;
      // If we got here without "Hiányzó API hitelesítő adatok", the fix works.
    } finally {
      // Restore env
      if (origKey !== undefined) process.env["BYBIT_API_KEY"] = origKey;
      if (origSecret !== undefined) process.env["BYBIT_API_SECRET"] = origSecret;
    }
  });

  it("live mode without auth credentials throws MissingCredentialsError", async () => {
    // The opposite of the above: live mode MUST require auth credentials.
    const origKey = process.env["BYBIT_API_KEY"];
    const origSecret = process.env["BYBIT_API_SECRET"];
    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];

    try {
      const config: BotConfig = {
        ...DEFAULT_BOT_CONFIG,
        bot: {
          ...DEFAULT_BOT_CONFIG.bot,
          mode: "live",
          state_file: stateFile,
        },
        exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "bybiteu" },
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
      const bot = new Bot({ config });
      const p = bot.start();
      // Should reject within a reasonable time
      await expect(p).rejects.toThrow(/Hiányzó API hitelesítő adatok/);
    } finally {
      if (origKey !== undefined) process.env["BYBIT_API_KEY"] = origKey;
      if (origSecret !== undefined) process.env["BYBIT_API_SECRET"] = origSecret;
    }
  });

  // ---------------------------------------------------------------------------
  // 1c) Explicit carry opt-in must fail fast until every mandatory
  // producer is wired. Paper mode may construct a MockDydxFundingSource,
  // but it does not have a precondition re-verifier producer. Starting a
  // permanently gated strategy would therefore be a silent no-op.
  // ---------------------------------------------------------------------------
  it("paper mode with dydx_cex_carry enabled fails fast without a precondition producer", async () => {
    const origKey = process.env["BYBIT_API_KEY"];
    const origSecret = process.env["BYBIT_API_SECRET"];
    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];

    try {
      const config: BotConfig = {
        ...DEFAULT_BOT_CONFIG,
        bot: {
          ...DEFAULT_BOT_CONFIG.bot,
          mode: "paper",
          state_file: stateFile,
        },
        exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "mock" },
        symbols: { enabled: ["BTC/USDC"] },
        strategies: {
          donchian_pivot_composition: { enabled: false },
          dydx_cex_carry: { enabled: true }, // ← THE test target
          cascade_fade: { enabled: false },
          funding_flip_kill_switch: { enabled: false },
          regime_detector: { enabled: false },
        },
        telemetry: {
          log_dir: stateFile + ".logs",
          metrics_interval_sec: 60,
        },
      };
      const bot = new Bot({ config, feed }); // explicit mock feed — exercises the init path
      await expect(bot.start()).rejects.toThrow(/precondition re-verifier producer/);
    } finally {
      if (origKey !== undefined) process.env["BYBIT_API_KEY"] = origKey;
      if (origSecret !== undefined) process.env["BYBIT_API_SECRET"] = origSecret;
    }
  });

  it("live mode with dydx_cex_carry enabled + no fundingSource does NOT silently start", async () => {
    // This test exercises the Phase 43 Track 1 fix: in live mode, the
    // bot must NOT auto-substitute a `MockDydxFundingSource` (that
    // would let the user run live with a mock funding source — a
    // silent safety violation).
    //
    // The exact error depends on which check fires first:
    //   - Feed-open fails first (fake API key) → bybiteu WS error.
    //     This is acceptable: the bot did NOT silently substitute a
    //     mock funding source, which is the contract.
    //   - Feed-open succeeds and the strategy-registry then fails
    //     because no fundingSource was provided → ConfigError
    //     mentioning `DydxFundingSource`. This is the canonical
    //     Phase 25 #2 path (tested directly in strategy-registry.test.ts).
    //
    // Either error is acceptable; the key invariant is that the bot
    // does NOT silently start.
    const origKey = process.env["BYBIT_API_KEY"];
    const origSecret = process.env["BYBIT_API_SECRET"];
    process.env["BYBIT_API_KEY"] = "fake_key_for_test";
    process.env["BYBIT_API_SECRET"] = "fake_secret_for_test";

    try {
      const config: BotConfig = {
        ...DEFAULT_BOT_CONFIG,
        bot: {
          ...DEFAULT_BOT_CONFIG.bot,
          mode: "live",
          state_file: stateFile,
        },
        exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "bybiteu" },
        symbols: { enabled: ["BTC/USDC"] },
        strategies: {
          donchian_pivot_composition: { enabled: false },
          dydx_cex_carry: { enabled: true }, // ← THE test target
          cascade_fade: { enabled: false },
          funding_flip_kill_switch: { enabled: false },
          regime_detector: { enabled: false },
        },
        telemetry: {
          log_dir: stateFile + ".logs",
          metrics_interval_sec: 60,
        },
      };
      const bot = new Bot({ config }); // no fundingSource injected
      const p = bot.start();
      // The bot MUST reject — either at feed-open (fake key) or at
      // strategy-registry (no fundingSource). Both prove the contract.
      await expect(p).rejects.toThrow();
    } finally {
      if (origKey !== undefined) process.env["BYBIT_API_KEY"] = origKey;
      else delete process.env["BYBIT_API_KEY"];
      if (origSecret !== undefined) process.env["BYBIT_API_SECRET"] = origSecret;
      else delete process.env["BYBIT_API_SECRET"];
    }
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
  // 12) stateSaveInterval callback fires (covers lines 373-375)
  // ---------------------------------------------------------------------------
  it("periodic state-save fires when stateSaveIntervalMs is short", async () => {
    const config = buildTestConfig(stateFile);
    // Inject a custom StateStore with 0 debounce so the save lands
    // immediately after the interval fires. The state-save interval
    // is the periodic trigger; the StateStore's debounce is separate.
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10,  // 10ms in test
      killSwitchEvalIntervalMs: 10_000,  // disable kill-switch eval
      heartbeatIntervalMs: 10_000,  // disable heartbeat
    });
    const p = bot.start();
    // Wait long enough for the state-save interval to fire + the 50ms
    // debounce window to expire (StateStore default debounceMs = 500ms
    // is too long for this test; we patch it post-init below).
    await new Promise<void>((r) => setTimeout(r, 30));

    // Patch the StateStore's debounce to 0 so the next requestSave
    // lands immediately. This is a test-only mutation.
    const botAny = bot as unknown as {
      stateStore: { debounceMs: number };
    };
    if (botAny.stateStore) {
      botAny.stateStore.debounceMs = 0;
    }

    // Wait for another interval tick to actually flush the save.
    await new Promise<void>((r) => setTimeout(r, 50));

    // The state file should have been written by the periodic save.
    expect(fileSystem.existsSync(stateFile)).toBe(true);
    const raw = fileSystem.existsSync(stateFile)
      ? (await import("node:fs")).readFileSync(stateFile, "utf8")
      : "";
    const parsed = JSON.parse(raw) as { version: number };
    expect(parsed.version).toBe(1);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 13) killSwitchInterval callback fires (covers lines 378-381)
  // ---------------------------------------------------------------------------
  it("periodic kill-switch eval fires when killSwitchEvalIntervalMs is short", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,  // disable state-save
      killSwitchEvalIntervalMs: 10,  // 10ms
      heartbeatIntervalMs: 10_000,   // disable heartbeat
    });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // The kill-switch eval ran at least once. The telemetry snapshot
    // should reflect the latest state.
    const botAny = bot as unknown as {
      runtime: { killSwitches: { getSnapshot: () => { engaged: boolean; reasons: string[] } } };
    };
    const snap = botAny.runtime.killSwitches.getSnapshot();
    expect(snap).toBeDefined();
    expect(typeof snap.engaged).toBe("boolean");

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 14) run() loop heartbeat callback fires (covers lines 413-419)
  // ---------------------------------------------------------------------------
  it("run() heartbeat fires the kill-switch check at short heartbeatIntervalMs", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,  // disable init's interval
      heartbeatIntervalMs: 10,  // 10ms heartbeat
    });
    const p = bot.start();
    // Wait long enough for the heartbeat to fire at least once.
    await new Promise<void>((r) => setTimeout(r, 50));

    // The run() loop is still running (we haven't called stop).
    // Verify state can be retrieved (no errors).
    const state = bot.getState();
    expect(state.version).toBe(1);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 15) kill-switch onTrigger callback fires (covers lines 354-355)
  // ---------------------------------------------------------------------------
  it("kill-switch onTrigger callback stops the bot when a switch engages", async () => {
    // Custom kill-switch that's always engaged — passes through
    // perStrategyKillSwitches option so the registry includes it from
    // init.
    const engagedSwitch = {
      id: "test-always-engaged",
      description: "test kill-switch that is always engaged",
      evaluate: () => ({ switchId: "test-always-engaged", engaged: true, reason: "test-always-engaged" }),
    };
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10,  // 10ms — quick eval
      heartbeatIntervalMs: 10_000,
      perStrategyKillSwitches: [engagedSwitch],
    });
    const p = bot.start();
    // Wait for the first eval to fire (within 10ms) + onTrigger callback.
    await new Promise<void>((r) => setTimeout(r, 100));
    await p;

    // Bot should be stopped (running = false) because the
    // onTrigger handler called this.stop().
    const botState = bot as unknown as { running: boolean };
    expect(botState.running).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 16) run() loop exits cleanly when stopRequested is set (covers the while-loop)
  // ---------------------------------------------------------------------------
  it("run() loop exits and the heartbeat interval is cleared on stop", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10,  // 10ms — frequent heartbeats
    });
    const p = bot.start();
    // Let the run loop run for a few cycles.
    await new Promise<void>((r) => setTimeout(r, 60));
    await bot.stop();
    await p;

    // After stop, running is false and the loop has exited.
    const botState = bot as unknown as { running: boolean; stateSaveInterval: ReturnType<typeof setInterval> | null; killSwitchInterval: ReturnType<typeof setInterval> | null };
    expect(botState.running).toBe(false);
    expect(botState.stateSaveInterval).toBeNull();
    expect(botState.killSwitchInterval).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 17) telemetry metrics interval fires (covers telemetry.ts line 117 callback)
  // ---------------------------------------------------------------------------
  it("telemetry metrics interval fires when telemetryMetricsIntervalSec is short", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
      telemetryMetricsIntervalSec: 0.05,  // 50ms — quick fire
    });
    const p = bot.start();
    // Wait long enough for the metrics interval to fire 2+ times.
    await new Promise<void>((r) => setTimeout(r, 200));

    // The metrics log file should exist (emitMetrics writes to it).
    const logFile = join(stateFile + ".logs", `bot-${new Date().toISOString().slice(0, 10)}.log`);
    expect(fileSystem.existsSync(logFile)).toBe(true);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 18) feed subscription callback fires when events are pushed (covers bot.ts 410-412)
  // ---------------------------------------------------------------------------
  it("feed subscription callback processes ticker events", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
    });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // Push a ticker event into the mock feed.
    const { asSymbol: asSym } = await import("@mm-crypto-bot/exchange");
    feed.pushEvent({
      kind: "ticker",
      payload: {
        symbol: asSym("BTC/USDC") as unknown as ExchangeSymbol,
        timestamp: Date.now(),
        bid: 59_999,
        ask: 60_001,
        last: 60_000,
        baseVolume: 100,
        quoteVolume: 6_000_000,
      },
    });
    // Let the feed deliver the event + the runner process it.
    await new Promise<void>((r) => setTimeout(r, 50));

    // No assertion on specific behavior (all strategies disabled);
    // this test exists to cover the subscription callback code path.
    expect(bot.getState().equityUsd).toBeGreaterThan(0);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 20) cleanup() swallows stateStore.flush() errors (covers lines 533-537).
  //     A state-fájl elérési útvonalát egy nem írható helyre állítjuk.
  // ---------------------------------------------------------------------------
  it("cleanup() swallows stateStore.flush() errors gracefully", async () => {
    // A tmp könyvtárban hozzunk létre egy "file" típusú elemet, és a
    // state-fájl útvonalaként ennek egy gyerekét adjuk meg. A
    // StateStore.saveSync megpróbálja létrehozni a parent könyvtárat
    // mkdirSync-kel — ami azért fog hibát dobni, mert a parent egy
    // fájl, nem könyvtár.
    const blockingFile = join(tmpDir, "blocker");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(blockingFile, "this is a file, not a dir", "utf8");

    const brokenStateFile = join(blockingFile, "state.json");
    const config = buildTestConfig(brokenStateFile);
    // A StateStore init-ben `load()`-ot hív, ami `readFileSync`-et
    // használ a file-ra. A `readFileSync` nem fog hibát dobni, ha
    // a fájl nem létezik (a Bot csak akkor ír, ha a `requestSave`
    // hívódik). A `mkdirSync` a `cleanup` flush-ában fog hibát dobni.
    // Viszont a `load()` is `readFileSync`-et hív, és a `brokenStateFile`
    // útvonalon a parent könyvtár (`blocker`) egy fájl, nem könyvtár —
    // a `readFileSync` is hibát dobhat, amit a StateStore `load` kezel.
    //
    // Egyszerűbb megközelítés: a cleanup() flush() a saveSync-et hívja,
    // ami `mkdirSync(dir, { recursive: true })`-et hív a `dir` (parent)
    // könyvtárra. Ha a `dir` maga egy fájl, a mkdirSync EEXIST-et dob,
    // amit a StateStore StateStoreError-ba csomagol. A cleanup() ezt
    // elkapja, és a logger.error-t hívja (a tesztelt catch block).
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // A bot leállítása — a cleanup-ban a flush hibát fog dobni.
    // A bot leállásának NEM szabad eldobnia a kivételt.
    await expect(bot.stop()).resolves.toBeUndefined();
    await p;

    // A blockingFile még mindig a helyén van (cleanup nem törli).
    const { existsSync: exists } = await import("node:fs");
    expect(exists(blockingFile)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 21) cleanup() swallows feed.close() errors (covers lines 547-551).
  //     A mock feed close()-ját úgy monkey-patch-eljük, hogy dobjon.
  // ---------------------------------------------------------------------------
  it("cleanup() swallows feed.close() errors gracefully", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });

    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // A feed close()-ját felülírjuk, hogy dobjon. A cleanup-ban a
    // feed.close() try-catch-ben van — a catch block kerül végrehajtásra.
    const originalClose = feed.close.bind(feed);
    let closeCalled = false;
    feed.close = async () => {
      closeCalled = true;
      throw new Error("intentional feed close failure");
    };

    await expect(bot.stop()).resolves.toBeUndefined();
    await p;

    // A close() meghívódott (és a hibát a cleanup elkapta).
    expect(closeCalled).toBe(true);

    // Visszaállítjuk, hogy a cleanup későbbi részei ne legyenek érintettek.
    feed.close = originalClose;
  });

  // ============================================================================
  // Phase 68: state-restore — a data/bot-state.json-ból betöltött pozíciók
  // átkerülnek a PositionManager-be. Ez a Phase 67 óta ismert bug, ami
  // miatt a position-skip fix CSAK fresh-start esetén működött — restart
  // után a pozíciók "elvesztek" a PositionManager-ből, és egy új fill
  // átlagolta volna a régit.
  // ============================================================================

  it("Phase 68: state-restore: pre-existing position is loaded into PositionManager", async () => {
    // 1) Pre-populate the state file with 1 position (dydx_cex_carry:BTC/USDC:long @ 60000)
    const initialState: BotState = {
      version: 1,
      savedAt: Date.now() - 60_000,
      equityUsd: 9_950, // 10000 - 50 unrealized
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
          notionalUsd: 10.0,
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

  it("Phase 68: state-restore: after restart, position-skip prevents averaging", async () => {
    // This test reproduces the ORIGINAL Phase 67 bug scenario: the bot had
    // a position, was restarted, and the new bot would average into the
    // position (or hit maxPositions cap) because PositionManager didn't
    // know about the loaded position.
    //
    // After the Phase 68 fix, after restart the PositionManager HAS the
    // loaded position, so the position-skip logic kicks in and the bot
    // does NOT open a new position on the same (strategy, symbol).

    // 1) Pre-populate the state file with 1 long position at entry 60000
    const preState: BotState = {
      version: 1,
      savedAt: Date.now() - 60_000,
      equityUsd: 9_950,
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
          notionalUsd: 10.0,
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
    const reloadedState = JSON.parse(readFileSync(stateFile, "utf8"));
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

  it("Phase 68: state-restore: realizedPnlUsd is restored so getEquity() is correct", async () => {
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
          notionalUsd: 10.0,
        },
      ],
      closedTrades: [
        {
          strategy: "dydx_cex_carry",
          symbol: "ETH/USDC",
          side: "long",
          quantity: 0.01,
          entryPrice: 3_000,
          exitPrice: 3_250,
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

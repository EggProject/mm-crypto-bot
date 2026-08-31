import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asSymbol } from "@mm-crypto-bot/exchange";
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import { RecordingLogger } from "@logging-testing";
import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";
import { BotRuntimeAssembly } from "./bot-runtime-assembly.js";
import { stopLifecycleForCleanup } from "./bot.js";
import {
  LiveEquityAuthority,
  PreparedLiveEquityAuthority,
  liveEquitySystemClock,
} from "./live-equity-authority.js";
import type { TelemetrySnapshot } from "./telemetry.js";
import {
  Bot,
  buildTestConfig,
  createBotTestFixture,
  disposeBotTestFixture,
  type BotTestFixture,
} from "./bot.test-support.js";
function telemetrySnapshot(): TelemetrySnapshot {
  return {
    equityUsd: 0,
    initialEquityUsd: 0,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    drawdownPct: 0,
    openPositions: 0,
    maxPositions: 0,
    counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    killSwitchEngaged: false,
    killSwitchReasons: [],
    uptime: 0,
    uptimeHuman: "0s",
    activeStrategies: [],
  };
}
function noOpEmergencyHandler(_reason: string): Promise<void> {
  void _reason;
  return Promise.resolve();
}
function createNoOpEmergencyHandler(): (reason: string) => Promise<void> {
  return noOpEmergencyHandler;
}
describe("Bot lifecycle", () => {
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
  it("warns and continues when the private lifecycle stop rejects", async () => {
    const logger = new RecordingLogger();
    const continuation: string[] = [];
    await stopLifecycleForCleanup(() => Promise.reject(new Error("scripted lifecycle stop failure")), logger);
    continuation.push("continued");
    expect(continuation).toEqual(["continued"]);
    expect(logger.getCalls()).toContainEqual({
      level: "warn",
      event: "bot.lifecycle.privatecleanup.failed",
      fields: { error: "scripted lifecycle stop failure" },
    });
  });
  it("starts and stops without error", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(feed.subscriptionCount()).toBe(1);
    await bot.stop();
    await p;
  });
  it("subscribes once to every configured strategy timeframe and forwards OHLCV events", async () => {
    const config: BotConfig = {
      ...buildTestConfig(stateFile),
      strategies: {
        donchian_pivot_composition: {
          enabled: true,
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
        total_risk_per_cycle_usd: 1000,
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
    expect(bot.getState().version).toBe(1);
    expect(bot.getConfig().risk.trailing_stop.enabled).toBe(true);
    expect(bot.getState().positions).toHaveLength(0);
    await bot.stop();
    await running;
  });
  it("rejects injected feeds in live mode before runtime equity observers can start", async () => {
    const config: BotConfig = {
      ...buildTestConfig(stateFile),
      bot: { ...buildTestConfig(stateFile).bot, mode: "live" },
      risk: { ...DEFAULT_BOT_CONFIG.risk, max_drawdown_pct: 0.1 },
    };
    const bot = new Bot({ config, feed, killSwitchEvalIntervalMs: 5, heartbeatIntervalMs: 5 });
    await expect(bot.start()).rejects.toThrow("Bot: live mode prohibits injected exchange feeds.");
  });
  it("getConfig() returns the original BotConfig (read-only accessor)", () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    expect(bot.getConfig()).toBe(config);
    expect(bot.getConfig().bot.state_file).toBe(stateFile);
  });
  it("paper mode starts without auth credentials (no MissingCredentialsError)", async () => {
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
          dydx_cex_carry: { enabled: false },
          cascade_fade: { enabled: false },
          funding_flip_kill_switch: { enabled: false },
          regime_detector: { enabled: false },
        },
        telemetry: {
          ...DEFAULT_BOT_CONFIG.telemetry,
          log_dir: stateFile + ".logs",
          metrics_interval_sec: 60,
        },
      };
      const bot = new Bot({ config, feed });
      const p = bot.start();
      await new Promise<void>((r) => setTimeout(r, 200));
      await bot.stop();
      await p;
    } finally {
      if (origKey !== undefined) process.env["BYBIT_API_KEY"] = origKey;
      if (origSecret !== undefined) process.env["BYBIT_API_SECRET"] = origSecret;
    }
  });
  it("live mode without auth credentials throws MissingCredentialsError", async () => {
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
          ...DEFAULT_BOT_CONFIG.telemetry,
          log_dir: stateFile + ".logs",
          metrics_interval_sec: 60,
        },
      };
      const bot = new Bot({ config });
      const p = bot.start();
      await expect(p).rejects.toThrow(/Hiányzó API hitelesítő adatok/);
    } finally {
      if (origKey !== undefined) process.env["BYBIT_API_KEY"] = origKey;
      if (origSecret !== undefined) process.env["BYBIT_API_SECRET"] = origSecret;
    }
  });
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
          ...DEFAULT_BOT_CONFIG.telemetry,
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
  it("rejects failed live preparation before any runtime lifecycle exists", async () => {
    const feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 999, total: 999 }] });
    await feed.open();
    try {
      await expect(
        PreparedLiveEquityAuthority.prepare({
          feed,
          symbols: [asSymbol("BTC/USDC")],
          maxAgeMs: 60_000,
          now: liveEquitySystemClock,
          maxDrawdownFraction: "0.1",
        }),
      ).rejects.toThrow(/exactly USD 1000/);
      expect(feed.subscriptionCount()).toBe(0);
    } finally {
      await feed.close();
    }
  });
  it("seals live authority control state against reflection and non-authentic receivers", () => {
    const feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 1000, total: 1000 }] });
    const authority = new LiveEquityAuthority({
      feed,
      symbols: [asSymbol("BTC/USDC")],
      maxAgeMs: 60_000,
      now: liveEquitySystemClock,
      maxDrawdownFraction: "0.1",
    });
    const proxied = new Proxy(authority, {});
    let didDelegate = false;
    const evidenceProxy = new Proxy(authority, {
      get(target, property, receiver): unknown {
        if (property === "getSnapshot") didDelegate = true;
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      },
    });
    class DerivedAuthority extends LiveEquityAuthority {}
    const derived = new DerivedAuthority({
      feed,
      symbols: [asSymbol("BTC/USDC")],
      maxAgeMs: 60_000,
      now: liveEquitySystemClock,
      maxDrawdownFraction: "0.1",
    });
    expect(Object.isFrozen(LiveEquityAuthority)).toBe(true);
    expect(Object.isFrozen(LiveEquityAuthority.prototype)).toBe(true);
    expect(Object.isFrozen(PreparedLiveEquityAuthority)).toBe(true);
    expect(
      Reflect.set(PreparedLiveEquityAuthority, "prepare", () => Promise.reject(new Error("replacement"))),
    ).toBe(false);
    expect(Reflect.set(PreparedLiveEquityAuthority, "require", () => authority)).toBe(false);
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Reflect.set(authority, "state", "fresh")).toBe(false);
    expect(Reflect.defineProperty(authority, "options", { value: {} })).toBe(false);
    expect(() => proxied.getSnapshot()).toThrow();
    expect(() => evidenceProxy.getStartupEvidence()).toThrow();
    expect(didDelegate).toBe(false);
    expect(derived.getSnapshot().state).toBe("initial");
  });
  it("live runtime assembly with dydx_cex_carry enabled and no funding source fails closed", async () => {
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
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
      telemetry: {
        ...DEFAULT_BOT_CONFIG.telemetry,
        log_dir: stateFile + ".logs",
        metrics_interval_sec: 60,
      },
    };
    const feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 1000, total: 1000 }] });
    const logger = new RecordingLogger();
    await feed.open();
    const assemblyOptions = {
      config,
      feed,
      initialEquity: 1000,
      fundingSource: undefined,
      sizingFn: undefined,
      perStrategyKillSwitches: undefined,
      telemetryMetricsIntervalSec: 60,
      logger,
      createEmergencyHandler: createNoOpEmergencyHandler,
      snapshotProvider: () => telemetrySnapshot(),
    };
    await expect(BotRuntimeAssembly.create(assemblyOptions)).rejects.toThrow(/prepared equity authority/);
    expect(feed.subscriptionCount()).toBe(0);
    const preparedLiveEquity = await PreparedLiveEquityAuthority.prepare({
      feed,
      symbols: [asSymbol("BTC/USDC")],
      maxAgeMs: 60_000,
      now: liveEquitySystemClock,
      maxDrawdownFraction: config.risk.max_drawdown_pct.toString(),
    });
    const forgedOptions = { ...assemblyOptions, preparedLiveEquity };
    Reflect.set(forgedOptions, "preparedLiveEquity", Object.create(PreparedLiveEquityAuthority.prototype));
    try {
      await expect(BotRuntimeAssembly.create(forgedOptions)).rejects.toThrow(/authentic/);
      expect(() =>
        PreparedLiveEquityAuthority.require(
          preparedLiveEquity,
          {
            ...preparedLiveEquity.authority.getPreparationRequest(),
            source: "forged-source",
          },
          1000,
        ),
      ).toThrow(/does not match/);
      expect(feed.subscriptionCount()).toBe(0);
      const mismatchedDrawdown = await PreparedLiveEquityAuthority.prepare({
        feed,
        symbols: [asSymbol("BTC/USDC")],
        maxAgeMs: 60_000,
        now: liveEquitySystemClock,
        maxDrawdownFraction: "0.1",
      });
      await expect(
        BotRuntimeAssembly.create({ ...assemblyOptions, preparedLiveEquity: mismatchedDrawdown }),
      ).rejects.toThrow(/does not match/);
      await expect(
        BotRuntimeAssembly.create({ ...assemblyOptions, initialEquity: 999, preparedLiveEquity }),
      ).rejects.toThrow(/does not match/);
      const mismatchedClock = await PreparedLiveEquityAuthority.prepare({
        feed,
        symbols: [asSymbol("BTC/USDC")],
        maxAgeMs: 60_000,
        now: () => Date.now(),
        maxDrawdownFraction: config.risk.max_drawdown_pct.toString(),
      });
      await expect(
        BotRuntimeAssembly.create({ ...assemblyOptions, preparedLiveEquity: mismatchedClock }),
      ).rejects.toThrow(/does not match/);
      await expect(
        BotRuntimeAssembly.create({
          ...assemblyOptions,
          feed: new MockExchangeFeed(),
          preparedLiveEquity,
        }),
      ).rejects.toThrow(/does not match/);
      await expect(
        BotRuntimeAssembly.create({
          ...assemblyOptions,
          config: { ...config, symbols: { enabled: ["ETH/USDC"] } },
          preparedLiveEquity,
        }),
      ).rejects.toThrow(/does not match/);
      await expect(
        BotRuntimeAssembly.create({
          ...assemblyOptions,
          preparedLiveEquity,
        }),
      ).rejects.toThrow(/DydxFundingSource/);
    } finally {
      await feed.close();
    }
  });
});

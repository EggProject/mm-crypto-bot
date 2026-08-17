import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  asSymbol,
  type Balance,
  type ExchangePosition,
  type FeedListener,
  type MarketMeta,
  type SubscriptionId,
  type Symbol as ExchangeSymbol,
  type Timeframe,
} from "@mm-crypto-bot/exchange";
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import type { Logger } from "@mm-crypto-bot/shared";

import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";
import { Bot, type BotOptions } from "./bot.js";
import type { BotState } from "./state-store.js";

const delay = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for public bot boundary");
    await delay(5);
  }
}

class RecordingLogger implements Logger {
  public readonly entries: {
    readonly level: string;
    readonly message: string;
    readonly meta?: Readonly<Record<string, unknown>>;
  }[] = [];

  public debug(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.entries.push({ level: "debug", message, meta });
  }
  public info(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.entries.push({ level: "info", message, meta });
  }
  public warn(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.entries.push({ level: "warn", message, meta });
  }
  public error(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.entries.push({ level: "error", message, meta });
  }
}

class FailingOhlcvFeed extends MockExchangeFeed {
  public override async subscribeOhlcv(
    symbol: ExchangeSymbol,
    timeframe: Timeframe,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    if (timeframe === "4h") throw new Error("4h subscription failed");
    if (timeframe === "15m") throw "15m subscription failed";
    return super.subscribeOhlcv(symbol, timeframe, listener);
  }
}

class BlockingTickerFeed extends MockExchangeFeed {
  private release: (() => void) | null = null;
  public tickerSubscriptionStarted = false;

  public override async subscribeTicker(
    symbol: ExchangeSymbol,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    this.tickerSubscriptionStarted = true;
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
    void symbol;
    void listener;
    return 30_000 as SubscriptionId;
  }

  public releaseTickerSubscription(): void {
    this.release?.();
  }
}

class CleanupFailureFeed extends MockExchangeFeed {
  private nextPrivateId = 20_000;

  public constructor(
    private readonly lifecycleFailure: unknown,
    private readonly closeFailure: unknown,
  ) {
    super({ balances: [{ currency: "USDC", free: 10_000, total: 10_000 }] });
  }

  public async subscribeOrderUpdates(): Promise<SubscriptionId> {
    return this.nextPrivateId++ as SubscriptionId;
  }
  public async subscribeExecutions(): Promise<SubscriptionId> {
    return this.nextPrivateId++ as SubscriptionId;
  }

  public override async unsubscribe(id: SubscriptionId): Promise<void> {
    if (id >= 20_000) throw this.lifecycleFailure;
    await super.unsubscribe(id);
  }

  public override async close(): Promise<void> {
    throw this.closeFailure;
  }
}

class ReconciliationFeed extends MockExchangeFeed {
  public balanceCalls = 0;
  public positionCalls = 0;
  public tickerCalls = 0;

  public constructor(
    private readonly initialBalances: readonly Balance[],
    private readonly reconciledBalances: readonly Balance[] | unknown,
    options: ConstructorParameters<typeof MockExchangeFeed>[0] = {},
  ) {
    super({ ...options, balances: initialBalances });
  }

  public override async fetchBalances(): Promise<readonly Balance[]> {
    this.balanceCalls += 1;
    if (this.balanceCalls === 1) return this.initialBalances;
    if (!Array.isArray(this.reconciledBalances)) throw this.reconciledBalances;
    return this.reconciledBalances;
  }

  public override async fetchPositions(
    symbols?: readonly ExchangeSymbol[],
  ): Promise<readonly ExchangePosition[]> {
    this.positionCalls += 1;
    return super.fetchPositions(symbols);
  }

  public override async fetchTickerSnapshot(symbol: ExchangeSymbol) {
    this.tickerCalls += 1;
    return super.fetchTickerSnapshot(symbol);
  }
}

function configFor(stateFile: string): BotConfig {
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
    telemetry: { log_dir: `${stateFile}.logs`, metrics_interval_sec: 60 },
  };
}

async function startThenStop(bot: Bot, feed: MockExchangeFeed): Promise<void> {
  const running = bot.start();
  await waitFor(() => feed.subscriptionCount() > 0);
  await bot.stop();
  await running;
}

describe("Bot public runtime boundaries", () => {
  let directory: string;
  let stateFile: string;
  let originalKey: string | undefined;
  let originalSecret: string | undefined;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "mm-bot-public-"));
    stateFile = join(directory, "state.json");
    originalKey = process.env["BYBIT_API_KEY"];
    originalSecret = process.env["BYBIT_API_SECRET"];
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
    else process.env["BYBIT_API_KEY"] = originalKey;
    if (originalSecret === undefined) delete process.env["BYBIT_API_SECRET"];
    else process.env["BYBIT_API_SECRET"] = originalSecret;
    rmSync(directory, { recursive: true, force: true });
  });

  it("rejects a mock production config when no test feed was supplied", async () => {
    await expect(new Bot({ config: configFor(stateFile) }).start()).rejects.toThrow("exchange.id = mock");
  });

  it("constructs unauthenticated paper market data with configured endpoints", async () => {
    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];
    const feed = new MockExchangeFeed();
    const calls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];
    const config = {
      ...configFor(stateFile),
      exchange: {
        ...configFor(stateFile).exchange,
        id: "bybiteu" as const,
        endpoint: "https://example.test/rest",
        ws_endpoint: "wss://example.test/ws",
      },
    };
    const bot = new Bot({
      config,
      feed: undefined,
      exchangeFeedFactory: (options) => {
        calls.push(options);
        return feed;
      },
    });
    await startThenStop(bot, feed);
    expect(calls).toEqual([
      expect.objectContaining({
        override: { apiKey: "", secret: "" },
        endpoint: "https://example.test/rest",
        wsEndpoint: "wss://example.test/ws",
      }),
    ]);
  });

  it("constructs authenticated paper data without optional endpoint overrides", async () => {
    process.env["BYBIT_API_KEY"] = "public-boundary-key";
    process.env["BYBIT_API_SECRET"] = "public-boundary-secret";
    const feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 1_234, total: 1_234 }] });
    const calls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];
    const config = {
      ...configFor(stateFile),
      exchange: { ...configFor(stateFile).exchange, id: "bybiteu" as const },
    };
    const bot = new Bot({
      config,
      exchangeFeedFactory: (options) => {
        calls.push(options);
        return feed;
      },
    });
    await startThenStop(bot, feed);
    expect(calls).toEqual([
      {
        rateLimitMs: config.exchange.rate_limit_ms,
        sandbox: config.exchange.sandbox,
        timeoutMs: config.exchange.timeout_ms,
      },
    ]);
  });

  it("preserves complementary endpoint options across unauthenticated and authenticated factory calls", async () => {
    const calls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];

    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];
    const publicFeed = new MockExchangeFeed();
    const publicConfig = {
      ...configFor(stateFile),
      exchange: { ...configFor(stateFile).exchange, id: "bybiteu" as const },
    };
    await startThenStop(
      new Bot({
        config: publicConfig,
        exchangeFeedFactory: (options) => {
          calls.push(options);
          return publicFeed;
        },
      }),
      publicFeed,
    );

    process.env["BYBIT_API_KEY"] = "public-boundary-key";
    process.env["BYBIT_API_SECRET"] = "public-boundary-secret";
    const authenticatedFeed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 1_000, total: 1_000 }],
    });
    const authenticatedConfig = {
      ...configFor(stateFile),
      exchange: {
        ...configFor(stateFile).exchange,
        id: "bybiteu" as const,
        endpoint: "https://example.test/rest",
        ws_endpoint: "wss://example.test/ws",
      },
    };
    await startThenStop(
      new Bot({
        config: authenticatedConfig,
        exchangeFeedFactory: (options) => {
          calls.push(options);
          return authenticatedFeed;
        },
      }),
      authenticatedFeed,
    );

    expect(calls[0]).not.toHaveProperty("endpoint");
    expect(calls[0]).not.toHaveProperty("wsEndpoint");
    expect(calls[1]).toEqual(
      expect.objectContaining({
        endpoint: "https://example.test/rest",
        wsEndpoint: "wss://example.test/ws",
      }),
    );
  });

  it("keeps the current 10,000 USD startup fallback when USDC is absent", async () => {
    process.env["BYBIT_API_KEY"] = "public-boundary-key";
    process.env["BYBIT_API_SECRET"] = "public-boundary-secret";
    const feed = new MockExchangeFeed({ balances: [{ currency: "BTC", free: 1, total: 1 }] });
    const bot = new Bot({ config: configFor(stateFile), feed });
    const running = bot.start();
    await waitFor(() => feed.subscriptionCount() > 0);
    expect(bot.getState().equityUsd).toBe(10_000);
    await bot.stop();
    await running;
  });

  it("accepts an explicit null funding source while carry is disabled", async () => {
    const feed = new MockExchangeFeed();
    await startThenStop(new Bot({ config: configFor(stateFile), feed, fundingSource: null }), feed);
  });

  it("applies explicit strategy policy fields and ignores unsupported configured timeframes", async () => {
    const feed = new MockExchangeFeed();
    const config: BotConfig = {
      ...configFor(stateFile),
      symbols: { enabled: ["BTC/USDC", "ETH/USDC"] },
      strategies: {
        ...configFor(stateFile).strategies,
        donchian_pivot_composition: {
          enabled: true,
          symbols: ["BTC/USDC", "XRP/USDC"],
          risk_per_trade: 0.01,
          max_positions: 1,
          leverage: 10,
          timeframes: { htf: "2h", mtf: "4h", ltf: "15m" },
        },
      },
    };
    const bot = new Bot({ config, feed });
    const running = bot.start();
    await waitFor(() => feed.subscriptionCount() === 5);
    // Two tickers, plus only the enabled BTC strategy's 4h/15m/1d timeframes.
    expect(feed.subscriptionCount()).toBe(5);
    await bot.stop();
    await running;
  });

  it("continues after Error and string OHLCV subscription failures", async () => {
    const logger = new RecordingLogger();
    const feed = new FailingOhlcvFeed();
    const config: BotConfig = {
      ...configFor(stateFile),
      strategies: {
        ...configFor(stateFile).strategies,
        donchian_pivot_composition: { enabled: true },
      },
    };
    await startThenStop(new Bot({ config, feed, logger }), feed);
    const warnings = logger.entries.filter((entry) =>
      entry.message.startsWith("[bot] OHLCV subscribe failed"),
    );
    expect(warnings.map((entry) => entry.meta?.["error"])).toEqual(
      expect.arrayContaining(["4h subscription failed", "15m subscription failed"]),
    );
  });

  it("forces cleanup after the configured graceful drain deadline", async () => {
    const logger = new RecordingLogger();
    const feed = new BlockingTickerFeed();
    const bot = new Bot({ config: configFor(stateFile), feed, logger, gracefulShutdownTimeoutMs: 0 });
    const running = bot.start();
    await waitFor(() => feed.tickerSubscriptionStarted);
    await bot.stop();
    feed.releaseTickerSubscription();
    await running;
    expect(
      logger.entries.some((entry) => entry.message === "[bot] graceful shutdown timeout — force-stopping"),
    ).toBe(true);
  });

  for (const failure of [
    { name: "Error", lifecycle: new Error("lifecycle Error"), close: new Error("close Error") },
    { name: "string", lifecycle: "lifecycle string", close: "close string" },
  ] as const) {
    it(`logs ${failure.name} cleanup boundary failures and still stops`, async () => {
      process.env["BYBIT_API_KEY"] = "public-boundary-key";
      process.env["BYBIT_API_SECRET"] = "public-boundary-secret";
      const logger = new RecordingLogger();
      const feed = new CleanupFailureFeed(failure.lifecycle, failure.close);
      const config = { ...configFor(stateFile), bot: { ...configFor(stateFile).bot, mode: "live" as const } };
      await startThenStop(new Bot({ config, feed, logger }), feed);
      expect(logger.entries).toContainEqual(
        expect.objectContaining({
          level: "warn",
          message: "[bot] private lifecycle cleanup failed",
          meta: { error: failure.name === "Error" ? "lifecycle Error" : "lifecycle string" },
        }),
      );
      expect(logger.entries).toContainEqual(
        expect.objectContaining({
          level: "error",
          message: "[bot] feed close failed",
          meta: { error: failure.name === "Error" ? "close Error" : "close string" },
        }),
      );
    });
  }

  it("keeps the last valid live equity when spot inventory is absent", async () => {
    process.env["BYBIT_API_KEY"] = "public-boundary-key";
    process.env["BYBIT_API_SECRET"] = "public-boundary-secret";
    const symbol = asSymbol("BTC/USDC") as ExchangeSymbol;
    const marketMeta = new Map<ExchangeSymbol, MarketMeta>([
      [
        symbol,
        {
          symbol,
          base: "BTC",
          quote: "USDC",
          amountPrecision: 4,
          pricePrecision: 2,
          minAmount: 0.0001,
          minCost: 1,
          isSpot: true,
        },
      ],
    ]);
    const feed = new ReconciliationFeed([{ currency: "USDC", free: 1_000, total: 1_000 }], [], {
      marketMeta,
    });
    const config = { ...configFor(stateFile), bot: { ...configFor(stateFile).bot, mode: "live" as const } };
    const bot = new Bot({ config, feed, heartbeatIntervalMs: 5, killSwitchEvalIntervalMs: 10_000 });
    const running = bot.start();
    await waitFor(() => feed.balanceCalls >= 2);
    expect(feed.tickerCalls).toBe(0);
    expect(bot.getState().equityUsd).toBe(1_000);
    await bot.stop();
    await running;
  });

  it("treats absent derivative UPL as zero during live reconciliation", async () => {
    process.env["BYBIT_API_KEY"] = "public-boundary-key";
    process.env["BYBIT_API_SECRET"] = "public-boundary-secret";
    const symbol = asSymbol("BTC/USDC") as ExchangeSymbol;
    const position: ExchangePosition = {
      symbol,
      side: "long",
      quantity: 1,
      entryPrice: 100,
      markPrice: 100,
      unrealizedPnl: undefined,
      updateTimestamp: Date.now(),
    };
    const feed = new ReconciliationFeed(
      [{ currency: "USDC", free: 1_000, total: 1_000 }],
      [{ currency: "USDC", free: 1_000, total: 1_000 }],
      {
        positions: [position],
        marketMeta: new Map([
          [
            symbol,
            {
              symbol,
              base: "BTC",
              quote: "USDC",
              amountPrecision: 4,
              pricePrecision: 2,
              minAmount: 0.0001,
              minCost: 1,
              isSpot: false,
            },
          ],
        ]),
      },
    );
    const config = { ...configFor(stateFile), bot: { ...configFor(stateFile).bot, mode: "live" as const } };
    const bot = new Bot({ config, feed, heartbeatIntervalMs: 5, killSwitchEvalIntervalMs: 10_000 });
    const running = bot.start();
    await waitFor(() => feed.positionCalls > 0);
    expect(bot.isKillSwitchEngaged()).toBe(false);
    await bot.stop();
    await running;
  });

  for (const failure of [new Error("balance Error"), "balance string"] as const) {
    it(`retains live equity and logs ${failure instanceof Error ? "Error" : "string"} reconciliation failures`, async () => {
      process.env["BYBIT_API_KEY"] = "public-boundary-key";
      process.env["BYBIT_API_SECRET"] = "public-boundary-secret";
      const logger = new RecordingLogger();
      const feed = new ReconciliationFeed([{ currency: "USDC", free: 1_000, total: 1_000 }], failure);
      const config = { ...configFor(stateFile), bot: { ...configFor(stateFile).bot, mode: "live" as const } };
      const bot = new Bot({ config, feed, logger, heartbeatIntervalMs: 5, killSwitchEvalIntervalMs: 10_000 });
      const running = bot.start();
      await waitFor(() =>
        logger.entries.some((entry) => entry.message === "[bot] authoritative equity reconciliation failed"),
      );
      expect(
        logger.entries.find((entry) => entry.message === "[bot] authoritative equity reconciliation failed")
          ?.meta?.["error"],
      ).toBe(failure instanceof Error ? failure.message : failure);
      await bot.stop();
      await running;
    });
  }

  it("restores every valid persisted position even when the configured capacity is one", async () => {
    const makePosition = (strategy: string, symbol: string): BotState["positions"][number] => ({
      id: `${strategy}:${symbol}:long`,
      strategy,
      symbol,
      side: "long",
      quantity: 0.01,
      entryPrice: 100,
      currentPrice: 100,
      leverage: 10,
      unrealizedPnl: 0,
      realizedPnl: 0,
      openedAt: Date.now() - 1_000,
      notionalUsd: 1,
    });
    const saved: BotState = {
      version: 1,
      savedAt: Date.now(),
      equityUsd: 10_000,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [makePosition("first", "BTC/USDC"), makePosition("second", "ETH/USDC")],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- per-test mkdtemp path
    writeFileSync(stateFile, JSON.stringify(saved), "utf8");
    const logger = new RecordingLogger();
    const feed = new MockExchangeFeed();
    const config = { ...configFor(stateFile), risk: { ...configFor(stateFile).risk, max_positions: 1 } };
    const bot = new Bot({ config, feed, logger });
    const running = bot.start();
    await waitFor(() => feed.subscriptionCount() > 0);
    expect(bot.getState().positions.map((position) => position.strategy)).toEqual(["first", "second"]);
    expect(
      logger.entries.some(
        (entry) => entry.message === "[bot] failed to restore position from state — skipping",
      ),
    ).toBe(false);
    await bot.stop();
    await running;
  });

  it("publishes telemetry for restored positions and clamps a nonpositive initial-equity projection", async () => {
    const saved: BotState = {
      version: 1,
      savedAt: Date.now(),
      equityUsd: 0,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [
        {
          id: "telemetry:BTC/USDC:long",
          strategy: "telemetry",
          symbol: "BTC/USDC",
          side: "long",
          quantity: 1,
          entryPrice: 10_001,
          currentPrice: 1,
          leverage: 10,
          unrealizedPnl: -10_000,
          realizedPnl: 0,
          openedAt: Date.now() - 1_000,
          notionalUsd: 10_001,
        },
      ],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- per-test mkdtemp path
    writeFileSync(stateFile, JSON.stringify(saved), "utf8");
    const feed = new MockExchangeFeed();
    const bot = new Bot({
      config: configFor(stateFile),
      feed,
      telemetryMetricsIntervalSec: 0.01,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
    });
    const running = bot.start();
    const logFile = join(`${stateFile}.logs`, `bot-${new Date().toISOString().slice(0, 10)}.log`);
    await waitFor(() => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- telemetry file under per-test mkdtemp path
      try {
        return readFileSync(logFile, "utf8").includes("unrealizedPnlUsd");
      } catch {
        return false;
      }
    });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- telemetry file under per-test mkdtemp path
    const log = readFileSync(logFile, "utf8");
    expect(log).toContain('"initialEquityUsd":0');
    expect(log).toContain('"unrealizedPnlUsd":-10000');
    await bot.stop();
    await running;
  });
});

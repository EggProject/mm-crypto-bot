import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import type { BotConfig } from "../config/schema.js";
import { BotExchangeInitializer } from "./bot-exchange-initializer.js";
import type { BotState } from "./state-store.js";
import {
  BlockingTickerFeed,
  Bot,
  CleanupFailureFeed,
  CountingOpenFeed,
  configFor,
  createPublicBoundaryTestFixture,
  disposePublicBoundaryTestFixture,
  FailingOhlcvFeed,
  RecordingLogger,
  startThenStop,
  type TestExchangeFactoryOptions,
  waitFor,
} from "./bot-public-boundaries.test-support.js";

describe("Bot public runtime boundaries", () => {
  let stateFile: string;
  let fixture: ReturnType<typeof createPublicBoundaryTestFixture>;

  beforeEach(() => {
    fixture = createPublicBoundaryTestFixture();
    stateFile = fixture.stateFile;
  });

  afterEach(() => {
    disposePublicBoundaryTestFixture(fixture);
  });

  it("rejects a mock production config when no test feed was supplied", async () => {
    await expect(new Bot({ config: configFor(stateFile) }).start()).rejects.toThrow("exchange.id = mock");
  });

  it("rejects an injected feed in live mode before opening it", async () => {
    const feed = new CountingOpenFeed();
    const config = {
      ...configFor(stateFile),
      bot: { ...configFor(stateFile).bot, mode: "live" as const },
      exchange: { ...configFor(stateFile).exchange, id: "bybiteu" as const },
    };

    await expect(new Bot({ config, feed }).start()).rejects.toThrow(
      "live mode prohibits injected exchange feeds",
    );
    expect(feed.openCalls).toBe(0);
  });

  it("rejects a custom exchange factory in live mode before it can create or open a feed", async () => {
    const feed = new CountingOpenFeed();
    let factoryCalls = 0;
    const config = {
      ...configFor(stateFile),
      bot: { ...configFor(stateFile).bot, mode: "live" as const },
      exchange: { ...configFor(stateFile).exchange, id: "bybiteu" as const },
    };

    await expect(
      new Bot({
        config,
        exchangeFeedFactory: () => {
          factoryCalls += 1;
          return feed;
        },
      }).start(),
    ).rejects.toThrow("live mode prohibits custom exchange feed factories");
    expect(factoryCalls).toBe(0);
    expect(feed.openCalls).toBe(0);
  });

  it("rejects a paper-order simulator in live mode before any exchange factory can run", async () => {
    const feed = new CountingOpenFeed();
    let factoryCalls = 0;
    const config = {
      ...configFor(stateFile),
      bot: { ...configFor(stateFile).bot, mode: "live" as const },
      exchange: { ...configFor(stateFile).exchange, id: "bybiteu" as const },
    };

    await expect(
      new Bot({
        config,
        paperOrderSimulator: () => "filled",
        exchangeFeedFactory: () => {
          factoryCalls += 1;
          return feed;
        },
      }).start(),
    ).rejects.toThrow("live mode prohibits paper order simulators");
    expect(factoryCalls).toBe(0);
    expect(feed.openCalls).toBe(0);
  });

  it("uses the fixed internal factory for a live construction without public overrides", async () => {
    process.env["BYBIT_API_KEY"] = "public-boundary-key";
    process.env["BYBIT_API_SECRET"] = "public-boundary-secret";
    let paperFactoryCalls = 0;
    const config = {
      ...configFor(stateFile),
      bot: { ...configFor(stateFile).bot, mode: "live" as const },
      exchange: { ...configFor(stateFile).exchange, id: "bybiteu" as const },
    };

    await expect(
      new BotExchangeInitializer().initialize({
        config,
        injectedFeed: undefined,
        paperExchangeFeedFactory: () => {
          paperFactoryCalls += 1;
          return new MockExchangeFeed();
        },
        hasCustomExchangeFeedFactory: false,
        logger: new RecordingLogger(),
        apiKey: process.env["BYBIT_API_KEY"],
        apiSecret: process.env["BYBIT_API_SECRET"],
        assignFeed: () => {
          throw new Error("test boundary: stop before feed opening");
        },
      }),
    ).rejects.toThrow("test boundary: stop before feed opening");
    expect(paperFactoryCalls).toBe(0);
  });

  it("accepts an injected feed in paper mode", async () => {
    const feed = new MockExchangeFeed();
    await startThenStop(new Bot({ config: configFor(stateFile), feed }), feed);
  });

  it("constructs unauthenticated paper market data with only approved factory options", async () => {
    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];
    const feed = new MockExchangeFeed();
    const calls: TestExchangeFactoryOptions[] = [];
    const config = {
      ...configFor(stateFile),
      exchange: {
        ...configFor(stateFile).exchange,
        id: "bybiteu" as const,
      },
    };
    const bot = new Bot({
      config,
      exchangeFeedFactory: (options: TestExchangeFactoryOptions) => {
        calls.push(options);
        return feed;
      },
    });
    await startThenStop(bot, feed);
    expect(calls).toEqual([
      {
        override: { apiKey: "", secret: "" },
        rateLimitMs: config.exchange.rate_limit_ms,
        timeoutMs: config.exchange.timeout_ms,
      },
    ]);
  });

  it("constructs authenticated paper data with only approved factory options", async () => {
    process.env["BYBIT_API_KEY"] = "public-boundary-key";
    process.env["BYBIT_API_SECRET"] = "public-boundary-secret";
    const feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 1234, total: 1234 }] });
    const calls: TestExchangeFactoryOptions[] = [];
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
        timeoutMs: config.exchange.timeout_ms,
      },
    ]);
  });

  it("keeps paper start and stop working across credential states", async () => {
    const calls: TestExchangeFactoryOptions[] = [];

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
        exchangeFeedFactory: (options: TestExchangeFactoryOptions) => {
          calls.push(options);
          return publicFeed;
        },
      }),
      publicFeed,
    );

    process.env["BYBIT_API_KEY"] = "public-boundary-key";
    process.env["BYBIT_API_SECRET"] = "public-boundary-secret";
    const authenticatedFeed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 1000, total: 1000 }],
    });
    const authenticatedConfig = {
      ...configFor(stateFile),
      exchange: {
        ...configFor(stateFile).exchange,
        id: "bybiteu" as const,
      },
    };
    await startThenStop(
      new Bot({
        config: authenticatedConfig,
        exchangeFeedFactory: (options: TestExchangeFactoryOptions) => {
          calls.push(options);
          return authenticatedFeed;
        },
      }),
      authenticatedFeed,
    );

    expect(calls).toEqual([
      {
        override: { apiKey: "", secret: "" },
        rateLimitMs: publicConfig.exchange.rate_limit_ms,
        timeoutMs: publicConfig.exchange.timeout_ms,
      },
      {
        rateLimitMs: authenticatedConfig.exchange.rate_limit_ms,
        timeoutMs: authenticatedConfig.exchange.timeout_ms,
      },
    ]);
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
    await startThenStop(new Bot({ config: configFor(stateFile), feed }), feed);
  });

  it("keeps feeds live when paper emergency close remains unresolved and joins the duplicate trigger", async () => {
    const saved: BotState = {
      version: 1,
      savedAt: Date.now(),
      equityUsd: 10_000,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [
        {
          id: "emergency:BTC/USDC:long",
          strategy: "emergency",
          symbol: "BTC/USDC",
          side: "long",
          quantity: 0.01,
          entryPrice: 100,
          currentPrice: 100,
          leverage: 10,
          unrealizedPnl: 0,
          realizedPnl: 0,
          openedAt: Date.now() - 1000,
          notionalUsd: 1,
        },
      ],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- per-test mkdtemp path
    writeFileSync(stateFile, JSON.stringify(saved), "utf8");
    const logger = new RecordingLogger();
    const feed = new MockExchangeFeed();
    const bot = new Bot({
      config: configFor(stateFile),
      feed,
      logger,
      heartbeatIntervalMs: 50,
      killSwitchEvalIntervalMs: 10_000,
      paperOrderSimulator: () => "unfilled",
      perStrategyKillSwitches: [
        {
          id: "unresolved-emergency",
          description: "exercises the unresolved emergency boundary",
          evaluate: () => ({
            switchId: "unresolved-emergency",
            engaged: true,
            reason: "unresolved emergency test",
          }),
        },
      ],
    });
    const running = bot.start();
    await waitFor(() => {
      return logger.entries.some((entry) => entry.event === "bot.emergency.close.report");
    });

    expect(bot.isKillSwitchEngaged()).toBe(true);
    expect(bot.getState().positions).toHaveLength(1);
    expect(
      logger.entries.filter((entry) => entry.event === "bot.emergency.coordinator.engaged"),
    ).toHaveLength(1);
    expect(
      logger.entries.some((entry) => {
        const unresolved = entry.fields?.["unresolved"];
        return (
          entry.event === "bot.emergency.close.report" && Array.isArray(unresolved) && unresolved.length > 0
        );
      }),
    ).toBe(true);

    await bot.stop();
    await running;
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
    const warnings = logger.entries.filter((entry) => entry.event === "bot.ohlcv.subscribe.failed");
    expect(warnings.some((entry) => entry.fields?.["error"] === "4h subscription failed")).toBe(true);
    expect(warnings.some((entry) => entry.fields?.["error"] === "15m subscription failed")).toBe(true);
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
    expect(logger.entries.some((entry) => entry.event === "bot.lifecycle.shutdown.timeout")).toBe(true);
  });

  for (const failure of [
    { name: "Error", close: new Error("close Error") },
    { name: "string", close: "close string" },
  ] as const) {
    it(`logs ${failure.name} paper feed-close boundary failures and still stops`, async () => {
      const logger = new RecordingLogger();
      const feed = new CleanupFailureFeed(failure.close);
      const config = configFor(stateFile);
      await startThenStop(new Bot({ config, feed, logger }), feed);
      const expectedCloseError = failure.name === "Error" ? "close Error" : "close string";
      expect(
        logger.entries.some(
          (entry) =>
            entry.level === "error" &&
            entry.event === "bot.feed.close.failed" &&
            entry.fields?.["error"] === expectedCloseError,
        ),
      ).toBe(true);
    });
  }
});

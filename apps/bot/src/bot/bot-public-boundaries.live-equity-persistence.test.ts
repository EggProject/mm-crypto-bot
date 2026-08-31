import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";

import {
  asSymbol,
  type Balance,
  type ExchangeFeed,
  type ExchangePosition,
  type MarketMeta,
  type Symbol as ExchangeSymbol,
  type Ticker,
} from "@mm-crypto-bot/exchange";
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";

import type { BotState } from "./state-store.js";
import { BotRuntimeAssembly, type BotRuntimeAssemblyResult } from "./bot-runtime-assembly.js";
import { BotRuntimeController } from "./bot-runtime-controller.js";
import {
  LiveEquityAuthority,
  PreparedLiveEquityAuthority,
  liveEquitySystemClock,
} from "./live-equity-authority.js";
import type { TelemetrySnapshot } from "./telemetry.js";
import {
  Bot,
  configFor,
  createPublicBoundaryTestFixture,
  disposePublicBoundaryTestFixture,
  ReconciliationFeed,
  RecordingLogger,
  waitFor,
} from "./bot-public-boundaries.test-support.js";

interface RuntimeControllerFixture {
  readonly controller: BotRuntimeController;
  readonly assembly: BotRuntimeAssemblyResult;
  dispose(): Promise<void>;
}

interface DeferredTicker {
  readonly promise: Promise<Ticker>;
  resolve(ticker: Ticker): void;
}

class AuthorityFeed extends MockExchangeFeed {
  private balanceIndex = 0;
  private readonly tickerDeferred = new Map<ExchangeSymbol, DeferredTicker>();
  public readonly tickerRequests: ExchangeSymbol[] = [];

  public constructor(
    private readonly balanceSnapshots: readonly (readonly Balance[] | Error)[],
    deferredTickers: readonly ExchangeSymbol[] = [],
    options: ConstructorParameters<typeof MockExchangeFeed>[0] = {},
  ) {
    super(options);
    for (const symbol of deferredTickers) this.tickerDeferred.set(symbol, Promise.withResolvers<Ticker>());
  }

  public override fetchBalances(): Promise<readonly Balance[]> {
    const snapshot = this.balanceSnapshots[Math.min(this.balanceIndex, this.balanceSnapshots.length - 1)];
    this.balanceIndex += 1;
    if (snapshot instanceof Error) return Promise.reject(snapshot);
    if (snapshot === undefined)
      return Promise.reject(new Error("authority test feed has no balance snapshot"));
    return Promise.resolve(snapshot);
  }

  public override fetchTickerSnapshot(symbol: ExchangeSymbol): Promise<Ticker> {
    this.tickerRequests.push(symbol);
    const deferred = this.tickerDeferred.get(symbol);
    return deferred === undefined ? super.fetchTickerSnapshot(symbol) : deferred.promise;
  }

  public resolveTicker(symbol: ExchangeSymbol, ticker: Ticker): void {
    const deferred = this.tickerDeferred.get(symbol);
    if (deferred === undefined) throw new Error(`authority test feed did not defer ${symbol}`);
    deferred.resolve(ticker);
  }
}

function createLiveAuthority(
  feed: ExchangeFeed,
  symbols: readonly ExchangeSymbol[],
  now = 100,
): LiveEquityAuthority {
  return new LiveEquityAuthority({
    feed,
    symbols,
    maxAgeMs: 10,
    now: () => now,
    maxDrawdownFraction: "0.1",
  });
}

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

function markRunExited(): void {
  return;
}

async function expectPromiseToThrow(operation: Promise<unknown>): Promise<void> {
  let thrown: unknown;
  try {
    await operation;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
}

async function createLiveReconciliationController(
  config: ReturnType<typeof configFor>,
  feed: ExchangeFeed,
  logger: RecordingLogger,
): Promise<RuntimeControllerFixture> {
  await feed.open();
  const liveConfig = { ...config, bot: { ...config.bot, mode: "live" as const } };
  const preparedLiveEquity = await PreparedLiveEquityAuthority.prepare({
    feed,
    symbols: liveConfig.symbols.enabled.map((symbol) => asSymbol(symbol)),
    maxAgeMs: 60_000,
    now: liveEquitySystemClock,
    maxDrawdownFraction: liveConfig.risk.max_drawdown_pct.toString(),
  });
  const assembly = await BotRuntimeAssembly.create({
    config: liveConfig,
    feed,
    initialEquity: 1000,
    preparedLiveEquity,
    fundingSource: undefined,
    sizingFn: undefined,
    perStrategyKillSwitches: undefined,
    telemetryMetricsIntervalSec: 60,
    logger,
    createEmergencyHandler: createNoOpEmergencyHandler,
    snapshotProvider: () => telemetrySnapshot(),
  });
  const controller = new BotRuntimeController({
    config: liveConfig,
    logger,
    context: assembly.context,
    strategyInstances: assembly.strategyInstances,
    heartbeatIntervalMs: 60_000,
    isRunning: () => false,
    isStopRequested: () => true,
    markRunExited,
  });
  return {
    controller,
    assembly,
    async dispose(): Promise<void> {
      assembly.context.telemetry.stop();
      await assembly.orderManager.stopLifecycle();
      assembly.context.runner.dispose();
      await feed.close();
    },
  };
}

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

  it("fails closed when a later live balance snapshot omits USDC", async () => {
    const symbol = asSymbol("BTC/USDC");
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
    const feed = new ReconciliationFeed([{ currency: "USDC", free: 1000, total: 1000 }], [], {
      marketMeta,
    });
    const logger = new RecordingLogger();
    const runtime = await createLiveReconciliationController(configFor(stateFile), feed, logger);
    try {
      await expectPromiseToThrow(runtime.controller.reconcileAuthoritativeEquity());
      expect(feed.tickerCalls).toBe(0);
      expect(runtime.controller.getLiveEquityAuthoritySnapshot()?.state).toBe("unavailable");
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects derivative metadata before constructing a live runtime", async () => {
    const symbol = asSymbol("BTC/USDC");
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
      [{ currency: "USDC", free: 1000, total: 1000 }],
      [{ currency: "USDC", free: 1000, total: 1000 }],
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
    const logger = new RecordingLogger();
    await expectPromiseToThrow(createLiveReconciliationController(configFor(stateFile), feed, logger));
    expect(feed.positionCalls).toBe(0);
  });

  for (const failure of [new Error("balance Error"), "balance string"] as const) {
    it(`fails closed on ${failure instanceof Error ? "Error" : "string"} reconciliation failures`, async () => {
      const logger = new RecordingLogger();
      const feed = new ReconciliationFeed([{ currency: "USDC", free: 1000, total: 1000 }], failure);
      const runtime = await createLiveReconciliationController(configFor(stateFile), feed, logger);
      try {
        await expectPromiseToThrow(runtime.controller.reconcileAuthoritativeEquity());
        expect(runtime.controller.getLiveEquityAuthoritySnapshot()?.state).toBe("unavailable");
      } finally {
        await runtime.dispose();
      }
    });
  }

  it("keeps an emergency latch through successful recovery and failed refresh until a new authority exists", async () => {
    const feed = new AuthorityFeed([
      [{ currency: "USDC", free: 1000, total: 1000 }],
      [{ currency: "USDC", free: 800, total: 800 }],
      [{ currency: "USDC", free: 1000, total: 1000 }],
      new Error("venue unavailable"),
    ]);
    await feed.open();
    const authority = createLiveAuthority(feed, [asSymbol("BTC/USDC")]);
    await authority.refresh();
    await authority.refresh();
    expect(authority.getSnapshot().state).toBe("emergency_latched");
    await authority.refresh();
    expect(authority.getSnapshot().state).toBe("emergency_latched");
    await expectPromiseToThrow(authority.refresh());
    expect(authority.getSnapshot().state).toBe("emergency_latched");

    const replacementFeed = new AuthorityFeed([[{ currency: "USDC", free: 1000, total: 1000 }]]);
    await replacementFeed.open();
    const replacement = createLiveAuthority(replacementFeed, [asSymbol("BTC/USDC")]);
    await replacement.refresh();
    expect(replacement.getSnapshot().state).toBe("fresh");
  });

  it("rejects invalid authority construction, future or fractional ticker timestamps, and unknown zero assets", async () => {
    const symbol = asSymbol("BTC/USDC");
    const baseFeed = new AuthorityFeed([[{ currency: "USDC", free: 1000, total: 1000 }]]);
    expect(
      () =>
        new LiveEquityAuthority({
          feed: baseFeed,
          symbols: [symbol],
          maxAgeMs: 0,
          now: () => 100,
          maxDrawdownFraction: "0.1",
        }),
    ).toThrow();

    for (const timestamp of [101, 100.5, Infinity]) {
      const feed = new AuthorityFeed([
        [
          { currency: "USDC", free: 1000, total: 1000 },
          { currency: "BTC", free: 1, total: 1 },
        ],
      ]);
      await feed.open();
      feed.setTicker(symbol, {
        symbol,
        timestamp,
        bid: 99,
        ask: 101,
        last: 100,
        baseVolume: 0,
        quoteVolume: 0,
      });
      await expectPromiseToThrow(createLiveAuthority(feed, [symbol]).refresh());
    }

    const unknownZeroAsset = new AuthorityFeed([
      [
        { currency: "USDC", free: 1000, total: 1000 },
        { currency: "UNSUPPORTED", free: 0, total: 0 },
      ],
    ]);
    await unknownZeroAsset.open();
    await expectPromiseToThrow(createLiveAuthority(unknownZeroAsset, [symbol]).refresh());
  });

  it("starts every required positive-asset ticker request before any response resolves", async () => {
    const btc = asSymbol("BTC/USDC");
    const eth = asSymbol("ETH/USDC");
    const feed = new AuthorityFeed(
      [
        [
          { currency: "USDC", free: 800, total: 800 },
          { currency: "BTC", free: 1, total: 1 },
          { currency: "ETH", free: 1, total: 1 },
        ],
      ],
      [btc, eth],
    );
    await feed.open();
    const refresh = createLiveAuthority(feed, [btc, eth]).refresh();
    await waitFor(() => feed.tickerRequests.length === 2);
    expect(feed.tickerRequests).toEqual([btc, eth]);
    feed.resolveTicker(btc, {
      symbol: btc,
      timestamp: 100,
      bid: 99,
      ask: 101,
      last: 100,
      baseVolume: 0,
      quoteVolume: 0,
    });
    feed.resolveTicker(eth, {
      symbol: eth,
      timestamp: 100,
      bid: 99,
      ask: 101,
      last: 100,
      baseVolume: 0,
      quoteVolume: 0,
    });
    await refresh;
  });

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
      openedAt: Date.now() - 1000,
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
    expect(logger.entries.some((entry) => entry.event === "bot.positions.state.restore.failed")).toBe(false);
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
          openedAt: Date.now() - 1000,
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
    const logger = new RecordingLogger();
    const bot = new Bot({
      config: configFor(stateFile),
      feed,
      logger,
      telemetryMetricsIntervalSec: 0.01,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
    });
    const running = bot.start();
    await waitFor(() => {
      return logger.entries.some((entry) => entry.event === "telemetry.metrics.observed");
    });
    const telemetryEntry = logger.entries.find((entry) => entry.event === "telemetry.metrics.observed");
    expect(telemetryEntry?.fields).toMatchObject({ initialEquityUsd: 0, unrealizedPnlUsd: -10_000 });
    await bot.stop();
    await running;
  });
});

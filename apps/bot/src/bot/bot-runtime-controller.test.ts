import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { asSymbol, type MarketMeta, type Ticker } from "@mm-crypto-bot/exchange";
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import { RecordingLogger } from "@logging-testing";

import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";

import { BotRuntimeAssembly, type BotRuntimeAssemblyResult } from "./bot-runtime-assembly.js";
import { BotRuntimeController } from "./bot-runtime-controller.js";
import {
  LiveEquityAuthority,
  PreparedLiveEquityAuthority,
  createLiveEquityPreparationRequest,
  liveEquitySystemClock,
  receivedNumberToExactRational,
} from "./live-equity-authority.js";
import { MockDydxFundingSource } from "./mock-dydx-funding-source.js";
import type { TelemetrySnapshot } from "./telemetry.js";

interface RuntimeControllerFixture {
  readonly controller: BotRuntimeController;
  readonly assembly: BotRuntimeAssemblyResult;
  dispose(): Promise<void>;
}
function buildTestConfig(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile, mode: "live" },
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
async function createRuntimeController(
  config: BotConfig,
  feed: MockExchangeFeed,
  fundingSource?: MockDydxFundingSource,
  preparedLiveEquity?: PreparedLiveEquityAuthority,
): Promise<RuntimeControllerFixture> {
  const logger = new RecordingLogger();
  await feed.open();
  const prepared =
    config.bot.mode === "live"
      ? (preparedLiveEquity ??
        (await PreparedLiveEquityAuthority.prepare({
          feed,
          symbols: config.symbols.enabled.map((symbol) => asSymbol(symbol)),
          maxAgeMs: 60_000,
          now: liveEquitySystemClock,
          maxDrawdownFraction: config.risk.max_drawdown_pct.toString(),
        })))
      : undefined;
  const assembly = await BotRuntimeAssembly.create({
    config,
    feed,
    initialEquity: 1000,
    ...(prepared !== undefined && { preparedLiveEquity: prepared }),
    fundingSource,
    sizingFn: undefined,
    perStrategyKillSwitches: undefined,
    telemetryMetricsIntervalSec: 60,
    logger,
    createEmergencyHandler: (portfolioManager) => async () => {
      await portfolioManager.executeCloseAll();
    },
    snapshotProvider: () => telemetrySnapshot(),
  });
  const runExitEvents: string[] = [];
  const controller = new BotRuntimeController({
    config,
    logger,
    context: assembly.context,
    strategyInstances: assembly.strategyInstances,
    heartbeatIntervalMs: 60_000,
    isRunning: () => false,
    isStopRequested: () => true,
    markRunExited: () => {
      runExitEvents.push("run-exited");
    },
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
async function reconcileLiveEquity(config: BotConfig, feed: MockExchangeFeed, afterPreparation?: () => void) {
  const fixture = await createRuntimeController(config, feed);
  try {
    afterPreparation?.();
    await fixture.controller.reconcileAuthoritativeEquity();
    return fixture.controller.getLiveEquityAuthoritySnapshot();
  } finally {
    await fixture.dispose();
  }
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
describe("BotRuntimeController", () => {
  let temporaryDirectory: string;
  let stateFile: string;
  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-bot-runtime-controller-test-"));
    stateFile = path.join(temporaryDirectory, "bot-state.json");
  });
  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("subscribes every canonical strategy-instance timeframe once", async () => {
    const baseConfig = buildTestConfig(stateFile);
    const config: BotConfig = {
      ...baseConfig,
      strategies: {
        ...baseConfig.strategies,
        donchian_pivot_composition: { enabled: true },
      },
    };
    const feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 1000, total: 1000 }] });
    const fixture = await createRuntimeController(config, feed);
    try {
      await fixture.controller.run();

      expect(feed.subscriptionCount()).toBe(4);
    } finally {
      await fixture.dispose();
    }
  });

  it("does not derive OHLCV subscriptions from an enabled plugin instance", async () => {
    const baseConfig = buildTestConfig(stateFile);
    const config: BotConfig = {
      ...baseConfig,
      strategies: {
        ...baseConfig.strategies,
        regime_detector: { enabled: true },
      },
    };
    const feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 1000, total: 1000 }] });
    const fixture = await createRuntimeController(config, feed);
    try {
      await fixture.controller.run();

      expect(feed.subscriptionCount()).toBe(1);
    } finally {
      await fixture.dispose();
    }
  });

  describe("authoritative live equity", () => {
    it("retains the initialized authority object and startup evidence through the controller", async () => {
      const feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 1000, total: 1000 }] });
      const config = buildTestConfig(stateFile);
      await feed.open();
      const prepared = await PreparedLiveEquityAuthority.prepare({
        feed,
        symbols: [asSymbol("BTC/USDC")],
        maxAgeMs: 60_000,
        now: liveEquitySystemClock,
        maxDrawdownFraction: config.risk.max_drawdown_pct.toString(),
      });
      const fixture = await createRuntimeController(config, feed, undefined, prepared);
      try {
        expect(fixture.assembly.context.preparedLiveEquity).toBe(prepared);
        expect(fixture.controller.getLiveEquityStartupEvidence()).toBe(prepared.evidence);
      } finally {
        await fixture.dispose();
      }
    });

    it("exposes an unforgeable frozen authority and evidence pair", async () => {
      const feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 1000, total: 1000 }] });
      const symbol = asSymbol("BTC/USDC");
      await feed.open();
      const first = await PreparedLiveEquityAuthority.prepare({
        feed,
        symbols: [symbol],
        maxAgeMs: 60_000,
        now: liveEquitySystemClock,
        maxDrawdownFraction: "0.1",
      });
      const second = await PreparedLiveEquityAuthority.prepare({
        feed,
        symbols: [symbol],
        maxAgeMs: 60_000,
        now: liveEquitySystemClock,
        maxDrawdownFraction: "0.1",
      });
      const forged: object = {};
      Object.setPrototypeOf(forged, PreparedLiveEquityAuthority.prototype);
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(PreparedLiveEquityAuthority)).toBe(true);
      expect(Reflect.set(first, "evidence", second.evidence)).toBe(false);
      expect(first.evidence).not.toBe(second.evidence);
      expect(first.authority).not.toBe(second.authority);
      expect(() =>
        PreparedLiveEquityAuthority.require(
          forged,
          createLiveEquityPreparationRequest({
            feed,
            symbols: [symbol],
            maxAgeMs: 60_000,
            now: liveEquitySystemClock,
            maxDrawdownFraction: "0.1",
          }),
          1000,
        ),
      ).toThrow(/authentic/);
      await feed.close();
    });

    it("retains an explicitly supplied funding source in the assembled runtime", async () => {
      const feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 1000, total: 1000 }] });
      const fundingSource = new MockDydxFundingSource();
      const fixture = await createRuntimeController(buildTestConfig(stateFile), feed, fundingSource);
      try {
        expect(fixture.assembly.fundingSource).toBe(fundingSource);
      } finally {
        await fixture.dispose();
      }
    });

    it("does not reconcile authoritative equity outside live mode", async () => {
      const feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 1000, total: 1000 }] });
      const liveConfig = buildTestConfig(stateFile);
      const config = {
        ...liveConfig,
        bot: { ...liveConfig.bot, mode: "paper" as const },
      };
      expect(await reconcileLiveEquity(config, feed)).toBeUndefined();
    });

    it("values configured spot inventory from venue balances", async () => {
      const symbol = asSymbol("BTC/USDC");
      const spotFeed = new MockExchangeFeed({
        balances: [
          { currency: "USDC", free: 1000, total: 1000 },
          { currency: "BTC", free: 0, total: 0 },
        ],
      });
      const ticker: Ticker = {
        symbol,
        timestamp: Date.now(),
        bid: 99,
        ask: 101,
        last: 100,
        baseVolume: 0,
        quoteVolume: 0,
      };
      spotFeed.setTicker(symbol, ticker);
      const snapshot = await reconcileLiveEquity(buildTestConfig(stateFile), spotFeed, () => {
        spotFeed.setBalance("BTC", 2, 2);
      });
      expect(snapshot?.current).toMatchObject({
        numerator: "1200",
        denominator: "1",
      });
    });

    it("fails closed when a configured market is not spot", async () => {
      const symbol = asSymbol("BTC/USDC");
      const derivativeMeta: MarketMeta = {
        symbol,
        base: "BTC",
        quote: "USDC",
        amountPrecision: 4,
        pricePrecision: 2,
        minAmount: 0.0001,
        minCost: 1,
        isSpot: false,
      };
      const derivativeFeed = new MockExchangeFeed({
        balances: [
          { currency: "USDC", free: 1000, total: 1000 },
          { currency: "BTC", free: 2, total: 2 },
        ],
        marketMeta: new Map([[symbol, derivativeMeta]]),
        positions: [
          {
            symbol,
            side: "long",
            quantity: 2,
            entryPrice: 100,
            markPrice: 105,
            unrealizedPnl: 10,
            updateTimestamp: Date.now(),
          },
        ],
      });
      await expectPromiseToThrow(reconcileLiveEquity(buildTestConfig(stateFile), derivativeFeed));
    });

    it("fails closed for a mixed spot and derivative configured scope", async () => {
      const btc = asSymbol("BTC/USDC");
      const eth = asSymbol("ETH/USDC");
      const mixedFeed = new MockExchangeFeed({
        balances: [
          { currency: "USDC", free: 1000, total: 1000 },
          { currency: "BTC", free: 1, total: 1 },
        ],
        marketMeta: new Map([
          [
            btc,
            {
              symbol: btc,
              base: "BTC",
              quote: "USDC",
              amountPrecision: 4,
              pricePrecision: 2,
              minAmount: 0.0001,
              minCost: 1,
              isSpot: true,
            },
          ],
          [
            eth,
            {
              symbol: eth,
              base: "ETH",
              quote: "USDC",
              amountPrecision: 4,
              pricePrecision: 2,
              minAmount: 0.0001,
              minCost: 1,
              isSpot: false,
            },
          ],
        ]),
        positions: [
          {
            symbol: eth,
            side: "short",
            quantity: 1,
            entryPrice: 10,
            markPrice: 12,
            unrealizedPnl: -5,
            updateTimestamp: Date.now(),
          },
        ],
      });
      mixedFeed.setTicker(btc, {
        symbol: btc,
        timestamp: Date.now(),
        bid: 99,
        ask: 101,
        last: 100,
        baseVolume: 0,
        quoteVolume: 0,
      });
      const config = {
        ...buildTestConfig(stateFile),
        symbols: { enabled: [btc, eth] },
      };
      await expectPromiseToThrow(reconcileLiveEquity(config, mixedFeed));
    });

    it("rejects invalid derivative market metadata before live runtime construction", async () => {
      const symbol = asSymbol("BTC/USDC");
      const derivativeFeed = new MockExchangeFeed({
        balances: [{ currency: "USDC", free: 1000, total: 1000 }],
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
      });
      const baseConfig = buildTestConfig(stateFile);
      const config: BotConfig = {
        ...baseConfig,
        risk: { ...baseConfig.risk, max_drawdown_pct: 0.1 },
      };
      await expectPromiseToThrow(createRuntimeController(config, derivativeFeed));
    });
  });
});

describe("live exact authority", () => {
  it.each([
    [1e-7, { numerator: "1", denominator: "10000000" }],
    [1e21, { numerator: "1000000000000000000000", denominator: "1" }],
    [12.5, { numerator: "25", denominator: "2" }],
  ])("preserves received IEEE number %s as exact decimal", (received, expected) => {
    expect(receivedNumberToExactRational(received).toSnapshot()).toMatchObject(expected);
  });

  it.each([NaN, Infinity, -0, -1])("rejects invalid transport %s", (received) => {
    expect(() => receivedNumberToExactRational(received)).toThrow();
  });

  it("values spot inventory exactly and rejects stale admission", async () => {
    const symbol = asSymbol("BTC/USDC");
    const feed = new MockExchangeFeed({
      balances: [
        { currency: "USDC", free: 1000, total: 1000 },
        { currency: "BTC", free: 2, total: 2 },
      ],
      marketMeta: new Map([
        [
          symbol,
          {
            symbol,
            base: "BTC",
            quote: "USDC",
            amountPrecision: 8,
            pricePrecision: 8,
            minAmount: 0.00000001,
            minCost: 1,
            isSpot: true,
          },
        ],
      ]),
    });
    await feed.open();
    feed.setTicker(symbol, {
      symbol,
      timestamp: 100,
      bid: 99,
      ask: 101,
      last: 100,
      baseVolume: 0,
      quoteVolume: 0,
    });
    const authority = new LiveEquityAuthority({
      feed,
      symbols: [symbol],
      maxAgeMs: 1,
      now: () => 100,
      maxDrawdownFraction: "0.1",
    });
    await authority.refresh();
    expect(authority.getSnapshot().current?.numerator).toBe("1200");
    authority.assertEntryAllowed();
    const stale = new LiveEquityAuthority({
      feed,
      symbols: [symbol],
      maxAgeMs: 1,
      now: () => 103,
      maxDrawdownFraction: "0.1",
    });
    await expectPromiseToThrow(stale.refresh());
    expect(() => {
      stale.assertEntryAllowed();
    }).toThrow();
  });
});

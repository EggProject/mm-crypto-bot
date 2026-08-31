import { describe, expect, it } from "vitest";

import type { Strategy, StrategySignal } from "@mm-crypto-bot/core";
import { asSymbol, type Ohlcv, type Symbol as ExchangeSymbol, type Timeframe } from "@mm-crypto-bot/exchange";
import { RecordingLogger } from "@logging-testing";

import type { StrategyName } from "../config/schema.js";
import type { BotStrategyInstance } from "../config/strategy-registry.js";
import type { PortfolioManager } from "../portfolio/index.js";
import { ImmediateFillFeed, makeStack } from "../portfolio/portfolio-manager.test-support.js";
import { PositionManager } from "./strategy-runner.test-support.js";
import type { PositionManager as RuntimePositionManager, PositionSnapshot } from "./position-manager.js";
import type { StrategyRuntimePolicy } from "./strategy-runner.types.js";
import { StrategyMarketEventController } from "./strategy-runner-market-event-controller.js";

class SymbolRecorder {
  public readonly symbols: string[] = [];

  public readonly record = (symbol: string): Promise<void> => {
    this.symbols.push(symbol);
    return Promise.resolve();
  };
}

interface TrailingCloseRequest {
  readonly positionId: string;
  readonly closePrice: number;
  readonly reason: string;
}

interface ControllerHarness {
  readonly controller: StrategyMarketEventController;
  readonly logger: RecordingLogger;
  readonly pendingOrders: SymbolRecorder;
  readonly riskCloses: SymbolRecorder;
  readonly trailingCloseRequests: readonly TrailingCloseRequest[];
  readonly handledSignals: readonly StrategyName[];
}

interface ControllerOptions {
  readonly instances?: ReadonlyMap<StrategyName, BotStrategyInstance>;
  readonly positionManager?: RuntimePositionManager;
  readonly enabledSymbols?: ReadonlySet<ExchangeSymbol>;
  readonly strategyPolicies?: ReadonlyMap<StrategyName, StrategyRuntimePolicy>;
  readonly findOpenPosition?: (
    strategyName: StrategyName,
    symbol: ExchangeSymbol,
  ) => PositionSnapshot | undefined;
  readonly getPortfolioManager?: () => PortfolioManager | undefined;
  readonly handleSignal?: (strategyName: StrategyName) => Promise<void>;
}

function makePositionManager(): PositionManager {
  return new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
}

function createController(options: ControllerOptions = {}): ControllerHarness {
  const pendingOrders = new SymbolRecorder();
  const riskCloses = new SymbolRecorder();
  const trailingCloseRequests: TrailingCloseRequest[] = [];
  const handledSignals: StrategyName[] = [];
  const logger = new RecordingLogger();
  const controller = new StrategyMarketEventController({
    instances: options.instances ?? new Map(),
    positionManager: options.positionManager ?? makePositionManager(),
    enabledSymbols: options.enabledSymbols ?? new Set([asSymbol("BTC/USDC")]),
    strategyPolicies: options.strategyPolicies ?? new Map(),
    logger,
    isOrderEmissionBlocked: () => false,
    reconcilePendingOrders: pendingOrders.record,
    reconcileRiskCloses: riskCloses.record,
    processPlugins: () => Promise.resolve(),
    findOpenPosition:
      options.findOpenPosition ??
      (() => {
        return;
      }),
    enforceProtection: () => Promise.resolve(false),
    getPortfolioManager:
      options.getPortfolioManager ??
      (() => {
        return;
      }),
    requestTrailingStopClose: (positionId, closePrice, reason) => {
      trailingCloseRequests.push({ positionId, closePrice, reason });
      return Promise.resolve();
    },
    handleSignal: (strategyName) => {
      handledSignals.push(strategyName);
      return options.handleSignal?.(strategyName) ?? Promise.resolve();
    },
  });
  return { controller, logger, pendingOrders, riskCloses, trailingCloseRequests, handledSignals };
}

function strategyInstance(
  name: StrategyName,
  strategy: Strategy,
): readonly [StrategyName, BotStrategyInstance] {
  return [name, { kind: "strategy", name, instance: strategy }];
}

function ohlcvEvent(symbol: ExchangeSymbol, timeframe: Timeframe, candle: Ohlcv = [1, 100, 104, 99, 103, 1]) {
  return { kind: "ohlcv" as const, payload: { symbol, timeframe, candle } };
}

function noSignal(): undefined {
  return;
}

const strategyName: StrategyName = "donchian_pivot_composition";

describe("StrategyMarketEventController", () => {
  it("records an enabled ticker as the latest price and reconciles its symbol", async () => {
    const symbol = asSymbol("BTC/USDC");
    const harness = createController({ enabledSymbols: new Set([symbol]) });

    await harness.controller.onFeedEventSerial({
      kind: "ticker",
      payload: {
        symbol,
        timestamp: 1,
        bid: 99,
        ask: 101,
        last: 100,
        baseVolume: 1,
        quoteVolume: 100,
      },
    });

    expect(harness.controller.getLatestPrice(symbol)).toBe(100);
    expect(harness.controller.getTicksProcessed()).toBe(1);
    expect(harness.pendingOrders.symbols).toEqual(["BTC/USDC"]);
    expect(harness.riskCloses.symbols).toEqual(["BTC/USDC"]);
  });

  it("does not advance paused work and ignores a disabled ticker after resuming", async () => {
    const enabled = asSymbol("BTC/USDC");
    const disabled = asSymbol("ETH/USDC");
    let isPaused = true;
    const pendingOrders = new SymbolRecorder();
    const riskCloses = new SymbolRecorder();
    const controller = new StrategyMarketEventController({
      instances: new Map(),
      positionManager: makePositionManager(),
      enabledSymbols: new Set([enabled]),
      strategyPolicies: new Map(),
      logger: new RecordingLogger(),
      isOrderEmissionBlocked: () => isPaused,
      reconcilePendingOrders: pendingOrders.record,
      reconcileRiskCloses: riskCloses.record,
      processPlugins: () => Promise.resolve(),
      findOpenPosition: () => {
        return;
      },
      enforceProtection: () => Promise.resolve(false),
      getPortfolioManager: () => {
        return;
      },
      requestTrailingStopClose: () => Promise.resolve(),
      handleSignal: () => Promise.resolve(),
    });
    const ticker = (symbol: typeof enabled) => ({
      kind: "ticker" as const,
      payload: { symbol, timestamp: 1, bid: 99, ask: 101, last: 100, baseVolume: 1, quoteVolume: 100 },
    });

    await controller.onFeedEventSerial(ticker(enabled));
    isPaused = false;
    await controller.onFeedEventSerial(ticker(disabled));

    expect(controller.getTicksProcessed()).toBe(0);
    expect(controller.getLatestPrice(enabled)).toBeUndefined();
    expect(controller.getLatestPrice(disabled)).toBeUndefined();
    expect(pendingOrders.symbols).toEqual([]);
    expect(riskCloses.symbols).toEqual([]);
  });

  it("skips a strategy without an LTF while dispatching one allowed by its policy", async () => {
    const symbol = asSymbol("BTC/USDC");
    let noTimeframeCalls = 0;
    const noTimeframeStrategy: Strategy = {
      name: "no-timeframe",
      timeframes: [],
      onCandle: () => {
        noTimeframeCalls += 1;
        noSignal();
      },
      warmup: () => 0,
    };
    const allowedStrategy: Strategy = {
      name: "policy-allowed",
      timeframes: ["15m"],
      onCandle: (): StrategySignal => ({
        side: "buy",
        confidence: 1,
        reason: "allowed",
        stopLoss: 0,
        takeProfit: 0,
      }),
      warmup: () => 0,
    };
    const harness = createController({
      instances: new Map([
        strategyInstance(strategyName, noTimeframeStrategy),
        strategyInstance("cascade_fade", allowedStrategy),
      ]),
      strategyPolicies: new Map([["cascade_fade", { symbols: [symbol] }]]),
    });

    await harness.controller.onFeedEventSerial(ohlcvEvent(symbol, "15m"));

    expect(noTimeframeCalls).toBe(0);
    expect(harness.handledSignals).toEqual(["cascade_fade"]);
  });

  it("isolates a non-Error handler failure raised by a public abort signal", async () => {
    const symbol = asSymbol("BTC/USDC");
    const cancellation = new AbortController();
    cancellation.abort("injected string cancellation");
    let laterStrategyCalls = 0;
    const canceledStrategy: Strategy = {
      name: "canceled-strategy",
      timeframes: ["15m"],
      onCandle: () => {
        cancellation.signal.throwIfAborted();
        noSignal();
      },
      warmup: () => 0,
    };
    const laterStrategy: Strategy = {
      name: "later-strategy",
      timeframes: ["15m"],
      onCandle: () => {
        laterStrategyCalls += 1;
        noSignal();
      },
      warmup: () => 0,
    };
    const harness = createController({
      instances: new Map([
        strategyInstance(strategyName, canceledStrategy),
        strategyInstance("cascade_fade", laterStrategy),
      ]),
    });

    await harness.controller.onFeedEventSerial(ohlcvEvent(symbol, "15m"));

    const failure = harness.logger.getCalls().find((call) => call.event === "strategy.candle.handler.failed");
    expect(failure?.fields).toMatchObject({
      error: "injected string cancellation",
      strategy: strategyName,
      symbol,
    });
    expect(laterStrategyCalls).toBe(1);
  });

  it("notifies a strategy only after its portfolio force exit is confirmed", async () => {
    const symbol = asSymbol("BTC/USDC");
    const closedReasons: string[] = [];
    const strategy: Strategy = {
      name: "portfolio-force-exit",
      timeframes: ["15m"],
      onCandle: noSignal,
      onOpenPositionUpdate: () => ({ forceExit: true, reason: "time_exit" }),
      onPositionClosed: (reason) => {
        closedReasons.push(reason);
      },
      warmup: () => 0,
    };
    const unresolvedStack = makeStack();
    const resolvedStack = makeStack({ feed: new ImmediateFillFeed("position") });
    const outcomes = [
      { stack: unresolvedStack, expectedReasons: [] },
      { stack: resolvedStack, expectedReasons: ["time_exit"] },
    ] as const;

    for (const { stack, expectedReasons } of outcomes) {
      await stack.feed.open();
      const position = stack.positionManager.openPosition(strategyName, symbol, "long", 1, 100, 10, 1);
      const harness = createController({
        instances: new Map([strategyInstance(strategyName, strategy)]),
        positionManager: stack.positionManager,
        findOpenPosition: () => position,
        getPortfolioManager: () => stack.portfolioManager,
      });

      await harness.controller.onFeedEventSerial(ohlcvEvent(symbol, "15m"));

      expect(harness.trailingCloseRequests).toEqual([]);
      expect(closedReasons).toEqual(expectedReasons);
    }
  });
});

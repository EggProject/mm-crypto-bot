import { describe, expect, it } from "vitest";

import type { Strategy, StrategyContext } from "@mm-crypto-bot/core";
import {
  asSymbol,
  type FeedEvent,
  type Ohlcv,
  type Symbol as ExchangeSymbol,
  type Timeframe,
} from "@mm-crypto-bot/exchange";
import { RecordingLogger } from "@logging-testing";

import type { StrategyName } from "../config/schema.js";
import type { BotStrategyInstance } from "../config/strategy-registry.js";
import type { PositionSnapshot } from "./position-manager.js";
import { PositionManager } from "./position-manager.test-support.js";
import { StrategyMarketEventController } from "./strategy-runner-market-event-controller.js";
import type { StrategyRuntimePolicy } from "./strategy-runner.types.js";

const strategyName: StrategyName = "donchian_pivot_composition";
const laterStrategyName: StrategyName = "cascade_fade";

interface TrailingCloseRequest {
  readonly positionId: string;
  readonly closePrice: number;
  readonly reason: string;
}

interface ControllerHarness {
  readonly controller: StrategyMarketEventController;
  readonly handleSignalCalls: readonly StrategyName[];
  readonly pluginCalls: readonly string[];
  readonly reconcilePendingCalls: readonly ExchangeSymbol[];
  readonly reconcileRiskCloseCalls: readonly ExchangeSymbol[];
  readonly trailingCloseRequests: readonly TrailingCloseRequest[];
}

interface ControllerOptions {
  readonly instances?: readonly (readonly [StrategyName, BotStrategyInstance])[];
  readonly enabledSymbols?: ReadonlySet<ExchangeSymbol>;
  readonly positionManager?: PositionManager;
  readonly strategyPolicies?: ReadonlyMap<StrategyName, StrategyRuntimePolicy>;
  readonly isOrderEmissionBlocked?: () => boolean;
  readonly processPlugins?: (symbol: ExchangeSymbol, timeframe: string) => Promise<void>;
  readonly findOpenPosition?: (
    strategy: StrategyName,
    symbol: ExchangeSymbol,
  ) => PositionSnapshot | undefined;
}

function makePositionManager(): PositionManager {
  return new PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
}

class MarketPriceRecorder extends PositionManager {
  public readonly updates: { readonly symbol: ExchangeSymbol; readonly price: number }[] = [];

  public override updateMarketPrice(symbol: ExchangeSymbol, price: number): void {
    this.updates.push({ symbol, price });
    super.updateMarketPrice(symbol, price);
  }
}

function strategyInstance(
  name: StrategyName,
  strategy: Strategy,
): readonly [StrategyName, BotStrategyInstance] {
  return [name, { kind: "strategy", name, instance: strategy }];
}

function noResult(): undefined {
  return;
}

function createController(options: ControllerOptions = {}): ControllerHarness {
  const handleSignalCalls: StrategyName[] = [];
  const pluginCalls: string[] = [];
  const reconcilePendingCalls: ExchangeSymbol[] = [];
  const reconcileRiskCloseCalls: ExchangeSymbol[] = [];
  const trailingCloseRequests: TrailingCloseRequest[] = [];
  const logger = new RecordingLogger();
  const controller = new StrategyMarketEventController({
    instances:
      options.instances === undefined
        ? new Map<StrategyName, BotStrategyInstance>()
        : new Map<StrategyName, BotStrategyInstance>(options.instances),
    positionManager: options.positionManager ?? makePositionManager(),
    enabledSymbols: options.enabledSymbols ?? new Set([asSymbol("BTC/USDC")]),
    strategyPolicies: options.strategyPolicies ?? new Map(),
    logger,
    isOrderEmissionBlocked: options.isOrderEmissionBlocked ?? (() => false),
    reconcilePendingOrders: (symbol) => {
      reconcilePendingCalls.push(symbol);
      return Promise.resolve();
    },
    reconcileRiskCloses: (symbol) => {
      reconcileRiskCloseCalls.push(symbol);
      return Promise.resolve();
    },
    processPlugins: async (symbol, timeframe) => {
      pluginCalls.push(`${symbol}:${timeframe}`);
      await options.processPlugins?.(symbol, timeframe);
    },
    findOpenPosition:
      options.findOpenPosition ??
      (() => {
        return;
      }),
    enforceProtection: () => Promise.resolve(false),
    getPortfolioManager: () => {
      return;
    },
    requestTrailingStopClose: (positionId, closePrice, reason) => {
      trailingCloseRequests.push({ positionId, closePrice, reason });
      return Promise.resolve();
    },
    handleSignal: (name) => {
      handleSignalCalls.push(name);
      return Promise.resolve();
    },
  });
  return {
    controller,
    handleSignalCalls,
    pluginCalls,
    reconcilePendingCalls,
    reconcileRiskCloseCalls,
    trailingCloseRequests,
  };
}

function ohlcvEvent(
  symbol: ExchangeSymbol,
  timeframe: Timeframe,
  candle: Ohlcv = [1, 100, 104, 99, 103, 1],
): FeedEvent {
  return { kind: "ohlcv", payload: { symbol, timeframe, candle } };
}

describe("StrategyMarketEventController public scenario boundaries", () => {
  it("observes an open position without emitting a signal when its update is absent", async () => {
    const symbol = asSymbol("BTC/USDC");
    const position = makePositionManager().openPosition(strategyName, symbol, "long", 1, 100, 10, 1);
    let observedCalls = 0;
    const strategy: Strategy = {
      name: "open-position-observer",
      timeframes: ["15m"],
      onCandle: () => {
        noResult();
      },
      onCandleObserved: () => {
        observedCalls++;
      },
      onOpenPositionUpdate: () => {
        noResult();
      },
      warmup: () => 0,
    };
    const harness = createController({
      instances: [strategyInstance(strategyName, strategy)],
      findOpenPosition: () => position,
    });

    await harness.controller.onFeedEventSerial(ohlcvEvent(symbol, "15m"));

    expect(observedCalls).toBe(1);
    expect(harness.trailingCloseRequests).toEqual([]);
    expect(harness.handleSignalCalls).toEqual([]);
  });

  it("uses force-exit defaults for an open short position without a portfolio manager", async () => {
    const symbol = asSymbol("BTC/USDC");
    const position = makePositionManager().openPosition(strategyName, symbol, "short", 1, 100, 10, 1);
    let receivedOpenPositionSide: "buy" | "sell" | undefined;
    const strategy: Strategy = {
      name: "force-exit-defaults",
      timeframes: ["15m"],
      onCandle: () => {
        noResult();
      },
      onOpenPositionUpdate: (context) => {
        receivedOpenPositionSide = context.openPosition.side;
        return { forceExit: true };
      },
      warmup: () => 0,
    };
    const harness = createController({
      instances: [strategyInstance(strategyName, strategy)],
      findOpenPosition: () => position,
    });

    await harness.controller.onFeedEventSerial(ohlcvEvent(symbol, "15m", [1, 100, 104, 99, 103, 1]));

    expect(receivedOpenPositionSide).toBe("sell");
    expect(harness.trailingCloseRequests).toEqual([
      { positionId: position.id, closePrice: 103, reason: "force_exit" },
    ]);
    expect(harness.handleSignalCalls).toEqual([]);
  });

  it("stops strategy dispatch when a plugin pauses the event after it starts", async () => {
    const symbol = asSymbol("BTC/USDC");
    let isOrderEmissionBlocked = false;
    let candleCalls = 0;
    const strategy: Strategy = {
      name: "plugin-pause-observer",
      timeframes: ["15m"],
      onCandle: () => {
        candleCalls++;
        noResult();
      },
      warmup: () => 0,
    };
    const harness = createController({
      instances: [strategyInstance(strategyName, strategy)],
      isOrderEmissionBlocked: () => isOrderEmissionBlocked,
      processPlugins: () => {
        isOrderEmissionBlocked = true;
        return Promise.resolve();
      },
    });

    await harness.controller.onFeedEventSerial(ohlcvEvent(symbol, "15m"));

    expect(harness.pluginCalls).toHaveLength(1);
    expect(candleCalls).toBe(0);
    expect(harness.handleSignalCalls).toEqual([]);
  });

  it("skips a strategy whose policy excludes the enabled event symbol", async () => {
    const symbol = asSymbol("BTC/USDC");
    let candleCalls = 0;
    const strategy: Strategy = {
      name: "policy-symbol-filter",
      timeframes: ["15m"],
      onCandle: () => {
        candleCalls++;
        noResult();
      },
      warmup: () => 0,
    };
    const harness = createController({
      instances: [strategyInstance(strategyName, strategy)],
      strategyPolicies: new Map([[strategyName, { symbols: ["ETH/USDC"] }]]),
    });

    await harness.controller.onFeedEventSerial(ohlcvEvent(symbol, "15m"));

    expect(candleCalls).toBe(0);
    expect(harness.handleSignalCalls).toEqual([]);
  });

  it("fails closed before strategy dispatch for an unsupported exchange symbol", async () => {
    const unsupportedSymbol = asSymbol("BTCUSDC");
    const positionManager = new MarketPriceRecorder({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    let candleCalls = 0;
    const strategy: Strategy = {
      name: "unsupported-symbol-observer",
      timeframes: ["15m"],
      onCandle: () => {
        candleCalls++;
        noResult();
      },
      warmup: () => 0,
    };
    const harness = createController({
      instances: [strategyInstance(strategyName, strategy)],
      enabledSymbols: new Set([unsupportedSymbol]),
      positionManager,
    });

    await expect(harness.controller.onFeedEventSerial(ohlcvEvent(unsupportedSymbol, "15m"))).rejects.toThrow(
      "Unsupported strategy context symbol: BTCUSDC",
    );

    expect(candleCalls).toBe(0);
    expect(harness.handleSignalCalls).toEqual([]);
    expect(harness.pluginCalls).toEqual([]);
    expect(harness.controller.getLatestPrice(unsupportedSymbol)).toBeUndefined();
    expect(harness.controller.getTicksProcessed()).toBe(0);
    expect(positionManager.updates).toEqual([]);
  });

  it("uses the LTF state as the MTF fallback for a two-timeframe strategy", async () => {
    const symbol = asSymbol("BTC/USDC");
    let receivedContext: StrategyContext | undefined;
    const strategy: Strategy = {
      name: "two-timeframe-fallback",
      timeframes: ["1h", "15m"],
      onCandle: (context) => {
        receivedContext = context;
        noResult();
      },
      warmup: () => 0,
    };
    const harness = createController({ instances: [strategyInstance(strategyName, strategy)] });

    await harness.controller.onFeedEventSerial(ohlcvEvent(symbol, "15m"));

    expect(receivedContext?.timeframe).toBe("15m");
    expect(receivedContext?.mtfState.mtf).toEqual({ close: 103, candleIndex: 1 });
  });

  it("keeps the LTF closed-bar history de-duplicated for duplicate timestamps", async () => {
    const symbol = asSymbol("BTC/USDC");
    const contexts: StrategyContext[] = [];
    const strategy: Strategy = {
      name: "closed-bar-deduplication",
      timeframes: ["15m"],
      onCandle: (context) => {
        contexts.push(context);
        noResult();
      },
      warmup: () => 0,
    };
    const harness = createController({ instances: [strategyInstance(strategyName, strategy)] });
    const event = ohlcvEvent(symbol, "15m", [7, 100, 104, 99, 103, 1]);

    await harness.controller.onFeedEventSerial(event);
    await harness.controller.onFeedEventSerial(event);

    expect(contexts).toHaveLength(2);
    expect(contexts[1]?.mtfState.ltf.candleIndex).toBe(1);
  });

  it("withholds ATR until fifteen heterogeneous LTF bars establish every true-range pair", async () => {
    const symbol = asSymbol("BTC/USDC");
    const candles: readonly Ohlcv[] = [
      [1, 100, 105, 99, 102, 1],
      [2, 102, 108, 101, 107, 1],
      [3, 107, 109, 103, 104, 1],
      [4, 104, 112, 104, 111, 1],
      [5, 111, 113, 108, 109, 1],
      [6, 109, 110, 100, 101, 1],
      [7, 101, 107, 99, 105, 1],
      [8, 105, 106, 96, 97, 1],
      [9, 97, 102, 95, 101, 1],
      [10, 101, 115, 100, 114, 1],
      [11, 114, 116, 110, 111, 1],
      [12, 111, 112, 105, 106, 1],
      [13, 106, 120, 104, 119, 1],
      [14, 119, 121, 117, 118, 1],
      [15, 118, 125, 115, 124, 1],
    ];
    let latestContext: StrategyContext | undefined;
    const strategy: Strategy = {
      name: "atr-window-observer",
      timeframes: ["15m"],
      onCandle: (context) => {
        latestContext = context;
        noResult();
      },
      warmup: () => 0,
    };
    const harness = createController({ instances: [strategyInstance(strategyName, strategy)] });

    for (const candle of candles.slice(0, 14)) {
      await harness.controller.onFeedEventSerial(ohlcvEvent(symbol, "15m", candle));
    }

    expect(latestContext?.mtfState.ltf.atr).toBeUndefined();

    const fifteenthCandle = candles.at(-1);
    if (fifteenthCandle === undefined) throw new Error("The ATR fixture requires a fifteenth candle.");
    await harness.controller.onFeedEventSerial(ohlcvEvent(symbol, "15m", fifteenthCandle));

    const expectedTrueRanges: readonly number[] = [7, 6, 8, 5, 10, 8, 10, 7, 15, 6, 7, 16, 4, 10];
    const expectedAtr = 8.5;
    expect(expectedTrueRanges).toHaveLength(14);
    expect(expectedTrueRanges.reduce((sum, value) => sum + value, 0)).toBe(119);
    expect(119 / expectedTrueRanges.length).toBe(expectedAtr);
    expect(latestContext?.mtfState.ltf.atr).toBe(expectedAtr);
  });

  it("counts valid non-price events without triggering price or strategy callbacks", async () => {
    const symbol = asSymbol("BTC/USDC");
    const strategy: Strategy = {
      name: "non-price-events",
      timeframes: ["15m"],
      onCandle: () => {
        noResult();
      },
      warmup: () => 0,
    };
    const harness = createController({ instances: [strategyInstance(strategyName, strategy)] });

    await harness.controller.onFeedEventSerial({
      kind: "orderbook",
      payload: {
        symbol,
        timestamp: 1,
        nonce: 1,
        bids: [{ price: 100, amount: 1 }],
        asks: [{ price: 101, amount: 1 }],
      },
    });
    await harness.controller.onFeedEventSerial({
      kind: "trade",
      payload: { id: "trade-1", symbol, timestamp: 2, price: 100, amount: 1, takerSide: "buy" },
    });

    expect(harness.controller.getTicksProcessed()).toBe(2);
    expect(harness.controller.getLatestPrice(symbol)).toBeUndefined();
    expect(harness.reconcilePendingCalls).toEqual([]);
    expect(harness.reconcileRiskCloseCalls).toEqual([]);
    expect(harness.pluginCalls).toEqual([]);
    expect(harness.handleSignalCalls).toEqual([]);
  });

  it("isolates a throwing strategy so later strategies still observe the candle", async () => {
    const symbol = asSymbol("BTC/USDC");
    const logger = new RecordingLogger();
    let laterStrategyCalls = 0;
    const throwingStrategy: Strategy = {
      name: "throwing-strategy",
      timeframes: ["15m"],
      onCandle: () => {
        throw new Error("injected strategy failure");
      },
      warmup: () => 0,
    };
    const laterStrategy: Strategy = {
      name: "later-strategy",
      timeframes: ["15m"],
      onCandle: () => {
        laterStrategyCalls++;
        noResult();
      },
      warmup: () => 0,
    };
    const handleSignalCalls: StrategyName[] = [];
    const controller = new StrategyMarketEventController({
      instances: new Map([
        strategyInstance(strategyName, throwingStrategy),
        strategyInstance(laterStrategyName, laterStrategy),
      ]),
      positionManager: makePositionManager(),
      enabledSymbols: new Set([symbol]),
      strategyPolicies: new Map(),
      logger,
      isOrderEmissionBlocked: () => false,
      reconcilePendingOrders: () => Promise.resolve(),
      reconcileRiskCloses: () => Promise.resolve(),
      processPlugins: () => Promise.resolve(),
      findOpenPosition: () => {
        return;
      },
      enforceProtection: () => Promise.resolve(false),
      getPortfolioManager: () => {
        return;
      },
      requestTrailingStopClose: () => Promise.resolve(),
      handleSignal: (name) => {
        handleSignalCalls.push(name);
        return Promise.resolve();
      },
    });

    await controller.onFeedEventSerial(ohlcvEvent(symbol, "15m"));

    expect(logger.getCalls().some((call) => call.event === "strategy.candle.handler.failed")).toBe(true);
    expect(laterStrategyCalls).toBe(1);
    expect(handleSignalCalls).toEqual([]);
  });
});

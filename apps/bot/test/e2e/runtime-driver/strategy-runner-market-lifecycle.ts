import * as support from "../../../src/bot/strategy-runner.test-support.js";
import { StrategyRunner as RuntimeStrategyRunner } from "../../../src/bot/strategy-runner.js";
import { CorrelationMatrix } from "../../../src/portfolio/correlation.js";
import { PortfolioManager } from "../../../src/portfolio/portfolio-manager.js";
import { PortfolioStop } from "../../../src/portfolio/portfolio-stop.js";
import { RiskBudgetAllocator } from "../../../src/portfolio/risk-budget.js";
import { assertCondition, expectAsyncFailure, quietLogger, RecordingLogger } from "./runtime-driver-core.js";
function hasObservationsForSymbol(
  value: object,
): value is { readonly observationsForSymbol: (symbol: string) => number } {
  return "observationsForSymbol" in value && typeof value.observationsForSymbol === "function";
}
class StaleFundingSource extends support.ManualFundingSource {
  public override lastTickAgeMs(): number {
    return 6 * 60 * 1000;
  }
}
function makePositionManager(): support.PositionManager {
  return new support.PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
}
function makePaperOrderManager(
  feed: support.MockExchangeFeed,
  positionManager: support.PositionManager,
): support.OrderManager {
  return new support.OrderManager({
    feed,
    getPositionContext: () => positionManager.getPositionContext(),
    paperMode: true,
  });
}
function makePortfolioManager(
  positionManager: support.PositionManager,
  orderManager: support.OrderManager,
): PortfolioManager {
  return new PortfolioManager({
    riskBudget: new RiskBudgetAllocator({
      totalRiskUsd: 1000,
      correlationPenaltyThreshold: 0.7,
      logger: quietLogger,
    }),
    correlation: new CorrelationMatrix({ windowSize: 30, logger: quietLogger }),
    portfolioStop: new PortfolioStop({ maxDdPct: 0.1, logger: quietLogger }),
    positionManager,
    orderManager,
    logger: quietLogger,
  });
}
function singleStrategyInstances(strategy: support.Strategy) {
  return support.strategyInstances([
    [
      "donchian_pivot_composition",
      { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
    ],
  ]);
}
function tickerEvent(timestamp: number, last = 100, symbol = support.makeSymbol()) {
  return {
    kind: "ticker" as const,
    payload: { symbol, timestamp, bid: last - 1, ask: last + 1, last, baseVolume: 1, quoteVolume: last },
  };
}
function orderBookEvent(timestamp: number, symbol = support.makeSymbol()) {
  return { kind: "orderbook" as const, payload: { symbol, timestamp, nonce: timestamp, bids: [], asks: [] } };
}
async function verifyMultiTimeframeIndicators(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positionManager = makePositionManager();
  const orderManager = makePaperOrderManager(feed, positionManager);
  let observedContext: support.StrategyContext | undefined;
  const strategy: support.Strategy = {
    name: "e2e-mtf",
    timeframes: ["1d", "4h", "15m"],
    warmup: () => 0,
    onCandle: (context) => {
      observedContext = context;
    },
  };
  const runner = new support.StrategyRunner({
    instances: singleStrategyInstances(strategy),
    orderManager,
    positionManager,
    sizingFn: support.defaultSizingFunction,
    enabledSymbols: ["BTC/USDC"],
  });
  const symbol = support.makeSymbol();
  for (let index = 0; index < 20; index++) {
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol, timeframe: "1d", candle: [index, 10 + index, 20 + index, 5 + index, 15 + index, 1] },
    });
  }
  await runner.onFeedEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe: "4h", candle: [99, 200, 201, 199, 200, 1] },
  });
  for (let index = 0; index < 15; index++) {
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: {
        symbol,
        timeframe: "15m",
        candle: [100 + index, 100, 105 + index, 95 - index, 100 + index, 1],
      },
    });
  }
  assertCondition(observedContext?.timeframe === "15m", "strategy did not receive its configured LTF");
  assertCondition(observedContext.mtfState.htf.donchianUpper === 39, "HTF upper channel missing");
  assertCondition(observedContext.mtfState.htf.donchianLower === 5, "HTF lower channel missing");
  assertCondition(observedContext.mtfState.htf.adx !== undefined, "HTF ADX missing");
  assertCondition(observedContext.mtfState.ltf.atr !== undefined, "LTF ATR missing");
  assertCondition(observedContext.mtfState.mtf.close === 200, "middle timeframe was not retained");
  runner.dispose();
  let oneFrameContext: support.StrategyContext | undefined;
  const oneFrameRunner = new support.StrategyRunner({
    instances: singleStrategyInstances({
      name: "e2e-one-frame",
      timeframes: ["15m"],
      warmup: () => 0,
      onCandle: (context) => {
        oneFrameContext = context;
      },
    }),
    orderManager,
    positionManager,
    sizingFn: () => 0,
    enabledSymbols: ["BTC/USDC"],
  });
  await oneFrameRunner.onFeedEvent(support.makeOhlcvFeedEvent(116));
  assertCondition(
    oneFrameContext?.mtfState.htf.close === 100 &&
      oneFrameContext.mtfState.mtf.close === 100 &&
      oneFrameContext.mtfState.ltf.close === 100,
    "one timeframe did not map every context frame to the current candle",
  );
  oneFrameRunner.dispose();
  const emptyFrameStrategy: support.Strategy = {
    name: "e2e-empty-frame",
    timeframes: [],
    warmup: () => 0,
    onCandle: () => {
      return;
    },
  };
  const emptyFrameRunner = new support.StrategyRunner({
    instances: singleStrategyInstances(emptyFrameStrategy),
    orderManager,
    positionManager,
    sizingFn: () => 0,
    enabledSymbols: ["BTC/USDC"],
  });
  await emptyFrameRunner.onFeedEvent(support.makeOhlcvFeedEvent(117));
  assertCondition(emptyFrameRunner.getStats().totalSignals === 0, "empty timeframes dispatched a strategy");
  emptyFrameRunner.dispose();
}
async function verifySymbolGates(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const event = support.makeOhlcvFeedEvent(1);
  const excludedPositionManager = makePositionManager();
  const excludedOrderManager = makePaperOrderManager(feed, excludedPositionManager);
  const excludedStrategy = new support.FixedSignalStrategy({
    side: "buy",
    confidence: 1,
    reason: "e2e-excluded-symbol",
    stopLoss: 0,
    takeProfit: 0,
  });
  const excludedRunner = new support.StrategyRunner({
    instances: singleStrategyInstances(excludedStrategy),
    orderManager: excludedOrderManager,
    positionManager: excludedPositionManager,
    sizingFn: () => 1,
    enabledSymbols: ["ETH/USDC"],
  });
  await excludedRunner.onFeedEvent(event);
  await excludedRunner.onFeedEvent(tickerEvent(2));
  await excludedRunner.onFeedEvent(orderBookEvent(3));
  assertCondition(excludedStrategy.onCandleCallCount === 0, "excluded symbol invoked a strategy");
  assertCondition(excludedPositionManager.getPositionCount() === 0, "excluded symbol created a position");
  assertCondition(
    excludedRunner.getStats().ticksProcessed === 0,
    "disabled market events advanced runner state",
  );
  excludedRunner.dispose();
}
async function verifyTickerAndDuplicateMarketEventLifecycle(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positionManager = makePositionManager();
  const orderManager = makePaperOrderManager(feed, positionManager);
  const plugin = new support.LifecyclePlugin();
  const policyExcludedStrategy = new support.FixedSignalStrategy({
    side: "buy",
    confidence: 1,
    reason: "e2e-policy-symbol",
    stopLoss: 0,
    takeProfit: 0,
  });
  const runner = new support.StrategyRunner({
    instances: support.strategyInstances([
      ["regime_detector", { kind: "plugin", name: "regime_detector", instance: plugin }],
      [
        "donchian_pivot_composition",
        { kind: "strategy", name: "donchian_pivot_composition", instance: policyExcludedStrategy },
      ],
    ]),
    orderManager,
    positionManager,
    sizingFn: () => 0,
    enabledSymbols: ["BTC/USDC"],
    strategyPolicies: new Map([["donchian_pivot_composition", { symbols: ["ETH/USDC"] }]]),
  });
  const symbol = support.makeSymbol();
  positionManager.openPosition("ticker-lifecycle", symbol, "long", 1, 100, 1);
  await runner.onFeedEvent(tickerEvent(1, 105, symbol));
  const duplicateBar = { symbol, timeframe: "15m" as const, candle: [2, 100, 106, 99, 105, 1] as const };
  await runner.onFeedEvent({ kind: "ohlcv", payload: duplicateBar });
  await runner.onFeedEvent({ kind: "ohlcv", payload: duplicateBar });
  await runner.onFeedEvent(orderBookEvent(3, symbol));
  assertCondition(
    positionManager.getPosition("ticker-lifecycle", symbol, "long")?.currentPrice === 105,
    "ticker did not update the public position market price",
  );
  assertCondition(plugin.barCalls === 2, "duplicate closed-bar delivery did not reach the plugin lifecycle");
  assertCondition(
    policyExcludedStrategy.onCandleCallCount === 0,
    "policy-excluded strategy received a candle",
  );
  assertCondition(
    runner.getStats().ticksProcessed === 4,
    "valid ticker, bar, and non-price events were not all counted",
  );
  runner.dispose();
}
async function verifyForceExitLifecycle(): Promise<void> {
  const symbol = support.makeSymbol();
  const directFeed = new support.MockExchangeFeed();
  await directFeed.open();
  const directPositions = makePositionManager();
  const directOrders = new support.OrderManager({
    feed: directFeed,
    getPositionContext: () => directPositions.getPositionContext(),
  });
  let shouldForceExit = false;
  const directStrategy: support.Strategy = {
    name: "e2e-force-exit-direct",
    timeframes: ["15m"],
    warmup: () => 0,
    onCandle: () => {
      return;
    },
    onOpenPositionUpdate: () => ({ forceExit: shouldForceExit }),
  };
  const directRunner = new support.StrategyRunner({
    instances: singleStrategyInstances(directStrategy),
    orderManager: directOrders,
    positionManager: directPositions,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC"],
  });
  directPositions.openPosition("donchian_pivot_composition", symbol, "short", 1, 100, 1);
  await directRunner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  assertCondition(directOrders.getCounters().placed === 0, "non-forcing position update submitted an order");
  shouldForceExit = true;
  await directRunner.onFeedEvent(support.makeOhlcvFeedEvent(2));
  assertCondition(
    directOrders.getCounters().placed === 1,
    "direct force exit did not submit a reducing order",
  );
  directRunner.dispose();
  await directFeed.close();

  for (const isPaperMode of [true, false]) {
    const feed = new support.MockExchangeFeed();
    await feed.open();
    const positions = makePositionManager();
    const orders = new support.OrderManager({
      feed,
      getPositionContext: () => positions.getPositionContext(),
      paperMode: isPaperMode,
    });
    const closedReasons: string[] = [];
    const strategy: support.Strategy = {
      name: "e2e-force-exit-portfolio",
      timeframes: ["15m"],
      warmup: () => 0,
      onCandle: () => {
        return;
      },
      onOpenPositionUpdate: () => ({ forceExit: true, reason: "trend_reversal" }),
      onPositionClosed: (reason) => {
        closedReasons.push(reason);
      },
    };
    const runner = new support.StrategyRunner({
      instances: singleStrategyInstances(strategy),
      orderManager: orders,
      positionManager: positions,
      portfolioManager: makePortfolioManager(positions, orders),
      sizingFn: () => 1,
      enabledSymbols: ["BTC/USDC"],
    });
    positions.openPosition("donchian_pivot_composition", symbol, "long", 1, 100, 1);
    await runner.onFeedEvent(support.makeOhlcvFeedEvent(isPaperMode ? 2 : 3));
    assertCondition(
      positions.getPositionCount() === (isPaperMode ? 0 : 1),
      "portfolio force exit did not preserve its confirmed-close boundary",
    );
    assertCondition(
      closedReasons.length === (isPaperMode ? 1 : 0),
      "portfolio force exit reported an unconfirmed close",
    );
    runner.dispose();
    await feed.close();
  }
}
async function verifyTickerReconcilesUsingTheObservedMarketPrice(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positionManager = makePositionManager();
  const orderManager = new support.OrderManager({
    feed,
    getPositionContext: () => positionManager.getPositionContext(),
  });
  const runner = new support.StrategyRunner({
    instances: singleStrategyInstances(
      new support.FixedSignalStrategy({
        side: "buy",
        confidence: 1,
        reason: "e2e-latest-price",
        stopLoss: 0,
        takeProfit: 0,
      }),
    ),
    orderManager,
    positionManager,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC"],
  });
  await runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  const orderId = support.requireDefined(
    orderManager.getInFlightOrderIds().at(0),
    "expected pending market entry",
  );
  feed.setOrderStatus(orderId, { filled: 1, status: "closed", average: undefined, price: undefined });
  await runner.onFeedEvent(tickerEvent(2, 102));
  assertCondition(
    positionManager.getPosition("donchian_pivot_composition", support.makeSymbol(), "long")?.entryPrice ===
      102,
    "pending fill did not use the observed ticker price when the exchange omitted price fields",
  );
  runner.dispose();
  await feed.close();
}
async function verifyRegimeDailyInputAndFundingExit(): Promise<void> {
  const config: support.BotConfig = {
    ...support.DEFAULT_BOT_CONFIG,
    symbols: { enabled: ["BTC/USDC"] },
    strategies: {
      ...support.DEFAULT_BOT_CONFIG.strategies,
      donchian_pivot_composition: { enabled: false },
      dydx_cex_carry: { enabled: false },
      cascade_fade: { enabled: false },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: true },
    },
  };
  const instances = support.createStrategyInstances(config);
  const regime = instances.get("regime_detector");
  if (regime?.kind !== "plugin" || !hasObservationsForSymbol(regime.instance)) {
    throw new Error("enabled regime detector did not expose observations");
  }
  const feed = new support.MockExchangeFeed();
  const positionManager = makePositionManager();
  const orderManager = makePaperOrderManager(feed, positionManager);
  const runner = new support.StrategyRunner({
    instances,
    orderManager,
    positionManager,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC"],
  });
  const symbol = support.makeSymbol();
  await runner.onFeedEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe: "1d", candle: [1, 100, 101, 99, 100, 1] },
  });
  await runner.onFeedEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe: "15m", candle: [2, 100, 102, 99, 101, 1] },
  });
  await runner.onFeedEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe: "1d", candle: [3, 101, 103, 100, 102, 1] },
  });
  assertCondition(regime.instance.observationsForSymbol("BTC/USDC") === 1, "regime consumed non-daily input");
  runner.dispose();

  const fundingSource = new StaleFundingSource();
  const carry = new support.DydxCexCarryStrategy({ fundingSource });
  const carryPositionManager = makePositionManager();
  const carryOrderManager = makePaperOrderManager(feed, carryPositionManager);
  const carryRunner = new support.StrategyRunner({
    instances: support.strategyInstances([
      ["dydx_cex_carry", { kind: "strategy", name: "dydx_cex_carry", instance: carry }],
    ]),
    orderManager: carryOrderManager,
    positionManager: carryPositionManager,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC"],
  });
  fundingSource.fire(1000);
  carryPositionManager.openPosition("dydx_cex_carry", symbol, "long", 1, 100, 1);
  carry.onPositionOpened({
    side: "buy",
    entryTime: 1,
    entryPrice: 100,
    quantity: 1,
    stopLoss: 99,
    takeProfit: 10_000,
    holdingBars: 0,
  });
  await carryRunner.onFeedEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe: "1d", candle: [2000, 100, 101, 99, 100, 1] },
  });
  assertCondition(carryPositionManager.getPositionCount() === 0, "carry kill switch did not exit exposure");
  assertCondition(!carry.state.hasEntered, "carry state remained entered after the exit");
  carryRunner.dispose();
  assertCondition(fundingSource.closeCalls === 1, "funding source was not released");
}
async function verifyUnsupportedAndCallbackFailureBoundaries(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positionManager = makePositionManager();
  const orderManager = makePaperOrderManager(feed, positionManager);
  let observed = 0;
  const logger = new RecordingLogger();
  let callbackFailures = 0;
  const strategy: support.Strategy = {
    name: "e2e-callback-boundaries",
    timeframes: ["15m"],
    warmup: () => 0,
    onCandle: () => {
      callbackFailures += 1;
      if (callbackFailures === 1) throw new Error("e2e Error callback failure");
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E verifies public string callback isolation.
      throw "e2e candle callback failure";
    },
    onCandleObserved: () => {
      observed += 1;
    },
  };
  const runner = new RuntimeStrategyRunner({
    instances: singleStrategyInstances(strategy),
    orderManager,
    positionManager,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC", "DOGE/USDC"],
    logger,
  });
  await expectAsyncFailure(
    () =>
      runner.onFeedEvent({
        kind: "ticker",
        payload: {
          symbol: support.asSymbol("DOGE/USDC"),
          timestamp: 1,
          bid: 1,
          ask: 1,
          last: 1,
          baseVolume: 1,
          quoteVolume: 1,
        },
      }),
    "unsupported strategy context symbol",
  );
  await runner.onFeedEvent(support.makeOhlcvFeedEvent(2));
  await runner.onFeedEvent(support.makeOhlcvFeedEvent(3));
  assertCondition(positionManager.getPositionCount() === 0, "failed callback emitted an order");
  positionManager.openPosition("donchian_pivot_composition", support.makeSymbol(), "long", 1, 100, 1);
  await runner.onFeedEvent(support.makeOhlcvFeedEvent(4));
  assertCondition(observed === 1, "existing-position observation did not survive callback isolation");
  assertCondition(
    logger.entries.filter((entry) => entry.message === "strategy.candle.handler.failed").length === 2,
    "both Error and string callback failures were not logged",
  );
  runner.dispose();
}

export async function runStrategyRunnerMarketLifecycle(): Promise<void> {
  await verifyMultiTimeframeIndicators();
  await verifySymbolGates();
  await verifyTickerAndDuplicateMarketEventLifecycle();
  await verifyForceExitLifecycle();
  await verifyTickerReconcilesUsingTheObservedMarketPrice();
  await verifyRegimeDailyInputAndFundingExit();
  await verifyUnsupportedAndCallbackFailureBoundaries();
}

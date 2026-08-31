import { asSymbol, type Order } from "@mm-crypto-bot/exchange";
import type { Strategy, StrategySignal } from "@mm-crypto-bot/core";

import { OrderManager, type OrderIntent } from "../../../src/bot/order-manager.js";
import { PositionManager } from "../../../src/bot/position-manager.js";
import { StrategyNativeProtectionController } from "../../../src/bot/strategy-runner-native-protection-controller.js";
import { StrategyPaperProtectionController } from "../../../src/bot/strategy-runner-paper-protection-controller.js";
import { StrategyRunner } from "../../../src/bot/strategy-runner.js";
import type { BotStrategyInstance } from "../../../src/config/strategy-registry.js";

import { assertCondition, MockExchangeFeed, quietLogger } from "./runtime-driver-core.js";

class FixedSignalStrategy implements Strategy {
  public readonly name = "runtime-driver-fixed";
  public readonly timeframes = ["15m"] as const;
  public readonly closeReasons: string[] = [];

  public constructor(private readonly signal: StrategySignal) {}

  public warmup(): number {
    return 0;
  }

  public onCandle(): StrategySignal {
    return this.signal;
  }

  public onPositionClosed(reason: string): void {
    this.closeReasons.push(reason);
  }
}

function protectionStrategy(
  side: StrategySignal["side"],
  reason: string,
  stopLoss: number,
  takeProfit: number,
): FixedSignalStrategy {
  return new FixedSignalStrategy({ side, confidence: 1, reason, stopLoss, takeProfit });
}

class TransformedPaperOrderManager extends OrderManager {
  public constructor(
    options: ConstructorParameters<typeof OrderManager>[0],
    private readonly transformReceipt: (order: Order) => Order,
  ) {
    super(options);
  }

  public override async placeOrder(intent: OrderIntent): Promise<Order> {
    return this.transformReceipt(await super.placeOrder(intent));
  }
}

interface PaperProtectionHarnessOptions {
  readonly strategyName: string;
  readonly symbol: Parameters<StrategyPaperProtectionController["protectionKey"]>[1];
  readonly side: "long" | "short";
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly transformReceipt?: (order: Order) => Order;
}

interface PaperProtectionHarness {
  readonly controller: StrategyPaperProtectionController;
  readonly positionManager: PositionManager;
  readonly position: ReturnType<PositionManager["openPosition"]>;
}

async function createPaperProtectionHarness({
  strategyName,
  symbol,
  side,
  stopLoss,
  takeProfit,
  transformReceipt,
}: PaperProtectionHarnessOptions): Promise<PaperProtectionHarness> {
  const feed = new MockExchangeFeed();
  await feed.open();
  const positionManager = new PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
    logger: quietLogger,
  });
  const options = {
    feed,
    logger: quietLogger,
    paperMode: true,
    getPositionContext: () => positionManager.getPositionContext(),
  };
  const orderManager =
    transformReceipt === undefined
      ? new OrderManager(options)
      : new TransformedPaperOrderManager(options, transformReceipt);
  const controller = new StrategyPaperProtectionController({ orderManager, positionManager });
  const position = positionManager.openPosition(strategyName, symbol, side, 1, 100, 1);
  controller.setPaperProtection(controller.protectionKey(strategyName, symbol), {
    side,
    stopLoss,
    takeProfit,
  });
  return { controller, positionManager, position };
}

export async function runStrategyRunnerProtections(): Promise<void> {
  const feed = new MockExchangeFeed();
  await feed.open();
  const positionManager = new PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
    logger: quietLogger,
  });
  const orderManager = new OrderManager({
    feed,
    logger: quietLogger,
    getPositionContext: () => positionManager.getPositionContext(),
    paperMode: true,
    getReduciblePosition: (symbol) => {
      const position = positionManager.getPositions().find((item) => item.symbol === symbol);
      return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
    },
  });
  const strategy = new FixedSignalStrategy({
    side: "buy",
    confidence: 1,
    reason: "protected",
    stopLoss: 90,
    takeProfit: 110,
  });
  const instances: ReadonlyMap<"donchian_pivot_composition", BotStrategyInstance> = new Map([
    [
      "donchian_pivot_composition",
      { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
    ],
  ]);
  const runner = new StrategyRunner({
    instances,
    orderManager,
    positionManager,
    logger: quietLogger,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC"],
  });
  const symbol = asSymbol("BTC/USDC");
  await runner.onFeedEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] },
  });
  await runner.onFeedEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe: "15m", candle: [2, 100, 109, 91, 100, 1] },
  });
  assertCondition(positionManager.getPositionCount() === 1, "non-triggering paper candle closed exposure");
  await runner.onFeedEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe: "15m", candle: [3, 95, 111, 89, 100, 1] },
  });
  assertCondition(positionManager.getPositionCount() === 0, "paper stop/target must close the position");
  assertCondition(
    positionManager.getClosedTrades().at(-1)?.exitPrice === 90,
    "same-candle stop must win conservatively",
  );
  runner.dispose();

  const shortFeed = new MockExchangeFeed();
  await shortFeed.open();
  const shortPositions = new PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
    logger: quietLogger,
  });
  const shortOrders = new OrderManager({
    feed: shortFeed,
    logger: quietLogger,
    paperMode: true,
    getPositionContext: () => shortPositions.getPositionContext(),
  });
  const shortStrategy = new FixedSignalStrategy({
    side: "sell",
    confidence: 1,
    reason: "short-protected",
    stopLoss: 110,
    takeProfit: 90,
  });
  const shortRunner = new StrategyRunner({
    instances: new Map([
      ["cascade_fade", { kind: "strategy" as const, name: "cascade_fade" as const, instance: shortStrategy }],
    ]),
    orderManager: shortOrders,
    positionManager: shortPositions,
    logger: quietLogger,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC"],
  });
  await shortRunner.onFeedEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe: "15m", candle: [3, 100, 101, 99, 100, 1] },
  });
  await shortRunner.onFeedEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe: "15m", candle: [4, 80, 105, 79, 85, 1] },
  });
  assertCondition(shortPositions.getPositionCount() === 0, "paper short target did not close exposure");
  assertCondition(
    shortPositions.getClosedTrades().at(-1)?.exitPrice === 80 &&
      shortStrategy.closeReasons.at(-1) === "take_profit",
    "paper short gap target did not use the conservative fill and callback",
  );
  shortRunner.dispose();

  const longTarget = await createPaperProtectionHarness({
    strategyName: "donchian_pivot_composition",
    symbol,
    side: "long",
    stopLoss: 90,
    takeProfit: 110,
  });
  const longTargetStrategy = protectionStrategy("buy", "long-target-gap", 90, 110);
  assertCondition(
    await longTarget.controller.enforceProtection(
      "donchian_pivot_composition",
      longTargetStrategy,
      longTarget.position,
      [4, 115, 120, 112, 115, 1],
    ),
    "paper long target gap was not accepted",
  );
  assertCondition(
    longTarget.positionManager.getClosedTrades().at(-1)?.exitPrice === 115 &&
      longTargetStrategy.closeReasons.at(-1) === "take_profit",
    "paper long target gap did not use the conservative price and callback",
  );

  const shortStop = await createPaperProtectionHarness({
    strategyName: "cascade_fade",
    symbol,
    side: "short",
    stopLoss: 110,
    takeProfit: 90,
  });
  const shortStopStrategy = protectionStrategy("sell", "short-stop-gap", 110, 90);
  assertCondition(
    await shortStop.controller.enforceProtection(
      "cascade_fade",
      shortStopStrategy,
      shortStop.position,
      [5, 120, 121, 115, 120, 1],
    ),
    "paper short stop gap was not accepted",
  );
  assertCondition(
    shortStop.positionManager.getClosedTrades().at(-1)?.exitPrice === 120 &&
      shortStopStrategy.closeReasons.at(-1) === "stop_loss",
    "paper short stop gap did not use the conservative price and callback",
  );

  const fallback = await createPaperProtectionHarness({
    strategyName: "donchian_pivot_composition",
    symbol,
    side: "long",
    stopLoss: 90,
    takeProfit: 110,
    transformReceipt: (order) => ({
      ...order,
      average: undefined,
      price: undefined,
      updateTimestamp: undefined,
    }),
  });
  const fallbackStrategy = protectionStrategy("buy", "missing-paper-receipt-fields", 90, 110);
  const fallbackStart = Date.now();
  assertCondition(
    await fallback.controller.enforceProtection(
      "donchian_pivot_composition",
      fallbackStrategy,
      fallback.position,
      [6, 85, 89, 80, 85, 1],
    ),
    "paper protection with omitted receipt fields was not accepted",
  );
  const fallbackEnd = Date.now();
  const fallbackTrade = fallback.positionManager.getClosedTrades().at(-1);
  assertCondition(
    fallbackTrade?.exitPrice === 85 &&
      fallbackTrade.closedAt >= fallbackStart &&
      fallbackTrade.closedAt <= fallbackEnd &&
      fallbackStrategy.closeReasons.at(-1) === "stop_loss",
    "paper protection did not use fill-price and current-time receipt fallbacks",
  );

  const partial = await createPaperProtectionHarness({
    strategyName: "donchian_pivot_composition",
    symbol,
    side: "long",
    stopLoss: 90,
    takeProfit: 110,
    transformReceipt: (order) => ({ ...order, filled: order.amount / 2 }),
  });
  const partialStrategy = protectionStrategy("buy", "partial-paper-protection", 90, 110);
  assertCondition(
    await partial.controller.enforceProtection(
      "donchian_pivot_composition",
      partialStrategy,
      partial.position,
      [7, 85, 89, 80, 85, 1],
    ),
    "partial paper protection was not accepted",
  );
  assertCondition(
    partial.positionManager.getPositions().at(-1)?.quantity === 0.5 &&
      partialStrategy.closeReasons.length === 0,
    "partial paper protection incorrectly closed the remaining position",
  );

  const openFeed = new MockExchangeFeed();
  await openFeed.open();
  const openPositions = new PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
    logger: quietLogger,
  });
  const openOrders = new OrderManager({
    feed: openFeed,
    logger: quietLogger,
    getPositionContext: () => openPositions.getPositionContext(),
    getReduciblePosition: () => ({ side: "long", quantity: 1 }),
  });
  const openPosition = openPositions.openPosition("donchian_pivot_composition", symbol, "long", 1, 100, 1);
  const openPaperProtection = new StrategyPaperProtectionController({
    orderManager: openOrders,
    positionManager: openPositions,
  });
  openPaperProtection.setPaperProtection(
    openPaperProtection.protectionKey("donchian_pivot_composition", symbol),
    { side: "long", stopLoss: 90, takeProfit: 110 },
  );
  const isAccepted = await openPaperProtection.enforceProtection(
    "donchian_pivot_composition",
    new FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "open-paper-exit",
      stopLoss: 90,
      takeProfit: 110,
    }),
    openPosition,
    [4, 95, 100, 89, 95, 1],
  );
  assertCondition(isAccepted, "open paper protection did not acknowledge the trigger");
  assertCondition(
    openPositions.getPositionCount() === 1 && openOrders.getInFlightCount() === 1,
    "zero-fill paper protection changed the position or lost the open order",
  );

  const nativeFeed = new MockExchangeFeed();
  await nativeFeed.open();
  const nativePositions = new PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
    logger: quietLogger,
  });
  const nativeOrders = new OrderManager({
    feed: nativeFeed,
    logger: quietLogger,
    getPositionContext: () => nativePositions.getPositionContext(),
  });
  nativePositions.recordFill({
    strategy: "donchian_pivot_composition",
    symbol,
    side: "long",
    quantity: 1,
    price: 100,
    leverage: 1,
    timestamp: 1,
  });
  const protectionKey = "donchian_pivot_composition\u{0}BTC/USDC";
  const nativeController = new StrategyNativeProtectionController({
    orderManager: nativeOrders,
    positionManager: nativePositions,
    portfolioManager: undefined,
    logger: quietLogger,
    findOpenPosition: (strategy, candidateSymbol) =>
      nativePositions
        .getPositions()
        .find((position) => position.strategy === strategy && position.symbol === candidateSymbol),
    protectionKey: (strategy, candidateSymbol) => `${strategy}\u{0}${candidateSymbol}`,
    latestPriceFor: () => 100,
    recordPendingRiskClose: (positionId, clientOrderId) => {
      void positionId;
      void clientOrderId;
    },
    setPaperProtection: (key, protection) => {
      void key;
      void protection;
    },
  });
  await nativeController.installProtections({
    strategy: "donchian_pivot_composition",
    symbol,
    side: "long",
    quantity: 1,
    leverage: 1,
    signal: { side: "buy", confidence: 1, reason: "native-protection", stopLoss: 90, takeProfit: 110 },
    referencePrice: 100,
  });
  const protectionIds = nativeOrders.getInFlightOrderIds();
  assertCondition(
    protectionIds.length === 2,
    "native protection pair must include stop loss and take profit",
  );
  assertCondition(
    protectionIds.every((id) => nativeController.getNativeProtection(id) !== undefined),
    "native protection metadata missing",
  );
  assertCondition(
    nativeController.getGroup(protectionKey)?.active.size === 2,
    "native protection group missing",
  );
  await nativeController.installProtections({
    strategy: "donchian_pivot_composition",
    symbol: asSymbol("ETH/USDC"),
    side: "long",
    quantity: 1,
    leverage: 1,
    signal: {
      side: "buy",
      confidence: 1,
      reason: "unmatched-native-protection",
      stopLoss: 90,
      takeProfit: 110,
    },
    referencePrice: 100,
  });
  assertCondition(
    nativeOrders.getInFlightOrderIds().length === 2,
    "native protections were installed without an authoritative open position",
  );
  nativePositions.recordFill({
    strategy: "dydx_cex_carry",
    symbol,
    side: "long",
    quantity: 1,
    price: 100,
    leverage: 1,
    timestamp: 2,
  });
  await nativeController.installProtections({
    strategy: "dydx_cex_carry",
    symbol,
    side: "long",
    quantity: 1,
    leverage: 1,
    signal: { side: "buy", confidence: 1, reason: "single-native-protection", stopLoss: 90, takeProfit: 0 },
    referencePrice: 100,
  });
  assertCondition(
    nativeOrders.getInFlightOrderIds().length === 3,
    "single configured native stop loss did not install exactly one protective leg",
  );
  nativePositions.recordFill({
    strategy: "cascade_fade",
    symbol,
    side: "short",
    quantity: 2,
    price: 100,
    leverage: 1,
    timestamp: 3,
  });
  await nativeController.installProtections({
    strategy: "cascade_fade",
    symbol,
    side: "short",
    quantity: 2,
    leverage: 1,
    signal: { side: "sell", confidence: 1, reason: "short-native-protection", stopLoss: 110, takeProfit: 90 },
    referencePrice: 100,
  });
  const shortProtectionOrders = nativeOrders
    .getInFlightOrderIds()
    .slice(-2)
    .map((id) => nativeFeed.getOrder(id));
  assertCondition(
    shortProtectionOrders.length === 2 && shortProtectionOrders.every((order) => order?.side === "buy"),
    "short protection pair did not use reduce-only buy-side exits",
  );
}

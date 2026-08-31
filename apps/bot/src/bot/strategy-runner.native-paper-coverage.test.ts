import { describe, expect, it } from "bun:test";

import type { Strategy } from "@mm-crypto-bot/core";
import type { ClientOrderId, Ohlcv, Order } from "@mm-crypto-bot/exchange";
import { RecordingLogger } from "@logging-testing";

import { StrategyNativeProtectionController } from "./strategy-runner-native-protection-controller.js";
import type { OrderIntent } from "./order-manager.js";
import { StrategyPaperProtectionController } from "./strategy-runner-paper-protection-controller.js";
import * as testSupport from "./strategy-runner.test-support.js";
import type { NativeProtectionInput } from "./strategy-runner.types.js";

const strategyName = "donchian_pivot_composition" as const;

class PartialPaperOrderManager extends testSupport.OrderManager {
  public override async placeOrder(intent: OrderIntent): Promise<Order> {
    const order = await super.placeOrder(intent);
    return { ...order, filled: order.amount / 2 };
  }
}

class ReconciliationFailureFeed extends testSupport.MockExchangeFeed {
  public override async fetchOrder(): Promise<Order> {
    await Promise.resolve();
    throw new Error("injected reconciliation failure");
  }
}

class ProtectionExitStrategy implements Strategy {
  public readonly name = "protection-exit";
  public readonly timeframes = ["15m"] as const;
  public readonly closedReasons: string[] = [];

  public onCandle() {
    return { side: "buy" as const, confidence: 1, reason: "unused", stopLoss: 0, takeProfit: 0 };
  }

  public warmup(): number {
    return 0;
  }

  public onPositionClosed(reason: "stop_loss" | "take_profit"): void {
    this.closedReasons.push(reason);
  }
}

interface NativeHarness {
  readonly controller: StrategyNativeProtectionController;
  readonly feed: testSupport.MockExchangeFeed;
  readonly orderManager: testSupport.OrderManager;
  readonly positionManager: testSupport.PositionManager;
  readonly pendingRiskCloseIds: string[];
  readonly paperProtections: string[];
}

async function createNativeHarness(
  feed: testSupport.MockExchangeFeed = new testSupport.MockExchangeFeed(),
  isPaperMode = false,
): Promise<NativeHarness> {
  await feed.open();
  const positionManager = new testSupport.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orderManager = new testSupport.OrderManager({
    feed,
    paperMode: isPaperMode,
    getPositionContext: () => positionManager.getPositionContext(),
    getReduciblePosition: (symbol, strategy) =>
      positionManager
        .getPositions()
        .find((position) => position.symbol === symbol && position.strategy === strategy),
  });
  const pendingRiskCloseIds: string[] = [];
  const paperProtections: string[] = [];
  const controller = new StrategyNativeProtectionController({
    orderManager,
    positionManager,
    portfolioManager: undefined,
    logger: new RecordingLogger(),
    findOpenPosition: (strategy, symbol) =>
      positionManager
        .getPositions()
        .find((position) => position.strategy === strategy && position.symbol === symbol),
    protectionKey: (strategy, symbol) => `${strategy}:${symbol}`,
    latestPriceFor: () => 101,
    recordPendingRiskClose: (_positionId, clientOrderId) => {
      pendingRiskCloseIds.push(clientOrderId);
    },
    setPaperProtection: (key) => {
      paperProtections.push(key);
    },
  });
  return { controller, feed, orderManager, positionManager, pendingRiskCloseIds, paperProtections };
}

function nativeInput(overrides: Partial<NativeProtectionInput> = {}): NativeProtectionInput {
  return {
    strategy: strategyName,
    symbol: testSupport.makeSymbol(),
    side: "long",
    quantity: 1,
    leverage: 1,
    signal: { side: "buy", confidence: 1, reason: "native-coverage", stopLoss: 90, takeProfit: 110 },
    referencePrice: 100,
    ...overrides,
  };
}

function openLong(harness: NativeHarness, quantity = 1): void {
  harness.positionManager.openPosition(strategyName, testSupport.makeSymbol(), "long", quantity, 100, 1);
}

function createPaperController(
  orderManager: testSupport.OrderManager,
  positionManager: testSupport.PositionManager,
) {
  return new StrategyPaperProtectionController({ orderManager, positionManager });
}

async function createPaperHarness(isPartial = false): Promise<{
  readonly controller: StrategyPaperProtectionController;
  readonly orderManager: testSupport.OrderManager;
  readonly positionManager: testSupport.PositionManager;
}> {
  const feed = new testSupport.MockExchangeFeed();
  await feed.open();
  const positionManager = new testSupport.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orderOptions = {
    feed,
    paperMode: true,
    getPositionContext: () => positionManager.getPositionContext(),
    getReduciblePosition: (symbol: ReturnType<typeof testSupport.makeSymbol>, strategy: string | undefined) =>
      positionManager
        .getPositions()
        .find((position) => position.symbol === symbol && position.strategy === strategy),
  };
  const orderManager = isPartial
    ? new PartialPaperOrderManager(orderOptions)
    : new testSupport.OrderManager(orderOptions);
  return { controller: createPaperController(orderManager, positionManager), orderManager, positionManager };
}

function candle(open: number, high: number, low: number): Ohlcv {
  return [1, open, high, low, open, 1];
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

describe("strategy protection controllers", () => {
  it("delegates paper installation and leaves native groups absent when no position exists", async () => {
    const paper = await createNativeHarness(undefined, true);
    await paper.controller.installProtections(nativeInput());
    expect(paper.paperProtections).toEqual([`${strategyName}:${testSupport.makeSymbol()}`]);

    const native = await createNativeHarness();
    await native.controller.installProtections(nativeInput());
    expect(native.controller.getGroup(`${strategyName}:${testSupport.makeSymbol()}`)).toBeUndefined();
  });

  it("keeps a valid position unprotected when both protection levels are absent", async () => {
    const harness = await createNativeHarness();
    openLong(harness);
    await harness.controller.installProtections(
      nativeInput({
        signal: { side: "buy", confidence: 1, reason: "no-levels", stopLoss: 0, takeProfit: 0 },
      }),
    );
    expect(harness.orderManager.getCounters().placed).toBe(0);
    expect(harness.controller.getGroup(`${strategyName}:${testSupport.makeSymbol()}`)).toBeUndefined();
  });

  it("uses the authoritative open-position price for native protection metadata", async () => {
    const harness = await createNativeHarness();
    openLong(harness);
    await harness.controller.installProtections(nativeInput({ referencePrice: 123 }));
    const id = requireValue(harness.orderManager.getInFlightOrderIds().at(0), "expected native protection");
    expect(harness.controller.getNativeProtection(id)?.referencePrice).toBe(100);
  });

  it("installs one native pair and replaces it only after both authoritative legs retire", async () => {
    const harness = await createNativeHarness();
    openLong(harness);
    await harness.controller.installProtections(nativeInput());
    const key = `${strategyName}:${testSupport.makeSymbol()}`;
    const group = harness.controller.getGroup(key);
    expect(group?.active.size).toBe(2);

    await harness.controller.installProtections(nativeInput({ referencePrice: 101 }));
    expect(group?.cancelPending.size).toBe(2);
    const existingGroup = requireValue(group, "expected native group");
    for (const id of existingGroup.active) harness.controller.retireProtectionLeg(existingGroup, id);
    await harness.controller.settleProtectionGroup(existingGroup);
    expect(harness.orderManager.getCounters().placed).toBe(4);
    expect(harness.controller.getGroup(key)?.active.size).toBe(2);
  });

  it("cancels an already-created stop loss and requests a pending fail-safe close after take-profit creation fails", async () => {
    const harness = await createNativeHarness(new testSupport.FailTakeProfitFeed());
    openLong(harness);
    await harness.controller.installProtections(nativeInput());
    const group = requireValue(
      harness.controller.getGroup(`${strategyName}:${testSupport.makeSymbol()}`),
      "expected failed protection group",
    );
    for (const id of group.active) harness.controller.retireProtectionLeg(group, id);
    await harness.controller.settleProtectionGroup(group);
    expect(harness.orderManager.getCounters().placed).toBe(2);
    expect(harness.pendingRiskCloseIds).toHaveLength(1);
    let hasCanceledOrder = false;
    for (const order of harness.feed.orderBook.values()) {
      if (order.status === "canceled") hasCanceledOrder = true;
    }
    expect(hasCanceledOrder).toBe(true);
  });

  it("retries a failed cancellation before installing a replacement pair", async () => {
    const harness = await createNativeHarness(new testSupport.FailFirstProtectionCancelFeed());
    openLong(harness);
    await harness.controller.installProtections(nativeInput());
    const key = `${strategyName}:${testSupport.makeSymbol()}`;
    const group = requireValue(harness.controller.getGroup(key), "expected active protection group");
    await harness.controller.installProtections(nativeInput({ referencePrice: 101 }));
    expect(group.cancelPending.size).toBe(1);
    await harness.controller.requestProtectionCancellation(group);
    expect(group.cancelPending.size).toBe(2);
  });

  it("reconciles a partial protective fill, cancels the sibling, and resizes the replacement pair", async () => {
    const harness = await createNativeHarness();
    openLong(harness);
    await harness.controller.installProtections(nativeInput());
    const key = `${strategyName}:${testSupport.makeSymbol()}`;
    const group = requireValue(harness.controller.getGroup(key), "expected active protection group");
    const filledId = requireValue(group.active.values().next().value, "expected protection leg");
    harness.feed.setOrderStatus(filledId, { status: "closed", filled: 0.4, average: 90 });
    await harness.controller.reconcileNativeProtections(testSupport.makeSymbol());
    expect(harness.positionManager.getPositions().at(0)?.quantity).toBeCloseTo(0.6);
    expect(group.cancelPending.size).toBe(1);
    for (const id of group.active) harness.controller.retireProtectionLeg(group, id);
    await harness.controller.settleProtectionGroup(group);
    const replacement = requireValue(harness.controller.getGroup(key), "expected replacement group");
    expect(replacement.active.size).toBe(2);
    for (const id of replacement.active) expect(harness.feed.getOrder(id)?.amount).toBeCloseTo(0.6);
  });

  it("reconciles a full protective execution, cancels the sibling, and settles after terminal proof", async () => {
    const harness = await createNativeHarness();
    openLong(harness);
    await harness.controller.installProtections(nativeInput());
    const key = `${strategyName}:${testSupport.makeSymbol()}`;
    const group = requireValue(harness.controller.getGroup(key), "expected active protection group");
    const filledId = requireValue(group.active.values().next().value, "expected protection leg");
    expect(harness.controller.getNativeProtection(filledId)?.sibling).toBeDefined();
    harness.feed.setOrderStatus(filledId, { status: "closed", filled: 1, average: 90 });
    await harness.controller.reconcileNativeProtections(testSupport.makeSymbol());
    expect(harness.positionManager.getPositionCount()).toBe(0);
    expect(group.cancelPending.size).toBe(1);
    for (const id of group.active) harness.controller.retireProtectionLeg(group, id);
    await harness.controller.settleProtectionGroup(group);
    expect(harness.controller.getGroup(key)).toBeUndefined();
  });

  it("contains reconciliation failures and preserves the native protection group", async () => {
    const harness = await createNativeHarness(new ReconciliationFailureFeed());
    openLong(harness);
    await harness.controller.installProtections(nativeInput());
    await harness.controller.reconcileNativeProtections(testSupport.makeSymbol());
    expect(harness.controller.getGroup(`${strategyName}:${testSupport.makeSymbol()}`)?.active.size).toBe(2);
  });

  it("bounds superseded native protection metadata while keeping the newest retired leg", async () => {
    const harness = await createNativeHarness();
    openLong(harness);
    const key = `${strategyName}:${testSupport.makeSymbol()}`;
    let oldestId: ClientOrderId | undefined;
    let newestId: ClientOrderId | undefined;

    for (let index = 0; index <= 500; index += 1) {
      await harness.controller.installProtections(nativeInput({ referencePrice: 100 + index }));
      const group = requireValue(harness.controller.getGroup(key), "expected active protection group");
      const retiredId = requireValue(group.active.values().next().value, "expected native protection leg");
      if (index === 0) oldestId = retiredId;
      newestId = retiredId;
      for (const id of group.active) harness.controller.retireProtectionLeg(group, id);
      await harness.controller.settleProtectionGroup(group);
    }

    expect(
      harness.controller.getNativeProtection(requireValue(oldestId, "expected oldest id")),
    ).toBeUndefined();
    expect(
      harness.controller.getNativeProtection(requireValue(newestId, "expected newest id")),
    ).toBeDefined();
  });

  it("closes a long paper position at the stop gap price and clears full protection", async () => {
    const harness = await createPaperHarness();
    const strategy = new ProtectionExitStrategy();
    harness.positionManager.openPosition(strategyName, testSupport.makeSymbol(), "long", 1, 100, 1);
    harness.controller.setPaperProtection(
      harness.controller.protectionKey(strategyName, testSupport.makeSymbol()),
      {
        side: "long",
        stopLoss: 90,
        takeProfit: 110,
      },
    );
    const position = requireValue(harness.positionManager.getPositions()[0], "expected long position");
    expect(
      await harness.controller.enforceProtection(strategyName, strategy, position, candle(85, 89, 80)),
    ).toBe(true);
    expect(harness.positionManager.getPositionCount()).toBe(0);
    expect(strategy.closedReasons).toEqual(["stop_loss"]);
  });

  it("closes a long paper position at the target gap price", async () => {
    const harness = await createPaperHarness();
    const strategy = new ProtectionExitStrategy();
    harness.positionManager.openPosition(strategyName, testSupport.makeSymbol(), "long", 1, 100, 1);
    harness.controller.setPaperProtection(
      harness.controller.protectionKey(strategyName, testSupport.makeSymbol()),
      {
        side: "long",
        stopLoss: 90,
        takeProfit: 110,
      },
    );
    const position = requireValue(harness.positionManager.getPositions()[0], "expected long position");
    const isProtected = await harness.controller.enforceProtection(
      strategyName,
      strategy,
      position,
      candle(115, 120, 112),
    );
    expect(isProtected).toBe(true);
    expect(strategy.closedReasons).toEqual(["take_profit"]);
  });

  it("closes short paper positions at stop and target gap prices", async () => {
    for (const [open, high, low, expected] of [
      [115, 120, 112, "stop_loss"],
      [85, 88, 80, "take_profit"],
    ] as const) {
      const harness = await createPaperHarness();
      const strategy = new ProtectionExitStrategy();
      harness.positionManager.openPosition(strategyName, testSupport.makeSymbol(), "short", 1, 100, 1);
      harness.controller.setPaperProtection(
        harness.controller.protectionKey(strategyName, testSupport.makeSymbol()),
        {
          side: "short",
          stopLoss: 110,
          takeProfit: 90,
        },
      );
      await harness.controller.enforceProtection(
        strategyName,
        strategy,
        requireValue(harness.positionManager.getPositions()[0], "expected short position"),
        candle(open, high, low),
      );
      expect(strategy.closedReasons).toEqual([expected]);
    }
  });

  it("leaves paper positions untouched for missing protection and non-trigger candles", async () => {
    const harness = await createPaperHarness();
    const strategy = new ProtectionExitStrategy();
    harness.positionManager.openPosition(strategyName, testSupport.makeSymbol(), "long", 1, 100, 1);
    const position = requireValue(harness.positionManager.getPositions()[0], "expected long position");
    expect(
      await harness.controller.enforceProtection(strategyName, strategy, position, candle(100, 105, 95)),
    ).toBe(false);
    harness.controller.setPaperProtection(
      harness.controller.protectionKey(strategyName, testSupport.makeSymbol()),
      {
        side: "long",
        stopLoss: 90,
        takeProfit: 110,
      },
    );
    expect(
      await harness.controller.enforceProtection(strategyName, strategy, position, candle(100, 105, 95)),
    ).toBe(false);
    expect(harness.positionManager.getPositionCount()).toBe(1);
  });

  it("retains paper protection after a partial protective fill", async () => {
    const harness = await createPaperHarness(true);
    const strategy = new ProtectionExitStrategy();
    harness.positionManager.openPosition(strategyName, testSupport.makeSymbol(), "long", 1, 100, 1);
    harness.controller.setPaperProtection(
      harness.controller.protectionKey(strategyName, testSupport.makeSymbol()),
      {
        side: "long",
        stopLoss: 90,
        takeProfit: 110,
      },
    );
    await harness.controller.enforceProtection(
      strategyName,
      strategy,
      requireValue(harness.positionManager.getPositions()[0], "expected long position"),
      candle(85, 89, 80),
    );
    expect(harness.positionManager.getPositions()[0]?.quantity).toBeCloseTo(0.5);
    expect(strategy.closedReasons).toEqual([]);
  });
});

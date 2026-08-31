import { describe, expect, it } from "vitest";

import type { Strategy, StrategySignal } from "@mm-crypto-bot/core";
import type { Order } from "@mm-crypto-bot/exchange";
import { RecordingLogger } from "@logging-testing";

import type { OrderLifecycleEvent } from "./order-manager.js";
import { StrategyOrderLifecycleController } from "./strategy-runner-order-lifecycle-controller.js";
import type { NativeProtectionInput } from "./strategy-runner.types.js";
import {
  MockExchangeFeed,
  OrderManager,
  PositionManager,
  makeSymbol,
} from "./strategy-runner.test-support.js";

const strategyName = "donchian_pivot_composition" as const;
const signal: StrategySignal = {
  side: "buy",
  confidence: 1,
  reason: "controller-boundary",
  stopLoss: 90,
  takeProfit: 110,
};

class PositionOpenedStrategy implements Strategy {
  public readonly name = "position-opened-probe";
  public readonly timeframes = ["15m"] as const;
  public readonly opened: { readonly quantity: number; readonly entryPrice: number }[] = [];

  public onCandle(): StrategySignal {
    return signal;
  }

  public onPositionOpened(position: { readonly quantity: number; readonly entryPrice: number }): void {
    this.opened.push({ quantity: position.quantity, entryPrice: position.entryPrice });
  }

  public warmup(): number {
    return 0;
  }
}

class SubmissionFailureOrderManager extends OrderManager {
  public override async placeOrder(): Promise<Order> {
    await Promise.resolve();
    throw new Error("injected submission failure");
  }
}

class ReconciliationFailureOrderManager extends OrderManager {
  public override async reconcileOrder(): Promise<{ readonly order: Order; readonly deltaFilled: number }> {
    await Promise.resolve();
    throw new Error("injected reconciliation failure");
  }
}

interface Harness {
  readonly controller: StrategyOrderLifecycleController;
  readonly feed: MockExchangeFeed;
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
  readonly installedProtections: NativeProtectionInput[];
  readonly strategy: PositionOpenedStrategy;
}

async function createHarness(
  options: {
    readonly orderManager?: OrderManager;
    readonly paperMode?: boolean;
    readonly isOrderEmissionBlocked?: () => boolean;
    readonly regimeModifier?: number;
    readonly sizingAmount?: number;
  } = {},
): Promise<Harness> {
  const feed = new MockExchangeFeed();
  await feed.open();
  const positionManager = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
  const orderManager =
    options.orderManager ??
    new OrderManager({
      feed,
      paperMode: options.paperMode === true,
      getPositionContext: () => positionManager.getPositionContext(),
      getReduciblePosition: (symbol, strategy) =>
        positionManager
          .getPositions()
          .find((position) => position.symbol === symbol && position.strategy === strategy),
    });
  const installedProtections: NativeProtectionInput[] = [];
  const controller = new StrategyOrderLifecycleController({
    orderManager,
    positionManager,
    sizingFn: () => options.sizingAmount ?? 1,
    riskPerTrade: 0.01,
    maxLeverage: 10,
    logger: new RecordingLogger(),
    isOrderEmissionBlocked: options.isOrderEmissionBlocked ?? (() => false),
    getRiskManager: () => {
      return;
    },
    getPortfolioManager: () => {
      return;
    },
    getRegimeSizeModifier: () => options.regimeModifier ?? 1,
    protectionKey: (strategy, symbol) => `${strategy}:${symbol}`,
    latestPriceFor: () => 101,
    installProtections: (input) => {
      installedProtections.push(input);
      return Promise.resolve();
    },
    reconcileNativeProtections: () => Promise.resolve(),
  });
  return {
    controller,
    feed,
    orderManager,
    positionManager,
    installedProtections,
    strategy: new PositionOpenedStrategy(),
  };
}

function lifecycleEvent(
  order: Order,
  deltaFilled: number,
  kind: "order" | "execution" = "order",
): OrderLifecycleEvent {
  if (kind === "execution") {
    return {
      kind,
      order,
      deltaFilled,
      execution: {
        executionId: "controller-execution",
        clientOrderId: order.clientOrderId,
        exchangeOrderId: order.exchangeId,
        symbol: order.symbol,
        side: order.side,
        quantity: deltaFilled,
        price: 101,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: 2,
      },
    };
  }
  return { kind, order, deltaFilled };
}

describe("StrategyOrderLifecycleController public boundaries", () => {
  it("stops order emission while paused, at policy capacity, with zero sizing, or under a blocked regime", async () => {
    const paused = await createHarness({ isOrderEmissionBlocked: () => true });
    await paused.controller.handleSignal(strategyName, paused.strategy, signal, makeSymbol(), 100, undefined);
    expect(paused.orderManager.getCounters().placed).toBe(0);

    const capacity = await createHarness();
    capacity.positionManager.openPosition(strategyName, makeSymbol(), "long", 1, 100, 1);
    await capacity.controller.handleSignal(strategyName, capacity.strategy, signal, makeSymbol(), 100, {
      maxPositions: 1,
    });
    expect(capacity.orderManager.getCounters().placed).toBe(0);

    const zeroSizing = await createHarness({ sizingAmount: 0 });
    await zeroSizing.controller.handleSignal(
      strategyName,
      zeroSizing.strategy,
      signal,
      makeSymbol(),
      100,
      undefined,
    );
    expect(zeroSizing.orderManager.getCounters().placed).toBe(0);

    const blockedRegime = await createHarness({ regimeModifier: 0 });
    await blockedRegime.controller.handleSignal(
      strategyName,
      blockedRegime.strategy,
      signal,
      makeSymbol(),
      100,
      undefined,
    );
    expect(blockedRegime.orderManager.getCounters().placed).toBe(0);
  });

  it("records immediate paper fills, then rejects a second signal while a live entry remains pending", async () => {
    const paper = await createHarness({ paperMode: true });
    await paper.controller.handleSignal(strategyName, paper.strategy, signal, makeSymbol(), 100, {
      leverage: 3,
    });
    expect(paper.positionManager.getPosition(strategyName, makeSymbol(), "long")?.quantity).toBe(1);
    expect(paper.installedProtections).toHaveLength(1);
    expect(paper.strategy.opened).toEqual([{ quantity: 1, entryPrice: 100 }]);

    const live = await createHarness();
    await live.controller.handleSignal(strategyName, live.strategy, signal, makeSymbol(), 100, undefined);
    await live.controller.handleSignal(strategyName, live.strategy, signal, makeSymbol(), 100, undefined);
    expect(live.orderManager.getCounters().placed).toBe(1);
  });

  it("applies execution and terminal lifecycle updates only for known pending entries", async () => {
    const harness = await createHarness();
    await harness.controller.handleSignal(
      strategyName,
      harness.strategy,
      signal,
      makeSymbol(),
      100,
      undefined,
    );
    const clientOrderId = harness.orderManager.getInFlightOrderIds()[0];
    if (clientOrderId === undefined) throw new Error("expected pending entry order");
    const openOrder = harness.feed.getOrder(clientOrderId);
    if (openOrder === undefined) throw new Error("expected feed order");

    const untrackedOrder = await harness.orderManager.placeOrder({
      signal,
      symbol: makeSymbol(),
      amount: 1,
      referencePrice: 100,
      type: "market",
      clientOrderIdHint: "untracked-controller-event",
    });
    await expect(
      harness.controller.applyPendingOrderLifecycle(lifecycleEvent(untrackedOrder, 0)),
    ).resolves.toBe(false);
    const partial = { ...openOrder, filled: 0.5, average: 101, updateTimestamp: 2 };
    await expect(
      harness.controller.applyPendingOrderLifecycle(lifecycleEvent(partial, 0.5, "execution")),
    ).resolves.toBe(true);
    expect(harness.positionManager.getPosition(strategyName, makeSymbol(), "long")?.quantity).toBe(0.5);
    expect(harness.installedProtections).toHaveLength(1);
    expect(harness.strategy.opened).toEqual([{ quantity: 0.5, entryPrice: 101 }]);

    const terminal = { ...partial, status: "closed" as const, filled: 1, updateTimestamp: 3 };
    await expect(harness.controller.applyPendingOrderLifecycle(lifecycleEvent(terminal, 0.5))).resolves.toBe(
      true,
    );
    expect(harness.positionManager.getPosition(strategyName, makeSymbol(), "long")?.quantity).toBe(1);
    expect(harness.strategy.opened).toHaveLength(1);
  });

  it("contains a submit failure and a pending-order reconciliation failure", async () => {
    const submitFeed = new MockExchangeFeed();
    await submitFeed.open();
    const submitPositions = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const failedSubmission = await createHarness({
      orderManager: new SubmissionFailureOrderManager({
        feed: submitFeed,
        getPositionContext: () => submitPositions.getPositionContext(),
      }),
    });
    await failedSubmission.controller.handleSignal(
      strategyName,
      failedSubmission.strategy,
      signal,
      makeSymbol(),
      100,
      undefined,
    );
    expect(failedSubmission.orderManager.getCounters().placed).toBe(0);

    const reconcileFeed = new MockExchangeFeed();
    await reconcileFeed.open();
    const reconcilePositions = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const failedReconciliation = await createHarness({
      orderManager: new ReconciliationFailureOrderManager({
        feed: reconcileFeed,
        getPositionContext: () => reconcilePositions.getPositionContext(),
      }),
    });
    await failedReconciliation.controller.handleSignal(
      strategyName,
      failedReconciliation.strategy,
      signal,
      makeSymbol(),
      100,
      undefined,
    );
    await failedReconciliation.controller.reconcilePendingOrders(makeSymbol());
    expect(failedReconciliation.orderManager.getCounters().placed).toBe(1);
  });
});

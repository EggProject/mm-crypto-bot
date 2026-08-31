import { describe, expect, it } from "vitest";

import { RecordingLogger } from "@logging-testing";

import { StrategyPluginRiskController } from "./strategy-runner-plugin-risk-controller.js";
import {
  MockExchangeFeed,
  OrderManager,
  PositionManager,
  makeSymbol,
  strategyInstances,
} from "./strategy-runner.test-support.js";

interface Harness {
  readonly controller: StrategyPluginRiskController;
  readonly feed: MockExchangeFeed;
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
  readonly closedStrategies: string[];
}

async function createHarness(isPaperMode = false, isBlocked = false): Promise<Harness> {
  const feed = new MockExchangeFeed();
  await feed.open();
  const positionManager = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
  const orderManager = new OrderManager({
    feed,
    paperMode: isPaperMode,
    getPositionContext: () => positionManager.getPositionContext(),
    getReduciblePosition: (symbol, strategy) =>
      positionManager
        .getPositions()
        .find((position) => position.symbol === symbol && position.strategy === strategy),
  });
  const closedStrategies: string[] = [];
  const controller = new StrategyPluginRiskController({
    instances: strategyInstances([]),
    orderManager,
    positionManager,
    enabledSymbols: new Set([makeSymbol()]),
    logger: new RecordingLogger(),
    isOrderEmissionBlocked: () => isBlocked,
    pause: () => {
      return;
    },
    getRiskManager: () => {
      return;
    },
    getPortfolioManager: () => {
      return;
    },
    getOnEmergency: () => {
      return;
    },
    latestPriceFor: () => 99,
    notifyStrategyClosed: (strategy) => {
      closedStrategies.push(strategy);
    },
  });
  return { controller, feed, orderManager, positionManager, closedStrategies };
}

describe("StrategyPluginRiskController trailing-close boundaries", () => {
  it("does not submit a trailing close while blocked or when the position no longer exists", async () => {
    const blocked = await createHarness(false, true);
    const position = blocked.positionManager.openPosition("trailing", makeSymbol(), "long", 1, 100, 1);
    await blocked.controller.requestTrailingStopClose(position.id, 90, "trailing_stop");
    expect(blocked.orderManager.getCounters().placed).toBe(0);

    const absent = await createHarness();
    await absent.controller.requestTrailingStopClose("missing-position", 90, "trailing_stop");
    expect(absent.orderManager.getCounters().placed).toBe(0);
  });

  it("closes a paper position immediately and notifies the strategy exactly once", async () => {
    const harness = await createHarness(true);
    const position = harness.positionManager.openPosition("trailing", makeSymbol(), "long", 1, 100, 1);
    await harness.controller.requestTrailingStopClose(position.id, 90, "trailing_stop");

    expect(harness.positionManager.getPositions()).toHaveLength(0);
    expect(harness.closedStrategies).toEqual(["trailing"]);
  });

  it("reconciles an open trailing order into a terminal fill", async () => {
    const harness = await createHarness();
    const position = harness.positionManager.openPosition("trailing", makeSymbol(), "long", 1, 100, 1);
    await harness.controller.requestTrailingStopClose(position.id, 90, "trailing_stop");
    const clientOrderId = harness.orderManager.getInFlightOrderIds()[0];
    if (clientOrderId === undefined) throw new Error("expected pending trailing order");
    harness.feed.setOrderStatus(clientOrderId, { status: "closed", filled: 1, average: 89 });

    await harness.controller.reconcileRiskCloses(makeSymbol());
    expect(harness.positionManager.getPositions()).toHaveLength(0);
    expect(harness.closedStrategies).toEqual(["trailing"]);
  });
});

import { describe, expect, it } from "vitest";

import { requestTrailingStopClose } from "./strategy-runner.controller.test-support.js";
import {
  MockExchangeFeed,
  OrderManager,
  PositionManager,
  makeSymbol,
} from "./strategy-runner.test-support.js";

describe("StrategyPluginRiskController trailing close", () => {
  it("closes a tracked long position through the reduce-only paper order boundary", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const positionManager = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const orderManager = new OrderManager({
      feed,
      paperMode: true,
      getPositionContext: () => positionManager.getPositionContext(),
      getReduciblePosition: () => ({ side: "long", quantity: 1 }),
    });
    const position = positionManager.openPosition(
      "donchian_pivot_composition",
      makeSymbol(),
      "long",
      1,
      100,
      1,
    );

    await requestTrailingStopClose({ orderManager, positionManager }, position.id, 90, "trailing-stop");

    expect(positionManager.getPositions()).toEqual([]);
    expect(orderManager.getCounters()).toMatchObject({ placed: 1, filled: 1 });
  });

  it("does not emit an order when the requested position is absent", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const positionManager = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const orderManager = new OrderManager({
      feed,
      paperMode: true,
      getPositionContext: () => positionManager.getPositionContext(),
    });

    await requestTrailingStopClose({ orderManager, positionManager }, "missing", 90, "trailing-stop");

    expect(orderManager.getCounters().placed).toBe(0);
  });
});

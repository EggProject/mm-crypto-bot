import { describe, expect, it, vi } from "vitest";

import { makeStack } from "../portfolio/portfolio-manager.test-support.js";
import {
  RiskActionPlugin,
  StrategyRunner,
  makeOhlcvFeedEvent,
  strategyInstances,
} from "./strategy-runner.test-support.js";

describe("StrategyRunner plugin emergency close", () => {
  it("pauses and delegates one plugin breach to PortfolioManager when no emergency callback exists", async () => {
    const stack = makeStack();
    await stack.feed.open();
    const plugin = new RiskActionPlugin("risk-probe:BTC/USDC", true);
    const closeAll = vi.spyOn(stack.portfolioManager, "executeCloseAll");
    const runner = new StrategyRunner({
      instances: strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: plugin }],
      ]),
      orderManager: stack.orderManager,
      positionManager: stack.positionManager,
      portfolioManager: stack.portfolioManager,
      sizingFn: () => 0,
      enabledSymbols: ["BTC/USDC"],
    });

    await runner.onFeedEvent(makeOhlcvFeedEvent(1));
    await Promise.resolve();
    await runner.onFeedEvent(makeOhlcvFeedEvent(2));

    expect(runner.isPaused()).toBe(true);
    expect(closeAll).toHaveBeenCalledTimes(1);
    runner.dispose();
  });
});

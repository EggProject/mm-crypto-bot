import { describe, expect, it, vi } from "vitest";

import {
  ok,
  type Bar,
  type CarryMarket,
  type ConfigError,
  type DydxFundingSource,
  type FundingSnapshot,
  type PluginState,
  type Result,
  type SignalBus,
  type Strategy,
  type StrategyPlugin,
} from "@mm-crypto-bot/core";
import type { ClientOrderId, Order, Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
import { ExactRational } from "@mm-crypto-bot/numeric";
import { RecordingLogger } from "@logging-testing";

import { StrategyPluginRiskController } from "./strategy-runner-plugin-risk-controller.js";
import {
  LifecyclePlugin,
  MockExchangeFeed,
  OrderManager,
  PositionManager,
  makeSymbol,
  strategyInstances,
} from "./strategy-runner.test-support.js";
import type { OrderIntent } from "./order-manager.js";

const noValue = undefined;
const sampleBar: Bar = { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 };

function noOperation(): void {
  return;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function runWithResourceCleanup(
  controller: StrategyPluginRiskController,
  feed: MockExchangeFeed,
  operation: () => Promise<void> | void,
): Promise<void> {
  let primaryFailure: Error | undefined;
  try {
    await operation();
  } catch (error) {
    primaryFailure = asError(error);
  }

  let cleanupFailure: Error | undefined;
  try {
    controller.dispose();
  } catch (error) {
    cleanupFailure = asError(error);
  }
  try {
    await feed.close();
  } catch (error) {
    cleanupFailure ??= asError(error);
  }

  if (primaryFailure !== undefined) throw primaryFailure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
}

interface ControllerDependencies {
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
  readonly logger: RecordingLogger;
}

async function createDependencies(
  feed = new MockExchangeFeed(),
): Promise<ControllerDependencies & { readonly feed: MockExchangeFeed }> {
  await feed.open();
  const positionManager = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
  const orderManager = new OrderManager({
    feed,
    getPositionContext: () => positionManager.getPositionContext(),
  });
  return { feed, orderManager, positionManager, logger: new RecordingLogger() };
}

function createController(
  dependencies: ControllerDependencies,
  instances: Parameters<typeof strategyInstances>[0],
  options: {
    readonly pause?: () => void;
  } = {},
): StrategyPluginRiskController {
  return new StrategyPluginRiskController({
    instances: strategyInstances(instances),
    orderManager: dependencies.orderManager,
    positionManager: dependencies.positionManager,
    enabledSymbols: new Set([makeSymbol()]),
    logger: dependencies.logger,
    isOrderEmissionBlocked: () => false,
    pause: options.pause ?? noOperation,
    getRiskManager: () => noValue,
    getPortfolioManager: () => noValue,
    getOnEmergency: () => noValue,
    latestPriceFor: () => noValue,
    notifyStrategyClosed: noOperation,
  });
}

class RegimeSignalPlugin extends LifecyclePlugin {
  private signalBus: SignalBus | undefined;

  public constructor(private readonly modifier: number | undefined) {
    super();
  }

  public override subscribe(signalBus: SignalBus): void {
    super.subscribe(signalBus);
    this.signalBus = signalBus;
  }

  public override onBar(bar: Bar, state: PluginState): void {
    super.onBar(bar, state);
    if (this.modifier === undefined) {
      this.signalBus?.emit({
        kind: "risk",
        varDaily95: 0,
        correlationPenalty: 0,
        drawdownLimit: 0,
        source: "regime-detector-v1:BTC/USDC",
        breach: false,
        reason: "missing modifier",
      });
      return;
    }
    this.signalBus?.emit({
      kind: "risk",
      varDaily95: 0,
      correlationPenalty: 0,
      drawdownLimit: 0,
      source: "regime-detector-v1:BTC/USDC",
      breach: false,
      reason: "invalid modifier",
      sizeModifier: this.modifier,
    });
  }
}

class ThrowingSubscribePlugin extends LifecyclePlugin {
  public override subscribe(signalBus: SignalBus): void {
    super.subscribe(signalBus);
    throw new Error("subscribe rejected");
  }
}

class ThrowingDisposePlugin extends LifecyclePlugin {
  public override dispose(): void {
    super.dispose();
    throw new Error("dispose rejected");
  }
}

class RejectingBarPlugin implements StrategyPlugin {
  public barCalls = 0;
  public readonly metadata: StrategyPlugin["metadata"] = {
    name: "rejecting-bar-probe",
    version: "1.0.0",
    edgeClass: "risk",
    capitalRequirement: 0,
    maxAggregateEffectiveLeverage: 1,
    onBarMode: "async",
  };

  public subscribe(_signalBus: SignalBus): void {
    return;
  }

  public async onBar(_bar: Bar, _state: PluginState): Promise<void> {
    await Promise.resolve();
    this.barCalls += 1;
    throw new Error("onBar rejected");
  }

  public reset(): void {
    return;
  }

  public validateConfig(_config: unknown): Result<void, ConfigError> {
    return ok(undefined);
  }
}

class FundingFaultSource implements DydxFundingSource {
  private listener:
    ((snapshot: { readonly dydx: FundingSnapshot; readonly cex: FundingSnapshot }) => void) | undefined;
  public closeCalls = 0;

  public constructor(private readonly isCloseFaulty: boolean) {}

  public subscribe(
    _market: CarryMarket,
    listener: (snapshot: { readonly dydx: FundingSnapshot; readonly cex: FundingSnapshot }) => void,
  ): { readonly close: () => void } {
    this.listener = listener;
    return {
      close: (): void => {
        this.closeCalls += 1;
        if (this.isCloseFaulty) throw new Error("funding close rejected");
        this.listener = undefined;
      },
    };
  }

  public fire(dydxTime: number, cexTime: number): void {
    this.listener?.({
      dydx: {
        symbol: "BTC-USD",
        fundingTime: dydxTime,
        fundingRate: ExactRational.from("0.001"),
        markPrice: ExactRational.from("100"),
      },
      cex: {
        symbol: "BTC-USD",
        fundingTime: cexTime,
        fundingRate: ExactRational.from("-0.001"),
        markPrice: ExactRational.from("100"),
      },
    });
  }

  public lastTickAgeMs(_market: CarryMarket, _nowMs: number): number | undefined {
    return 0;
  }

  public lastChainBlockHeight(_market: CarryMarket): number | undefined {
    return 1;
  }

  public lastChainBlockTs(_market: CarryMarket): number | undefined {
    return 1;
  }

  public bybitEuSpotDepthUsd(_market: CarryMarket, _nowMs: number): number | undefined {
    return 1_000_000;
  }

  public health(): {
    readonly lastTickMs: number | undefined;
    readonly chainBlockHeight: number | undefined;
  } {
    return { lastTickMs: 1, chainBlockHeight: 1 };
  }
}

class FundingFaultStrategy implements Strategy {
  public readonly name = "funding-fault";
  public readonly timeframes = ["1d"] as const;
  public readonly observedTimes: number[] = [];
  public readonly config: { readonly market: CarryMarket; readonly fundingSource: DydxFundingSource };

  public constructor(fundingSource: DydxFundingSource) {
    this.config = { market: "BTC-USD", fundingSource };
  }

  public onCandle() {
    return { side: "buy" as const, confidence: 1, reason: "unused", stopLoss: 0, takeProfit: 0 };
  }

  public warmup(): number {
    return 0;
  }

  public recordFundingTick(_dydx: FundingSnapshot, _cex: FundingSnapshot, nowMs: number): ExactRational {
    this.observedTimes.push(nowMs);
    throw new Error("funding record rejected");
  }
}

class ThrowingFetchFeed extends MockExchangeFeed {
  public override fetchOrder(_clientOrderId: ClientOrderId, _symbol: ExchangeSymbol): Promise<Order> {
    return Promise.reject(new Error("reconcile rejected"));
  }
}

class CapturingOrderManager extends OrderManager {
  public lastRequestedLeverage: number | undefined;

  public override async placeOrder(intent: OrderIntent): Promise<Order> {
    this.lastRequestedLeverage = intent.leverage;
    return super.placeOrder(intent);
  }
}

describe("StrategyPluginRiskController plugin and funding fault boundaries", () => {
  it.each([undefined, -1, 2, NaN])(
    "fails closed when a regime plugin emits size modifier %s",
    async (modifier) => {
      const dependencies = await createDependencies();
      const plugin = new RegimeSignalPlugin(modifier);
      let pauses = 0;
      const controller = createController(
        dependencies,
        [["regime_detector", { kind: "plugin", name: "regime_detector", instance: plugin }]],
        {
          pause: () => {
            pauses += 1;
          },
        },
      );

      await runWithResourceCleanup(controller, dependencies.feed, async () => {
        controller.start();
        await controller.processPlugins(makeSymbol(), "15m", sampleBar);
      });

      expect(pauses).toBe(1);
      expect(controller.getRegimeSizeModifier(makeSymbol())).toBe(1);
    },
  );

  it("rolls back started plugin subscriptions when a later subscription fails", async () => {
    const dependencies = await createDependencies();
    const startedPlugin = new LifecyclePlugin();
    const failingPlugin = new ThrowingSubscribePlugin();
    const controller = createController(dependencies, [
      ["regime_detector", { kind: "plugin", name: "regime_detector", instance: startedPlugin }],
      [
        "funding_flip_kill_switch",
        { kind: "plugin", name: "funding_flip_kill_switch", instance: failingPlugin },
      ],
    ]);

    await runWithResourceCleanup(controller, dependencies.feed, () => {
      expect(() => {
        controller.start();
      }).toThrow("subscribe rejected");
      expect(startedPlugin.disposeCalls).toBe(1);
      expect(failingPlugin.disposeCalls).toBe(0);
    });
  });

  it("logs plugin disposal and daily-bar contract failures while preserving other plugins", async () => {
    const dependencies = await createDependencies();
    const missingDailyContract = new LifecyclePlugin();
    const rejectingPlugin = new RejectingBarPlugin();
    const disposalFailure = new ThrowingDisposePlugin();
    const controller = createController(dependencies, [
      ["regime_detector", { kind: "plugin", name: "regime_detector", instance: missingDailyContract }],
      [
        "funding_flip_kill_switch",
        { kind: "plugin", name: "funding_flip_kill_switch", instance: rejectingPlugin },
      ],
      ["cascade_fade", { kind: "plugin", name: "cascade_fade", instance: disposalFailure }],
    ]);

    await runWithResourceCleanup(controller, dependencies.feed, async () => {
      controller.start();
      await controller.processPlugins(makeSymbol(), "1d", sampleBar);
    });

    expect(missingDailyContract.barCalls).toBe(0);
    expect(rejectingPlugin.barCalls).toBe(1);
    expect(disposalFailure.disposeCalls).toBe(1);
    expect(dependencies.logger.getCalls().map((call) => call.event)).toEqual(
      expect.arrayContaining(["strategy.plugin.bar.handler.failed", "strategy.plugin.dispose.failed"]),
    );
  });

  it("uses a clock fallback for invalid funding timestamps and logs funding and close faults", async () => {
    const dependencies = await createDependencies();
    const fundingSource = new FundingFaultSource(true);
    const strategy = new FundingFaultStrategy(fundingSource);
    const controller = createController(dependencies, [
      ["dydx_cex_carry", { kind: "strategy", name: "dydx_cex_carry", instance: strategy }],
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(9876);
    try {
      await runWithResourceCleanup(controller, dependencies.feed, () => {
        controller.start();
        fundingSource.fire(NaN, NaN);
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(strategy.observedTimes).toEqual([9876]);
    expect(fundingSource.closeCalls).toBe(1);
    expect(dependencies.logger.getCalls().map((call) => call.event)).toEqual(
      expect.arrayContaining([
        "strategy.funding.tick.rejected",
        "strategy.funding.subscription.close.failed",
      ]),
    );
  });

  it("retains a pending trailing close after a supported reconciliation port rejects", async () => {
    const feed = new ThrowingFetchFeed();
    await feed.open();
    const positionManager = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const orderManager = new CapturingOrderManager({
      feed,
      getPositionContext: () => positionManager.getPositionContext(),
    });
    const logger = new RecordingLogger();
    const dependencies = { feed, orderManager, positionManager, logger };
    const controller = createController(dependencies, []);
    await runWithResourceCleanup(controller, feed, async () => {
      const position = positionManager.openPosition("trailing", makeSymbol(), "long", 1, 100, 10);
      const order = await orderManager.placeOrder({
        signal: { side: "sell", confidence: 1, reason: "trailing", stopLoss: 0, takeProfit: 0 },
        symbol: makeSymbol(),
        amount: 1,
        referencePrice: 90,
        type: "market",
        reduceOnly: true,
        strategy: "trailing",
        leverage: 10,
      });
      controller.recordPendingRiskClose(position.id, order.clientOrderId);

      await controller.reconcileRiskCloses(makeSymbol());
      await controller.reconcileRiskCloses(makeSymbol());
    });

    expect(orderManager.lastRequestedLeverage).toBe(10);
    expect(positionManager.getPositions()).toEqual([expect.objectContaining({ leverage: 10 })]);
    expect(
      dependencies.logger
        .getCalls()
        .filter((call) => call.event === "strategy.trailingstop.reconciliation.failed"),
    ).toHaveLength(2);
  });
});

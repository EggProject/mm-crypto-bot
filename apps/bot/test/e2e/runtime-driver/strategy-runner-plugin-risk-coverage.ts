import type { Bar, PluginState, SignalBus } from "@mm-crypto-bot/core";
import { ExactRational } from "@mm-crypto-bot/numeric";
import { StrategyPluginRiskController } from "../../../src/bot/strategy-runner-plugin-risk-controller.js";
import * as support from "../../../src/bot/strategy-runner.test-support.js";
import { CorrelationMatrix } from "../../../src/portfolio/correlation.js";
import { PortfolioManager } from "../../../src/portfolio/portfolio-manager.js";
import { PortfolioStop } from "../../../src/portfolio/portfolio-stop.js";
import { RiskBudgetAllocator } from "../../../src/portfolio/risk-budget.js";
import { assertCondition, quietLogger } from "./runtime-driver-core.js";
import { makePortfolioStack } from "./runtime-driver-portfolio-fixtures.js";
class RegimeSignalPlugin extends support.LifecyclePlugin {
  private signalBus: SignalBus | undefined;
  public constructor(
    private readonly source: string,
    private readonly sizeModifier: number | undefined,
  ) {
    super();
  }
  public override subscribe(signalBus: SignalBus): void {
    super.subscribe(signalBus);
    this.signalBus = signalBus;
  }
  public override onBar(bar: Bar, state: PluginState): void {
    super.onBar(bar, state);
    this.signalBus?.emit({
      kind: "risk",
      varDaily95: 0,
      correlationPenalty: 0,
      drawdownLimit: 0,
      source: this.source,
      breach: false,
      reason: "e2e regime sizing",
      ...(this.sizeModifier !== undefined && { sizeModifier: this.sizeModifier }),
    });
  }
}
class FailingSubscribePlugin extends support.LifecyclePlugin {
  public override subscribe(_signalBus: SignalBus): void {
    throw new Error("e2e plugin subscribe failure");
  }
}
class FailingDisposePlugin extends support.LifecyclePlugin {
  public disposeAttempts = 0;
  public constructor(private readonly failure: unknown = new Error("e2e plugin dispose failure")) {
    super();
  }
  public override dispose(): void {
    this.disposeAttempts += 1;
    throw this.failure;
  }
}
class FailingBarPlugin extends support.LifecyclePlugin {
  public constructor(private readonly failure: unknown = new Error("e2e plugin onBar failure")) {
    super();
  }
  public override onBar(_bar: Bar, _state: PluginState): void {
    throw this.failure;
  }
}
const unavailableFundingSignal: support.StrategySignal = {
  side: "buy",
  confidence: 0,
  reason: "e2e funding contract",
  stopLoss: 0,
  takeProfit: 0,
};
class FundingShapedStrategy extends support.FixedSignalStrategy {
  public readonly config: {
    readonly market: support.CarryMarket;
    readonly fundingSource: support.DydxFundingSource;
  };
  public readonly recordFundingTick = "e2e non-callable funding tick";
  public constructor(fundingSource: support.DydxFundingSource) {
    super(unavailableFundingSignal);
    this.config = { market: "BTC-USD", fundingSource };
  }
}
function throwInjectedFailure(failure: Error | string): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E fixture verifies raw-string boundary containment.
  throw failure;
}
class FundingProbeSource implements support.DydxFundingSource {
  private listener:
    | ((snapshot: { readonly dydx: support.FundingSnapshot; readonly cex: support.FundingSnapshot }) => void)
    | undefined;
  public subscribeCalls = 0;
  public closeCalls = 0;
  public constructor(
    private readonly shouldFailSubscription: boolean,
    private readonly closeFailure?: Error | string,
  ) {}
  public subscribe(
    _market: support.CarryMarket,
    listener: (snapshot: {
      readonly dydx: support.FundingSnapshot;
      readonly cex: support.FundingSnapshot;
    }) => void,
  ): { readonly close: () => void } {
    this.subscribeCalls += 1;
    if (this.shouldFailSubscription) throw new Error("e2e funding subscription failure");
    this.listener = listener;
    return {
      close: () => {
        this.closeCalls += 1;
        if (this.closeFailure !== undefined) throwInjectedFailure(this.closeFailure);
        this.listener = undefined;
      },
    };
  }
  public fire(dydxFundingTime: number, cexFundingTime: number): void {
    this.listener?.({
      dydx: {
        symbol: "BTC-USD",
        fundingTime: dydxFundingTime,
        fundingRate: ExactRational.from("-0.001"),
        markPrice: ExactRational.from("100"),
      },
      cex: {
        symbol: "BTC-USD",
        fundingTime: cexFundingTime,
        fundingRate: ExactRational.from("0.001"),
        markPrice: ExactRational.from("100"),
      },
    });
  }
  public lastTickAgeMs(_market: support.CarryMarket, _nowMs: number): number | undefined {
    return 0;
  }
  public lastChainBlockHeight(_market: support.CarryMarket): number | undefined {
    return 1;
  }
  public lastChainBlockTs(_market: support.CarryMarket): number | undefined {
    return 1;
  }
  public bybitEuSpotDepthUsd(_market: support.CarryMarket, _nowMs: number): number | undefined {
    return 1_000_000;
  }
  public health(): {
    readonly lastTickMs: number | undefined;
    readonly chainBlockHeight: number | undefined;
  } {
    return { lastTickMs: 1, chainBlockHeight: 1 };
  }
}
class FundingProbeStrategy implements support.Strategy {
  public readonly name = "e2e-funding-probe";
  public readonly timeframes = ["15m"] as const;
  public readonly observedNowMs: number[] = [];
  public readonly config: {
    readonly market: support.CarryMarket;
    readonly fundingSource: support.DydxFundingSource;
  };
  public constructor(
    fundingSource: support.DydxFundingSource,
    private readonly fundingTickFailure?: Error | string,
  ) {
    this.config = { market: "BTC-USD", fundingSource };
  }
  public warmup(): number {
    return 0;
  }
  public onCandle(): support.StrategySignal {
    return { side: "buy", confidence: 0, reason: "e2e funding probe", stopLoss: 0, takeProfit: 0 };
  }
  public recordFundingTick(
    _dydx: support.FundingSnapshot,
    _cex: support.FundingSnapshot,
    nowMs: number,
  ): ExactRational {
    this.observedNowMs.push(nowMs);
    if (this.fundingTickFailure !== undefined) throwInjectedFailure(this.fundingTickFailure);
    return ExactRational.from("0");
  }
}
type RunnerInstances = ConstructorParameters<typeof support.StrategyRunner>[0]["instances"];
async function createRunner(
  instances: RunnerInstances,
  options: {
    readonly portfolioManager?: support.PortfolioManager;
    readonly onEmergency?: (reason: string) => void | Promise<void>;
  } = {},
): Promise<{
  readonly feed: support.MockExchangeFeed;
  readonly positions: support.PositionManager;
  readonly orders: support.OrderManager;
  readonly runner: support.StrategyRunner;
}> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({
    feed,
    getPositionContext: () => positions.getPositionContext(),
    paperMode: true,
  });
  const runner = new support.StrategyRunner({
    instances,
    orderManager: orders,
    positionManager: positions,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC"],
    ...options,
  });
  return { feed, positions, orders, runner };
}
async function deliverBar(
  runner: support.StrategyRunner,
  timestamp: number,
  timeframe: support.Timeframe = "15m",
): Promise<void> {
  await runner.onFeedEvent({
    kind: "ohlcv",
    payload: {
      symbol: support.makeSymbol(),
      timeframe,
      candle: [timestamp, 100, 101, 99, 100, 1],
    },
  });
}
async function verifyInvalidRegimeSignals(): Promise<void> {
  for (const sizeModifier of [undefined, -1, 2, NaN]) {
    const plugin = new RegimeSignalPlugin("regime-detector-v1:BTC/USDC", sizeModifier);
    const stack = await createRunner(
      support.strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: plugin }],
      ]),
    );
    await deliverBar(stack.runner, 1);
    assertCondition(stack.runner.isPaused(), `invalid regime modifier ${String(sizeModifier)} did not pause`);
    assertCondition(stack.orders.getCounters().placed === 0, "invalid regime modifier emitted an order");
    stack.runner.dispose();
  }
  const valid = await createRunner(
    support.strategyInstances([
      [
        "regime_detector",
        {
          kind: "plugin",
          name: "regime_detector",
          instance: new RegimeSignalPlugin("regime-detector-v1:BTC/USDC", 0.5),
        },
      ],
    ]),
  );
  await deliverBar(valid.runner, 2);
  assertCondition(!valid.runner.isPaused(), "valid regime modifier paused the runner");
  valid.runner.dispose();
}
async function verifyDisabledSymbolAndPortfolioFallback(): Promise<void> {
  const disabledPlugin = new support.RiskActionPlugin("portfolio-risk:ETH/USDC", true);
  let emergencies = 0;
  const disabled = await createRunner(
    support.strategyInstances([
      ["regime_detector", { kind: "plugin", name: "regime_detector", instance: disabledPlugin }],
    ]),
    {
      onEmergency: () => {
        emergencies += 1;
      },
    },
  );
  await deliverBar(disabled.runner, 1);
  assertCondition(!disabled.runner.isPaused(), "disabled-symbol breach paused the runner");
  assertCondition(emergencies === 0, "disabled-symbol breach invoked emergency handling");
  disabled.runner.dispose();
  const portfolio = await makePortfolioStack({ paperMode: true });
  try {
    portfolio.positionManager.openPosition("portfolio", support.makeSymbol(), "long", 1, 100, 1);
    const fallbackPlugin = new support.RiskActionPlugin("portfolio-risk", true);
    const runner = new support.StrategyRunner({
      instances: support.strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: fallbackPlugin }],
      ]),
      orderManager: portfolio.orderManager,
      positionManager: portfolio.positionManager,
      portfolioManager: portfolio.portfolioManager,
      sizingFn: () => 0,
      enabledSymbols: ["BTC/USDC"],
    });
    await deliverBar(runner, 2);
    await Promise.resolve();
    await Promise.resolve();
    assertCondition(runner.isPaused(), "portfolio fallback breach did not pause the runner");
    assertCondition(
      portfolio.positionManager.getPositionCount() === 0,
      "portfolio fallback did not close the remaining position",
    );
    runner.dispose();
  } finally {
    await portfolio.feed.close();
  }
}
async function verifyPluginFaultIsolation(): Promise<void> {
  const started = new support.LifecyclePlugin();
  let isSubscribeFailureObserved = false;
  try {
    await createRunner(
      support.strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: started }],
        [
          "donchian_pivot_composition",
          { kind: "plugin", name: "donchian_pivot_composition", instance: new FailingSubscribePlugin() },
        ],
      ]),
    );
  } catch {
    isSubscribeFailureObserved = true;
  }
  assertCondition(
    isSubscribeFailureObserved,
    "plugin subscription failure did not reject runner construction",
  );
  assertCondition(started.disposeCalls === 1, "failed subscription did not roll back started plugins");
  for (const [failure, label] of [
    [undefined, "plugin dispose failure"],
    ["e2e plugin dispose string failure", "string plugin dispose failure"],
  ] as const) {
    const plugin = new FailingDisposePlugin(failure);
    const stack = await createRunner(
      support.strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: plugin }],
      ]),
    );
    stack.runner.dispose();
    assertCondition(plugin.disposeAttempts === 1, `${label} was not contained`);
  }
  const barPlugin = new FailingBarPlugin("e2e plugin onBar string failure");
  const strategy = new support.FixedSignalStrategy({
    side: "buy",
    confidence: 1,
    reason: "e2e plugin fault isolation",
    stopLoss: 0,
    takeProfit: 0,
  });
  const barFault = await createRunner(
    support.strategyInstances([
      ["regime_detector", { kind: "plugin", name: "regime_detector", instance: barPlugin }],
      [
        "donchian_pivot_composition",
        { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
      ],
    ]),
  );
  await deliverBar(barFault.runner, 3);
  assertCondition(
    barFault.positions.getPositionCount() === 1,
    "plugin onBar failure blocked the strategy flow",
  );
  barFault.runner.dispose();
  const malformed = new support.LifecyclePlugin();
  const malformedRunner = await createRunner(
    support.strategyInstances([
      ["regime_detector", { kind: "plugin", name: "regime_detector", instance: malformed }],
    ]),
  );
  await deliverBar(malformedRunner.runner, 4, "1d");
  assertCondition(
    malformed.barCalls === 0,
    "malformed regime plugin received a bar after recordClose rejection",
  );
  assertCondition(
    malformedRunner.runner.getStats().ticksProcessed === 1,
    "malformed plugin escaped the feed boundary",
  );
  malformedRunner.runner.dispose();
}
async function verifyFundingSourceFaults(): Promise<void> {
  for (const [label, strategy] of [
    ["missing funding config", new support.FixedSignalStrategy(unavailableFundingSignal)],
    ["non-callable funding tick", new FundingShapedStrategy(new FundingProbeSource(false))],
  ] as const) {
    let wasRejected = false;
    try {
      await createRunner(
        support.strategyInstances([
          ["dydx_cex_carry", { kind: "strategy", name: "dydx_cex_carry", instance: strategy }],
        ]),
      );
    } catch {
      wasRejected = true;
    }
    assertCondition(wasRejected, `${label} did not fail closed`);
  }
  const source = new FundingProbeSource(false, new Error("e2e funding close failure"));
  const strategy = new FundingProbeStrategy(source);
  const stack = await createRunner(
    support.strategyInstances([
      ["dydx_cex_carry", { kind: "strategy", name: "dydx_cex_carry", instance: strategy }],
    ]),
  );
  source.fire(7, 11);
  source.fire(NaN, -1);
  assertCondition(
    strategy.observedNowMs.at(0) === 11,
    "funding source did not preserve the latest valid timestamp",
  );
  assertCondition(
    (strategy.observedNowMs.at(1) ?? 0) > 0,
    "invalid funding timestamp did not fall back to the current clock",
  );
  stack.runner.dispose();
  assertCondition(source.closeCalls === 1, "funding subscription was not closed");
  for (const [closeFailure, tickFailure, timestamp, label] of [
    [undefined, new Error("e2e funding tick rejection"), 1, "funding tick"],
    ["e2e funding close string failure", "e2e funding tick string rejection", 3, "string funding tick"],
  ] as const) {
    const faultSource = new FundingProbeSource(false, closeFailure);
    const faultStrategy = new FundingProbeStrategy(faultSource, tickFailure);
    const faultStack = await createRunner(
      support.strategyInstances([
        ["dydx_cex_carry", { kind: "strategy", name: "dydx_cex_carry", instance: faultStrategy }],
      ]),
    );
    faultSource.fire(timestamp, timestamp + 1);
    assertCondition(faultStrategy.observedNowMs.length === 1, `${label} was not delivered`);
    faultStack.runner.dispose();
  }
  let isFundingSubscriptionFailureObserved = false;
  try {
    const failingSource = new FundingProbeSource(true);
    const failingStrategy = new FundingProbeStrategy(failingSource);
    await createRunner(
      support.strategyInstances([
        ["dydx_cex_carry", { kind: "strategy", name: "dydx_cex_carry", instance: failingStrategy }],
      ]),
    );
  } catch {
    isFundingSubscriptionFailureObserved = true;
  }
  assertCondition(
    isFundingSubscriptionFailureObserved,
    "funding source subscription failure did not reject runner construction",
  );
}
async function verifyPendingPortfolioTrailingClose(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({
    feed,
    getPositionContext: () => positions.getPositionContext(),
    getReduciblePosition: (symbol) => {
      const position = positions.getPositions().find((candidate) => candidate.symbol === symbol);
      return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
    },
  });
  const portfolioManager = new PortfolioManager({
    riskBudget: new RiskBudgetAllocator({
      totalRiskUsd: 1000,
      correlationPenaltyThreshold: 0.7,
      logger: quietLogger,
    }),
    correlation: new CorrelationMatrix({ windowSize: 30, logger: quietLogger }),
    portfolioStop: new PortfolioStop({ maxDdPct: 0.1, logger: quietLogger }),
    positionManager: positions,
    orderManager: orders,
    logger: quietLogger,
  });
  const controller = new StrategyPluginRiskController({
    instances: support.strategyInstances([]),
    orderManager: orders,
    positionManager: positions,
    enabledSymbols: new Set([support.makeSymbol()]),
    logger: quietLogger,
    isOrderEmissionBlocked: () => false,
    pause: () => void 0,
    getRiskManager: () => void 0,
    getPortfolioManager: () => portfolioManager,
    getOnEmergency: () => void 0,
    latestPriceFor: () => void 0,
    notifyStrategyClosed: () => void 0,
  });
  try {
    const position = positions.openPosition("pending-portfolio", support.makeSymbol(), "long", 1, 100, 1);
    await controller.requestTrailingStopClose(position.id, 103, "trailing_stop");
    assertCondition(positions.getPositionCount() === 1, "pending portfolio close changed exposure");
    assertCondition(orders.getCounters().placed === 1, "pending portfolio close did not place its order");
  } finally {
    controller.dispose();
    await feed.close();
  }
}
export async function runStrategyRunnerPluginRiskCoverage(): Promise<void> {
  await verifyInvalidRegimeSignals();
  await verifyDisabledSymbolAndPortfolioFallback();
  await verifyPluginFaultIsolation();
  await verifyFundingSourceFaults();
  await verifyPendingPortfolioTrailingClose();
}

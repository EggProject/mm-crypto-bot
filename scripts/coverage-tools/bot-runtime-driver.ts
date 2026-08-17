/* eslint-disable security/detect-non-literal-fs-filename -- stateFile is created below this process's fresh mkdtemp directory */
/* eslint-disable @typescript-eslint/only-throw-error -- fault-injection cases deliberately verify production normalization of non-Error throws */
/* eslint-disable @typescript-eslint/prefer-promise-reject-errors -- fault-injection cases deliberately verify production normalization of non-Error rejections */
/* eslint-disable @typescript-eslint/require-await -- async fixture doubles implement production interfaces and intentionally settle synchronously */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  asSymbol,
  type Balance,
  type ClientOrderId,
  type ExchangeFeed,
  type ExchangePosition,
  type Execution,
  type FeedEvent,
  type FeedListener,
  type MarketMeta,
  type Ohlcv,
  type Order,
  type OrderBook,
  type OrderRequest,
  type OrderStatus,
  type SubscriptionId,
  type Symbol as ExchangeSymbol,
  type Ticker,
  type Timeframe,
} from "../../packages/exchange/src/index.js";
import type { Logger } from "../../packages/shared/src/logger.js";
import { MockExchangeFeed as BaseMockExchangeFeed } from "../../packages/exchange/src/__testing__/mockFeed.js";
import { Bot, type BotOptions } from "../../apps/bot/src/bot/bot.js";
import { MockDydxFundingSource } from "../../apps/bot/src/bot/mock-dydx-funding-source.js";
import { OrderManager } from "../../apps/bot/src/bot/order-manager.js";
import { PositionManager } from "../../apps/bot/src/bot/position-manager.js";
import type { BotState } from "../../apps/bot/src/bot/state-store.js";
import type { KillSwitch } from "../../apps/bot/src/bot/kill-switches.js";
import { parseArgv } from "../../apps/bot/src/cli/argv.js";
import { applyClose, checkSlTpHit } from "../../apps/bot/src/cli/commands/backtest.js";
import {
  createConfigCommand,
  runConfigInit,
  validateConfigForEdit,
  type ConfigFileBoundary,
} from "../../apps/bot/src/cli/commands/config.js";
import {
  createStartCommand,
  installConsoleRedirection,
  resolveLogFilePath,
  restoreConsoleRedirection,
  runHeadless,
} from "../../apps/bot/src/cli/commands/start.js";
import { ConfigError } from "../../apps/bot/src/config/loader.js";
import { DEFAULT_BOT_CONFIG } from "../../apps/bot/src/config/defaults.js";
import type { BotConfig } from "../../apps/bot/src/config/schema.js";
import { ConfigStore, getConfigStore, resetConfigStoreCache } from "../../apps/bot/src/config/store.js";
import { PortfolioStop, PortfolioStopError } from "../../apps/bot/src/portfolio/portfolio-stop.js";
import { CorrelationMatrix } from "../../apps/bot/src/portfolio/correlation.js";
import { PortfolioManager } from "../../apps/bot/src/portfolio/portfolio-manager.js";
import {
  RISK_BUDGET_HARD_CAPS,
  RiskBudgetAllocator,
  type StrategyRiskConfig,
} from "../../apps/bot/src/portfolio/risk-budget.js";
import { DrawdownScaler } from "../../apps/bot/src/risk/drawdown-scaler.js";
import { KellySizer, computeStats, kellyFraction } from "../../apps/bot/src/risk/kelly.js";
import { RiskManager } from "../../apps/bot/src/risk/risk-manager.js";
import { TrailingStopManager } from "../../apps/bot/src/risk/trailing-stop.js";
import { getInstalledOutboundNetworkGuard } from "./bot-runtime-network-guard.ts";

const caseId = process.argv[2];
const networkGuard = getInstalledOutboundNetworkGuard();
const placeOrderLedger: {
  readonly symbol: string;
  readonly side: OrderRequest["side"];
  readonly type: OrderRequest["type"];
}[] = [];

class MockExchangeFeed extends BaseMockExchangeFeed {
  public override async placeOrder(request: OrderRequest): Promise<Order> {
    placeOrderLedger.push({ symbol: String(request.symbol), side: request.side, type: request.type });
    return super.placeOrder(request);
  }
}

const quietLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function withoutLogger<T extends { readonly logger: unknown }>(value: T): Omit<T, "logger"> {
  const { logger, ...remaining } = value;
  void logger;
  return remaining;
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForCondition(predicate: () => boolean, label: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(5);
  }
}

function expectFailure(action: () => unknown, label: string): void {
  let failed = false;
  try {
    action();
  } catch {
    failed = true;
  }
  assertCondition(failed, `${label} did not fail`);
}

async function expectAsyncFailure(action: () => Promise<unknown>, label: string): Promise<void> {
  let failed = false;
  try {
    await action();
  } catch {
    failed = true;
  }
  assertCondition(failed, `${label} did not fail`);
}

class RecordingLogger implements Logger {
  public readonly entries: {
    readonly level: string;
    readonly message: string;
    readonly meta?: Readonly<Record<string, unknown>>;
  }[] = [];

  private record(level: string, message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.entries.push(meta === undefined ? { level, message } : { level, message, meta });
  }

  public debug(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.record("debug", message, meta);
  }
  public info(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.record("info", message, meta);
  }
  public warn(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.record("warn", message, meta);
  }
  public error(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.record("error", message, meta);
  }
}

class FailingOhlcvFeed extends MockExchangeFeed {
  public override async subscribeOhlcv(
    symbol: ExchangeSymbol,
    timeframe: Timeframe,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    if (timeframe === "4h") throw new Error("4h subscription failed");
    if (timeframe === "15m") throw "15m subscription failed";
    return super.subscribeOhlcv(symbol, timeframe, listener);
  }
}

class BlockingTickerFeed extends MockExchangeFeed {
  private release: (() => void) | null = null;
  public tickerSubscriptionStarted = false;

  public override async subscribeTicker(
    symbol: ExchangeSymbol,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    this.tickerSubscriptionStarted = true;
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
    void symbol;
    void listener;
    return 30_000;
  }

  public releaseTickerSubscription(): void {
    this.release?.();
  }
}

class CleanupFailureFeed extends MockExchangeFeed {
  private nextPrivateId = 20_000;

  public constructor(
    private readonly lifecycleFailure: unknown,
    private readonly closeFailure: unknown,
  ) {
    super({ balances: [{ currency: "USDC", free: 10_000, total: 10_000 }] });
  }

  public async subscribeOrderUpdates(_listener: FeedListener): Promise<SubscriptionId> {
    return this.nextPrivateId++;
  }
  public async subscribeExecutions(_listener: FeedListener): Promise<SubscriptionId> {
    return this.nextPrivateId++;
  }

  public override async unsubscribe(id: SubscriptionId): Promise<void> {
    if (id >= 20_000) throw this.lifecycleFailure;
    await super.unsubscribe(id);
  }

  public override async close(): Promise<void> {
    throw this.closeFailure;
  }
}

class AllUnsubscribeFailureFeed extends MockExchangeFeed {
  public override async unsubscribe(_id: SubscriptionId): Promise<void> {
    throw new Error("scripted public unsubscribe failure");
  }
}

class ReconciliationFeed extends MockExchangeFeed {
  public balanceCalls = 0;
  public positionCalls = 0;
  public tickerCalls = 0;

  public constructor(
    private readonly initialBalances: readonly Balance[],
    private readonly reconciledBalances: readonly Balance[] | Error | string,
    options: ConstructorParameters<typeof MockExchangeFeed>[0] = {},
  ) {
    super({ ...options, balances: initialBalances });
  }

  public override async fetchBalances(): Promise<readonly Balance[]> {
    this.balanceCalls += 1;
    if (this.balanceCalls === 1) return this.initialBalances;
    if (this.reconciledBalances instanceof Error || typeof this.reconciledBalances === "string") {
      throw this.reconciledBalances;
    }
    return this.reconciledBalances;
  }

  public override async fetchPositions(
    symbols?: readonly ExchangeSymbol[],
  ): Promise<readonly ExchangePosition[]> {
    this.positionCalls += 1;
    return super.fetchPositions(symbols);
  }

  public override async fetchTickerSnapshot(symbol: ExchangeSymbol): Promise<Ticker> {
    this.tickerCalls += 1;
    return super.fetchTickerSnapshot(symbol);
  }
}

class PositionFaultReconciliationFeed extends ReconciliationFeed {
  public constructor(
    private readonly positionFailure: unknown,
    balances: readonly Balance[],
  ) {
    super(balances, balances);
  }

  public override async fetchPositions(): Promise<readonly ExchangePosition[]> {
    this.positionCalls += 1;
    throw this.positionFailure;
  }
}

class SlowReconciliationFeed extends MockExchangeFeed {
  public balanceCalls = 0;

  public constructor() {
    super({ balances: [{ currency: "USDC", free: 1_000, total: 1_000 }] });
  }

  public override async fetchBalances(): Promise<readonly Balance[]> {
    this.balanceCalls += 1;
    if (this.balanceCalls > 1) await Bun.sleep(30);
    return [{ currency: "USDC", free: 1_000, total: 1_000 }];
  }
}

class SequencedBalanceFeed extends MockExchangeFeed {
  private readonly reconciled: number[];
  public balanceCalls = 0;

  public constructor(values: readonly number[]) {
    const initial = values[0] ?? 1_000;
    super({ balances: [{ currency: "USDC", free: initial, total: initial }] });
    this.reconciled = [...values];
  }

  public override async fetchBalances(): Promise<readonly Balance[]> {
    const value = this.reconciled[Math.min(this.balanceCalls, this.reconciled.length - 1)] ?? 1_000;
    this.balanceCalls += 1;
    return [{ currency: "USDC", free: value, total: value }];
  }
}

class NoPositionsFeed implements ExchangeFeed {
  private readonly delegate = new MockExchangeFeed({
    balances: [{ currency: "USDC", free: 1_000, total: 1_000 }],
  });
  public readonly exchangeId = "scripted-no-positions";
  public readonly statusOf = (status: string): OrderStatus => this.delegate.statusOf(status);

  public open(): Promise<void> {
    return this.delegate.open();
  }
  public subscribeTicker(symbol: ExchangeSymbol, listener: FeedListener): Promise<SubscriptionId> {
    return this.delegate.subscribeTicker(symbol, listener);
  }
  public subscribeOrderBook(
    symbol: ExchangeSymbol,
    limit: number,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    return this.delegate.subscribeOrderBook(symbol, limit, listener);
  }
  public subscribeTrades(symbol: ExchangeSymbol, listener: FeedListener): Promise<SubscriptionId> {
    return this.delegate.subscribeTrades(symbol, listener);
  }
  public subscribeOhlcv(
    symbol: ExchangeSymbol,
    timeframe: Timeframe,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    return this.delegate.subscribeOhlcv(symbol, timeframe, listener);
  }
  public unsubscribe(id: SubscriptionId): Promise<void> {
    return this.delegate.unsubscribe(id);
  }
  public fetchTickerSnapshot(symbol: ExchangeSymbol): Promise<Ticker> {
    return this.delegate.fetchTickerSnapshot(symbol);
  }
  public fetchOrderBookSnapshot(symbol: ExchangeSymbol, limit: number): Promise<OrderBook> {
    return this.delegate.fetchOrderBookSnapshot(symbol, limit);
  }
  public fetchOHLCV(
    symbol: ExchangeSymbol,
    timeframe: Timeframe,
    since: number | undefined,
    limit: number,
  ): Promise<readonly Ohlcv[]> {
    return this.delegate.fetchOHLCV(symbol, timeframe, since, limit);
  }
  public fetchMarketMeta(symbol: ExchangeSymbol): Promise<MarketMeta> {
    return this.delegate.fetchMarketMeta(symbol);
  }
  public fetchBalances(): Promise<readonly Balance[]> {
    return this.delegate.fetchBalances();
  }
  public placeOrder(request: OrderRequest): Promise<Order> {
    return this.delegate.placeOrder(request);
  }
  public cancelOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    return this.delegate.cancelOrder(clientOrderId, symbol);
  }
  public fetchOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    return this.delegate.fetchOrder(clientOrderId, symbol);
  }
  public fetchOpenOrders(symbol: ExchangeSymbol): Promise<readonly Order[]> {
    return this.delegate.fetchOpenOrders(symbol);
  }
  public close(): Promise<void> {
    return this.delegate.close();
  }
  public subscriptionCount(): number {
    return this.delegate.subscriptionCount();
  }
}

function botConfigFor(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile },
    exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "mock" },
    symbols: { enabled: ["BTC/USDC"] },
    strategies: {
      donchian_pivot_composition: { enabled: false },
      dydx_cex_carry: { enabled: false },
      cascade_fade: { enabled: false },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: false },
    },
    telemetry: {
      ...DEFAULT_BOT_CONFIG.telemetry,
      log_dir: `${stateFile}.logs`,
      metrics_interval_sec: 60,
    },
  };
}

async function startBotThenStop(bot: Bot, feed: MockExchangeFeed): Promise<void> {
  const running = bot.start();
  await waitForCondition(() => feed.subscriptionCount() > 0, "bot subscription");
  await bot.stop();
  await running;
}

function makePortfolioSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC");
}

function makePortfolioMarketMeta(isSpot: boolean, minCost = 1): MarketMeta {
  const symbol = makePortfolioSymbol();
  return {
    symbol,
    base: "BTC",
    quote: "USDC",
    amountPrecision: 4,
    pricePrecision: 2,
    minAmount: 0.0001,
    minCost,
    isSpot,
  };
}

function makeRemotePosition(side: "long" | "short" = "long", quantity = 0.01): ExchangePosition {
  return {
    symbol: makePortfolioSymbol(),
    side,
    quantity,
    entryPrice: 60_000,
    markPrice: 59_900,
    unrealizedPnl: -1,
    updateTimestamp: 1,
  };
}

function firstOrder(orders: readonly Order[], label: string): Order {
  const order = orders[0];
  if (order === undefined) throw new Error(`${label}: expected an order`);
  return order;
}

class SequencedFillFeed extends MockExchangeFeed {
  public readonly placedOrders: Order[] = [];

  public constructor(
    private readonly fillFractions: number[],
    options: ConstructorParameters<typeof MockExchangeFeed>[0],
  ) {
    super(options);
  }

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(request);
    const filled = request.amount * (this.fillFractions.shift() ?? 1);
    this.setOrderStatus(order.clientOrderId, {
      status: "closed",
      filled,
      average: request.price,
    });
    const closed = this.getOrder(order.clientOrderId) ?? order;
    this.placedOrders.push(closed);
    return closed;
  }
}

class FailOnceCancelFeed extends MockExchangeFeed {
  private failNextCancel = true;

  public override async cancelOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    if (this.failNextCancel) {
      this.failNextCancel = false;
      throw new Error("injected cancel failure");
    }
    return super.cancelOrder(clientOrderId, symbol);
  }
}

class FaultFeed extends MockExchangeFeed {
  public readonly marketMetaFailures: unknown[] = [];
  public readonly positionFailures: unknown[] = [];
  public readonly balanceFailures: unknown[] = [];
  public readonly placeFailures: unknown[] = [];
  public readonly orderFailures: unknown[] = [];
  public readonly tickerFailures: unknown[] = [];
  public positionFailureOnCall: { readonly call: number; readonly failure: unknown } | undefined;
  public balanceFailureOnCall: { readonly call: number; readonly failure: unknown } | undefined;
  public readonly placedOrders: Order[] = [];
  private positionCalls = 0;
  private balanceCalls = 0;

  private throwNext(failures: unknown[]): void {
    if (failures.length > 0) throw failures.shift();
  }

  public override async fetchMarketMeta(symbol: ExchangeSymbol): Promise<MarketMeta> {
    this.throwNext(this.marketMetaFailures);
    return super.fetchMarketMeta(symbol);
  }

  public override async fetchPositions(
    symbols?: readonly ExchangeSymbol[],
  ): Promise<readonly ExchangePosition[]> {
    this.positionCalls += 1;
    if (this.positionFailureOnCall?.call === this.positionCalls) throw this.positionFailureOnCall.failure;
    this.throwNext(this.positionFailures);
    return super.fetchPositions(symbols);
  }

  public override async fetchBalances(): Promise<readonly Balance[]> {
    this.balanceCalls += 1;
    if (this.balanceFailureOnCall?.call === this.balanceCalls) throw this.balanceFailureOnCall.failure;
    this.throwNext(this.balanceFailures);
    return super.fetchBalances();
  }

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    this.throwNext(this.placeFailures);
    const order = await super.placeOrder(request);
    this.placedOrders.push(order);
    return order;
  }

  public override async fetchOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    this.throwNext(this.orderFailures);
    return super.fetchOrder(clientOrderId, symbol);
  }

  public override async fetchTickerSnapshot(symbol: ExchangeSymbol): Promise<Ticker> {
    this.throwNext(this.tickerFailures);
    return super.fetchTickerSnapshot(symbol);
  }
}

class LifecycleFeed extends MockExchangeFeed {
  private readonly lifecycleListeners = new Map<SubscriptionId, FeedListener>();
  private nextLifecycleId = 10_000;
  public readonly placedOrders: Order[] = [];

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(request);
    this.placedOrders.push(order);
    return order;
  }

  public async subscribeOrderUpdates(listener: FeedListener): Promise<SubscriptionId> {
    return this.addLifecycleListener(listener);
  }

  public async subscribeExecutions(listener: FeedListener): Promise<SubscriptionId> {
    return this.addLifecycleListener(listener);
  }

  public override async unsubscribe(id: SubscriptionId): Promise<void> {
    if (!this.lifecycleListeners.delete(id)) await super.unsubscribe(id);
  }

  public emitLifecycle(event: FeedEvent): void {
    for (const listener of this.lifecycleListeners.values()) listener(event);
  }

  private addLifecycleListener(listener: FeedListener): SubscriptionId {
    const id = this.nextLifecycleId;
    this.nextLifecycleId += 1;
    this.lifecycleListeners.set(id, listener);
    return id;
  }
}

class FailOnceLifecycleFeed extends LifecycleFeed {
  private failNextCancel = true;

  public override async cancelOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    if (this.failNextCancel) {
      this.failNextCancel = false;
      throw new Error("injected lifecycle cancel failure");
    }
    return super.cancelOrder(clientOrderId, symbol);
  }
}

class AutoFlattenFeed extends MockExchangeFeed {
  public readonly placedOrders: Order[] = [];

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(request);
    const closed: Order = {
      ...order,
      status: "closed",
      filled: request.amount,
      average: request.price,
    };
    this.setOrderStatus(order.clientOrderId, closed);
    this.placedOrders.push(closed);
    if (request.side === "sell") {
      this.setPositions([]);
      this.setBalance("BTC", 0, 0);
    }
    return this.getOrder(order.clientOrderId) ?? closed;
  }
}

class ImmediateFillFeed extends MockExchangeFeed {
  public constructor(private readonly pricing: "average" | "price" | "position") {
    super();
  }

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(request);
    return {
      ...order,
      status: "closed",
      filled: request.amount,
      average: this.pricing === "average" ? request.price : undefined,
      price: this.pricing === "price" ? request.price : undefined,
      updateTimestamp: undefined,
    };
  }
}

interface PortfolioStackOptions {
  readonly totalRiskUsd?: number;
  readonly maxDdPct?: number;
  readonly threshold?: number;
  readonly requireAuthoritativeEmergencyState?: boolean;
  readonly configuredSymbols?: readonly string[];
  readonly balances?: readonly Balance[];
  readonly positions?: readonly ExchangePosition[];
  readonly marketMeta?: ReadonlyMap<ExchangeSymbol, MarketMeta>;
  readonly feed?: MockExchangeFeed;
  readonly logger?: Logger;
  readonly terminalCloseEvidenceLimit?: number;
  readonly paperMode?: boolean;
}

interface PortfolioStack {
  readonly feed: MockExchangeFeed;
  readonly positionManager: PositionManager;
  readonly orderManager: OrderManager;
  readonly correlation: CorrelationMatrix;
  readonly portfolioStop: PortfolioStop;
  readonly portfolioManager: PortfolioManager;
}

async function makePortfolioStack(options: PortfolioStackOptions = {}): Promise<PortfolioStack> {
  const feed =
    options.feed ??
    new MockExchangeFeed({
      balances: options.balances ?? [{ currency: "USDC", free: 1_000_000, total: 1_000_000 }],
      ...(options.positions === undefined ? {} : { positions: options.positions }),
      ...(options.marketMeta === undefined ? {} : { marketMeta: options.marketMeta }),
    });
  await feed.open();
  const positionManager = new PositionManager({
    initialEquityUsd: 100_000,
    maxPositions: 8,
    maxLeverage: 10,
    logger: quietLogger,
  });
  const orderManager = new OrderManager({
    feed,
    getPositionContext: () => positionManager.getPositionContext(),
    paperMode: options.paperMode ?? false,
    logger: quietLogger,
  });
  const riskBudget = new RiskBudgetAllocator({
    totalRiskUsd: options.totalRiskUsd ?? 1_000,
    correlationPenaltyThreshold: options.threshold ?? 0.7,
    logger: quietLogger,
  });
  const correlation = new CorrelationMatrix({ windowSize: 30, logger: quietLogger });
  const portfolioStop = new PortfolioStop({ maxDdPct: options.maxDdPct ?? 0.1, logger: quietLogger });
  const portfolioManager = new PortfolioManager({
    riskBudget,
    correlation,
    portfolioStop,
    positionManager,
    orderManager,
    ...(options.requireAuthoritativeEmergencyState === undefined
      ? {}
      : { requireAuthoritativeEmergencyState: options.requireAuthoritativeEmergencyState }),
    ...(options.configuredSymbols === undefined ? {} : { configuredSymbols: options.configuredSymbols }),
    logger: options.logger ?? quietLogger,
    ...(options.terminalCloseEvidenceLimit === undefined
      ? {}
      : { terminalCloseEvidenceLimit: options.terminalCloseEvidenceLimit }),
  });
  return { feed, positionManager, orderManager, correlation, portfolioStop, portfolioManager };
}

function registerPortfolioStrategies(
  stack: PortfolioStack,
  configs: readonly (readonly [string, number])[],
): void {
  for (const [strategyId, weight] of configs) {
    stack.portfolioManager.setStrategyConfig({ strategyId, weight, riskPerTrade: 0.01 });
  }
}

function makeExecution(order: Order, id: string, quantity: number, price = 59_900): Execution {
  return {
    executionId: id,
    clientOrderId: order.clientOrderId,
    exchangeOrderId: order.exchangeId,
    symbol: order.symbol,
    side: order.side,
    quantity,
    price,
    fee: 0,
    feeCurrency: "USDC",
    timestamp: 1,
  };
}

function runCliBoundaries(): void {
  const cases: readonly (readonly string[])[] = [
    [],
    ["start", "--config=foo"],
    ["start", "--config", "foo"],
    ["start", "--mock"],
    ["start", "--no-mock"],
    ["start", "--help"],
    ["start", "-h"],
    ["config", "init", "--", "--not-a-flag"],
    ["start", "--no-mock", "extra"],
    ["start", "--config="],
    ["start", "-x"],
    ["-abc"],
    ["start", "-abc"],
    ["--foo!bar"],
    ["start", "--foo!bar"],
    ["start", "--no-"],
    ["start", "--no-foo!"],
    ["start", "--=value"],
    ["start", "--foo", "--bar"],
  ];
  for (const argv of cases) parseArgv(argv);
  const representative = parseArgv(["config", "validate", "--config=run-bot/config/default.toml"]);
  assertCondition(representative.subcommand === "config", "CLI boundary driver lost the subcommand");
  assertCondition(representative.positional[0] === "validate", "CLI boundary driver lost positional input");
}

function runBacktestBoundaries(): void {
  const longSignal = {
    side: "buy" as const,
    confidence: 1,
    reason: "driver",
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 115,
    timestamp: 1,
    fastEma: 0,
    slowEma: 0,
    rsi: 0,
    atr: 0,
  };
  const shortSignal = { ...longSignal, side: "sell" as const, stopLoss: 105, takeProfit: 85 };
  const candle = (high: number, low: number) => ({
    timestamp: 2,
    open: 100,
    high,
    low,
    close: 100,
    volume: 0,
  });
  assertCondition(
    checkSlTpHit(candle(102, 94), { signal: longSignal, entryPrice: 100 }) === 95,
    "long SL mismatch",
  );
  assertCondition(
    checkSlTpHit(candle(116, 99), { signal: longSignal, entryPrice: 100 }) === 115,
    "long TP mismatch",
  );
  assertCondition(
    checkSlTpHit(candle(110, 96), { signal: longSignal, entryPrice: 100 }) === null,
    "long no-hit mismatch",
  );
  assertCondition(
    checkSlTpHit(candle(106, 100), { signal: shortSignal, entryPrice: 100 }) === 105,
    "short SL mismatch",
  );
  assertCondition(
    checkSlTpHit(candle(100, 84), { signal: shortSignal, entryPrice: 100 }) === 85,
    "short TP mismatch",
  );
  assertCondition(
    checkSlTpHit(candle(103, 90), { signal: shortSignal, entryPrice: 100 }) === null,
    "short no-hit mismatch",
  );

  const state = { equity: 10_000, peakEquity: 10_000, maxDD: 0, wins: 0, losses: 0, trades: 0 };
  applyClose({ signal: longSignal, entryPrice: 100 }, 110, 0.01, state);
  applyClose({ signal: shortSignal, entryPrice: 100 }, 110, 0.01, state);
  applyClose({ signal: longSignal, entryPrice: 100 }, 100, 0.01, state);
  applyClose({ signal: { ...longSignal, stopLoss: 100 }, entryPrice: 100 }, 120, 0.01, state);
  assertCondition(
    state.wins === 1 && state.losses === 1 && state.trades === 4,
    "backtest close aggregation mismatch",
  );
}

async function runConfigCommandBoundaries(): Promise<void> {
  const context = { config: DEFAULT_BOT_CONFIG };
  const richSection = {
    ...DEFAULT_BOT_CONFIG.strategies.donchian_pivot_composition,
    enabled: true,
    cap: 0.4,
    leverage: 7,
    symbols: ["BTC/USDC"],
    timeframes: { htf: "1d" as const, mtf: "4h" as const, ltf: "15m" as const },
    custom_string: "value",
    custom_number: 42,
    custom_boolean: true,
    custom_array: ["a", 2, false],
    custom_object: { ignored: true },
  };
  const richConfig: BotConfig = {
    ...DEFAULT_BOT_CONFIG,
    strategies: {
      ...DEFAULT_BOT_CONFIG.strategies,
      donchian_pivot_composition: richSection,
    },
  };
  const richCommand = createConfigCommand({ loadConfig: () => richConfig });
  assertCondition(
    (await richCommand(parseArgv(["config", "validate", "--config=rich.toml"]), context)) === 0,
    "injected validate failed",
  );
  assertCondition(
    (await richCommand(parseArgv(["config", "validate"]), context)) === 0,
    "injected default validate failed",
  );
  assertCondition(
    (await richCommand(parseArgv(["config", "show"]), context)) === 0,
    "injected rich show failed",
  );

  const configFailure = new ConfigError("invalid injected config", "bot.mode", []);
  for (const subcommand of ["validate", "show"] as const) {
    const command = createConfigCommand({
      loadConfig: () => {
        throw configFailure;
      },
    });
    assertCondition(
      (await command(parseArgv(["config", subcommand]), context)) === 2,
      `${subcommand} ConfigError exit mismatch`,
    );
    for (const failure of [new Error("loader Error"), "loader string"] as const) {
      const fault = createConfigCommand({
        loadConfig: () => {
          throw failure;
        },
      });
      assertCondition(
        (await fault(parseArgv(["config", subcommand]), context)) === 1,
        `${subcommand} runtime error exit mismatch`,
      );
    }
  }
  assertCondition(
    validateConfigForEdit("valid.toml", () => richConfig) === 0,
    "edit validation success mismatch",
  );
  assertCondition(
    validateConfigForEdit("run-bot/config/default.toml") === 0,
    "default edit validation success mismatch",
  );
  for (const failure of [new Error("edit Error"), "edit string"] as const) {
    assertCondition(
      validateConfigForEdit("invalid.toml", () => {
        throw failure;
      }) === 2,
      "edit validation failure mismatch",
    );
  }

  const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-boundary-"));
  const target = join(directory, "nested", "out.toml");
  const source = join(directory, "source.toml");
  const initState = { ensured: false, written: false };
  const successBoundary: ConfigFileBoundary = {
    exists: (path) => path === source || (initState.ensured && path === join(directory, "nested")),
    read: () => '[bot]\nmode = "paper"\n',
    ensureDirectory: () => {
      initState.ensured = true;
    },
    write: () => {
      initState.written = true;
    },
  };
  assertCondition(
    runConfigInit(target, source, successBoundary) === 0 && initState.ensured && initState.written,
    "config init boundary success mismatch",
  );
  initState.written = false;
  assertCondition(
    runConfigInit(undefined, source, successBoundary) === 0 && initState.written,
    "config init default output mismatch",
  );
  const existingBoundary: ConfigFileBoundary = {
    ...successBoundary,
    exists: (path) => path === target || path === source,
  };
  assertCondition(runConfigInit(target, source, existingBoundary) === 1, "config init overwrite mismatch");
  const missingBoundary: ConfigFileBoundary = {
    ...successBoundary,
    exists: () => false,
  };
  assertCondition(
    runConfigInit(target, source, missingBoundary) === 1,
    "config init missing template mismatch",
  );
  for (const failure of [new Error("write Error"), "write string"] as const) {
    const failureBoundary: ConfigFileBoundary = {
      ...successBoundary,
      write: () => {
        throw failure;
      },
    };
    assertCondition(runConfigInit(target, source, failureBoundary) === 1, "config init write fault mismatch");
  }
  expectFailure(() => runConfigInit(target, "\0"), "invalid config template path");
  const observedInitOutputs: (string | undefined)[] = [];
  const initCommand = createConfigCommand({
    loadConfig: () => richConfig,
    initConfig: (outPath) => {
      observedInitOutputs.push(outPath);
      return 0;
    },
  });
  assertCondition(
    (await initCommand(parseArgv(["config", "init"]), context)) === 0,
    "injected default init failed",
  );
  assertCondition(
    (await initCommand(parseArgv(["config", "init", "--out=custom.toml"]), context)) === 0,
    "injected explicit init failed",
  );
  assertCondition(
    observedInitOutputs[0] === undefined && observedInitOutputs[1] === "custom.toml",
    "config init output dispatch mismatch",
  );
  rmSync(directory, { recursive: true, force: true });
}

async function runStartCommandBoundaries(): Promise<void> {
  const context = { config: DEFAULT_BOT_CONFIG };
  const noOpBot = { start: async () => undefined, stop: async () => undefined };
  const baseCommand = createStartCommand({
    loadConfig: () => DEFAULT_BOT_CONFIG,
    createBot: () => noOpBot,
    run: async () => 0,
  });
  for (const argv of [
    ["start", "--unknown"],
    ["start", "--config"],
    ["start", "--color=always"],
    ["start", "extra"],
  ] as const) {
    assertCondition(
      (await baseCommand(parseArgv(argv), context)) === 1,
      `start validation accepted ${argv.join(" ")}`,
    );
  }

  const originalNoColor = process.env["NO_COLOR"];
  delete process.env["NO_COLOR"];
  assertCondition(
    (await baseCommand(parseArgv(["start", "--no-color", "--help"]), context)) === 1,
    "start help exit mismatch",
  );
  assertCondition(process.env["NO_COLOR"] === "1", "start no-color policy was not applied");
  assertCondition(
    (await baseCommand(parseArgv(["start", "--no-color", "--help"]), context)) === 1,
    "start repeated help exit mismatch",
  );
  if (originalNoColor === undefined) delete process.env["NO_COLOR"];
  else process.env["NO_COLOR"] = originalNoColor;

  const configErrorCommand = createStartCommand({
    loadConfig: () => {
      throw new ConfigError("bad config", "bot", []);
    },
  });
  assertCondition(
    (await configErrorCommand(parseArgv(["start"]), context)) === 2,
    "start ConfigError exit mismatch",
  );
  for (const failure of [new Error("loader Error"), "loader string"] as const) {
    const command = createStartCommand({
      loadConfig: () => {
        throw failure;
      },
    });
    assertCondition(
      (await command(parseArgv(["start"]), context)) === 1,
      "start loader failure exit mismatch",
    );
  }

  const startState = { created: 0, observedPaths: [] as (string | undefined)[] };
  const normalCommand = createStartCommand({
    loadConfig: (path) => {
      startState.observedPaths.push(path);
      return DEFAULT_BOT_CONFIG;
    },
    createBot: () => {
      startState.created += 1;
      return noOpBot;
    },
    run: async () => 7,
  });
  assertCondition(
    (await normalCommand(parseArgv(["start"]), context)) === 7,
    "start injected run exit mismatch",
  );
  assertCondition(
    startState.observedPaths.at(0) === undefined && startState.created === 1,
    "start default path/create mismatch",
  );
  assertCondition(
    (await normalCommand(parseArgv(["start", "--config=config.toml"]), context)) === 7,
    "start explicit config run mismatch",
  );
  assertCondition(startState.observedPaths.at(1) === "config.toml", "start explicit config path mismatch");

  const liveConfig: BotConfig = { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" } };
  const liveCommand = createStartCommand({
    loadConfig: () => liveConfig,
    createBot: () => noOpBot,
    run: async () => 0,
  });
  const originalKey = process.env["BYBIT_API_KEY"];
  delete process.env["BYBIT_API_KEY"];
  assertCondition(
    (await liveCommand(parseArgv(["start"]), context)) === 0,
    "live missing-key start mismatch",
  );
  process.env["BYBIT_API_KEY"] = "";
  assertCondition((await liveCommand(parseArgv(["start"]), context)) === 0, "live empty-key start mismatch");
  process.env["BYBIT_API_KEY"] = "present";
  assertCondition(
    (await liveCommand(parseArgv(["start"]), context)) === 0,
    "live present-key start mismatch",
  );
  if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
  else process.env["BYBIT_API_KEY"] = originalKey;

  const withStateFile = (stateFile: string): BotConfig => ({
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile },
  });
  assertCondition(
    resolveLogFilePath(withStateFile("data/state.json")) === "data/state.json.log",
    "relative log path mismatch",
  );
  for (const invalid of ["", "data/../state.json", "data/\0state.json"]) {
    expectFailure(() => resolveLogFilePath(withStateFile(invalid)), "invalid log file path");
  }

  const writes: string[] = [];
  const backup = installConsoleRedirection({
    write: async (data) => {
      writes.push(data);
    },
    close: async () => undefined,
  });
  try {
    console.log("text", { structured: true });
    console.error("error");
  } finally {
    restoreConsoleRedirection(backup);
  }
  await backup.drain();
  assertCondition(writes.join("").includes("structured"), "console redirection lost structured output");
  const rejectedBackup = installConsoleRedirection({
    write: async () => Promise.reject(new Error("disk unavailable")),
    close: async () => undefined,
  });
  try {
    console.error("rejected");
  } finally {
    restoreConsoleRedirection(rejectedBackup);
  }
  await rejectedBackup.drain();

  const directory = mkdtempSync(join(tmpdir(), "mm-bot-headless-driver-"));
  try {
    const normalState = join(directory, "normal.json");
    assertCondition(
      (await runHeadless(noOpBot, withStateFile(normalState))) === 0,
      "normal headless exit mismatch",
    );
    for (const failure of [new Error("startup Error"), "startup string"] as const) {
      const failedState = join(directory, `${typeof failure}.json`);
      const code = await runHeadless(
        {
          start: async () => Promise.reject(failure),
          stop: async () => undefined,
        },
        withStateFile(failedState),
      );
      assertCondition(code === 1, "headless startup failure exit mismatch");
      assertCondition(
        readFileSync(`${failedState}.log`, "utf8").includes(
          typeof failure === "string" ? failure : failure.message,
        ),
        "headless startup failure was not logged",
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function runCliCommandBoundaries(): Promise<void> {
  runBacktestBoundaries();
  await runConfigCommandBoundaries();
  await runStartCommandBoundaries();
}

async function runLifecycleSmoke(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-coverage-driver-"));
  const stateFile = join(directory, "state.json");
  const config: BotConfig = {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile, log_level: "error" },
    exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "mock" },
    symbols: { enabled: ["BTC/USDC"] },
    strategies: {
      donchian_pivot_composition: { enabled: false },
      dydx_cex_carry: { enabled: false },
      cascade_fade: { enabled: false },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: false },
    },
    telemetry: {
      ...DEFAULT_BOT_CONFIG.telemetry,
      log_dir: join(directory, "telemetry"),
      metrics_interval_sec: 60,
    },
  };
  const feed = new MockExchangeFeed({
    balances: [{ currency: "USDC", free: 10_000, total: 10_000 }],
  });
  const bot = new Bot({
    config,
    feed,
    logger: quietLogger,
    stateSaveIntervalMs: 25,
    killSwitchEvalIntervalMs: 25,
    heartbeatIntervalMs: 25,
    telemetryMetricsIntervalSec: 1,
  });

  try {
    const running = bot.start();
    await Bun.sleep(100);
    const symbol = asSymbol("BTC/USDC");
    const ticker: Ticker = {
      symbol,
      timestamp: Date.now(),
      bid: 59_999,
      ask: 60_001,
      last: 60_000,
      baseVolume: 100,
      quoteVolume: 6_000_000,
    };
    feed.pushEvent({ kind: "ticker", payload: ticker });
    const candle: Ohlcv = [Date.now() - 60_000, 59_990, 60_010, 59_980, 60_000, 100];
    feed.pushEvent({ kind: "ohlcv", payload: { symbol, timeframe: "15m", candle } });
    await Bun.sleep(100);
    const state = bot.getState();
    assertCondition(state.version === 1, "runtime driver observed an invalid state version");
    await bot.stop();
    await running;
    assertCondition(existsSync(stateFile), "runtime driver did not persist state");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function runBotLifecycleFactory(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-factory-driver-"));
  const originalKey = process.env["BYBIT_API_KEY"];
  const originalSecret = process.env["BYBIT_API_SECRET"];
  try {
    const preStart = new Bot({
      config: botConfigFor(join(directory, "pre.json")),
      feed: new MockExchangeFeed(),
    });
    expectFailure(() => preStart.getState(), "pre-start state");
    await preStart.stop();
    assertCondition(preStart.getConfig().bot.state_file.endsWith("pre.json"), "Bot config accessor mismatch");

    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];
    const unauthFeed = new MockExchangeFeed();
    const unauthCalls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];
    const unauthConfig: BotConfig = {
      ...botConfigFor(join(directory, "unauth.json")),
      exchange: {
        ...botConfigFor(join(directory, "unauth.json")).exchange,
        id: "bybiteu",
        endpoint: "https://scripted.invalid/rest",
        ws_endpoint: "wss://scripted.invalid/ws",
      },
    };
    await startBotThenStop(
      new Bot({
        config: unauthConfig,
        exchangeFeedFactory: (options) => {
          unauthCalls.push(options);
          return unauthFeed;
        },
      }),
      unauthFeed,
    );
    assertCondition(
      unauthCalls[0]?.override?.apiKey === "",
      "unauthenticated factory did not receive empty credentials",
    );
    assertCondition(
      unauthCalls[0].endpoint === "https://scripted.invalid/rest",
      "unauthenticated REST endpoint missing",
    );
    assertCondition(
      unauthCalls[0].wsEndpoint === "wss://scripted.invalid/ws",
      "unauthenticated WS endpoint missing",
    );

    const noEndpointFeed = new MockExchangeFeed();
    const noEndpointCalls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];
    const noEndpointConfig: BotConfig = {
      ...botConfigFor(join(directory, "unauth-no-endpoint.json")),
      exchange: { ...botConfigFor(join(directory, "unauth-no-endpoint.json")).exchange, id: "bybiteu" },
    };
    await startBotThenStop(
      new Bot({
        config: noEndpointConfig,
        exchangeFeedFactory: (options) => {
          noEndpointCalls.push(options);
          return noEndpointFeed;
        },
        logger: quietLogger,
      }),
      noEndpointFeed,
    );
    assertCondition(
      noEndpointCalls[0]?.endpoint === undefined && noEndpointCalls[0]?.wsEndpoint === undefined,
      "unauthenticated absent endpoints were populated",
    );

    process.env["BYBIT_API_KEY"] = "scripted-key";
    process.env["BYBIT_API_SECRET"] = "scripted-secret";
    const authFeed = new MockExchangeFeed({ balances: [{ currency: "BTC", free: 1, total: 1 }] });
    const authCalls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];
    const authConfig: BotConfig = {
      ...botConfigFor(join(directory, "auth.json")),
      exchange: { ...botConfigFor(join(directory, "auth.json")).exchange, id: "bybiteu" },
    };
    const authBot = new Bot({
      config: authConfig,
      exchangeFeedFactory: (options) => {
        authCalls.push(options);
        return authFeed;
      },
      fundingSource: null,
    });
    const authRunning = authBot.start();
    await waitForCondition(() => authFeed.subscriptionCount() > 0, "authenticated subscription");
    assertCondition(authBot.getState().equityUsd === 10_000, "missing-USDC startup fallback changed");
    await authBot.stop();
    await authRunning;
    assertCondition(
      authCalls[0]?.override === undefined,
      "authenticated factory received credential override",
    );
    assertCondition(
      authCalls[0]?.endpoint === undefined && authCalls[0]?.wsEndpoint === undefined,
      "absent factory endpoints were populated",
    );

    const endpointFeed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 1_000, total: 1_000 }],
    });
    const endpointCalls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];
    const endpointConfig: BotConfig = {
      ...botConfigFor(join(directory, "endpoint.json")),
      exchange: {
        ...botConfigFor(join(directory, "endpoint.json")).exchange,
        id: "bybiteu",
        endpoint: "https://scripted.invalid/rest",
        ws_endpoint: "wss://scripted.invalid/ws",
      },
    };
    await startBotThenStop(
      new Bot({
        config: endpointConfig,
        exchangeFeedFactory: (options) => {
          endpointCalls.push(options);
          return endpointFeed;
        },
      }),
      endpointFeed,
    );
    const endpointCall = endpointCalls.at(0);
    assertCondition(
      endpointCall?.endpoint !== undefined && endpointCall.wsEndpoint !== undefined,
      "authenticated endpoints were dropped",
    );

    const doubleFeed = new MockExchangeFeed();
    const doubleBot = new Bot({ config: botConfigFor(join(directory, "double.json")), feed: doubleFeed });
    const doubleRunning = doubleBot.start();
    await waitForCondition(() => doubleFeed.subscriptionCount() > 0, "double-start subscription");
    await expectAsyncFailure(() => doubleBot.start(), "double start");
    await doubleBot.stop();
    await doubleRunning;
    await doubleBot.stop();

    const blockingFeed = new BlockingTickerFeed();
    const blockingLogger = new RecordingLogger();
    const blockingBot = new Bot({
      config: botConfigFor(join(directory, "blocking.json")),
      feed: blockingFeed,
      logger: blockingLogger,
      gracefulShutdownTimeoutMs: 0,
    });
    const blockingRunning = blockingBot.start();
    await waitForCondition(() => blockingFeed.tickerSubscriptionStarted, "blocking ticker subscription");
    await blockingBot.stop();
    blockingFeed.releaseTickerSubscription();
    await blockingRunning;
    assertCondition(
      blockingLogger.entries.some((entry) => entry.message.includes("graceful shutdown timeout")),
      "force-stop fallback was not logged",
    );
  } finally {
    if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
    else process.env["BYBIT_API_KEY"] = originalKey;
    if (originalSecret === undefined) delete process.env["BYBIT_API_SECRET"];
    else process.env["BYBIT_API_SECRET"] = originalSecret;
    rmSync(directory, { recursive: true, force: true });
  }
}

async function runBotSubscriptions(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-subscriptions-driver-"));
  try {
    const feed = new MockExchangeFeed();
    const config: BotConfig = {
      ...botConfigFor(join(directory, "subscriptions.json")),
      symbols: { enabled: ["BTC/USDC", "ETH/USDC"] },
      strategies: {
        ...botConfigFor(join(directory, "subscriptions.json")).strategies,
        donchian_pivot_composition: {
          enabled: true,
          symbols: ["BTC/USDC", "XRP/USDC"],
          risk_per_trade: 0.01,
          max_positions: 1,
          leverage: 10,
          timeframes: { htf: "2h", mtf: "4h", ltf: "15m" },
        },
      },
    };
    const bot = new Bot({ config, feed, logger: quietLogger });
    const running = bot.start();
    await waitForCondition(() => feed.subscriptionCount() === 5, "strategy timeframe subscriptions");
    const symbol = asSymbol("BTC/USDC");
    feed.pushEvent({
      kind: "ticker",
      payload: { symbol, timestamp: 1, bid: 99, ask: 101, last: 100, baseVolume: 0, quoteVolume: 0 },
    });
    feed.pushEvent({
      kind: "ohlcv",
      payload: { symbol, timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] },
    });
    await Bun.sleep(20);
    assertCondition(placeOrderLedger.length === 0, "subscription callback reached order placement");
    await bot.stop();
    await running;

    const failureFeed = new FailingOhlcvFeed();
    const failureLogger = new RecordingLogger();
    const failureConfig: BotConfig = {
      ...botConfigFor(join(directory, "subscription-faults.json")),
      strategies: {
        ...botConfigFor(join(directory, "subscription-faults.json")).strategies,
        donchian_pivot_composition: { enabled: true },
      },
    };
    await startBotThenStop(
      new Bot({ config: failureConfig, feed: failureFeed, logger: failureLogger }),
      failureFeed,
    );
    const errors = failureLogger.entries
      .filter((entry) => entry.message.startsWith("[bot] OHLCV subscribe failed"))
      .map((entry) => entry.meta?.["error"]);
    assertCondition(errors.includes("4h subscription failed"), "Error OHLCV failure was not logged");
    assertCondition(errors.includes("15m subscription failed"), "string OHLCV failure was not logged");

    const pluginFeed = new MockExchangeFeed();
    const pluginConfig: BotConfig = {
      ...botConfigFor(join(directory, "plugin-instance.json")),
      strategies: {
        ...botConfigFor(join(directory, "plugin-instance.json")).strategies,
        regime_detector: { enabled: true },
      },
    };
    await startBotThenStop(
      new Bot({ config: pluginConfig, feed: pluginFeed, logger: quietLogger }),
      pluginFeed,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function makeSavedPosition(strategy: string, symbol: string): BotState["positions"][number] {
  return {
    id: `${strategy}:${symbol}:long`,
    strategy,
    symbol,
    side: "long",
    quantity: 0.01,
    entryPrice: 100,
    currentPrice: 100,
    leverage: 10,
    unrealizedPnl: 0,
    realizedPnl: 0,
    openedAt: 1,
    notionalUsd: 1,
  };
}

async function runBotRestoreTelemetry(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-restore-driver-"));
  try {
    const stateFile = join(directory, "restore.json");
    const saved: BotState = {
      version: 1,
      savedAt: 1,
      equityUsd: 10_100,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 100,
      positions: [makeSavedPosition("first", "BTC/USDC"), makeSavedPosition("second", "ETH/USDC")],
      closedTrades: [
        {
          strategy: "closed",
          symbol: "BTC/USDC",
          side: "long",
          quantity: 0.01,
          entryPrice: 100,
          exitPrice: 110,
          pnl: 0.1,
          pnlPct: 0.1,
          closedAt: 1,
        },
      ],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    writeFileSync(stateFile, JSON.stringify(saved), "utf8");
    const feed = new MockExchangeFeed();
    const config: BotConfig = {
      ...botConfigFor(stateFile),
      risk: { ...botConfigFor(stateFile).risk, max_positions: 1 },
    };
    const bot = new Bot({
      config,
      feed,
      logger: quietLogger,
      stateSaveIntervalMs: 10,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
      telemetryMetricsIntervalSec: 10,
    });
    const running = bot.start();
    await waitForCondition(() => feed.subscriptionCount() > 0, "restored bot subscription");
    const restored = bot.getState();
    assertCondition(restored.positions.length === 2, "restored positions were capacity-truncated");
    assertCondition(restored.closedTrades.length === 1, "closed trade history was not restored");
    assertCondition(restored.realizedPnlUsd === 100, "realized PnL was not restored");
    await Bun.sleep(30);
    await bot.stop();
    await running;
    assertCondition(existsSync(stateFile), "periodic/final state save was missing");

    const emptyStateFile = join(directory, "empty-state.json");
    const emptySaved: BotState = {
      version: 1,
      savedAt: 1,
      equityUsd: 10_000,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    writeFileSync(emptyStateFile, JSON.stringify(emptySaved), "utf8");
    const emptyFeed = new MockExchangeFeed();
    await startBotThenStop(
      new Bot({ config: botConfigFor(emptyStateFile), feed: emptyFeed, logger: quietLogger }),
      emptyFeed,
    );

    const positiveTelemetryState = join(directory, "positive-telemetry.json");
    const positiveFeed = new MockExchangeFeed();
    const positiveBot = new Bot({
      config: botConfigFor(positiveTelemetryState),
      feed: positiveFeed,
      logger: quietLogger,
      telemetryMetricsIntervalSec: 0.01,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
    });
    const positiveRunning = positiveBot.start();
    const positiveLog = join(
      `${positiveTelemetryState}.logs`,
      `bot-${new Date().toISOString().slice(0, 10)}.log`,
    );
    await waitForCondition(() => {
      try {
        return readFileSync(positiveLog, "utf8").includes('"initialEquityUsd":10000');
      } catch {
        return false;
      }
    }, "positive telemetry snapshot");
    await positiveBot.stop();
    await positiveRunning;

    const telemetryStateFile = join(directory, "telemetry.json");
    const telemetrySaved: BotState = {
      ...saved,
      equityUsd: 0,
      realizedPnlUsd: 0,
      positions: [
        {
          ...makeSavedPosition("telemetry", "BTC/USDC"),
          quantity: 1,
          entryPrice: 10_001,
          currentPrice: 1,
          unrealizedPnl: -10_000,
          notionalUsd: 10_001,
        },
      ],
      closedTrades: [],
    };
    writeFileSync(telemetryStateFile, JSON.stringify(telemetrySaved), "utf8");
    const telemetryFeed = new MockExchangeFeed();
    const telemetryBot = new Bot({
      config: botConfigFor(telemetryStateFile),
      feed: telemetryFeed,
      logger: quietLogger,
      telemetryMetricsIntervalSec: 0.01,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
    });
    const telemetryRunning = telemetryBot.start();
    const telemetryLog = join(
      `${telemetryStateFile}.logs`,
      `bot-${new Date().toISOString().slice(0, 10)}.log`,
    );
    await waitForCondition(() => {
      try {
        return readFileSync(telemetryLog, "utf8").includes("unrealizedPnlUsd");
      } catch {
        return false;
      }
    }, "telemetry snapshot");
    const contents = readFileSync(telemetryLog, "utf8");
    assertCondition(contents.includes('"initialEquityUsd":0'), "telemetry initial equity was not clamped");
    assertCondition(contents.includes('"unrealizedPnlUsd":-10000'), "telemetry unrealized PnL mismatch");
    await telemetryBot.stop();
    await telemetryRunning;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function runBotLiveReconciliation(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-live-driver-"));
  const originalKey = process.env["BYBIT_API_KEY"];
  const originalSecret = process.env["BYBIT_API_SECRET"];
  process.env["BYBIT_API_KEY"] = "scripted-key";
  process.env["BYBIT_API_SECRET"] = "scripted-secret";
  const liveConfig = (name: string, symbols: readonly string[] = ["BTC/USDC"]): BotConfig => ({
    ...botConfigFor(join(directory, `${name}.json`)),
    bot: { ...botConfigFor(join(directory, `${name}.json`)).bot, mode: "live" },
    symbols: { enabled: [...symbols] },
  });
  try {
    const btc = asSymbol("BTC/USDC");
    const eth = asSymbol("ETH/USDC");
    const usdc = asSymbol("USDC/USDT");
    const mixedFeed = new ReconciliationFeed(
      [{ currency: "USDC", free: 1_000, total: 1_000 }],
      [
        { currency: "USDC", free: 1_000, total: 1_000 },
        { currency: "BTC", free: 1, total: 1 },
      ],
      {
        positions: [
          {
            symbol: eth,
            side: "short",
            quantity: 1,
            entryPrice: 10,
            markPrice: 12,
            unrealizedPnl: -5,
            updateTimestamp: 1,
          },
        ],
        marketMeta: new Map([
          [btc, { ...makePortfolioMarketMeta(true), symbol: btc }],
          [eth, { ...makePortfolioMarketMeta(false), symbol: eth, base: "ETH" }],
          [usdc, { ...makePortfolioMarketMeta(true), symbol: usdc, base: "USDC", quote: "USDT" }],
        ]),
      },
    );
    mixedFeed.setTicker(btc, {
      symbol: btc,
      timestamp: 1,
      bid: 99,
      ask: 101,
      last: 100,
      baseVolume: 0,
      quoteVolume: 0,
    });
    const mixedBot = new Bot({
      config: liveConfig("mixed", [String(btc), String(eth), String(usdc)]),
      feed: mixedFeed,
      logger: quietLogger,
      heartbeatIntervalMs: 5,
      killSwitchEvalIntervalMs: 10_000,
    });
    const mixedRunning = mixedBot.start();
    await waitForCondition(
      () => mixedFeed.tickerCalls > 0 && mixedFeed.positionCalls > 0,
      "mixed live reconciliation",
    );
    assertCondition(!mixedBot.isKillSwitchEngaged(), "mixed live reconciliation engaged kill switch");
    await mixedBot.stop();
    await mixedRunning;

    const absentFeed = new ReconciliationFeed([{ currency: "USDC", free: 1_000, total: 1_000 }], [], {
      marketMeta: new Map([[btc, makePortfolioMarketMeta(true)]]),
    });
    const absentBot = new Bot({
      config: liveConfig("absent"),
      feed: absentFeed,
      logger: quietLogger,
      heartbeatIntervalMs: 5,
      killSwitchEvalIntervalMs: 10_000,
    });
    const absentRunning = absentBot.start();
    await waitForCondition(() => absentFeed.balanceCalls >= 2, "absent spot reconciliation");
    assertCondition(absentFeed.tickerCalls === 0, "absent spot inventory fetched a ticker");
    await absentBot.stop();
    await absentRunning;

    const undefinedUpl: ExchangePosition = {
      symbol: btc,
      side: "long",
      quantity: 1,
      entryPrice: 100,
      markPrice: 100,
      unrealizedPnl: undefined,
      updateTimestamp: 1,
    };
    const derivativeFeed = new ReconciliationFeed(
      [{ currency: "USDC", free: 1_000, total: 1_000 }],
      [{ currency: "USDC", free: 1_000, total: 1_000 }],
      {
        positions: [undefinedUpl],
        marketMeta: new Map([[btc, makePortfolioMarketMeta(false)]]),
      },
    );
    const derivativeBot = new Bot({
      config: liveConfig("derivative"),
      feed: derivativeFeed,
      logger: quietLogger,
      heartbeatIntervalMs: 5,
      killSwitchEvalIntervalMs: 10_000,
    });
    const derivativeRunning = derivativeBot.start();
    await waitForCondition(() => derivativeFeed.positionCalls > 0, "derivative reconciliation");
    await derivativeBot.stop();
    await derivativeRunning;

    for (const failure of [new Error("position Error"), "position string"] as const) {
      const positionFeed = new PositionFaultReconciliationFeed(failure, [
        { currency: "USDC", free: 1_000, total: 1_000 },
      ]);
      const positionBot = new Bot({
        config: liveConfig(`position-${typeof failure}`),
        feed: positionFeed,
        logger: quietLogger,
        heartbeatIntervalMs: 5,
        killSwitchEvalIntervalMs: 10_000,
      });
      const positionRunning = positionBot.start();
      await waitForCondition(() => positionFeed.positionCalls > 0, "position-query rejection");
      await positionBot.stop();
      await positionRunning;
    }

    for (const failure of [new Error("balance Error"), "balance string"] as const) {
      const logger = new RecordingLogger();
      const balanceFeed = new ReconciliationFeed([{ currency: "USDC", free: 1_000, total: 1_000 }], failure);
      const balanceBot = new Bot({
        config: liveConfig(`balance-${typeof failure}`),
        feed: balanceFeed,
        logger,
        heartbeatIntervalMs: 5,
        killSwitchEvalIntervalMs: 10_000,
      });
      const balanceRunning = balanceBot.start();
      await waitForCondition(
        () =>
          logger.entries.some(
            (entry) => entry.message === "[bot] authoritative equity reconciliation failed",
          ),
        "balance reconciliation failure",
      );
      assertCondition(
        logger.entries.some(
          (entry) => entry.meta?.["error"] === (failure instanceof Error ? failure.message : failure),
        ),
        "balance reconciliation failure detail missing",
      );
      await balanceBot.stop();
      await balanceRunning;
    }

    for (const invalidEquity of [0, Number.NaN]) {
      const invalidFeed = new ReconciliationFeed(
        [{ currency: "USDC", free: 1_000, total: 1_000 }],
        [{ currency: "USDC", free: invalidEquity, total: invalidEquity }],
      );
      const invalidBot = new Bot({
        config: liveConfig(`invalid-${String(invalidEquity)}`),
        feed: invalidFeed,
        logger: quietLogger,
        heartbeatIntervalMs: 5,
        killSwitchEvalIntervalMs: 10_000,
      });
      const invalidRunning = invalidBot.start();
      await waitForCondition(() => invalidFeed.balanceCalls >= 2, "invalid-equity reconciliation");
      await invalidBot.stop();
      await invalidRunning;
    }

    const slowFeed = new SlowReconciliationFeed();
    const slowBot = new Bot({
      config: liveConfig("slow"),
      feed: slowFeed,
      logger: quietLogger,
      heartbeatIntervalMs: 1,
      killSwitchEvalIntervalMs: 10_000,
    });
    const slowRunning = slowBot.start();
    await waitForCondition(() => slowFeed.balanceCalls >= 2, "overlapping reconciliation");
    await Bun.sleep(10);
    await slowBot.stop();
    await slowRunning;

    const noPositionsFeed = new NoPositionsFeed();
    const noPositionsBot = new Bot({
      config: liveConfig("no-positions"),
      feed: noPositionsFeed,
      logger: quietLogger,
      heartbeatIntervalMs: 5,
      killSwitchEvalIntervalMs: 10_000,
    });
    const noPositionsRunning = noPositionsBot.start();
    await waitForCondition(() => noPositionsFeed.subscriptionCount() > 0, "no-positions subscription");
    await Bun.sleep(15);
    await noPositionsBot.stop();
    await noPositionsRunning;
  } finally {
    if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
    else process.env["BYBIT_API_KEY"] = originalKey;
    if (originalSecret === undefined) delete process.env["BYBIT_API_SECRET"];
    else process.env["BYBIT_API_SECRET"] = originalSecret;
    rmSync(directory, { recursive: true, force: true });
  }
}

async function runBotCleanupFaults(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-cleanup-driver-"));
  const originalKey = process.env["BYBIT_API_KEY"];
  const originalSecret = process.env["BYBIT_API_SECRET"];
  process.env["BYBIT_API_KEY"] = "scripted-key";
  process.env["BYBIT_API_SECRET"] = "scripted-secret";
  try {
    for (const failure of [
      {
        lifecycle: new Error("lifecycle Error"),
        close: new Error("close Error"),
        expectedLifecycle: "lifecycle Error",
        expectedClose: "close Error",
      },
      {
        lifecycle: "lifecycle string",
        close: "close string",
        expectedLifecycle: "lifecycle string",
        expectedClose: "close string",
      },
    ] as const) {
      const logger = new RecordingLogger();
      const feed = new CleanupFailureFeed(failure.lifecycle, failure.close);
      const config: BotConfig = {
        ...botConfigFor(join(directory, `cleanup-${typeof failure.lifecycle}.json`)),
        bot: {
          ...botConfigFor(join(directory, `cleanup-${typeof failure.lifecycle}.json`)).bot,
          mode: "live",
        },
      };
      await startBotThenStop(new Bot({ config, feed, logger }), feed);
      assertCondition(
        logger.entries.some(
          (entry) =>
            entry.message === "[bot] private lifecycle cleanup failed" &&
            entry.meta?.["error"] === failure.expectedLifecycle,
        ),
        "private lifecycle cleanup failure missing",
      );
      assertCondition(
        logger.entries.some(
          (entry) =>
            entry.message === "[bot] feed close failed" && entry.meta?.["error"] === failure.expectedClose,
        ),
        "feed close failure missing",
      );
    }

    const unsubscribeFeed = new AllUnsubscribeFailureFeed();
    await startBotThenStop(
      new Bot({
        config: botConfigFor(join(directory, "unsubscribe.json")),
        feed: unsubscribeFeed,
        logger: quietLogger,
      }),
      unsubscribeFeed,
    );

    const blocker = join(directory, "state-parent-file");
    writeFileSync(blocker, "not a directory", "utf8");
    const invalidStateFile = join(blocker, "state.json");
    const flushLogger = new RecordingLogger();
    const flushFeed = new MockExchangeFeed();
    const flushBot = new Bot({
      config: botConfigFor(invalidStateFile),
      feed: flushFeed,
      logger: flushLogger,
    });
    const flushRunning = flushBot.start();
    await waitForCondition(() => flushFeed.subscriptionCount() > 0, "flush-fault subscription");
    await flushBot.stop();
    await flushRunning;
    assertCondition(
      flushLogger.entries.some((entry) => entry.message === "[bot] state flush failed"),
      "state flush failure was not logged",
    );
  } finally {
    if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
    else process.env["BYBIT_API_KEY"] = originalKey;
    if (originalSecret === undefined) delete process.env["BYBIT_API_SECRET"];
    else process.env["BYBIT_API_SECRET"] = originalSecret;
    rmSync(directory, { recursive: true, force: true });
  }
}

function alwaysEngagedSwitch(id: string): KillSwitch {
  return {
    id,
    description: "scripted always-engaged kill switch",
    evaluate: () => ({ switchId: id, engaged: true, reason: id }),
  };
}

async function runBotOrderRisk(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-order-risk-driver-"));
  const originalKey = process.env["BYBIT_API_KEY"];
  const originalSecret = process.env["BYBIT_API_SECRET"];
  try {
    const paperStateFile = join(directory, "paper-emergency.json");
    const paperState: BotState = {
      version: 1,
      savedAt: 1,
      equityUsd: 10_000,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [makeSavedPosition("first", "BTC/USDC"), makeSavedPosition("second", "ETH/USDC")],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    writeFileSync(paperStateFile, JSON.stringify(paperState), "utf8");
    const paperFeed = new MockExchangeFeed();
    const paperBot = new Bot({
      config: botConfigFor(paperStateFile),
      feed: paperFeed,
      logger: quietLogger,
      perStrategyKillSwitches: [alwaysEngagedSwitch("paper-emergency")],
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 5,
      gracefulShutdownTimeoutMs: 0,
    });
    const paperRunning = paperBot.start();
    await paperRunning;
    assertCondition(paperBot.isKillSwitchEngaged(), "paper emergency did not engage kill switch");
    assertCondition(
      paperBot.getState().positions.length === 0,
      "paper emergency retained restored positions",
    );

    process.env["BYBIT_API_KEY"] = "scripted-key";
    process.env["BYBIT_API_SECRET"] = "scripted-secret";
    const venueSymbol = asSymbol("BTC/USDC");
    const venueFeed = new AutoFlattenFeed({
      positions: [makeRemotePosition()],
      marketMeta: new Map([[venueSymbol, makePortfolioMarketMeta(false)]]),
      balances: [{ currency: "USDC", free: 10_000, total: 10_000 }],
    });
    const venueConfig: BotConfig = {
      ...botConfigFor(join(directory, "venue-emergency.json")),
      bot: { ...botConfigFor(join(directory, "venue-emergency.json")).bot, mode: "live" },
    };
    const venueBot = new Bot({
      config: venueConfig,
      feed: venueFeed,
      logger: quietLogger,
      perStrategyKillSwitches: [alwaysEngagedSwitch("venue-emergency")],
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 5,
      gracefulShutdownTimeoutMs: 0,
    });
    await venueBot.start();
    assertCondition(venueBot.isKillSwitchEngaged(), "venue emergency did not engage kill switch");

    const unresolvedFeed = new MockExchangeFeed({
      positions: [{ ...makeRemotePosition(), entryPrice: undefined, markPrice: undefined }],
      marketMeta: new Map([[venueSymbol, makePortfolioMarketMeta(false)]]),
      balances: [{ currency: "USDC", free: 10_000, total: 10_000 }],
    });
    const unresolvedConfig: BotConfig = {
      ...botConfigFor(join(directory, "unresolved-emergency.json")),
      bot: { ...botConfigFor(join(directory, "unresolved-emergency.json")).bot, mode: "live" },
    };
    const unresolvedBot = new Bot({
      config: unresolvedConfig,
      feed: unresolvedFeed,
      logger: quietLogger,
      perStrategyKillSwitches: [alwaysEngagedSwitch("unresolved-emergency")],
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 5,
      gracefulShutdownTimeoutMs: 0,
    });
    const unresolvedRunning = unresolvedBot.start();
    await waitForCondition(() => unresolvedBot.isKillSwitchEngaged(), "unresolved emergency engagement");
    await Bun.sleep(20);
    await unresolvedBot.stop();
    await unresolvedRunning;

    const tripFeed = new SequencedBalanceFeed([1_000, 1_000, 800]);
    const tripConfig: BotConfig = {
      ...botConfigFor(join(directory, "portfolio-trip.json")),
      bot: { ...botConfigFor(join(directory, "portfolio-trip.json")).bot, mode: "live" },
    };
    const tripBot = new Bot({
      config: tripConfig,
      feed: tripFeed,
      logger: quietLogger,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 5,
      gracefulShutdownTimeoutMs: 0,
    });
    await tripBot.start();
    assertCondition(tripBot.isKillSwitchEngaged(), "portfolio stop did not engage emergency coordinator");
  } finally {
    if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
    else process.env["BYBIT_API_KEY"] = originalKey;
    if (originalSecret === undefined) delete process.env["BYBIT_API_SECRET"];
    else process.env["BYBIT_API_SECRET"] = originalSecret;
    rmSync(directory, { recursive: true, force: true });
  }
}

function exerciseTrailingStops(): void {
  const config = {
    enabled: true,
    atrPeriod: 14,
    atrMultiplier: 2,
    side: "both" as const,
    logger: quietLogger,
  };
  expectFailure(
    () => new TrailingStopManager({ ...config, atrMultiplier: Number.NaN }),
    "NaN ATR multiplier",
  );
  expectFailure(() => new TrailingStopManager({ ...config, atrMultiplier: 0 }), "zero ATR multiplier");
  expectFailure(() => new TrailingStopManager({ ...config, atrPeriod: 1.5 }), "fractional ATR period");
  expectFailure(() => new TrailingStopManager({ ...config, atrPeriod: 0 }), "zero ATR period");

  const disabled = new TrailingStopManager({ ...config, enabled: false });
  expectFailure(() => disabled.arm("disabled", "long", 100, 2), "disabled trailing stop");
  assertCondition(!disabled.isEnabled(), "disabled trailing stop reported enabled");

  const manager = new TrailingStopManager(config);
  new TrailingStopManager(withoutLogger(config));
  expectFailure(() => manager.arm("bad-price-nan", "long", Number.NaN, 2), "NaN entry price");
  expectFailure(() => manager.arm("bad-price-zero", "long", 0, 2), "zero entry price");
  expectFailure(() => manager.arm("bad-atr-nan", "long", 100, Number.NaN), "NaN arm ATR");
  expectFailure(() => manager.arm("bad-atr-zero", "long", 100, 0), "zero arm ATR");

  manager.evaluate({ positionId: "missing", side: "long", currentPrice: 100, atr: 2 });
  manager.arm("long", "long", 100, 2);
  manager.arm("short", "short", 100, 2);
  manager.getState("long");
  manager.getState("missing");
  manager.getAllStates();
  assertCondition(manager.shouldTrackSide("long"), "both-side filter rejected long");
  const longOnly = new TrailingStopManager({ ...config, side: "long" });
  assertCondition(longOnly.shouldTrackSide("long"), "long filter rejected long");
  assertCondition(!longOnly.shouldTrackSide("short"), "long filter accepted short");
  manager.updateAtr("missing", 2);
  manager.updateAtr("long", Number.NaN);
  manager.updateAtr("long", 0);
  manager.updateAtr("long", 1);
  manager.updateAtr("short", 1);
  manager.evaluate({ positionId: "long", side: "long", currentPrice: Number.NaN, atr: 1 });
  manager.evaluate({ positionId: "long", side: "long", currentPrice: 0, atr: 1 });
  manager.evaluate({ positionId: "long", side: "long", currentPrice: 101, atr: Number.NaN });
  manager.evaluate({ positionId: "long", side: "long", currentPrice: 101, atr: 0 });
  manager.evaluate({ positionId: "long", side: "long", currentPrice: 110, atr: 2 });
  manager.evaluate({ positionId: "long", side: "long", currentPrice: 108, atr: 2 });
  const longClose = manager.evaluate({ positionId: "long", side: "long", currentPrice: 105, atr: 2 });
  assertCondition(longClose.kind === "close", "long trail did not close");
  manager.evaluate({ positionId: "short", side: "short", currentPrice: 90, atr: 2 });
  manager.evaluate({ positionId: "short", side: "short", currentPrice: 92, atr: 2 });
  const shortClose = manager.evaluate({ positionId: "short", side: "short", currentPrice: 95, atr: 2 });
  assertCondition(shortClose.kind === "close", "short trail did not close");
  manager.disarm("long");
  manager.disarm("long");
  assertCondition(manager.getAtrPeriod() === 14, "ATR period changed");
}

function exerciseDrawdownScaler(): void {
  const config = { enabled: true, maxDdPct: 0.2, initialEquity: 1000, logger: quietLogger };
  expectFailure(() => new DrawdownScaler({ ...config, maxDdPct: Number.NaN }), "NaN drawdown cap");
  expectFailure(() => new DrawdownScaler({ ...config, maxDdPct: 0 }), "zero drawdown cap");
  expectFailure(() => new DrawdownScaler({ ...config, maxDdPct: 1.1 }), "large drawdown cap");
  expectFailure(() => new DrawdownScaler({ ...config, initialEquity: Number.NaN }), "NaN initial equity");
  expectFailure(() => new DrawdownScaler({ ...config, initialEquity: 0 }), "zero initial equity");
  const disabled = new DrawdownScaler({ ...withoutLogger(config), enabled: false });
  assertCondition(disabled.scaleFactor() === 1, "disabled drawdown scaler changed size");
  const scaler = new DrawdownScaler(config);
  scaler.updateEquity(Number.NaN);
  scaler.updateEquity(0);
  scaler.updateEquity(1100);
  scaler.updateEquity(1000);
  assertCondition(scaler.scaleFactor() === 1, "normal drawdown scale mismatch");
  scaler.updateEquity(950);
  assertCondition(scaler.scaleFactor() === 0.5, "caution drawdown scale mismatch");
  scaler.updateEquity(900);
  assertCondition(!scaler.canOpenNew(), "kill drawdown allowed a position");
  scaler.getState();
  scaler.reset(Number.NaN);
  scaler.reset(0);
  scaler.reset(1200);
  assertCondition(scaler.canOpenNew(), "reset drawdown did not reopen sizing");
  DrawdownScaler.scaleFactorForRegion("normal");
  DrawdownScaler.scaleFactorForRegion("caution");
  DrawdownScaler.scaleFactorForRegion("kill");
}

function makeKelly(enabled: boolean, logger: Logger | undefined = quietLogger): KellySizer {
  return new KellySizer({
    enabled,
    fraction: 0.5,
    windowSize: 3,
    minTrades: 2,
    fallbackFraction: 0.01,
    maxFraction: 0.2,
    logger,
  });
}

function exerciseKelly(): void {
  for (const winRate of [Number.NaN, -0.1, 1.1]) {
    expectFailure(() => kellyFraction(winRate, 1), "invalid Kelly win rate");
  }
  for (const ratio of [Number.NaN, -1]) {
    expectFailure(() => kellyFraction(0.5, ratio), "invalid Kelly ratio");
  }
  kellyFraction(0.5, 0);
  kellyFraction(0.2, 1);
  kellyFraction(1, 0.5);
  computeStats([]);
  computeStats([{ pnlUsd: 0, closedAt: 1 }]);
  computeStats([{ pnlUsd: 10, closedAt: 1 }]);
  computeStats([{ pnlUsd: -5, closedAt: 1 }]);
  computeStats([
    { pnlUsd: 10, closedAt: 1 },
    { pnlUsd: -5, closedAt: 2 },
  ]);

  const base = {
    enabled: true,
    fraction: 0.5,
    windowSize: 3,
    minTrades: 2,
    fallbackFraction: 0.01,
    maxFraction: 0.2,
    logger: quietLogger,
  };
  for (const fraction of [Number.NaN, 0, 1.1])
    expectFailure(() => new KellySizer({ ...base, fraction }), "invalid Kelly fraction");
  for (const windowSize of [1.5, 0])
    expectFailure(() => new KellySizer({ ...base, windowSize }), "invalid Kelly window");
  for (const minTrades of [1.5, 0])
    expectFailure(() => new KellySizer({ ...base, minTrades }), "invalid Kelly minimum");
  for (const fallbackFraction of [Number.NaN, -0.1, 1.1])
    expectFailure(() => new KellySizer({ ...base, fallbackFraction }), "invalid Kelly fallback");
  for (const maxFraction of [Number.NaN, 0, 1.1])
    expectFailure(() => new KellySizer({ ...base, maxFraction }), "invalid Kelly maximum");

  const disabled = makeKelly(false, undefined);
  assertCondition(disabled.recommendedSize() === 0, "disabled Kelly returned size");
  disabled.getStats();
  new KellySizer(withoutLogger(base));
  const kelly = makeKelly(true);
  assertCondition(kelly.recommendedSize() === 0.01, "Kelly cold-start fallback mismatch");
  kelly.recordClosedTrade({ pnlUsd: Number.NaN, closedAt: 0 });
  kelly.recordClosedTrade({ pnlUsd: -10, closedAt: 1 });
  kelly.getStats();
  kelly.recordClosedTrade({ pnlUsd: -10, closedAt: 2 });
  assertCondition(kelly.recommendedSize() === 0, "no-edge Kelly returned size");
  kelly.getStats();
  kelly.recordClosedTrade({ pnlUsd: 100, closedAt: 3 });
  kelly.recordClosedTrade({ pnlUsd: 100, closedAt: 4 });
  assertCondition(kelly.recommendedSize() <= 0.2, "Kelly maximum cap failed");
  kelly.getStats();
  kelly.reset();
  assertCondition(kelly.isEnabled(), "enabled Kelly reported disabled");
}

function riskConfig(enabled: boolean) {
  return {
    trailingStop: { enabled, atrPeriod: 14, atrMultiplier: 2, side: "both" as const },
    kelly: {
      enabled,
      fraction: 0.5,
      windowSize: 3,
      minTrades: 2,
      fallbackFraction: 0,
      maxFraction: 0.2,
    },
    drawdownScaler: { enabled, maxDdPct: 0.2, initialEquity: 1000 },
    logger: quietLogger,
  };
}

function exerciseRiskManager(): void {
  const disabled = new RiskManager(withoutLogger(riskConfig(false)));
  disabled.armTrailingStop("disabled", "long", 100, 2);
  assertCondition(
    disabled.evaluateNewPositionSize({ equityUsd: 1000, baseSizeFraction: 0.02 }) === 0.02,
    "disabled risk sizing changed base size",
  );
  const longOnly = new RiskManager({
    ...riskConfig(true),
    trailingStop: { enabled: true, atrPeriod: 14, atrMultiplier: 2, side: "long" },
  });
  longOnly.armTrailingStop("filtered", "short", 100, 2);
  const manager = new RiskManager(riskConfig(true));
  let callbacks = 0;
  manager.onTrailingStopClose(() => {
    callbacks += 1;
  });
  manager.onTrailingStopClose(() => {
    throw new Error("callback Error");
  });
  manager.onTrailingStopClose(() => {
    throw "callback rejection";
  });
  manager.armTrailingStop("long", "long", 100, 2);
  manager.onTick({ positionId: "long", side: "long", currentPrice: 110, atr: 2, timestamp: 1 });
  manager.getSnapshot();
  manager.onTick({ positionId: "long", side: "long", currentPrice: 105, atr: 2, timestamp: 2 });
  assertCondition(callbacks === 1, "risk close callback count mismatch");
  manager.disarmTrailingStop("long");
  manager.onTradeClosed(-10, 1);
  manager.onTradeClosed(-10, 2);
  assertCondition(
    manager.evaluateNewPositionSize({ equityUsd: 1000, baseSizeFraction: 0.02 }) === 0,
    "no-edge Kelly returned risk size",
  );
  manager.onTradeClosed(100, 3);
  manager.onTradeClosed(100, 4);
  assertCondition(
    manager.evaluateNewPositionSize({ equityUsd: 1000, baseSizeFraction: 0.02 }) > 0,
    "active Kelly returned zero size",
  );
  manager.onEquityUpdate(800);
  assertCondition(
    manager.evaluateNewPositionSize({ equityUsd: 800, baseSizeFraction: 0.02 }) === 0,
    "kill drawdown returned risk size",
  );
  manager.getSnapshot();
  manager.getDrawdownScaler();
  manager.getKellySizer();
  manager.getTrailingStopManager();
}

function runRiskModules(): void {
  exerciseTrailingStops();
  exerciseDrawdownScaler();
  exerciseKelly();
  exerciseRiskManager();
}

function exerciseConfigStoreFaults(directory: string): void {
  const path = join(directory, "fault.toml");
  expectFailure(
    () =>
      new ConfigStore(path, {
        readText: () => {
          throw new Error("read Error");
        },
      }).read(),
    "ConfigStore Error read",
  );
  expectFailure(
    () =>
      new ConfigStore(path, {
        readText: () => {
          throw "read rejection";
        },
      }).read(),
    "ConfigStore non-Error read",
  );
  expectFailure(
    () =>
      new ConfigStore(path, {
        readText: () => "ignored",
        parse: () => {
          throw "parse rejection";
        },
      }).read(),
    "ConfigStore non-Error parse",
  );
  expectFailure(() => {
    new ConfigStore(path, {
      parse: () => {
        throw new Error("round-trip Error");
      },
    }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore round-trip Error");
  expectFailure(() => {
    new ConfigStore(path, {
      parse: () => {
        throw "round-trip rejection";
      },
    }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore round-trip non-Error");
  expectFailure(() => {
    new ConfigStore(path, { parse: () => null }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore round-trip validation");
  expectFailure(() => {
    new ConfigStore(path, {
      atomicWrite: () => {
        throw new Error("atomic Error");
      },
    }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore atomic Error");
  expectFailure(() => {
    new ConfigStore(path, {
      atomicWrite: () => {
        throw "atomic rejection";
      },
    }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore atomic non-Error");

  const liveConfig: BotConfig = {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" },
  };
  expectFailure(
    () =>
      new ConfigStore(path, {
        appendText: () => {
          throw new Error("audit Error");
        },
      }).writeAfterTypedLive(liveConfig, "LIVE", "paper"),
    "ConfigStore audit Error",
  );
  expectFailure(
    () =>
      new ConfigStore(path, {
        appendText: () => {
          throw "audit rejection";
        },
      }).writeAfterTypedLive(liveConfig, "LIVE", "paper"),
    "ConfigStore audit non-Error",
  );
}

function runConfigStore(): void {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-coverage-store-"));
  try {
    const emptyPath = join(directory, "empty.toml");
    writeFileSync(emptyPath, "", "utf8");
    const emptyStore = new ConfigStore(emptyPath);
    assertCondition(emptyStore.read().bot.mode === "paper", "empty config did not apply defaults");
    expectFailure(() => new ConfigStore(join(directory, "missing.toml")).read(), "missing config read");

    const malformedPath = join(directory, "malformed.toml");
    writeFileSync(malformedPath, "not [ valid TOML", "utf8");
    expectFailure(() => new ConfigStore(malformedPath).read(), "malformed TOML read");
    const invalidPath = join(directory, "invalid.toml");
    writeFileSync(invalidPath, "[risk]\nmax_leverage = 15\n", "utf8");
    expectFailure(() => new ConfigStore(invalidPath).read(), "invalid config read");

    emptyStore.validate(DEFAULT_BOT_CONFIG);
    expectFailure(() => emptyStore.validate(null), "root config validation");
    expectFailure(() => emptyStore.validate({ risk: { max_leverage: 15 } }), "field config validation");

    const configPath = join(directory, "nested", "mm-bot.toml");
    const store = new ConfigStore(configPath);
    store.write(DEFAULT_BOT_CONFIG);
    store.write({
      ...DEFAULT_BOT_CONFIG,
      risk: { ...DEFAULT_BOT_CONFIG.risk, risk_per_trade: 0.02 },
    });
    assertCondition(existsSync(`${configPath}.bak`), "ConfigStore did not create a backup");
    assertCondition(
      readFileSync(`${configPath}.bak`, "utf8").includes("risk_per_trade = 0.01"),
      "ConfigStore backup did not preserve the previous config",
    );

    const liveConfig: BotConfig = {
      ...DEFAULT_BOT_CONFIG,
      bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" },
    };
    expectFailure(
      () => store.writeAfterTypedLive(liveConfig, "live", "paper"),
      "lowercase LIVE confirmation",
    );
    store.writeAfterTypedLive(liveConfig, "LIVE", "paper");
    store.writeAfterTypedLive(liveConfig, "LIVE", "live");
    assertCondition(
      readFileSync(`${configPath}.audit.log`, "utf8").trim().split("\n").length === 2,
      "ConfigStore audit log entry count mismatch",
    );

    store.setStrategyEnabled("regime_detector", true);
    store.setStrategySetting("donchian_pivot_composition", "cap", 0.4);
    store.setStrategySetting("dydx_cex_carry", "notional_per_leg_usd", 250_000);
    expectFailure(() => {
      store.setStrategySetting("dydx_cex_carry", "leverage", "five");
    }, "invalid strategy setting");
    store.setExchangeConfig({ slippage_pct: 0.1, fee_tier: "vip" });
    store.setSymbols(["BTC/USDC", "ETH/USDC"]);
    store.setSymbols([]);
    store.setTelemetryConfig({
      log_level: "debug",
      log_destination: "file",
      metrics_enabled: false,
      heartbeat_interval_sec: 60,
    });
    assertCondition(store.read().telemetry.log_level === "debug", "ConfigStore setter result mismatch");

    resetConfigStoreCache();
    const cachedDefault = getConfigStore();
    assertCondition(cachedDefault === getConfigStore(), "default ConfigStore was not cached");
    const cachedExplicit = getConfigStore(configPath);
    assertCondition(cachedExplicit === getConfigStore(configPath), "explicit ConfigStore was not cached");
    resetConfigStoreCache();
    assertCondition(cachedExplicit !== getConfigStore(configPath), "ConfigStore cache did not reset");

    exerciseConfigStoreFaults(directory);
  } finally {
    resetConfigStoreCache();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function runFundingSource(): Promise<void> {
  const market = "BTC-USD" as const;
  const source = new MockDydxFundingSource();
  assertCondition(
    source.lastTickAgeMs(market, Date.now()) === null,
    "funding source unexpectedly had a pre-subscription tick",
  );
  assertCondition(
    source.lastChainBlockHeight(market) === 1_000_000,
    "funding source initial height mismatch",
  );
  assertCondition(
    source.lastChainBlockTs(market) === null,
    "funding source unexpectedly had a pre-subscription block time",
  );
  assertCondition(
    source.bybitEuSpotDepthUsd(market, Date.now()) === 1_000_000,
    "funding source depth mismatch",
  );
  source.health();
  let ticks = 0;
  const handle = source.subscribe(market, (snapshot) => {
    ticks += 1;
    assertCondition(snapshot.dydx.symbol === "BTC-USD", "dYdX funding symbol mismatch");
    assertCondition(snapshot.cex.symbol === "BTCUSDT", "CEX funding symbol mismatch");
  });
  await Bun.sleep(1_050);
  handle.close();
  assertCondition(ticks >= 2, "funding interval did not emit a second tick");
  assertCondition(source.lastTickAgeMs(market, Date.now()) !== null, "funding source lost its last tick");
  assertCondition(source.lastChainBlockTs(market) !== null, "funding source lost its block time");
  source.health();

  const first = new MockDydxFundingSource(123);
  const second = new MockDydxFundingSource(123);
  let firstRate: number | undefined;
  let secondRate: number | undefined;
  const firstHandle = first.subscribe(market, (snapshot) => {
    firstRate = snapshot.dydx.fundingRate;
  });
  const secondHandle = second.subscribe(market, (snapshot) => {
    secondRate = snapshot.dydx.fundingRate;
  });
  firstHandle.close();
  secondHandle.close();
  assertCondition(firstRate === secondRate, "seeded funding sources diverged");
}

function makeStrategyConfigs(
  entries: readonly (readonly [string, number])[],
): Map<string, StrategyRiskConfig> {
  return new Map(
    entries.map(([strategyId, weight]) => [
      strategyId,
      {
        strategyId,
        weight,
        riskPerTrade: 0.01,
      },
    ]),
  );
}

function exerciseRiskBudget(): void {
  const maximum = RISK_BUDGET_HARD_CAPS.totalRiskUsdMax;
  for (const totalRiskUsd of [Number.NaN, 0, maximum + 1]) {
    expectFailure(() => new RiskBudgetAllocator({ totalRiskUsd }), "invalid total risk budget");
  }
  for (const correlationPenaltyThreshold of [Number.NaN, -0.1, 1.1]) {
    expectFailure(
      () => new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold }),
      "invalid correlation threshold",
    );
  }
  const defaultAllocator = new RiskBudgetAllocator({ totalRiskUsd: maximum });
  assertCondition(defaultAllocator.getTotalRiskUsd() === maximum, "risk budget maximum changed");
  assertCondition(
    defaultAllocator.getCorrelationPenaltyThreshold() === 0.7,
    "risk budget default threshold changed",
  );
  assertCondition(defaultAllocator.computeBudgets(new Map()).size === 0, "empty risk budget was not empty");

  const allocator = new RiskBudgetAllocator({
    totalRiskUsd: 100,
    correlationPenaltyThreshold: 0.5,
    logger: quietLogger,
  });
  const configs = makeStrategyConfigs([
    ["a", 2],
    ["b", 1],
    ["c", -1],
  ]);
  allocator.computeBudgets(configs);
  allocator.computeBudgets(
    makeStrategyConfigs([
      ["a", 0],
      ["b", -1],
    ]),
  );
  const matrix = new Map<string, ReadonlyMap<string, number>>([
    [
      "a",
      new Map([
        ["a", 1],
        ["b", -0.9],
        ["c", Number.NaN],
        ["d", 2],
      ]),
    ],
    [
      "b",
      new Map([
        ["a", -0.9],
        ["b", 1],
      ]),
    ],
  ]);
  const budgets = allocator.computeBudgets(configs, () => matrix);
  assertCondition((budgets.get("a")?.penalty ?? 0) > 0, "correlated strategy was not penalized");

  const thresholdOne = new RiskBudgetAllocator({
    totalRiskUsd: 100,
    correlationPenaltyThreshold: 1,
    logger: quietLogger,
  });
  thresholdOne.computeBudgets(
    makeStrategyConfigs([
      ["a", 0.5],
      ["b", 0.5],
    ]),
    () =>
      new Map([
        [
          "a",
          new Map([
            ["a", 1],
            ["b", 1],
          ]),
        ],
        [
          "b",
          new Map([
            ["a", 1],
            ["b", 1],
          ]),
        ],
      ]),
  );
}

async function exercisePortfolioStop(): Promise<void> {
  new PortfolioStopError("default cause");
  new PortfolioStopError("explicit cause", new Error("cause"));
  for (const maxDdPct of [Number.NaN, 0.005, 0.31]) {
    expectFailure(() => new PortfolioStop({ maxDdPct }), "invalid portfolio stop threshold");
  }
  const defaultStop = new PortfolioStop();
  assertCondition(defaultStop.getDrawdownPct() === 0, "empty portfolio stop drawdown changed");
  assertCondition(!defaultStop.hasReceivedAnyEquity(), "portfolio stop received phantom equity");
  defaultStop.recordEquity(Number.NaN);
  defaultStop.recordEquity(0);
  defaultStop.recordEquity(-1);
  defaultStop.evaluate();
  defaultStop.getState();

  let trips = 0;
  const stop = new PortfolioStop({
    maxDdPct: 0.1,
    logger: quietLogger,
    tripAction: () => {
      trips += 1;
      return Promise.resolve();
    },
  });
  stop.getMaxDdPct();
  stop.getTrippedAt();
  stop.recordEquity(10_000, new Map([["strategy-a", -10]]));
  stop.recordEquity(11_000);
  stop.recordEquity(10_500);
  stop.recordEquity(9_900, new Map([["strategy-b", -100]]));
  await Promise.resolve();
  assertCondition(stop.isTripped() && trips === 1, "portfolio stop did not trip once");
  stop.recordEquity(8_000);
  stop.getPeakEquity();
  stop.getCurrentEquity();
  stop.getDrawdownPct();
  stop.getState();
  stop.reset();
  stop.forceTrip("manual");
  stop.forceTrip("duplicate");
  stop.reset({ clearPeak: true });
  assertCondition(!stop.hasReceivedAnyEquity(), "clear-peak reset retained equity state");
  stop.setTripAction(null);
  stop.forceTrip("no-action");
  await Promise.resolve();

  const errorAction = new PortfolioStop({
    maxDdPct: 0.1,
    logger: quietLogger,
    tripAction: () => {
      throw new Error("trip Error");
    },
  });
  errorAction.forceTrip("error-action");
  const rejectionAction = new PortfolioStop({
    maxDdPct: 0.1,
    logger: quietLogger,
    tripAction: () => {
      throw "trip rejection";
    },
  });
  rejectionAction.forceTrip("rejection-action");
  await Promise.resolve();
  await Promise.resolve();
}

async function runPortfolioPrimitives(): Promise<void> {
  exerciseRiskBudget();
  await exercisePortfolioStop();
}

async function runPortfolioManagerPaper(): Promise<void> {
  const symbol = makePortfolioSymbol();
  const stack = await makePortfolioStack({
    totalRiskUsd: 1_000,
    threshold: 0.5,
    maxDdPct: 0.1,
    paperMode: true,
  });
  try {
    assertCondition(!stack.portfolioManager.isTripped(), "fresh portfolio was tripped");
    assertCondition(stack.portfolioManager.getBudgetFor("missing") === 0, "unknown strategy received budget");
    registerPortfolioStrategies(stack, [
      ["a", 0.5],
      ["b", 0.5],
    ]);
    stack.portfolioManager.setStrategyConfig({ strategyId: "a", weight: 0.6, riskPerTrade: 0.01 });
    assertCondition(
      stack.portfolioManager.getPerStrategyBudget().size === 2,
      "portfolio budget size mismatch",
    );
    assertCondition(
      stack.portfolioManager.getBudgetBreakdowns().size === 2,
      "portfolio breakdown size mismatch",
    );
    assertCondition(
      stack.portfolioManager.getStrategyConfigs().get("a")?.weight === 0.6,
      "portfolio config update failed",
    );
    for (let index = 0; index < 20; index += 1) {
      stack.portfolioManager.recordFill({ strategyId: "a", returnPct: index * 0.001 });
      stack.portfolioManager.recordFill({ strategyId: "b", returnPct: index * 0.001 });
    }
    assertCondition(
      stack.portfolioManager.getBudgetFor("a") < 600,
      "correlation did not reduce portfolio budget",
    );
    assertCondition(
      stack.portfolioManager.getCorrelationMatrix().sampleCounts.get("a") === 20,
      "portfolio correlation sample mismatch",
    );
    stack.portfolioManager.removeStrategyConfig("b");
    assertCondition(!stack.portfolioManager.getStrategyConfigs().has("b"), "portfolio config removal failed");

    stack.positionManager.openPosition("a", symbol, "long", 0.01, 60_000, 10, 1);
    stack.positionManager.openPosition("b", symbol, "short", 0.01, 60_000, 10, 1);
    stack.portfolioManager.recordEquity(100_000);
    assertCondition(
      stack.portfolioManager.getStopState().peakEquityUsd === 100_000,
      "portfolio peak mismatch",
    );
    const firstClose = stack.portfolioManager.executeCloseAll();
    const concurrentClose = stack.portfolioManager.executeCloseAll();
    const [firstReport, concurrentReport] = await Promise.all([firstClose, concurrentClose]);
    assertCondition(firstReport.unresolved.length === 0, "paper portfolio close was unresolved");
    assertCondition(concurrentReport.unresolved.length === 0, "concurrent portfolio close diverged");
    assertCondition(
      stack.positionManager.getPositionCount() === 0,
      "paper portfolio close retained positions",
    );
    assertCondition(stack.portfolioManager.didExecuteCloseAll(), "paper portfolio close did not latch");
    const noOp = await stack.portfolioManager.executeCloseAll();
    assertCondition(noOp.closed.length === 0, "latched portfolio close was not a no-op");

    stack.portfolioManager.reset();
    assertCondition(!stack.portfolioManager.isTripped(), "portfolio reset retained stop latch");
    assertCondition(!stack.portfolioManager.didExecuteCloseAll(), "portfolio reset retained close latch");
    assertCondition(
      stack.portfolioManager.getPortfolioState().perStrategyBudgetUsd.size === 1,
      "portfolio reset lost strategy config",
    );
    stack.portfolioManager.recordEquity(100_000);
    await stack.portfolioManager.recordEquityAndSettle(95_000);
    assertCondition(!stack.portfolioManager.isTripped(), "normal drawdown tripped portfolio");
    await stack.portfolioManager.recordEquityAndSettle(80_000);
    assertCondition(
      stack.portfolioManager.getPortfolioState().isTripped,
      "portfolio trip state was not exposed",
    );

    expectFailure(
      () =>
        new PortfolioManager({
          riskBudget: new RiskBudgetAllocator({ totalRiskUsd: 100 }),
          correlation: new CorrelationMatrix(),
          portfolioStop: new PortfolioStop(),
          positionManager: stack.positionManager,
          orderManager: stack.orderManager,
          terminalCloseEvidenceLimit: 0,
        }),
      "zero terminal evidence bound",
    );
    expectFailure(
      () =>
        new PortfolioManager({
          riskBudget: new RiskBudgetAllocator({ totalRiskUsd: 100 }),
          correlation: new CorrelationMatrix(),
          portfolioStop: new PortfolioStop(),
          positionManager: stack.positionManager,
          orderManager: stack.orderManager,
          terminalCloseEvidenceLimit: 1.5,
        }),
      "fractional terminal evidence bound",
    );
  } finally {
    await stack.feed.close();
  }

  for (const pricing of ["average", "price", "position"] as const) {
    const feed = new ImmediateFillFeed(pricing);
    const pricingStack = await makePortfolioStack({ feed });
    try {
      const side = pricing === "average" ? "short" : "long";
      const position = pricingStack.positionManager.openPosition(pricing, symbol, side, 0.01, 60_000, 10, 1);
      assertCondition(
        await pricingStack.portfolioManager.requestPositionClose(position, pricing),
        `${pricing} close did not settle`,
      );
      assertCondition(
        pricingStack.positionManager.getPositionCount() === 0,
        `${pricing} close retained position`,
      );
    } finally {
      await feed.close();
    }
  }

  const sequencedFeed = new SequencedFillFeed([1, 0], {});
  const sequencedStack = await makePortfolioStack({ feed: sequencedFeed });
  try {
    sequencedStack.positionManager.openPosition("closed", symbol, "long", 0.01, 60_000, 10, 1);
    sequencedStack.positionManager.openPosition("unresolved", symbol, "short", 0.01, 60_000, 10, 1);
    const report = await sequencedStack.portfolioManager.executeCloseAll();
    assertCondition(report.closed.includes("closed/BTC/USDC"), "mixed close report omitted closed position");
    assertCondition(
      report.unresolved.includes("unresolved/BTC/USDC/short"),
      "mixed close report omitted unresolved position",
    );
  } finally {
    await sequencedFeed.close();
  }
}

async function runPortfolioManagerAuthoritative(): Promise<void> {
  const symbol = makePortfolioSymbol();
  const derivativeMeta = new Map([[symbol, makePortfolioMarketMeta(false)]]);
  const spotMeta = new Map([[symbol, makePortfolioMarketMeta(true)]]);

  const stale = await makePortfolioStack({
    feed: new FaultFeed({ positions: [], marketMeta: derivativeMeta }),
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  stale.positionManager.openPosition("stale", symbol, "long", 0.01, 60_000, 10, 1);
  const staleReport = await stale.portfolioManager.executeCloseAll();
  assertCondition(staleReport.unresolved.length === 0, "stale derivative remained unresolved");
  assertCondition(stale.positionManager.getPositionCount() === 0, "stale derivative remained local");

  const spotFeed = new FaultFeed({
    positions: [],
    balances: [
      { currency: "USDC", free: 1_000_000, total: 1_000_000 },
      { currency: "BTC", free: 0.02, total: 0.02 },
    ],
    marketMeta: spotMeta,
  });
  const spot = await makePortfolioStack({
    feed: spotFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  const spotReport = await spot.portfolioManager.executeCloseAll();
  assertCondition(
    firstOrder(spotFeed.placedOrders, "spot venue close").amount === 0.02,
    "spot venue quantity mismatch",
  );
  assertCondition(
    spotReport.unresolved.includes("venue/BTC/USDC/spot"),
    "spot venue exposure was not retryable",
  );
  const spotPendingReport = await spot.portfolioManager.executeCloseAll();
  assertCondition(
    spotPendingReport.unresolved.includes("venue/BTC/USDC/spot"),
    "open spot journal did not remain retryable",
  );

  const derivativeFeed = new FaultFeed({
    positions: [makeRemotePosition("long", 0.03)],
    marketMeta: derivativeMeta,
  });
  const derivative = await makePortfolioStack({
    feed: derivativeFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  const derivativeReport = await derivative.portfolioManager.executeCloseAll();
  assertCondition(
    firstOrder(derivativeFeed.placedOrders, "derivative venue close").amount === 0.03,
    "derivative venue quantity mismatch",
  );
  assertCondition(
    derivativeReport.unresolved.includes("venue/BTC/USDC/long"),
    "derivative venue exposure was not retryable",
  );
  const derivativePendingReport = await derivative.portfolioManager.executeCloseAll();
  assertCondition(
    derivativePendingReport.unresolved.includes("venue/BTC/USDC/long"),
    "open derivative journal did not remain retryable",
  );

  const autoFeed = new AutoFlattenFeed({
    positions: [makeRemotePosition()],
    marketMeta: derivativeMeta,
  });
  const auto = await makePortfolioStack({
    feed: autoFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  auto.positionManager.openPosition("carry", symbol, "long", 0.01, 60_000, 10, 1);
  const autoReport = await auto.portfolioManager.executeCloseAll();
  assertCondition(autoReport.unresolved.length === 0, "auto-flatten remained unresolved");
  assertCondition(autoReport.closed.includes("carry/BTC/USDC/long"), "auto-flatten omitted attribution");
  assertCondition(auto.portfolioManager.didExecuteCloseAll(), "auto-flatten did not latch");

  const autoSpotFeed = new AutoFlattenFeed({
    positions: [],
    balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
    marketMeta: spotMeta,
  });
  const autoSpot = await makePortfolioStack({
    feed: autoSpotFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  const autoSpotReport = await autoSpot.portfolioManager.executeCloseAll();
  assertCondition(autoSpotReport.unresolved.length === 0, "auto-flatten spot remained unresolved");

  for (const failure of [new Error("authority Error"), "authority string"] as const) {
    const metaFeed = new FaultFeed({ positions: [] });
    metaFeed.marketMetaFailures.push(failure);
    const metaStack = await makePortfolioStack({
      feed: metaFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [String(symbol)],
    });
    assertCondition(
      (await metaStack.portfolioManager.executeCloseAll()).unresolved
        .join(" ")
        .includes(typeof failure === "string" ? failure : failure.message),
      "metadata failure was not reported",
    );

    const positionFeed = new FaultFeed({ positions: [], marketMeta: derivativeMeta });
    positionFeed.positionFailures.push(failure);
    const positionStack = await makePortfolioStack({
      feed: positionFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [String(symbol)],
    });
    positionStack.positionManager.openPosition("unavailable", symbol, "long", 0.01, 60_000, 10, 1);
    assertCondition(
      (await positionStack.portfolioManager.executeCloseAll()).unresolved
        .join(" ")
        .includes("derivative position unavailable"),
      "position failure was not reported",
    );

    const balanceFeed = new FaultFeed({ positions: [] });
    balanceFeed.balanceFailures.push(failure);
    const balanceStack = await makePortfolioStack({
      feed: balanceFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [String(symbol)],
    });
    assertCondition(
      (await balanceStack.portfolioManager.executeCloseAll()).unresolved
        .join(" ")
        .includes(typeof failure === "string" ? failure : failure.message),
      "balance failure was not reported",
    );

    const verifyFeed = new FaultFeed({ positions: [] });
    verifyFeed.positionFailureOnCall = { call: 2, failure };
    verifyFeed.balanceFailureOnCall = { call: 2, failure };
    const verifyStack = await makePortfolioStack({
      feed: verifyFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [String(symbol)],
    });
    const verifyReport = await verifyStack.portfolioManager.executeCloseAll();
    assertCondition(
      verifyReport.unresolved.join(" ").includes("authoritative position verification"),
      "position verification failure was not reported",
    );
    assertCondition(
      verifyReport.unresolved.join(" ").includes("authoritative balance verification"),
      "balance verification failure was not reported",
    );
  }

  const invalidSpot = await makePortfolioStack({
    feed: new FaultFeed({
      positions: [],
      balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
      marketMeta: spotMeta,
    }),
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  invalidSpot.positionManager.openPosition("spot", symbol, "short", 0.01, 60_000, 10, 1);
  assertCondition(
    (await invalidSpot.portfolioManager.executeCloseAll()).unresolved
      .join(" ")
      .includes("invalid local spot short removed"),
    "invalid spot short was not quarantined",
  );

  const unavailableSpotFeed = new FaultFeed({ positions: [], marketMeta: spotMeta });
  unavailableSpotFeed.balanceFailures.push("balances unavailable");
  const unavailableSpot = await makePortfolioStack({
    feed: unavailableSpotFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  unavailableSpot.positionManager.openPosition("spot", symbol, "long", 0.01, 60_000, 10, 1);
  assertCondition(
    (await unavailableSpot.portfolioManager.executeCloseAll()).unresolved
      .join(" ")
      .includes("spot inventory unavailable"),
    "unavailable spot inventory was not reported",
  );

  const staleSpot = await makePortfolioStack({
    feed: new FaultFeed({
      positions: [],
      balances: [{ currency: "BTC", free: 0, total: 0 }],
      marketMeta: spotMeta,
    }),
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  staleSpot.positionManager.openPosition("stale-spot", symbol, "long", 0.01, 60_000, 10, 1);
  await staleSpot.portfolioManager.executeCloseAll();
  assertCondition(staleSpot.positionManager.getPositionCount() === 0, "stale spot position remained local");

  const absentSpotBalance = await makePortfolioStack({
    feed: new FaultFeed({
      positions: [],
      balances: [{ currency: "USDC", free: 1_000, total: 1_000 }],
      marketMeta: spotMeta,
    }),
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  absentSpotBalance.positionManager.openPosition("absent-spot", symbol, "long", 0.01, 60_000, 10, 1);
  await absentSpotBalance.portfolioManager.executeCloseAll();
  assertCondition(
    absentSpotBalance.positionManager.getPositionCount() === 0,
    "absent spot balance remained local",
  );

  const attributedSpotFeed = new FaultFeed({
    positions: [],
    balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
    marketMeta: spotMeta,
  });
  const attributedSpot = await makePortfolioStack({
    feed: attributedSpotFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  attributedSpot.positionManager.openPosition("attributed-spot", symbol, "long", 0.01, 60_000, 10, 1);
  const attributedSpotReport = await attributedSpot.portfolioManager.executeCloseAll();
  assertCondition(
    attributedSpotReport.unresolved.includes("attributed-spot/BTC/USDC/long"),
    "spot venue close lost local attribution",
  );

  const noPriceFeed = new FaultFeed({
    positions: [{ ...makeRemotePosition(), entryPrice: undefined, markPrice: undefined }],
    marketMeta: derivativeMeta,
  });
  const noPrice = await makePortfolioStack({
    feed: noPriceFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  assertCondition(
    (await noPrice.portfolioManager.executeCloseAll()).unresolved.includes("venue/BTC/USDC/long"),
    "price-less derivative was not unresolved",
  );

  const shortFeed = new FaultFeed({ positions: [makeRemotePosition("short")], marketMeta: derivativeMeta });
  const short = await makePortfolioStack({
    feed: shortFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  await short.portfolioManager.executeCloseAll();
  assertCondition(
    firstOrder(shortFeed.placedOrders, "short venue close").side === "buy",
    "short venue close side mismatch",
  );

  for (const failure of [new Error("venue Error"), "venue string"] as const) {
    const failedDerivativeFeed = new FaultFeed({
      positions: [makeRemotePosition()],
      marketMeta: derivativeMeta,
    });
    failedDerivativeFeed.placeFailures.push(failure);
    const failedDerivative = await makePortfolioStack({
      feed: failedDerivativeFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [String(symbol)],
    });
    assertCondition(
      (await failedDerivative.portfolioManager.executeCloseAll()).unresolved.includes("venue/BTC/USDC/long"),
      "failed derivative close was not unresolved",
    );

    const failedSpotFeed = new FaultFeed({
      positions: [],
      balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
      marketMeta: spotMeta,
    });
    failedSpotFeed.placeFailures.push(failure);
    const failedSpot = await makePortfolioStack({
      feed: failedSpotFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [String(symbol)],
    });
    assertCondition(
      (await failedSpot.portfolioManager.executeCloseAll()).unresolved.includes("venue/BTC/USDC/spot"),
      "failed spot close was not unresolved",
    );
  }

  const fallbackTickerFeed = new FaultFeed({
    positions: [],
    balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
    marketMeta: spotMeta,
  });
  fallbackTickerFeed.setTicker(symbol, {
    symbol,
    timestamp: 1,
    bid: 0,
    ask: 60_001,
    last: 60_000,
    baseVolume: 0,
    quoteVolume: 0,
  });
  const fallbackTicker = await makePortfolioStack({
    feed: fallbackTickerFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  await fallbackTicker.portfolioManager.executeCloseAll();
  assertCondition(
    fallbackTickerFeed.placedOrders.length === 1,
    "last-price spot fallback did not place scripted order",
  );

  const tooSmallFeed = new FaultFeed({
    positions: [],
    balances: [{ currency: "BTC", free: 0.0001, total: 0.0001 }],
    marketMeta: new Map([[symbol, makePortfolioMarketMeta(true, 1_000_000)]]),
  });
  const tooSmall = await makePortfolioStack({
    feed: tooSmallFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  await tooSmall.portfolioManager.executeCloseAll();
  assertCondition(tooSmallFeed.placedOrders.length === 0, "untradable spot amount placed a scripted order");

  for (const isSpot of [true, false]) {
    const requestFeed = new FaultFeed({
      positions: [],
      marketMeta: new Map([[symbol, makePortfolioMarketMeta(isSpot)]]),
    });
    const requestStack = await makePortfolioStack({
      feed: requestFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [String(symbol)],
    });
    const position = requestStack.positionManager.openPosition(
      isSpot ? "spot" : "derivative",
      symbol,
      "long",
      0.01,
      60_000,
      10,
      1,
    );
    assertCondition(
      !(await requestStack.portfolioManager.requestPositionClose(position, "manual")),
      "open authoritative request unexpectedly settled",
    );
  }
  for (const failure of [new Error("metadata Error"), "metadata string"] as const) {
    const requestFeed = new FaultFeed();
    requestFeed.marketMetaFailures.push(failure);
    const requestStack = await makePortfolioStack({
      feed: requestFeed,
      requireAuthoritativeEmergencyState: true,
    });
    const position = requestStack.positionManager.openPosition(
      "metadata",
      symbol,
      "long",
      0.01,
      60_000,
      10,
      1,
    );
    assertCondition(
      !(await requestStack.portfolioManager.requestPositionClose(position, "manual")),
      "metadata failure settled close",
    );
  }

  for (const mode of ["terminal", "unavailable"] as const) {
    const pendingFeed = new FaultFeed({ positions: [makeRemotePosition()], marketMeta: derivativeMeta });
    const pendingStack = await makePortfolioStack({
      feed: pendingFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [String(symbol)],
    });
    await pendingStack.portfolioManager.executeCloseAll();
    const pendingOrder = firstOrder(pendingFeed.placedOrders, `${mode} authoritative close`);
    if (mode === "terminal")
      pendingFeed.setOrderStatus(pendingOrder.clientOrderId, { status: "canceled", filled: 0 });
    else pendingFeed.orderFailures.push("pending unavailable");
    await pendingStack.portfolioManager.executeCloseAll();
  }

  for (const mode of ["terminal", "unavailable"] as const) {
    const pendingFeed = new FaultFeed({
      positions: [],
      balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
      marketMeta: spotMeta,
    });
    const pendingStack = await makePortfolioStack({
      feed: pendingFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [String(symbol)],
    });
    await pendingStack.portfolioManager.executeCloseAll();
    const pendingOrder = firstOrder(pendingFeed.placedOrders, `${mode} spot close`);
    if (mode === "terminal")
      pendingFeed.setOrderStatus(pendingOrder.clientOrderId, { status: "canceled", filled: 0 });
    else pendingFeed.orderFailures.push("pending spot unavailable");
    await pendingStack.portfolioManager.executeCloseAll();
  }
}

async function runPortfolioManagerLifecycle(): Promise<void> {
  const symbol = makePortfolioSymbol();
  const feed = new LifecycleFeed();
  const stack = await makePortfolioStack({ feed, terminalCloseEvidenceLimit: 1 });
  await stack.orderManager.startLifecycle();
  try {
    for (const side of ["long", "short"] as const) {
      const position = stack.positionManager.openPosition(side, symbol, side, 0.01, 60_000, 10, 1);
      assertCondition(
        !(await stack.portfolioManager.requestPositionClose(position, `close-${side}`)),
        `${side} close settled before lifecycle fill`,
      );
      const order = feed.placedOrders.at(-1);
      if (order === undefined) throw new Error(`missing ${side} lifecycle close order`);
      feed.emitLifecycle({ kind: "order", payload: { ...order, status: "open", filled: 0 } });
      feed.emitLifecycle({ kind: "execution", payload: makeExecution(order, `execution-${side}`, 0.01) });
      assertCondition(
        !stack.positionManager.getPositions().some((item) => item.id === position.id),
        `${side} lifecycle fill retained position`,
      );
      feed.emitLifecycle({
        kind: "execution",
        payload: makeExecution(order, `execution-${side}-late`, 0.01),
      });
      feed.emitLifecycle({
        kind: "execution",
        payload: makeExecution(order, `execution-${side}-late`, 0.01),
      });
    }

    const missing = stack.positionManager.openPosition("missing", symbol, "long", 0.01, 60_000, 10, 1);
    await stack.portfolioManager.requestPositionClose(missing, "missing");
    const missingOrder = feed.placedOrders.at(-1);
    if (missingOrder === undefined) throw new Error("missing-position order was not scripted");
    stack.positionManager.reconcileVenueAbsent(missing.id);
    feed.emitLifecycle({
      kind: "execution",
      payload: makeExecution(missingOrder, "execution-missing", 0.01),
    });

    const orderPosition = stack.positionManager.openPosition(
      "order-event",
      symbol,
      "long",
      0.01,
      60_000,
      10,
      1,
    );
    await stack.portfolioManager.requestPositionClose(orderPosition, "order-event");
    const orderUpdate = feed.placedOrders.at(-1);
    if (orderUpdate === undefined) throw new Error("order-event close was not scripted");
    feed.emitLifecycle({
      kind: "order",
      payload: {
        ...orderUpdate,
        status: "closed",
        filled: 0.01,
        average: 59_900,
        updateTimestamp: undefined,
      },
    });
    assertCondition(
      !stack.positionManager.getPositions().some((item) => item.id === orderPosition.id),
      "closed order event retained position",
    );

    const latePosition = stack.positionManager.openPosition("late", symbol, "long", 0.01, 60_000, 10, 1);
    await stack.portfolioManager.requestPositionClose(latePosition, "late-first");
    const cancelledOrder = feed.placedOrders.at(-1);
    if (cancelledOrder === undefined) throw new Error("late close was not scripted");
    feed.emitLifecycle({ kind: "order", payload: { ...cancelledOrder, status: "canceled", filled: 0 } });
    await stack.portfolioManager.requestPositionClose(latePosition, "late-retry");
    const replacement = feed.placedOrders.at(-1);
    if (replacement === undefined) throw new Error("replacement close was not scripted");
    feed.emitLifecycle({
      kind: "order",
      payload: {
        ...cancelledOrder,
        status: "closed",
        filled: 0.004,
        average: 59_850,
        updateTimestamp: undefined,
      },
    });
    await Promise.resolve();
    assertCondition(
      stack.positionManager.getPositions().find((item) => item.id === latePosition.id)?.quantity === 0.006,
      "late fill remainder mismatch",
    );
    assertCondition(
      feed.getOrder(replacement.clientOrderId)?.status === "canceled",
      "late fill did not cancel replacement",
    );

    const noReplacementPosition = stack.positionManager.openPosition(
      "no-replacement",
      symbol,
      "long",
      0.01,
      60_000,
      10,
      1,
    );
    await stack.portfolioManager.requestPositionClose(noReplacementPosition, "no-replacement");
    const noReplacementOrder = feed.placedOrders.at(-1);
    if (noReplacementOrder === undefined) throw new Error("no-replacement close was not scripted");
    feed.emitLifecycle({ kind: "order", payload: { ...noReplacementOrder, status: "canceled", filled: 0 } });
    feed.emitLifecycle({
      kind: "execution",
      payload: makeExecution(noReplacementOrder, "late-without-replacement", 0.004),
    });
  } finally {
    await stack.orderManager.stopLifecycle();
    await feed.close();
  }

  const errorLog: string[] = [];
  const errorLogger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message) => {
      errorLog.push(message);
    },
  };
  const failFeed = new FailOnceLifecycleFeed();
  const failStack = await makePortfolioStack({ feed: failFeed, logger: errorLogger });
  await failStack.orderManager.startLifecycle();
  try {
    const position = failStack.positionManager.openPosition(
      "cancel-fault",
      symbol,
      "long",
      0.01,
      60_000,
      10,
      1,
    );
    await failStack.portfolioManager.requestPositionClose(position, "cancel-first");
    const cancelledOrder = failFeed.placedOrders.at(-1);
    if (cancelledOrder === undefined) throw new Error("cancel-fault order was not scripted");
    failFeed.emitLifecycle({ kind: "order", payload: { ...cancelledOrder, status: "canceled", filled: 0 } });
    await failStack.portfolioManager.requestPositionClose(position, "cancel-retry");
    failFeed.emitLifecycle({
      kind: "execution",
      payload: makeExecution(cancelledOrder, "late-cancel-fault", 0.004),
    });
    await Bun.sleep(0);
    assertCondition(
      errorLog.includes("[portfolio-manager] late terminal fill replacement cancel failed"),
      "late replacement cancel failure was not logged",
    );
  } finally {
    await failStack.orderManager.stopLifecycle();
    await failFeed.close();
  }

  const reconcileFeed = new FaultFeed();
  const reconcile = await makePortfolioStack({ feed: reconcileFeed });
  const pending = reconcile.positionManager.openPosition("reconcile", symbol, "long", 0.01, 60_000, 10, 1);
  assertCondition(
    !(await reconcile.portfolioManager.requestPositionClose(pending, "first")),
    "open close unexpectedly settled",
  );
  assertCondition(
    !(await reconcile.portfolioManager.requestPositionClose(pending, "still-open")),
    "open reconciliation unexpectedly settled",
  );
  const pendingOrder = firstOrder(reconcileFeed.placedOrders, "reconcile close");
  reconcileFeed.setOrderStatus(pendingOrder.clientOrderId, {
    status: "canceled",
    filled: 0.004,
    average: undefined,
    price: undefined,
    updateTimestamp: undefined,
  });
  assertCondition(
    !(await reconcile.portfolioManager.requestPositionClose(pending, "partial-retry")),
    "partial REST close unexpectedly settled",
  );
  const replacementOrder = reconcileFeed.placedOrders.at(-1);
  if (replacementOrder === undefined) throw new Error("partial REST replacement was not scripted");
  reconcileFeed.setOrderStatus(replacementOrder.clientOrderId, {
    status: "closed",
    filled: 0.006,
    average: undefined,
    price: undefined,
    updateTimestamp: undefined,
  });
  const remaining = reconcile.positionManager.getPositions()[0];
  if (remaining === undefined) throw new Error("partial REST close lost remaining position");
  assertCondition(
    await reconcile.portfolioManager.requestPositionClose(remaining, "final-reconcile"),
    "REST-reconciled close did not settle",
  );
  await reconcileFeed.close();

  const cancelFeed = new FailOnceCancelFeed();
  const cancelStack = await makePortfolioStack({ feed: cancelFeed });
  await cancelStack.orderManager.placeOrder({
    signal: { side: "buy", confidence: 1, reason: "pending-entry", stopLoss: 0, takeProfit: 0 },
    symbol,
    amount: 0.01,
    referencePrice: 60_000,
    type: "market",
  });
  const failedCancel = await cancelStack.portfolioManager.executeCloseAll();
  assertCondition(
    failedCancel.unresolved.some((entry) => entry.startsWith("cancel ")),
    "cancel failure was not reported",
  );
  const successfulCancel = await cancelStack.portfolioManager.executeCloseAll();
  assertCondition(
    successfulCancel.cancelledOrders.length === 1,
    "successful retry cancellation was not reported",
  );

  for (const failure of [new Error("close Error"), "close string"] as const) {
    const pendingFeed = new FaultFeed();
    const pendingStack = await makePortfolioStack({ feed: pendingFeed });
    const pendingPosition = pendingStack.positionManager.openPosition(
      "pending",
      symbol,
      "long",
      0.01,
      60_000,
      10,
      1,
    );
    await pendingStack.portfolioManager.requestPositionClose(pendingPosition, "first");
    pendingFeed.orderFailures.push(failure);
    assertCondition(
      !(await pendingStack.portfolioManager.requestPositionClose(pendingPosition, "retry")),
      "failed reconciliation settled close",
    );

    const placeFeed = new FaultFeed();
    placeFeed.placeFailures.push(failure);
    const placeStack = await makePortfolioStack({ feed: placeFeed });
    const fresh = placeStack.positionManager.openPosition("fresh", symbol, "long", 0.01, 60_000, 10, 1);
    assertCondition(
      !(await placeStack.portfolioManager.requestPositionClose(fresh, "first")),
      "failed placement settled close",
    );
  }

  const attributionFeed = new LifecycleFeed({
    positions: [makeRemotePosition("long", 0.01)],
    marketMeta: new Map([[symbol, makePortfolioMarketMeta(false)]]),
  });
  const attribution = await makePortfolioStack({
    feed: attributionFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [String(symbol)],
  });
  await attribution.orderManager.startLifecycle();
  try {
    attribution.positionManager.openPosition("first", symbol, "long", 0.01, 60_000, 10, 1);
    attribution.positionManager.openPosition("second", symbol, "long", 0.01, 60_000, 10, 1);
    await attribution.portfolioManager.executeCloseAll();
    const venueOrder = attributionFeed.placedOrders.find((order) => order.side === "sell");
    if (venueOrder === undefined) throw new Error("authoritative attribution order was not scripted");
    attributionFeed.emitLifecycle({
      kind: "execution",
      payload: makeExecution(venueOrder, "attribution-exhaustion", 0.01),
    });
    assertCondition(
      attribution.positionManager.getPositionCount() === 1,
      "attribution did not stop at venue quantity",
    );
  } finally {
    await attribution.orderManager.stopLifecycle();
    await attributionFeed.close();
  }
}

if (caseId === "cli-boundaries") {
  runCliBoundaries();
} else if (caseId === "cli-command-boundaries") {
  await runCliCommandBoundaries();
} else if (caseId === "risk-modules") {
  runRiskModules();
} else if (caseId === "config-store") {
  runConfigStore();
} else if (caseId === "funding-source") {
  await runFundingSource();
} else if (caseId === "portfolio-primitives") {
  await runPortfolioPrimitives();
} else if (caseId === "portfolio-manager-paper") {
  await runPortfolioManagerPaper();
} else if (caseId === "portfolio-manager-authoritative") {
  await runPortfolioManagerAuthoritative();
} else if (caseId === "portfolio-manager-lifecycle") {
  await runPortfolioManagerLifecycle();
} else if (caseId === "lifecycle-smoke") {
  await runLifecycleSmoke();
} else if (caseId === "bot-lifecycle-factory") {
  await runBotLifecycleFactory();
} else if (caseId === "bot-subscriptions") {
  await runBotSubscriptions();
} else if (caseId === "bot-restore-telemetry") {
  await runBotRestoreTelemetry();
} else if (caseId === "bot-live-reconciliation") {
  await runBotLiveReconciliation();
} else if (caseId === "bot-order-risk") {
  await runBotOrderRisk();
} else if (caseId === "bot-cleanup-faults") {
  await runBotCleanupFaults();
} else {
  throw new Error(`unknown runtime driver case: ${String(caseId)}`);
}

const orderExerciseCases = new Set([
  "bot-order-risk",
  "portfolio-manager-paper",
  "portfolio-manager-authoritative",
  "portfolio-manager-lifecycle",
]);
if (orderExerciseCases.has(caseId)) {
  assertCondition(placeOrderLedger.length > 0, `${caseId} did not exercise the injected placeOrder boundary`);
} else {
  assertCondition(placeOrderLedger.length === 0, `${caseId} unexpectedly exercised placeOrder`);
}
networkGuard.assertNoAttempts();

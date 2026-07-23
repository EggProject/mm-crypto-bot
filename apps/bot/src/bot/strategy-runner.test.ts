/**
 * apps/bot/src/bot/strategy-runner.test.ts
 *
 * A `StrategyRunner` és a `defaultSizingFn` unit tesztjei.
 */

import { describe, expect, it } from "bun:test";
import { asSymbol, type Ohlcv, type Symbol as ExchangeSymbol, type Ticker, type Timeframe } from "@mm-crypto-bot/exchange";
// Phase 66: `MockExchangeFeed` is test-only — import from the
// `@exchange-testing/*` path alias (see tsconfig.base.json).
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import type {
  PositionManagementContext,
  PositionUpdate,
  Strategy,
  StrategyContext,
  StrategySignal,
} from "@mm-crypto-bot/core";

import { OrderManager } from "./order-manager.js";
import { PositionManager } from "./position-manager.js";
import { StrategyRunner, defaultSizingFn, runnerStatsToState } from "./strategy-runner.js";
import { createStrategyInstances } from "../config/strategy-registry.js";
import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";
import { RiskManager } from "../risk/risk-manager.js";

function makeSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
}

/**
 * `FixedSignalStrategy` — a `Strategy` interface minimális implementációja,
 * ami minden `onCandle` hívásra egy fix jelet ad vissza.
 */
class FixedSignalStrategy implements Strategy {
  readonly name = "fixed-signal";
  readonly timeframes = ["15m"] as const;
  private readonly _signal: StrategySignal;
  public onCandleCallCount = 0;

  public constructor(signal: StrategySignal) {
    this._signal = signal;
  }

  public onCandle(_ctx: StrategyContext): StrategySignal {
    this.onCandleCallCount++;
    return this._signal;
  }

  public warmup(): number {
    return 0;
  }
}

/**
 * `ForceExitStrategy` — a `Strategy` interface implementációja, ami
 * minden `onCandle` hívásra egy fix signalt ad, ÉS minden
 * `onOpenPositionUpdate` hívásra `forceExit: true`-t. A Phase 67
 * position-check + `onOpenPositionUpdate` wire-up tesztelésére.
 */
class ForceExitStrategy implements Strategy {
  readonly name = "force-exit-strategy";
  readonly timeframes = ["15m"] as const;
  private readonly _signal: StrategySignal;
  public onCandleCallCount = 0;
  public onOpenPositionUpdateCallCount = 0;

  public constructor(signal: StrategySignal) {
    this._signal = signal;
  }

  public onCandle(_ctx: StrategyContext): StrategySignal {
    this.onCandleCallCount++;
    return this._signal;
  }

  public onOpenPositionUpdate(_ctx: PositionManagementContext): PositionUpdate {
    this.onOpenPositionUpdateCallCount++;
    return { forceExit: true, reason: "trend_reversal" };
  }

  public warmup(): number {
    return 0;
  }
}

function pushTickerTick(feed: MockExchangeFeed, symbol: ExchangeSymbol, last: number): void {
  const ticker: Ticker = {
    symbol,
    timestamp: Date.now(),
    bid: last - 1,
    ask: last + 1,
    last,
    baseVolume: 100,
    quoteVolume: 100 * last,
  };
  feed.pushEvent({ kind: "ticker", payload: ticker });
}

function pushOhlcvTick(feed: MockExchangeFeed, symbol: ExchangeSymbol, timeframe: Timeframe, candle: Ohlcv): void {
  feed.pushEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe, candle },
  });
}

describe("StrategyRunner", () => {
  // ---------------------------------------------------------------------------
  // 1) defaultSizingFn computes qty correctly
  // ---------------------------------------------------------------------------
  it("defaultSizingFn returns equity * riskPerTrade / price", () => {
    const qty = defaultSizingFn({
      signal: { side: "buy", confidence: 1, reason: "test", stopLoss: 0, takeProfit: 0 },
      symbol: makeSymbol(),
      referencePrice: 60_000,
      equityUsd: 10_000,
      riskPerTrade: 0.01,
    });
    // 10_000 * 0.01 / 60_000 = 0.001666...
    expect(qty).toBeCloseTo(0.00166, 4);
  });

  // ---------------------------------------------------------------------------
  // 2) defaultSizingFn returns 0 for invalid price
  // ---------------------------------------------------------------------------
  it("defaultSizingFn returns 0 for invalid price", () => {
    const qty = defaultSizingFn({
      signal: { side: "buy", confidence: 1, reason: "test", stopLoss: 0, takeProfit: 0 },
      symbol: makeSymbol(),
      referencePrice: 0,
      equityUsd: 10_000,
      riskPerTrade: 0.01,
    });
    expect(qty).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 3) onFeedEvent processes ticker events
  // ---------------------------------------------------------------------------
  it("onFeedEvent processes ticker events", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
    });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["test-strategy" as const, { kind: "strategy" as const, name: "test-strategy" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    // Subscribe to the feed so pushEvent delivers.
    await feed.subscribeTicker(makeSymbol(), (event) => {
      void runner.onFeedEvent(event);
    });
    pushTickerTick(feed, makeSymbol(), 60_000);
    pushTickerTick(feed, makeSymbol(), 61_000);
    await new Promise<void>((r) => {
      setTimeout(r, 10);
    });
    const stats = runner.getStats();
    expect(stats.ticksProcessed).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // 4) ohlcv event triggers strategy and places an order
  // ---------------------------------------------------------------------------
  it("ohlcv event triggers strategy.onCandle and places order", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 100_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
    });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["test-strategy" as const, { kind: "strategy" as const, name: "test-strategy" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    await feed.subscribeOhlcv(makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_200, 100];
    pushOhlcvTick(feed, makeSymbol(), "15m", candle);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });
    const stats = runner.getStats();
    expect(stats.totalSignals).toBe(1);
    expect(pm.getPositionCount()).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 5) Disabled symbols are skipped
  // ---------------------------------------------------------------------------
  it("skips ohlcv events for symbols not in enabledSymbols", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
    });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["test-strategy" as const, { kind: "strategy" as const, name: "test-strategy" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["ETH/USDC"], // BTC not enabled
    });
    await feed.subscribeOhlcv(makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_200, 100];
    pushOhlcvTick(feed, makeSymbol(), "15m", candle);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });
    const stats = runner.getStats();
    expect(stats.totalSignals).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 6) getActiveStrategyNames returns strategy names
  // ---------------------------------------------------------------------------
  it("getActiveStrategyNames returns the strategy names", () => {
    const feed = new MockExchangeFeed();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 0.5,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["a" as const, { kind: "strategy" as const, name: "a" as const, instance: strategy as unknown as Strategy }],
      ["b" as const, { kind: "strategy" as const, name: "b" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    expect(runner.getActiveStrategyNames()).toEqual(["a", "b"]);
  });

  // ---------------------------------------------------------------------------
  // 7) Wire with createStrategyInstances (default config, no funding source)
  // ---------------------------------------------------------------------------
  it("works with createStrategyInstances for the default config (without dydx)", () => {
    const config: BotConfig = {
      ...DEFAULT_BOT_CONFIG,
      strategies: {
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    };
    const instances = createStrategyInstances(config);
    expect(instances.size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 8) runnerStatsToState — currently a no-op pass-through
  // ---------------------------------------------------------------------------
  it("runnerStatsToState passes the state through unchanged", () => {
    const state = {
      version: 1 as const,
      savedAt: 0,
      equityUsd: 10_000,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    const stats = {
      activeStrategies: [],
      totalSignalsEmitted: 0,
      totalSignalsSuppressed: 0,
      lastSignalTime: null,
    };
    const result = runnerStatsToState(stats, state);
    // Pass-through semantics: same shape, same counter reference.
    expect(result).toEqual(state);
    expect(result.counters).toBe(state.counters);
  });

  // ---------------------------------------------------------------------------
  // 9) setRiskManager / riskManager wiring — Phase 37 Track 1
  // ---------------------------------------------------------------------------
  it("setRiskManager attaches and detaches the risk manager", () => {
    const feed = new MockExchangeFeed();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const runner = new StrategyRunner({
      instances: new Map(),
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    const rm = new RiskManager({
      trailingStop: { enabled: false, atrPeriod: 14, atrMultiplier: 3.0, side: "both" },
      kelly: { enabled: true, fraction: 0.25, windowSize: 50, minTrades: 5, fallbackFraction: 0.01, maxFraction: 0.1 },
      drawdownScaler: { enabled: false, maxDdPct: 0.20, initialEquity: 10_000 },
    });
    runner.setRiskManager(rm);
    runner.setRiskManager(null);
    runner.setRiskManager(rm);
    // No-op: detaching and re-attaching is supported.
  });

  it("riskManager overrides sizing when set", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 100_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["fixed-signal" as const, { kind: "strategy" as const, name: "fixed-signal" as const, instance: strategy as unknown as Strategy }],
    ]);
    const symbol = makeSymbol();
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    const rm = new RiskManager({
      trailingStop: { enabled: false, atrPeriod: 14, atrMultiplier: 3.0, side: "both" },
      kelly: { enabled: true, fraction: 0.25, windowSize: 50, minTrades: 5, fallbackFraction: 0.02, maxFraction: 0.1 },
      drawdownScaler: { enabled: false, maxDdPct: 0.20, initialEquity: 10_000 },
    });
    runner.setRiskManager(rm);
    await feed.subscribeOhlcv(symbol, "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_000, 100];
    pushOhlcvTick(feed, symbol, "15m", candle);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    // RiskManager path → fallback 0.02 (cold-start, no trades yet)
    // → quantity = 0.02 × 100_000 / 60_000 ≈ 0.0333
    const pos = pm.getPosition("fixed-signal", symbol, "long");
    expect(pos).toBeDefined();
    expect(pos?.quantity).toBeCloseTo(0.0333, 4);
  });

  it("drawdown scaler kill region blocks new orders when riskManager is set", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 100_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["fixed-signal" as const, { kind: "strategy" as const, name: "fixed-signal" as const, instance: strategy as unknown as Strategy }],
    ]);
    const symbol = makeSymbol();
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    const rm = new RiskManager({
      trailingStop: { enabled: false, atrPeriod: 14, atrMultiplier: 3.0, side: "both" },
      kelly: { enabled: false, fraction: 0.25, windowSize: 50, minTrades: 5, fallbackFraction: 0.01, maxFraction: 0.1 },
      drawdownScaler: { enabled: true, maxDdPct: 0.20, initialEquity: 10_000 },
    });
    // Pre-warm equity to a kill-region value
    rm.onEquityUpdate(7_000); // -30% from 10k = 150% of 20% → kill
    runner.setRiskManager(rm);
    await feed.subscribeOhlcv(symbol, "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_000, 100];
    pushOhlcvTick(feed, symbol, "15m", candle);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    // Drawdown scaler in kill region → 0 size → no position
    expect(pm.getPositionCount()).toBe(0);
  });

  // ===========================================================================
  // Phase 67 — position-skip + onOpenPositionUpdate force-exit
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // 10) ohlcv with existing position on SAME side does NOT open a new position
  //     (the "donchian_pivot_composition never-closes" bug fix)
  // ---------------------------------------------------------------------------
  it("Phase 67: ohlcv with existing same-side position does NOT open a new one", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 100_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
    });
    // Pre-populate a long position for (test-strategy, BTC/USDC).
    pm.openPosition("test-strategy", makeSymbol(), "long", 0.1, 60_000, 1);
    expect(pm.getPositionCount()).toBe(1);

    const strategy = new FixedSignalStrategy({
      side: "buy", // same side as the existing long → should be SKIPPED
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["test-strategy" as const, { kind: "strategy" as const, name: "test-strategy" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    await feed.subscribeOhlcv(makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });

    // Send 3 OHLCV ticks with buy signals. The existing long should
    // stay unchanged — NO new positions should be opened, NO entry
    // price averaging should occur.
    for (let i = 0; i < 3; i++) {
      const candle: Ohlcv = [Date.now() + i * 1000, 60_000, 60_500, 59_500, 60_200, 100];
      pushOhlcvTick(feed, makeSymbol(), "15m", candle);
      await new Promise<void>((r) => {
        setTimeout(r, 20);
      });
    }

    // Position count is STILL 1 (no new position opened).
    expect(pm.getPositionCount()).toBe(1);
    // The existing long is unchanged (entry price still 60_000).
    const pos = pm.getPosition("test-strategy", makeSymbol(), "long");
    expect(pos?.entryPrice).toBe(60_000);
    expect(pos?.quantity).toBeCloseTo(0.1, 8);
    // `onCandle` is STILL called every tick (state freshness).
    expect(strategy.onCandleCallCount).toBe(3);
    // `totalSignals` is 0 because the new-signal path was gated.
    // (FixedSignalStrategy always returns a signal, but the runner
    // never reached `handleSignal`.)
    expect(runner.getStats().totalSignals).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 11) ohlcv with existing position on OPPOSITE side does NOT open a new one
  //     (close-on-opposite-signal is OUT of Phase 67 scope; the existing
  //     position stays open until SL/TP/trailing-stop/portfolio-stop closes it)
  // ---------------------------------------------------------------------------
  it("Phase 67: ohlcv with existing opposite-side position does NOT open a new one", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 100_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
    });
    // Pre-populate a long position.
    pm.openPosition("test-strategy", makeSymbol(), "long", 0.1, 60_000, 1);
    expect(pm.getPositionCount()).toBe(1);

    const strategy = new FixedSignalStrategy({
      side: "sell", // opposite side as the existing long
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["test-strategy" as const, { kind: "strategy" as const, name: "test-strategy" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    await feed.subscribeOhlcv(makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });

    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_200, 100];
    pushOhlcvTick(feed, makeSymbol(), "15m", candle);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });

    // Position count is STILL 1 (no new short position opened).
    expect(pm.getPositionCount()).toBe(1);
    // The long is still open.
    const pos = pm.getPosition("test-strategy", makeSymbol(), "long");
    expect(pos).toBeDefined();
    // No new short.
    const shortPos = pm.getPosition("test-strategy", makeSymbol(), "short");
    expect(shortPos).toBeUndefined();
    // `onCandle` was called once.
    expect(strategy.onCandleCallCount).toBe(1);
    // `totalSignals` is 0 (gated).
    expect(runner.getStats().totalSignals).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 12) onOpenPositionUpdate forceExit: true closes the position
  // ---------------------------------------------------------------------------
  it("Phase 67: onOpenPositionUpdate forceExit closes the open position", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 100_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
    });
    // Pre-populate a long position.
    pm.openPosition("test-strategy", makeSymbol(), "long", 0.1, 60_000, 1);
    expect(pm.getPositionCount()).toBe(1);

    const strategy = new ForceExitStrategy({
      side: "buy",
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["test-strategy" as const, { kind: "strategy" as const, name: "test-strategy" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    await feed.subscribeOhlcv(makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });

    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_200, 100];
    pushOhlcvTick(feed, makeSymbol(), "15m", candle);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });

    // The position was force-closed by the strategy.
    expect(pm.getPositionCount()).toBe(0);
    // onOpenPositionUpdate was called once.
    expect(strategy.onOpenPositionUpdateCallCount).toBe(1);
    // onCandle was also called once.
    expect(strategy.onCandleCallCount).toBe(1);
    // The closed trade is recorded.
    const closed = pm.getClosedTrades();
    expect(closed.length).toBe(1);
    expect(closed[0]?.side).toBe("long");
  });

  // ---------------------------------------------------------------------------
  // 13) Phase 67 regression: getActiveStrategyNames + getStats work after fix
  // ---------------------------------------------------------------------------
  it("Phase 67: getActiveStrategyNames and getStats still work with position-skip", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 100_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
    });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["a" as const, { kind: "strategy" as const, name: "a" as const, instance: strategy as unknown as Strategy }],
      ["b" as const, { kind: "strategy" as const, name: "b" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    expect(runner.getActiveStrategyNames()).toEqual(["a", "b"]);

    // Run a tick; verify stats are sensible.
    await feed.subscribeOhlcv(makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_200, 100];
    pushOhlcvTick(feed, makeSymbol(), "15m", candle);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });

    const stats = runner.getStats();
    expect(stats.ticksProcessed).toBe(1);
    expect(stats.totalSignals).toBe(2); // a + b both fired
    expect(stats.activeStrategies).toEqual(["a", "b"]);
    // Two DIFFERENT strategies, same symbol — each gets its own
    // position (position-skip is per (strategy, symbol), not per
    // symbol). 2 positions opened, both at entry 60_200.
    expect(pm.getPositionCount()).toBe(2);
  });
});

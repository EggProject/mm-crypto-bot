import { makeSymbol, type Candle } from "@mm-crypto-bot/shared";
import { ExactRational } from "@mm-crypto-bot/numeric";

import type { PositionManagementContext, StrategyContext } from "../types.js";
import { DydxCexCarryStrategy } from "./dydx-cex-carry.js";
import type { CarryMarket, DEFAULT_DYDX_CEX_CARRY_CONFIG, DydxFundingSource } from "./dydx-cex-carry.js";
import type { BybitEuSpotFillSimulator } from "./dydx-cex-carry.paper-trade.js";
import type { FundingSnapshot } from "./funding-snapshot.js";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const FIXED_NOW = Date.UTC(2026, 6, 1, 0, 0, 0);

export class MockFundingSource implements DydxFundingSource {
  private subscriptionCount = 0;
  private closeCount = 0;

  staleMsOverride: number | undefined = 0;
  chainBlockTsOverride: number | undefined = FIXED_NOW;
  chainBlockHeightOverride: number | undefined = 1_000_000;
  bybitEuDepthUsdOverride: number | undefined = 200_000;
  lastTickMsOverride: number | undefined = FIXED_NOW;

  subscribe(
    _market: CarryMarket,
    _onTick: (snapshot: { readonly dydx: FundingSnapshot; readonly cex: FundingSnapshot }) => void,
  ): { readonly close: () => void } {
    this.subscriptionCount += 1;
    return {
      close: (): void => {
        this.closeCount += 1;
      },
    };
  }

  lastTickAgeMs(_market: CarryMarket, nowMs: number): number | undefined {
    if (this.staleMsOverride === undefined || this.lastTickMsOverride === undefined) return undefined;
    return this.staleMsOverride > 0 ? this.staleMsOverride : nowMs - this.lastTickMsOverride;
  }

  lastChainBlockHeight(_market: CarryMarket): number | undefined {
    return this.chainBlockHeightOverride;
  }

  lastChainBlockTs(_market: CarryMarket): number | undefined {
    return this.chainBlockTsOverride;
  }

  advanceChainTo(timestampMs: number): void {
    if (this.chainBlockTsOverride === undefined) return;
    this.chainBlockTsOverride = timestampMs;
    this.lastTickMsOverride = timestampMs;
  }

  bybitEuSpotDepthUsd(_market: CarryMarket, _nowMs: number): number | undefined {
    return this.bybitEuDepthUsdOverride;
  }

  health(): { readonly lastTickMs: number | undefined; readonly chainBlockHeight: number | undefined } {
    return { lastTickMs: this.lastTickMsOverride, chainBlockHeight: this.chainBlockHeightOverride };
  }

  get subscriptionCountForTest(): number {
    return this.subscriptionCount;
  }

  get closeCountForTest(): number {
    return this.closeCount;
  }
}

export class MockFillSimulator implements BybitEuSpotFillSimulator {
  midPriceUsdOverride: ExactRational | undefined = ExactRational.from("60000");
  slippageBpsOverride = ExactRational.from("5");
  depthUsdAt1PctOverride: number | undefined = 200_000;

  slippageBps(_notionalUsd: ExactRational, _nowMs: number): ExactRational {
    return this.slippageBpsOverride;
  }

  depthUsdAt1Pct(_nowMs: number): number | undefined {
    return this.depthUsdAt1PctOverride;
  }

  midPriceUsd(_nowMs: number): ExactRational | undefined {
    return this.midPriceUsdOverride;
  }
}

export function mkStrategy(
  fundingSource: MockFundingSource,
  override: Partial<typeof DEFAULT_DYDX_CEX_CARRY_CONFIG> = {},
): DydxCexCarryStrategy {
  return new DydxCexCarryStrategy({ fundingSource, ...override });
}

export function recordReadyCarryObservations(
  strategy: DydxCexCarryStrategy,
  fundingSource: MockFundingSource,
  nowMs = FIXED_NOW,
): void {
  strategy.recordLatencySnapshot(
    { pair: "test-dydx-bybit-btc", sourceJsonPath: "test-support", roundTripMsMax: 0 },
    nowMs,
  );
  strategy.recordBybitEuLiquidity("BTC-USD", fundingSource.bybitEuDepthUsdOverride, nowMs);
}

export function satisfyPreconditions(strategy: DydxCexCarryStrategy, nowMs = FIXED_NOW): void {
  strategy.recordPreconditionReverify("live-divergence", true, nowMs - 8 * DAY);
  strategy.recordPreconditionReverify("chain-incident-clear", true, nowMs - 4 * DAY);
  strategy.recordPreconditionReverify("no-recent-governance", true, nowMs - 15 * DAY);
}

export function mkSnapshot(
  market: CarryMarket = "BTC-USD",
  fundingTime = FIXED_NOW,
  fundingRate = "0",
  markPrice?: string,
): FundingSnapshot {
  if (markPrice === undefined)
    return { fundingTime, symbol: market, fundingRate: ExactRational.from(fundingRate) };
  return {
    fundingTime,
    symbol: market,
    fundingRate: ExactRational.from(fundingRate),
    markPrice: ExactRational.from(markPrice),
  };
}

export function mkCandle(timestamp = FIXED_NOW, close = 60_000): Candle {
  return { timestamp, open: close, high: close + 500, low: close - 500, close, volume: 1000 };
}

export function mkStrategyContext(candleIndex = 25, timestamp = FIXED_NOW): StrategyContext {
  return {
    symbol: makeSymbol("BTC/USDC"),
    timeframe: "1h",
    candleIndex,
    candle: mkCandle(timestamp),
    mtfState: { htf: {}, mtf: {}, ltf: {} },
    pricePrecision: 2,
  };
}

export function mkPositionManagementContext(timestamp = FIXED_NOW): PositionManagementContext {
  return {
    openPosition: {
      side: "buy",
      entryTime: timestamp - HOUR,
      entryPrice: 60_000,
      quantity: 1,
      stopLoss: 59_400,
      takeProfit: 6_000_000,
      holdingBars: 1,
    },
    candle: mkCandle(timestamp),
    candleIndex: 25,
    mtfState: { htf: {}, mtf: {}, ltf: {} },
    pricePrecision: 2,
  };
}

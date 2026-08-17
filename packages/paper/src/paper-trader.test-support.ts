import { MockExchangeFeed, defaultMockTicker } from "./test-helpers.js";
import type { ExchangeFeed, ExchangeFeeConfig, TradingSignal } from "@mm-crypto-bot/shared";
import type { Ticker } from "ccxt";

function throwMissingTestValue(description: string): never {
  throw new Error(`Expected ${description} to be defined`);
}

export function requireTestValue<T>(value: T | null | undefined, description: string): T {
  return value ?? throwMissingTestValue(description);
}

export const DEFAULT_FEE: ExchangeFeeConfig = {
  spotTakerFee: 0.001,
  spotMakerFee: 0.001,
  borrowRatePerDay: 0.0002,
  liquidationFee: 0.02,
  maintenanceMarginRatio: 1,
};
export const ZERO_FEE: ExchangeFeeConfig = { ...DEFAULT_FEE, spotTakerFee: 0 };
export function makeFeed(options: ConstructorParameters<typeof MockExchangeFeed>[0] = {}): MockExchangeFeed {
  return new MockExchangeFeed(options);
}

/**
 * Models a runtime adapter capability absence without changing ExchangeFeed's static contract.
 */
export function makeFeedWithoutWatchTicker(): ExchangeFeed {
  const feed = makeFeed();
  Object.defineProperty(feed, "watchTicker", { configurable: true, value: undefined });
  return feed;
}

/**
 * Creates a ticker whose runtime timestamp is absent for the sequence guard negative case.
 */
export function makeTickerWithoutTimestamp(symbol: string): Ticker {
  const ticker = defaultMockTicker(symbol);
  Object.defineProperty(ticker, "timestamp", { configurable: true, value: undefined });
  return ticker;
}
export function buySignal(overrides: Partial<TradingSignal> = {}): TradingSignal {
  return {
    symbol: "BTC/USDT",
    action: "buy",
    confidence: 0.5,
    reason: "test",
    generatedAt: Date.now(),
    ...overrides,
  };
}
export function sellSignal(overrides: Partial<TradingSignal> = {}): TradingSignal {
  return {
    symbol: "BTC/USDT",
    action: "sell",
    confidence: 0.5,
    reason: "test",
    generatedAt: Date.now(),
    ...overrides,
  };
}

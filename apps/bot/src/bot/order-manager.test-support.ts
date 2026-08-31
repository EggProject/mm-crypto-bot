import { asSymbol, type Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
import type { Position as LeveragePosition, StrategySignal } from "@mm-crypto-bot/core";

import { RecordingLogger } from "@logging-testing";
import { OrderManager as RuntimeOrderManager } from "./order-manager.js";

export class OrderManager extends RuntimeOrderManager {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimeOrderManager>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}

export function makeSignal(side: "buy" | "sell" = "buy"): StrategySignal {
  return {
    side,
    confidence: 0.8,
    reason: "unit-test",
    stopLoss: 0,
    takeProfit: 0,
  };
}

export function makeSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC");
}

export function makePosition(symbol: string, source: string, notional: number): LeveragePosition {
  return { symbol, source, effectiveNotionalUsd: notional };
}

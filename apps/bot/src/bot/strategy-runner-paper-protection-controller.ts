import type { Ohlcv, Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
import type { Strategy } from "@mm-crypto-bot/core";

import type { StrategyName } from "../config/schema.js";
import type { OrderManager } from "./order-manager.js";
import type { PositionManager, PositionSnapshot } from "./position-manager.js";

interface PaperProtection {
  readonly side: "long" | "short";
  readonly stopLoss: number;
  readonly takeProfit: number;
}

export interface StrategyPaperProtectionControllerOptions {
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
}

/**
 * Owns candle-simulated protective exits for paper orders.
 */
export class StrategyPaperProtectionController {
  private readonly protections = new Map<string, PaperProtection>();

  public constructor(private readonly options: StrategyPaperProtectionControllerOptions) {}

  public protectionKey(strategy: string, symbol: ExchangeSymbol): string {
    return `${strategy}\u{0}${symbol}`;
  }

  public setPaperProtection(key: string, protection: PaperProtection): void {
    this.protections.set(key, protection);
  }

  public async enforceProtection(
    strategyName: StrategyName,
    strategy: Strategy,
    position: PositionSnapshot,
    candle: Ohlcv,
  ): Promise<boolean> {
    const key = this.protectionKey(strategyName, position.symbol);
    const protection = this.protections.get(key);
    if (protection === undefined) return false;
    const isStopHit =
      protection.side === "long"
        ? protection.stopLoss > 0 && candle[3] <= protection.stopLoss
        : protection.stopLoss > 0 && candle[2] >= protection.stopLoss;
    const isTargetHit =
      protection.side === "long"
        ? protection.takeProfit > 0 && candle[2] >= protection.takeProfit
        : protection.takeProfit > 0 && candle[3] <= protection.takeProfit;
    if (!isStopHit && !isTargetHit) return false;
    const isStop = isStopHit;
    const trigger = isStop ? protection.stopLoss : protection.takeProfit;
    const fillPrice =
      protection.side === "long"
        ? isStop
          ? Math.min(candle[1], trigger)
          : Math.max(candle[1], trigger)
        : isStop
          ? Math.max(candle[1], trigger)
          : Math.min(candle[1], trigger);
    const closingSide = position.side === "long" ? "sell" : "buy";
    const order = await this.options.orderManager.placeOrder({
      signal: {
        side: closingSide,
        confidence: 1,
        reason: isStop ? "stop_loss" : "take_profit",
        stopLoss: 0,
        takeProfit: 0,
      },
      symbol: position.symbol,
      amount: position.quantity,
      referencePrice: fillPrice,
      type: "market",
      reduceOnly: true,
      strategy: strategyName,
      clientOrderIdHint: `${strategyName}-${isStop ? "sl" : "tp"}`,
    });
    this.options.orderManager.recordFill(order.clientOrderId, order);
    if (order.filled <= 0) return true;
    this.options.positionManager.recordFill({
      strategy: strategyName,
      symbol: position.symbol,
      side: closingSide === "sell" ? "short" : "long",
      quantity: order.filled,
      price: order.average ?? order.price ?? fillPrice,
      leverage: position.leverage,
      timestamp: order.updateTimestamp ?? Date.now(),
    });
    if (order.filled >= position.quantity) {
      this.protections.delete(key);
      strategy.onPositionClosed?.(isStop ? "stop_loss" : "take_profit");
    }
    return true;
  }
}

import type { ClientOrderId, Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
import type { StrategySignal } from "@mm-crypto-bot/core";
import type { Logger } from "@mm-crypto-bot/logging";

import type { StrategyName } from "../config/schema.js";
import type { PortfolioManager } from "../portfolio/index.js";
import type { OrderManager } from "./order-manager.js";
import type { PositionManager, PositionSnapshot } from "./position-manager.js";
import type { NativeProtectionGroup, NativeProtectionInput } from "./strategy-runner.types.js";

interface NativeProtectionMetadata {
  readonly sibling: ClientOrderId | undefined;
  readonly strategy: StrategyName;
  readonly symbol: ExchangeSymbol;
  readonly side: "long" | "short";
  readonly leverage: number;
  readonly kind: "stop_loss" | "take_profit";
  readonly signal: StrategySignal;
  readonly referencePrice: number;
}

function normalizedOrderManagerErrorMessage(error: unknown): string {
  return String(error).replace(/^[^:\n]*:\s*/u, "");
}

export interface StrategyNativeProtectionControllerOptions {
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
  readonly portfolioManager: PortfolioManager | undefined;
  readonly logger: Logger;
  readonly findOpenPosition: (
    strategyName: StrategyName,
    symbol: ExchangeSymbol,
  ) => PositionSnapshot | undefined;
  readonly protectionKey: (strategyName: string, symbol: ExchangeSymbol) => string;
  readonly latestPriceFor: (symbol: ExchangeSymbol) => number | undefined;
  readonly recordPendingRiskClose: (positionId: string, clientOrderId: ClientOrderId) => void;
  readonly setPaperProtection: (
    key: string,
    protection: { readonly side: "long" | "short"; readonly stopLoss: number; readonly takeProfit: number },
  ) => void;
}

export class StrategyNativeProtectionController {
  private readonly nativeProtections = new Map<ClientOrderId, NativeProtectionMetadata>();
  private readonly supersededNativeProtections = new Set<ClientOrderId>();
  private readonly groups = new Map<string, NativeProtectionGroup>();

  public constructor(private readonly options: StrategyNativeProtectionControllerOptions) {}

  public getGroup(key: string): NativeProtectionGroup | undefined {
    return this.groups.get(key);
  }

  public getNativeProtection(clientOrderId: ClientOrderId): NativeProtectionMetadata | undefined {
    return this.nativeProtections.get(clientOrderId);
  }

  public async installProtections(input: NativeProtectionInput): Promise<void> {
    if (this.options.orderManager.isPaperMode()) {
      this.options.setPaperProtection(this.options.protectionKey(input.strategy, input.symbol), {
        side: input.side,
        stopLoss: input.signal.stopLoss,
        takeProfit: input.signal.takeProfit,
      });
      return;
    }
    const current = this.options.findOpenPosition(input.strategy, input.symbol);
    const desired =
      current === undefined
        ? undefined
        : {
            ...input,
            quantity: current.quantity,
            referencePrice: current.currentPrice,
          };
    if (desired === undefined || desired.quantity <= 0) return;
    const key = this.options.protectionKey(input.strategy, input.symbol);
    const existing = this.groups.get(key);
    if (existing !== undefined) {
      existing.desired = desired;
      if (existing.active.size > 0 || existing.cancelPending.size > 0) {
        await this.requestProtectionCancellation(existing);
        return;
      }
      await this.settleProtectionGroup(existing);
      return;
    }
    const group: NativeProtectionGroup = {
      key,
      strategy: input.strategy,
      symbol: input.symbol,
      active: new Set(),
      cancelPending: new Set(),
      desired,
      failSafe: undefined,
      installing: false,
    };
    this.groups.set(key, group);
    await this.settleProtectionGroup(group);
  }

  /**
  Install one pair only when every previous leg has public terminal proof.
  */
  public async createProtectionPair(
    group: NativeProtectionGroup,
    input: NativeProtectionInput,
  ): Promise<void> {
    const current = this.options.findOpenPosition(input.strategy, input.symbol);
    const protectedQuantity = current?.quantity ?? 0;
    if (protectedQuantity <= 0 || (input.signal.stopLoss <= 0 && input.signal.takeProfit <= 0)) return;
    const closingSide = input.side === "long" ? "sell" : "buy";
    const created: { readonly id: ClientOrderId; readonly kind: "stop_loss" | "take_profit" }[] = [];
    try {
      for (const [kind, triggerPrice] of [
        ["stop_loss", input.signal.stopLoss],
        ["take_profit", input.signal.takeProfit],
      ] as const) {
        if (triggerPrice <= 0) continue;
        const order = await this.options.orderManager.placeOrder({
          signal: { side: closingSide, confidence: 1, reason: `native_${kind}`, stopLoss: 0, takeProfit: 0 },
          symbol: input.symbol,
          amount: protectedQuantity,
          referencePrice: input.referencePrice,
          type: "market",
          reduceOnly: true,
          strategy: input.strategy,
          protectiveKind: kind,
          triggerPrice,
          leverage: input.leverage,
          clientOrderIdHint: `${input.strategy}-${kind}`,
        });
        created.push({ id: order.clientOrderId, kind });
      }
      for (const item of created) {
        group.active.add(item.id);
        this.nativeProtections.set(item.id, {
          sibling: created.find((candidate) => candidate.id !== item.id)?.id,
          strategy: input.strategy,
          symbol: input.symbol,
          side: input.side,
          leverage: input.leverage,
          kind: item.kind,
          signal: input.signal,
          referencePrice: input.referencePrice,
        });
      }
    } catch (error) {
      for (const item of created) {
        group.active.add(item.id);
        this.nativeProtections.set(item.id, {
          sibling: created.find((candidate) => candidate.id !== item.id)?.id,
          strategy: input.strategy,
          symbol: input.symbol,
          side: input.side,
          leverage: input.leverage,
          kind: item.kind,
          signal: input.signal,
          referencePrice: input.referencePrice,
        });
      }
      group.desired = undefined;
      group.failSafe = input;
      this.options.logger.error("strategy.protection.place.failed", {
        strategy: input.strategy,
        symbol: input.symbol,
        error: normalizedOrderManagerErrorMessage(error),
      });
      await this.requestProtectionCancellation(group);
      await this.settleProtectionGroup(group);
    }
  }

  public async failSafeClose(input: NativeProtectionInput): Promise<void> {
    const position = this.options.findOpenPosition(input.strategy, input.symbol);
    if (position === undefined) return;
    if (this.options.portfolioManager !== undefined) {
      await this.options.portfolioManager.requestPositionClose(position, "protection_setup_failed");
      return;
    }
    const closingSide = position.side === "long" ? "sell" : "buy";
    const order = await this.options.orderManager.placeOrder({
      signal: {
        side: closingSide,
        confidence: 1,
        reason: "protection_setup_failed",
        stopLoss: 0,
        takeProfit: 0,
      },
      symbol: input.symbol,
      amount: position.quantity,
      referencePrice: input.referencePrice,
      type: "market",
      reduceOnly: true,
      strategy: input.strategy,
      clientOrderIdHint: `${input.strategy}-protection-failsafe`,
    });
    if (order.filled <= 0) {
      this.options.recordPendingRiskClose(position.id, order.clientOrderId);
      this.options.logger.error("strategy.protection.failsafe.unfilled", {
        strategy: input.strategy,
        symbol: input.symbol,
        clientOrderId: order.clientOrderId,
      });
      return;
    }
    this.options.positionManager.recordFill({
      strategy: input.strategy,
      symbol: input.symbol,
      side: closingSide === "sell" ? "short" : "long",
      quantity: order.filled,
      price: order.average ?? order.price ?? input.referencePrice,
      leverage: input.leverage,
      timestamp: order.updateTimestamp ?? Date.now(),
    });
  }

  public async reconcileNativeProtections(symbol: ExchangeSymbol): Promise<void> {
    for (const [id, meta] of this.nativeProtections) {
      if (meta.symbol !== symbol) continue;
      const owner = this.groups.get(this.options.protectionKey(meta.strategy, symbol));
      // A create/cancel REST ACK is not terminal evidence on Bybit.  While a
      // cancel is pending, only the authenticated public order stream may
      // retire the leg (including Filled/cancel races).
      if (owner?.cancelPending.has(id) === true) continue;
      try {
        const { order, deltaFilled } = await this.options.orderManager.reconcileOrder(id, symbol);
        if (deltaFilled > 0) {
          const closingSide = meta.side === "long" ? "sell" : "buy";
          const position = this.options.findOpenPosition(meta.strategy, symbol);
          if (position !== undefined)
            this.options.positionManager.recordFill({
              strategy: meta.strategy,
              symbol,
              side: closingSide === "sell" ? "short" : "long",
              quantity: Math.min(deltaFilled, position.quantity),
              price:
                order.average ?? order.price ?? this.options.latestPriceFor(symbol) ?? position.currentPrice,
              leverage: meta.leverage,
              timestamp: order.updateTimestamp ?? Date.now(),
            });
          const remaining = this.options.findOpenPosition(meta.strategy, symbol);
          const group = this.groups.get(this.options.protectionKey(meta.strategy, symbol));
          if (group !== undefined) {
            group.desired =
              remaining === undefined
                ? undefined
                : {
                    strategy: meta.strategy,
                    symbol,
                    side: meta.side,
                    quantity: remaining.quantity,
                    leverage: meta.leverage,
                    signal: meta.signal,
                    referencePrice: remaining.currentPrice,
                  };
            await this.requestProtectionCancellation(group);
          }
        }
        const group = this.groups.get(this.options.protectionKey(meta.strategy, symbol));
        if (group !== undefined && order.status !== "open") this.retireProtectionLeg(group, id);
        if (group?.desired !== undefined && group.active.size > 0)
          await this.requestProtectionCancellation(group);
        if (group !== undefined) await this.settleProtectionGroup(group);
      } catch (error) {
        this.options.logger.warn("strategy.protection.reconciliation.failed", {
          id,
          error: normalizedOrderManagerErrorMessage(error),
        });
      }
    }
  }

  /**
  Request cancellation, but keep every leg authoritative until public terminal proof.
  */
  public async requestProtectionCancellation(group: NativeProtectionGroup): Promise<void> {
    for (const id of group.active) {
      if (group.cancelPending.has(id)) continue;
      group.cancelPending.add(id);
      try {
        await this.options.orderManager.cancelOrder(id, group.symbol);
      } catch (error) {
        group.cancelPending.delete(id);
        this.options.logger.warn("strategy.protection.cancel.unresolved", {
          id,
          strategy: group.strategy,
          symbol: group.symbol,
          error: normalizedOrderManagerErrorMessage(error),
        });
      }
    }
  }

  public retireProtectionLeg(group: NativeProtectionGroup, id: ClientOrderId): void {
    group.active.delete(id);
    group.cancelPending.delete(id);
    this.supersededNativeProtections.add(id);
    if (this.supersededNativeProtections.size <= 1000) return;
    for (const oldest of this.supersededNativeProtections) {
      this.supersededNativeProtections.delete(oldest);
      this.nativeProtections.delete(oldest);
      break;
    }
  }

  public async settleProtectionGroup(group: NativeProtectionGroup): Promise<void> {
    if (group.installing || group.active.size > 0 || group.cancelPending.size > 0) return;
    if (group.failSafe !== undefined) {
      const failSafe = group.failSafe;
      group.failSafe = undefined;
      await this.failSafeClose(failSafe);
      this.groups.delete(group.key);
      return;
    }
    const desired = group.desired;
    group.desired = undefined;
    if (desired === undefined) {
      this.groups.delete(group.key);
      return;
    }
    group.installing = true;
    try {
      await this.createProtectionPair(group, desired);
    } finally {
      group.installing = false;
    }
    if (group.active.size === 0 && group.cancelPending.size === 0) {
      await this.settleProtectionGroup(group);
    }
  }
}

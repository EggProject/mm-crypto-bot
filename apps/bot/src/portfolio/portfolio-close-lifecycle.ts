import type {
  ClientOrderId,
  ExchangePosition,
  MarketMeta,
  Symbol as ExchangeSymbol,
} from "@mm-crypto-bot/exchange";
import type { Logger } from "@mm-crypto-bot/logging";

import type { OrderLifecycleEvent, OrderManager } from "../bot/order-manager.js";
import type { PositionManager, PositionSnapshot } from "../bot/position-manager.js";

interface PendingCloseJournal {
  readonly key: string;
  readonly clientOrderId: ClientOrderId;
  readonly symbol: ExchangeSymbol;
  readonly reason: string;
  readonly positionIds: readonly string[];
  readonly requestedQuantity: number;
}

export function managedErrorMessage(error: unknown): string {
  return String(Reflect.get(new Object(error), "message"));
}

export interface PortfolioCloseLifecycleOptions {
  readonly logger: Logger;
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
  readonly terminalCloseEvidenceLimit: number;
}

export class PortfolioCloseLifecycle {
  private readonly logger: Logger;
  private readonly orderManager: OrderManager;
  private readonly positionManager: PositionManager;
  private readonly terminalCloseEvidenceLimit: number;
  private readonly pendingCloses = new Map<string, PendingCloseJournal>();
  private readonly pendingCloseByOrder = new Map<ClientOrderId, PendingCloseJournal>();
  private readonly terminalCloseEvidence = new Map<
    ClientOrderId,
    {
      readonly journal: PendingCloseJournal;
      readonly status: "closed" | "canceled";
      readonly filled: number;
    }
  >();

  public constructor(options: PortfolioCloseLifecycleOptions) {
    this.logger = options.logger;
    this.orderManager = options.orderManager;
    this.positionManager = options.positionManager;
    this.terminalCloseEvidenceLimit = options.terminalCloseEvidenceLimit;
  }

  public getPendingCloseOrderIds(): Set<ClientOrderId> {
    const orderIds = new Set<ClientOrderId>();
    this.pendingCloses.forEach((pendingClose) => {
      orderIds.add(pendingClose.clientOrderId);
    });
    return orderIds;
  }

  public getPendingCloseCount(): number {
    return this.pendingCloses.size;
  }

  public async verifyAuthoritativeFlat(
    symbols: readonly ExchangeSymbol[],
    marketMeta: ReadonlyMap<ExchangeSymbol, MarketMeta>,
  ): Promise<{ readonly flat: boolean; readonly failures: readonly string[] }> {
    const failures: string[] = [];
    let isDerivativeFlat = false;
    try {
      const positions = await this.orderManager.getAuthoritativePositions(symbols);
      isDerivativeFlat = positions.every((position) => !(position.quantity > 0));
    } catch (error) {
      failures.push(`authoritative position verification: ${managedErrorMessage(error)}`);
    }

    let isSpotFlat = false;
    try {
      const authoritativeBalances = await this.orderManager.getAuthoritativeBalances();
      const balances = new Map(authoritativeBalances.map((balance) => [balance.currency, balance.total]));
      isSpotFlat = true;
      marketMeta.forEach((meta) => {
        if (meta.isSpot !== true) return;
        const quantity = this.roundSpotQuantity(balances.get(meta.base) ?? 0, meta);
        if (this.isTradableSpotQuantity(quantity, meta, undefined)) isSpotFlat = false;
      });
    } catch (error) {
      failures.push(`authoritative balance verification: ${managedErrorMessage(error)}`);
    }

    return { flat: isDerivativeFlat && isSpotFlat && failures.length === 0, failures };
  }

  public async placeCloseOrder(
    pos: PositionSnapshot,
    authoritativeQuantity: number | undefined,
    reason: string,
    journalKey?: string,
  ): Promise<boolean> {
    const closingSide = pos.side === "long" ? "sell" : "buy";
    const referencePrice = pos.currentPrice;
    const key = journalKey ?? `local:${pos.id}`;
    const journal = this.pendingCloses.get(key);
    if (journal !== undefined) {
      try {
        const { order, deltaFilled } = await this.orderManager.reconcileOrder(
          journal.clientOrderId,
          pos.symbol,
        );
        this.applyCloseDelta(journal.positionIds, order, deltaFilled);
        const remaining = this.positionManager.getPositions().find((item) => item.id === pos.id);
        if (remaining === undefined) {
          this.finishCloseJournal(journal, "closed", order.filled);
          return true;
        }
        if (order.status === "open") return false;
        // Terminal partial/cancel: retry only the confirmed remainder below.
        this.finishCloseJournal(journal, order.status, order.filled);
        pos = remaining;
      } catch (error) {
        this.logger.warn("portfolio.close.reconciliation.failed", {
          positionId: pos.id,
          clientOrderId: journal.clientOrderId,
          error: managedErrorMessage(error),
        });
        return false;
      }
    }
    const amount = Math.min(authoritativeQuantity ?? pos.quantity, pos.quantity);
    try {
      const order = await this.orderManager.placeOrder({
        signal: {
          side: closingSide,
          confidence: 1,
          reason,
          stopLoss: 0,
          takeProfit: 0,
        },
        symbol: pos.symbol,
        amount,
        referencePrice,
        type: "market",
        reduceOnly: true,
        strategy: pos.strategy,
        leverage: pos.leverage,
        clientOrderIdHint: `pf-stop-${pos.strategy}`,
      });
      this.orderManager.recordFill(order.clientOrderId, order);
      if (order.status === "open")
        this.openCloseJournal({
          key,
          clientOrderId: order.clientOrderId,
          symbol: pos.symbol,
          reason,
          positionIds: [pos.id],
          requestedQuantity: amount,
        });
      if (order.filled <= 0) {
        this.logger.warn("portfolio.close.unfilled", {
          strategy: pos.strategy,
          symbol: pos.symbol,
          clientOrderId: order.clientOrderId,
        });
        return false;
      }
      this.positionManager.recordFill({
        strategy: pos.strategy,
        symbol: pos.symbol,
        side: closingSide === "sell" ? "short" : "long",
        quantity: order.filled,
        price: order.average ?? order.price ?? referencePrice,
        leverage: pos.leverage,
        timestamp: order.updateTimestamp ?? Date.now(),
      });
      this.logger.info("portfolio.close.order.placed", {
        strategy: pos.strategy,
        symbol: pos.symbol,
        side: pos.side,
        closingSide,
        quantity: amount,
        referencePrice,
      });
      return this.positionManager.getPositions().every((item) => item.id !== pos.id);
    } catch (error) {
      this.logger.error("portfolio.close.order.failed", {
        strategy: pos.strategy,
        symbol: pos.symbol,
        side: pos.side,
        quantity: pos.quantity,
        error: managedErrorMessage(error),
      });
      return false;
    }
  }

  /**
  Shared close entry point for force-exit and trailing/emergency owners.
  */
  public async requestPositionClose(
    pos: PositionSnapshot,
    reason: string,
    requiresAuthoritativeEmergencyState: boolean,
  ): Promise<boolean> {
    if (requiresAuthoritativeEmergencyState && !this.orderManager.isPaperMode()) {
      try {
        const meta = await this.orderManager.getMarketMeta(pos.symbol);
        const key =
          meta.isSpot === true
            ? this.spotCloseKey(pos.symbol)
            : this.derivativeCloseKey(pos.symbol, pos.side);
        return await this.placeCloseOrder(pos, undefined, reason, key);
      } catch (error) {
        this.logger.error("portfolio.close.key.unavailable", {
          positionId: pos.id,
          symbol: pos.symbol,
          error: managedErrorMessage(error),
        });
        return false;
      }
    }
    return this.placeCloseOrder(pos, undefined, reason, `local:${pos.id}`);
  }

  public applyCloseDelta(
    positionIds: readonly string[],
    order: OrderLifecycleEvent["order"],
    deltaFilled: number,
    executionPrice?: number,
  ): void {
    if (deltaFilled <= 0) return;
    let unallocated = deltaFilled;
    for (const positionId of positionIds) {
      if (unallocated <= 0) break;
      const position = this.positionManager.getPositions().find((item) => item.id === positionId);
      if (position === undefined) continue;
      const closingSide = position.side === "long" ? "sell" : "buy";
      const quantity = Math.min(unallocated, position.quantity);
      this.positionManager.recordFill({
        strategy: position.strategy,
        symbol: position.symbol,
        side: closingSide === "sell" ? "short" : "long",
        quantity,
        price: executionPrice ?? order.average ?? order.price ?? position.currentPrice,
        leverage: position.leverage,
        timestamp: order.updateTimestamp ?? Date.now(),
      });
      unallocated -= quantity;
    }
  }

  public applyCloseLifecycle(event: OrderLifecycleEvent): void {
    const journal = this.pendingCloseByOrder.get(event.order.clientOrderId);
    if (journal === undefined) {
      const terminal = this.terminalCloseEvidence.get(event.order.clientOrderId);
      if (terminal === undefined || event.deltaFilled <= 0) return;
      // Bybit documents late Filled/cancel races. Keep terminal ownership so a
      // late execution is still booked, then cancel any replacement close for
      // the same authoritative exposure before it can over-close.
      this.applyCloseDelta(
        terminal.journal.positionIds,
        event.order,
        event.deltaFilled,
        event.kind === "execution" ? event.execution.price : undefined,
      );
      const replacement = this.pendingCloses.get(terminal.journal.key);
      if (replacement !== undefined && replacement.clientOrderId !== event.order.clientOrderId) {
        void this.orderManager
          .cancelOrder(replacement.clientOrderId, replacement.symbol)
          .catch((error: unknown) => {
            this.logger.error("portfolio.close.replacement.cancel.failed", {
              key: terminal.journal.key,
              clientOrderId: replacement.clientOrderId,
              error: managedErrorMessage(error),
            });
          });
      }
      return;
    }
    this.applyCloseDelta(
      journal.positionIds,
      event.order,
      event.deltaFilled,
      event.kind === "execution" ? event.execution.price : undefined,
    );
    if (event.order.status !== "open")
      this.finishCloseJournal(journal, event.order.status, event.order.filled);
  }
  public openCloseJournal(journal: PendingCloseJournal): void {
    this.pendingCloses.set(journal.key, journal);
    this.pendingCloseByOrder.set(journal.clientOrderId, journal);
  }

  public finishCloseJournal(
    journal: PendingCloseJournal,
    status: "closed" | "canceled",
    filled: number,
  ): void {
    this.pendingCloses.delete(journal.key);
    this.pendingCloseByOrder.delete(journal.clientOrderId);
    this.terminalCloseEvidence.set(journal.clientOrderId, { journal, status, filled });
    if (this.terminalCloseEvidence.size > this.terminalCloseEvidenceLimit) {
      for (const oldest of this.terminalCloseEvidence.keys()) {
        this.terminalCloseEvidence.delete(oldest);
        break;
      }
    }
  }

  /**
  Flattens a derivative position the venue reports but the local book lacks.
  */
  public async placeVenueOnlyClose(
    position: ExchangePosition,
    positionIds: readonly string[],
  ): Promise<boolean> {
    const side = position.side === "long" ? "sell" : "buy";
    const price = position.markPrice ?? position.entryPrice;
    if (price === undefined || price <= 0) return false;
    const key = this.derivativeCloseKey(position.symbol, position.side);
    const pending = await this.reconcilePendingVenueClose(key, position.symbol);
    if (pending === "open" || pending === "unavailable") return false;
    try {
      const order = await this.orderManager.placeOrder({
        signal: { side, confidence: 1, reason: "venue-only-emergency-close", stopLoss: 0, takeProfit: 0 },
        symbol: position.symbol,
        amount: position.quantity,
        referencePrice: price,
        type: "market",
        reduceOnly: true,
        clientOrderIdHint: positionIds.length > 0 ? "pf-stop-authoritative" : "venue-emergency",
      });
      this.orderManager.recordFill(order.clientOrderId, order);
      if (order.status === "open")
        this.openCloseJournal({
          key,
          clientOrderId: order.clientOrderId,
          symbol: position.symbol,
          reason: "venue-only-emergency-close",
          positionIds,
          requestedQuantity: position.quantity,
        });
      this.applyCloseDelta(positionIds, order, order.filled);
      return order.filled >= position.quantity;
    } catch (error) {
      this.logger.error("portfolio.close.venue.failed", {
        symbol: position.symbol,
        error: managedErrorMessage(error),
      });
      return false;
    }
  }

  /**
  Sells inventory which exists at the venue but has no local position.
  */
  public async placeVenueOnlySpotClose(
    symbol: ExchangeSymbol,
    quantity: number,
    meta: MarketMeta,
    positionIds: readonly string[],
  ): Promise<boolean> {
    const key = this.spotCloseKey(symbol);
    const pending = await this.reconcilePendingVenueClose(key, symbol);
    if (pending === "open" || pending === "unavailable") return false;
    try {
      const ticker = await this.orderManager.getTickerSnapshot(symbol);
      const referencePrice = ticker.bid > 0 ? ticker.bid : ticker.last;
      if (!this.isTradableSpotQuantity(quantity, meta, referencePrice)) return false;
      const order = await this.orderManager.placeOrder({
        signal: {
          side: "sell",
          confidence: 1,
          reason: "venue-only-spot-emergency-close",
          stopLoss: 0,
          takeProfit: 0,
        },
        symbol,
        amount: quantity,
        referencePrice,
        type: "market",
        // Bybit spot does not accept reduceOnly; its adapter intentionally
        // omits this flag while the sell quantity is derived from balances.
        reduceOnly: true,
        clientOrderIdHint: positionIds.length > 0 ? "pf-stop-authoritative" : "venue-spot-emergency",
      });
      this.orderManager.recordFill(order.clientOrderId, order);
      if (order.status === "open")
        this.openCloseJournal({
          key,
          clientOrderId: order.clientOrderId,
          symbol,
          reason: "venue-only-spot-emergency-close",
          positionIds,
          requestedQuantity: quantity,
        });
      this.applyCloseDelta(positionIds, order, order.filled);
      return order.filled >= quantity;
    } catch (error) {
      this.logger.error("portfolio.close.spot.venue.failed", {
        symbol: symbol,
        error: managedErrorMessage(error),
      });
      return false;
    }
  }

  public async reconcilePendingVenueClose(
    key: string,
    symbol: ExchangeSymbol,
  ): Promise<"none" | "open" | "terminal" | "unavailable"> {
    const journal = this.pendingCloses.get(key);
    if (journal === undefined) return "none";
    try {
      const { order, deltaFilled } = await this.orderManager.reconcileOrder(journal.clientOrderId, symbol);
      this.applyCloseDelta(journal.positionIds, order, deltaFilled);
      if (order.status === "open") return "open";
      this.finishCloseJournal(journal, order.status, order.filled);
      return "terminal";
    } catch (error) {
      this.logger.warn("portfolio.close.authoritative.reconciliation.failed", {
        key,
        clientOrderId: journal.clientOrderId,
        error: managedErrorMessage(error),
      });
      return "unavailable";
    }
  }

  public derivativeCloseKey(symbol: ExchangeSymbol, side: "long" | "short"): string {
    return `derivative:${symbol}:${side}`;
  }

  public spotCloseKey(symbol: ExchangeSymbol): string {
    return `spot:${symbol}`;
  }

  public roundSpotQuantity(quantity: number, meta: MarketMeta): number {
    if (!Number.isFinite(quantity) || quantity <= 0) return 0;
    const factor = 10 ** meta.amountPrecision;
    return Math.floor((quantity + Number.EPSILON) * factor) / factor;
  }

  public isTradableSpotQuantity(quantity: number, meta: MarketMeta, price: number | undefined): boolean {
    if (!Number.isFinite(quantity) || quantity < meta.minAmount) return false;
    return price === undefined || meta.minCost <= 0 || quantity * price >= meta.minCost;
  }
}

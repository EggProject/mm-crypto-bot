import type {
  ClientOrderId,
  ExchangeFeed,
  Execution,
  FeedEvent,
  Order,
  SubscriptionId,
} from "@mm-crypto-bot/exchange";
import { assertDefined } from "@mm-crypto-bot/assert";
import type { Logger } from "@mm-crypto-bot/logging";

import {
  OrderManagerError,
  type OrderLifecycleEvent,
  type OrderLifecycleListener,
  type OrderManagerCounters,
} from "./order-manager.types.js";

const MAX_CANCEL_RACE_ORDERS = 1000;
const MAX_SEEN_EXECUTION_IDS = 5000;
const MAX_KNOWN_ORDERS = 5000;
const ACTIVE_ORDER_CAPACITY_ERROR = "[order-manager] active order capacity exhausted";

function activeOrderCapacityError(): OrderManagerError {
  return new OrderManagerError(ACTIVE_ORDER_CAPACITY_ERROR, new Error("active order capacity exhausted"));
}

export class OrderLifecycleController {
  private readonly inFlight = new Map<ClientOrderId, Order>();
  private readonly cancelRaceOrders = new Map<ClientOrderId, Order>();
  private readonly lifecycleListeners = new Set<OrderLifecycleListener>();
  private readonly lifecycleSubscriptions: SubscriptionId[] = [];
  private readonly seenExecutionIds = new Set<string>();
  private readonly executionIdsByOrder = new Map<ClientOrderId, Set<string>>();
  private readonly bookedCumulative = new Map<ClientOrderId, number>();
  private readonly snapshotRecoveryCoverage = new Map<ClientOrderId, number>();
  private readonly knownOrders = new Map<ClientOrderId, Order>();
  private pendingPlacements = 0;

  public constructor(
    private readonly feed: ExchangeFeed,
    private readonly logger: Logger,
    private readonly counters: OrderManagerCounters,
  ) {}

  public trackPlaced(order: Order): void {
    if (this.pendingPlacements > 0) this.pendingPlacements--;
    else if (this.inFlight.size + this.cancelRaceOrders.size >= MAX_KNOWN_ORDERS)
      throw activeOrderCapacityError();
    this.inFlight.set(order.clientOrderId, order);
    this.bookedCumulative.set(order.clientOrderId, order.filled);
    this.snapshotRecoveryCoverage.set(order.clientOrderId, order.filled);
    this.rememberOrder(order);
  }

  public reservePlacement(): void {
    if (this.inFlight.size + this.cancelRaceOrders.size + this.pendingPlacements >= MAX_KNOWN_ORDERS)
      throw activeOrderCapacityError();
    this.pendingPlacements++;
  }

  public releasePlacement(): void {
    this.pendingPlacements = Math.max(0, this.pendingPlacements - 1);
  }

  public trackCancellation(clientOrderId: ClientOrderId): void {
    const prior = this.inFlight.get(clientOrderId);
    this.inFlight.delete(clientOrderId);
    if (prior === undefined) return;
    this.cancelRaceOrders.set(clientOrderId, prior);
    this.removeOldestCancelRaceOrder();
  }

  public recordFill(clientOrderId: ClientOrderId, updated: Order): void {
    const prior = this.bookedCumulative.get(clientOrderId) ?? 0;
    const cumulative = Math.max(prior, updated.filled);
    this.bookedCumulative.set(clientOrderId, cumulative);
    if (cumulative > prior) {
      this.snapshotRecoveryCoverage.set(
        clientOrderId,
        (this.snapshotRecoveryCoverage.get(clientOrderId) ?? 0) + cumulative - prior,
      );
    }
    this.rememberOrder(updated);
    if (!this.inFlight.has(clientOrderId)) return;
    this.inFlight.set(clientOrderId, updated);
    if (updated.status === "closed") {
      this.counters.filled++;
      this.inFlight.delete(clientOrderId);
    } else if (updated.status === "canceled") {
      this.inFlight.delete(clientOrderId);
    }
  }

  public async reconcileOrder(
    clientOrderId: ClientOrderId,
    symbol: Order["symbol"],
  ): Promise<{ readonly order: Order; readonly deltaFilled: number }> {
    const previous = this.findKnownOrder(clientOrderId);
    const updated = await this.feed.fetchOrder(clientOrderId, symbol);
    const { merged, deltaFilled } = this.applyOrderSnapshot(updated, previous);
    this.inFlight.set(clientOrderId, merged);
    if (merged.status === "closed") {
      this.counters.filled++;
      this.inFlight.delete(clientOrderId);
    } else if (merged.status === "canceled") {
      this.counters.cancelled++;
      this.inFlight.delete(clientOrderId);
    }
    return { order: merged, deltaFilled };
  }

  public onLifecycle(listener: OrderLifecycleListener): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  public async start(onFeedEvent: (event: FeedEvent) => void): Promise<void> {
    if (this.lifecycleSubscriptions.length > 0) return;
    if (this.feed.subscribeOrderUpdates !== undefined) {
      this.lifecycleSubscriptions.push(
        await this.feed.subscribeOrderUpdates((event) => {
          onFeedEvent(event);
        }),
      );
    }
    if (this.feed.subscribeExecutions !== undefined) {
      this.lifecycleSubscriptions.push(
        await this.feed.subscribeExecutions((event) => {
          onFeedEvent(event);
        }),
      );
    }
  }

  public async stop(): Promise<void> {
    const subscriptions = [...this.lifecycleSubscriptions];
    this.lifecycleSubscriptions.length = 0;
    await Promise.all(subscriptions.map(async (id) => this.feed.unsubscribe(id)));
  }

  // The facade owns the lifecycle event transport boundary.
  public processFeedEvent(event: FeedEvent): void {
    if (event.kind === "order") {
      this.handleOrderEvent(event.payload);
      return;
    }
    if (event.kind === "execution") this.handleExecutionEvent(event.payload);
  }

  public getInFlightCount(): number {
    return this.inFlight.size;
  }

  public getInFlightOrderIds(): readonly ClientOrderId[] {
    // eslint-disable-next-line unicorn/prefer-iterator-to-array -- The configured TypeScript library does not type Iterator#toArray.
    return [...this.inFlight.keys()];
  }

  public getCancellableOrders(preserve: ReadonlySet<ClientOrderId>): readonly Order[] {
    // eslint-disable-next-line unicorn/prefer-iterator-to-array -- The configured TypeScript library does not type Iterator#toArray.
    return [...this.inFlight.values()].filter((order) => !preserve.has(order.clientOrderId));
  }

  // eslint-disable-next-line unicorn/consistent-class-member-order -- Event handlers remain grouped as one stream-dispatch responsibility.
  private handleOrderEvent(updated: Order): void {
    const previous = this.findKnownOrder(updated.clientOrderId);
    if (previous === undefined) return;
    const { merged, deltaFilled } = this.applyOrderSnapshot(updated, previous);
    this.updateTrackedOrder(merged);
    this.emitLifecycle({ kind: "order", order: merged, deltaFilled });
  }

  private handleExecutionEvent(execution: Execution): void {
    const clientOrderId = this.resolveClientOrderId(execution);
    if (clientOrderId === undefined) return;
    const previous = this.findKnownOrder(clientOrderId);
    if (previous === undefined) return;
    if (this.seenExecutionIds.has(execution.executionId)) return;
    this.rememberExecutionId(execution.executionId, clientOrderId);
    const merged = this.mergeExecution(clientOrderId, previous, execution);
    this.updateTrackedOrder(merged.order);
    this.emitLifecycle({
      kind: "execution",
      order: merged.order,
      execution,
      deltaFilled: merged.deltaFilled,
    });
  }

  private resolveClientOrderId(execution: Execution): ClientOrderId | undefined {
    if (execution.clientOrderId !== undefined) return execution.clientOrderId;
    if (execution.exchangeOrderId === undefined) return undefined;
    for (const order of this.knownOrders.values()) {
      if (order.exchangeId === execution.exchangeOrderId) return order.clientOrderId;
    }
    return undefined;
  }

  private mergeExecution(
    clientOrderId: ClientOrderId,
    previous: Order,
    execution: Execution,
  ): { readonly order: Order; readonly deltaFilled: number } {
    const prior = this.bookedCumulative.get(clientOrderId);
    const recoveryCoverage = this.snapshotRecoveryCoverage.get(clientOrderId);
    assertDefined(prior, "tracked order is missing booked fill state");
    assertDefined(recoveryCoverage, "tracked order is missing snapshot recovery state");
    const absorbedByRecovery = Math.min(recoveryCoverage, execution.quantity);
    this.snapshotRecoveryCoverage.set(clientOrderId, recoveryCoverage - absorbedByRecovery);
    const deltaFilled = Math.max(
      0,
      Math.min(execution.quantity - absorbedByRecovery, previous.amount - prior),
    );
    const cumulative = prior + deltaFilled;
    const previousValue = prior * (previous.average ?? execution.price);
    const average = (previousValue + deltaFilled * execution.price) / cumulative;
    const order: Order = {
      ...previous,
      filled: cumulative,
      average,
      status: cumulative >= previous.amount ? "closed" : previous.status === "canceled" ? "canceled" : "open",
      updateTimestamp: execution.timestamp,
    };
    this.bookedCumulative.set(clientOrderId, cumulative);
    return { order, deltaFilled };
  }

  private updateTrackedOrder(order: Order): void {
    this.rememberOrder(order);
    if (order.status === "open") {
      if (this.cancelRaceOrders.has(order.clientOrderId)) {
        this.cancelRaceOrders.set(order.clientOrderId, order);
      } else {
        this.inFlight.set(order.clientOrderId, order);
      }
      return;
    }
    if (order.status === "canceled" && this.cancelRaceOrders.has(order.clientOrderId)) {
      this.cancelRaceOrders.set(order.clientOrderId, order);
      return;
    }
    this.inFlight.delete(order.clientOrderId);
    this.cancelRaceOrders.delete(order.clientOrderId);
  }

  private applyOrderSnapshot(
    updated: Order,
    previous?: Order,
  ): { readonly merged: Order; readonly deltaFilled: number } {
    const clientOrderId = updated.clientOrderId;
    const prior = this.bookedCumulative.get(clientOrderId) ?? 0;
    const deltaFilled = Math.max(0, Math.min(updated.filled - prior, updated.amount - prior));
    const cumulative = prior + deltaFilled;
    if (deltaFilled > 0) {
      this.snapshotRecoveryCoverage.set(
        clientOrderId,
        (this.snapshotRecoveryCoverage.get(clientOrderId) ?? 0) + deltaFilled,
      );
    }
    this.bookedCumulative.set(clientOrderId, cumulative);
    const status =
      previous?.status === "closed" || updated.status === "closed" || cumulative >= updated.amount
        ? "closed"
        : previous?.status === "canceled" && updated.status === "open"
          ? "canceled"
          : updated.status;
    const merged: Order = { ...updated, status, filled: cumulative };
    this.rememberOrder(merged);
    return { merged, deltaFilled };
  }

  private findKnownOrder(clientOrderId: ClientOrderId): Order | undefined {
    return (
      this.inFlight.get(clientOrderId) ??
      this.cancelRaceOrders.get(clientOrderId) ??
      this.knownOrders.get(clientOrderId)
    );
  }

  private rememberOrder(order: Order): void {
    this.knownOrders.delete(order.clientOrderId);
    this.knownOrders.set(order.clientOrderId, order);
    if (this.knownOrders.size <= MAX_KNOWN_ORDERS) return;
    for (const oldest of this.knownOrders.keys()) {
      if (this.inFlight.has(oldest) || this.cancelRaceOrders.has(oldest)) continue;
      this.knownOrders.delete(oldest);
      this.bookedCumulative.delete(oldest);
      this.snapshotRecoveryCoverage.delete(oldest);
      this.forgetExecutionIds(oldest);
      break;
    }
  }

  private rememberExecutionId(executionId: string, clientOrderId: ClientOrderId): void {
    if (this.seenExecutionIds.size >= MAX_SEEN_EXECUTION_IDS) {
      throw new OrderManagerError(
        "[order-manager] execution deduplication capacity exhausted",
        new Error("execution deduplication capacity exhausted"),
      );
    }
    this.seenExecutionIds.add(executionId);
    const executionIds = this.executionIdsByOrder.get(clientOrderId);
    if (executionIds !== undefined) {
      executionIds.add(executionId);
      return;
    }
    this.executionIdsByOrder.set(clientOrderId, new Set([executionId]));
  }

  private forgetExecutionIds(clientOrderId: ClientOrderId): void {
    const executionIds = this.executionIdsByOrder.get(clientOrderId);
    if (executionIds === undefined) return;
    for (const executionId of executionIds) this.seenExecutionIds.delete(executionId);
    this.executionIdsByOrder.delete(clientOrderId);
  }

  private removeOldestCancelRaceOrder(): void {
    if (this.cancelRaceOrders.size <= MAX_CANCEL_RACE_ORDERS) return;
    for (const oldest of this.cancelRaceOrders.keys()) {
      this.cancelRaceOrders.delete(oldest);
      break;
    }
  }

  private emitLifecycle(event: OrderLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error("order.lifecycle.listener.failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

import type { Brand } from "@mm-crypto-bot/shared";
import { SelectedLeverage } from "@mm-crypto-bot/numeric";
import type {
  Balance,
  ClientOrderId,
  ExchangeFeed,
  ExchangePosition,
  FeedEvent,
  MarketMeta,
  Order,
  Symbol,
  Ticker,
} from "@mm-crypto-bot/exchange";
import {
  DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
  type AggregateEffectiveExposureLimit,
} from "@mm-crypto-bot/core";
import { requireLogger, type Logger } from "@mm-crypto-bot/logging";

import { OrderLifecycleController } from "./order-manager-lifecycle.js";
import {
  createPaperOrder,
  parsePaperOrderSimulationOutcome,
  validateOrderIntent,
} from "./order-manager-placement.js";
import {
  OrderManagerError,
  type OrderIntent,
  type OrderLifecycleListener,
  type OrderManagerCounters,
  type OrderManagerOptions,
  type PaperOrderSimulationInput,
  type PaperOrderSimulationOutcome,
  type PaperOrderSimulator,
  type PositionSizeQuery,
} from "./order-manager.types.js";
import { stringifyUnknownError } from "./stringify-unknown-error.js";

export {
  OrderManagerError,
  type OrderIntent,
  type OrderLifecycleEvent,
  type OrderLifecycleListener,
  type OrderManagerOptions,
  type PaperOrderSimulator,
  type PaperOrderSimulationInput,
  type PaperOrderSimulationOutcome,
  type OrderType,
  type PositionSizeQuery,
} from "./order-manager.types.js";

export class OrderManager {
  private readonly feed: ExchangeFeed;
  private readonly getPositionContext: () => PositionSizeQuery;
  private readonly getReduciblePosition: OrderManagerOptions["getReduciblePosition"];
  private readonly aggregateExposureLimit: AggregateEffectiveExposureLimit;
  private readonly logger: Logger;
  private readonly paperMode: boolean;
  private readonly paperOrderSimulator: PaperOrderSimulator | undefined;
  private readonly liveAuthority: OrderManagerOptions["liveAuthority"];
  private readonly lifecycle: OrderLifecycleController;
  private placementSequence = 0n;
  private readonly counters: OrderManagerCounters = {
    placed: 0,
    filled: 0,
    cancelled: 0,
    rejected: 0,
  };

  public constructor(options: OrderManagerOptions) {
    this.feed = options.feed;
    this.getPositionContext = options.getPositionContext;
    this.getReduciblePosition = options.getReduciblePosition;
    this.aggregateExposureLimit =
      options.aggregateExposureLimit ?? DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT;
    this.paperMode = options.paperMode ?? false;
    this.paperOrderSimulator = options.paperOrderSimulator;
    this.liveAuthority = options.liveAuthority;
    if (!this.paperMode && this.paperOrderSimulator !== undefined) {
      throw new OrderManagerError(
        "[order-manager] paper order simulator is only permitted in paper mode.",
        new Error("paper order simulator outside paper mode"),
      );
    }
    this.logger = requireLogger(options.logger, "order-manager");
    this.lifecycle = new OrderLifecycleController(this.feed, this.logger, this.counters);
  }

  public async placeOrder(intent: OrderIntent): Promise<Order> {
    if (!this.paperMode && intent.reduceOnly !== true && this.liveAuthority !== undefined) {
      try {
        this.liveAuthority.assertEntryAllowed();
      } catch (error) {
        this.counters.rejected++;
        this.logger.error("order.authority.rejected", {
          symbol: intent.symbol,
          error: stringifyUnknownError(error),
        });
        throw new OrderManagerError("[order-manager] live authority rejected new exposure", error);
      }
    }
    const placementSequence = this.issuePlacementSequence();
    const clientOrderId = this.generateClientOrderId(placementSequence, intent.clientOrderIdHint);
    const selectedSpotMarginLeverage: Parameters<
      typeof validateOrderIntent
    >[2]["selectedSpotMarginLeverage"] = this.paperMode ? undefined : SelectedLeverage.initialBaseline;
    const validated = validateOrderIntent(intent, clientOrderId, {
      getPositionContext: this.getPositionContext,
      getReduciblePosition: this.getReduciblePosition,
      aggregateExposureLimit: this.aggregateExposureLimit,
      logger: this.logger,
      rejectOrder: () => {
        this.counters.rejected++;
      },
      ...(selectedSpotMarginLeverage !== undefined && { selectedSpotMarginLeverage }),
    });
    try {
      this.lifecycle.reservePlacement();
    } catch (error) {
      this.counters.rejected++;
      this.logger.error("order.capacity.rejected", {
        symbol: intent.symbol,
        reason: stringifyUnknownError(error),
      });
      throw error;
    }
    let order: Order;
    try {
      order = await this.submitOrder(intent, validated.clientOrderId, validated.request, placementSequence);
    } catch (error) {
      this.lifecycle.releasePlacement();
      throw error;
    }
    this.lifecycle.trackPlaced(order);
    if (order.status !== "open") {
      this.lifecycle.recordFill(order.clientOrderId, order);
    }
    this.counters.placed++;
    this.logger.info("order.placed", {
      symbol: intent.symbol,
      side: order.side,
      type: order.type,
      amount: order.amount,
      price: order.price,
      clientOrderId: validated.clientOrderId,
    });
    return order;
  }

  public async cancelOrder(clientOrderId: ClientOrderId, symbol: Symbol): Promise<Order> {
    try {
      const order = await this.feed.cancelOrder(clientOrderId, symbol);
      this.lifecycle.trackCancellation(clientOrderId);
      this.counters.cancelled++;
      this.logger.info("order.cancelled", { clientOrderId, symbol });
      return order;
    } catch (error) {
      this.logger.error("order.cancel.failed", {
        clientOrderId,
        symbol,
        error: stringifyUnknownError(error),
      });
      throw new OrderManagerError(
        `[order-manager] cancelOrder failed for ${clientOrderId} on ${symbol}: ${stringifyUnknownError(error)}`,
        error,
      );
    }
  }

  public async getOpenOrders(symbol: Symbol): Promise<readonly Order[]> {
    try {
      return await this.feed.fetchOpenOrders(symbol);
    } catch (error) {
      this.logger.error("order.open.fetch.failed", {
        symbol,
        error: stringifyUnknownError(error),
      });
      throw new OrderManagerError(
        `[order-manager] fetchOpenOrders failed for ${symbol}: ${stringifyUnknownError(error)}`,
        error,
      );
    }
  }

  public recordFill(clientOrderId: ClientOrderId, updated: Order): void {
    this.lifecycle.recordFill(clientOrderId, updated);
  }

  public async reconcileOrder(
    clientOrderId: ClientOrderId,
    symbol: Symbol,
  ): Promise<{ readonly order: Order; readonly deltaFilled: number }> {
    try {
      return await this.lifecycle.reconcileOrder(clientOrderId, symbol);
    } catch (error) {
      throw new OrderManagerError(
        `[order-manager] reconcile fetchOrder failed for ${clientOrderId}: ${stringifyUnknownError(error)}`,
        error,
      );
    }
  }

  public onLifecycle(listener: OrderLifecycleListener): () => void {
    return this.lifecycle.onLifecycle(listener);
  }

  public async startLifecycle(): Promise<void> {
    if (!this.paperMode) {
      await this.lifecycle.start((event) => {
        this.handleLifecycleFeedEvent(event);
      });
    }
  }

  public async stopLifecycle(): Promise<void> {
    await this.lifecycle.stop();
  }

  // eslint-disable-next-line unicorn/consistent-class-member-order -- Private stream dispatch stays with the lifecycle controls it serves.
  private handleLifecycleFeedEvent(event: FeedEvent): void {
    this.lifecycle.processFeedEvent(event);
  }

  public getCounters(): Readonly<OrderManagerCounters> {
    return { ...this.counters };
  }

  public getInFlightCount(): number {
    return this.lifecycle.getInFlightCount();
  }

  public isPaperMode(): boolean {
    return this.paperMode;
  }

  public getInFlightOrderIds(): readonly ClientOrderId[] {
    return this.lifecycle.getInFlightOrderIds();
  }

  public async getAuthoritativePositions(symbols?: readonly Symbol[]): Promise<readonly ExchangePosition[]> {
    if (this.paperMode) return [];
    if (this.feed.fetchPositions === undefined) {
      throw new OrderManagerError(
        "[order-manager] exchange does not expose authoritative positions",
        new Error("fetchPositions unavailable"),
      );
    }
    try {
      return await this.feed.fetchPositions(symbols);
    } catch (error) {
      throw new OrderManagerError(
        `[order-manager] authoritative position query failed: ${stringifyUnknownError(error)}`,
        error,
      );
    }
  }

  public async getAuthoritativeBalances(): Promise<readonly Balance[]> {
    try {
      return await this.feed.fetchBalances();
    } catch (error) {
      throw new OrderManagerError(
        `[order-manager] authoritative balance query failed: ${stringifyUnknownError(error)}`,
        error,
      );
    }
  }

  public async getMarketMeta(symbol: Symbol): Promise<MarketMeta> {
    try {
      return await this.feed.fetchMarketMeta(symbol);
    } catch (error) {
      throw new OrderManagerError(
        `[order-manager] market metadata query failed for ${symbol}: ${stringifyUnknownError(error)}`,
        error,
      );
    }
  }

  private async submitOrder(
    intent: OrderIntent,
    clientOrderId: ClientOrderId,
    request: Parameters<ExchangeFeed["placeOrder"]>[0],
    placementSequence: bigint,
  ): Promise<Order> {
    if (this.paperMode) {
      const timestamp = Date.now();
      const simulatorInput: PaperOrderSimulationInput = {
        intent,
        clientOrderId,
        placedCount: this.counters.placed,
        timestamp,
      };
      let outcome: PaperOrderSimulationOutcome = "filled";
      try {
        outcome = parsePaperOrderSimulationOutcome(this.paperOrderSimulator?.(simulatorInput) ?? outcome);
      } catch (error) {
        this.counters.rejected++;
        this.logger.error("order.paper.simulator.failed", {
          symbol: intent.symbol,
          clientOrderId,
          error: stringifyUnknownError(error),
        });
        throw new OrderManagerError(
          `[order-manager] paper order simulator failed for ${intent.symbol} (clientOrderId=${clientOrderId}): ${stringifyUnknownError(error)}`,
          error,
        );
      }
      const order = createPaperOrder(intent, clientOrderId, placementSequence, timestamp, outcome);
      this.logger.info("order.paper.simulated", {
        symbol: intent.symbol,
        clientOrderId,
        side: order.side,
        amount: order.amount,
        price: order.price,
        outcome,
      });
      return order;
    }
    try {
      return await this.feed.placeOrder(request);
    } catch (error) {
      this.counters.rejected++;
      this.logger.error("order.exchange.place.failed", {
        symbol: intent.symbol,
        clientOrderId,
        error: stringifyUnknownError(error),
      });
      throw new OrderManagerError(
        `[order-manager] placeOrder failed for ${intent.symbol} (clientOrderId=${clientOrderId}): ${stringifyUnknownError(error)}`,
        error,
      );
    }
  }

  public async getTickerSnapshot(symbol: Symbol): Promise<Ticker> {
    try {
      return await this.feed.fetchTickerSnapshot(symbol);
    } catch (error) {
      throw new OrderManagerError(
        `[order-manager] ticker query failed for ${symbol}: ${stringifyUnknownError(error)}`,
        error,
      );
    }
  }

  private issuePlacementSequence(): bigint {
    const sequence = this.placementSequence;
    this.placementSequence += 1n;
    return sequence;
  }

  private generateClientOrderId(placementSequence: bigint, prefix = "bot"): ClientOrderId {
    const timestamp = Date.now().toString(36);
    const sequence = placementSequence.toString(36);
    return `${prefix}-${timestamp}-${sequence}` as Brand<string, "ClientOrderId">;
  }

  public async cancelTrackedOrders(
    preserve: ReadonlySet<ClientOrderId> = new Set(),
  ): Promise<
    readonly { readonly clientOrderId: ClientOrderId; readonly symbol: Symbol; readonly error?: string }[]
  > {
    return Promise.all(
      this.lifecycle.getCancellableOrders(preserve).map(async (order) => {
        try {
          await this.cancelOrder(order.clientOrderId, order.symbol);
          return { clientOrderId: order.clientOrderId, symbol: order.symbol };
        } catch (error) {
          return {
            clientOrderId: order.clientOrderId,
            symbol: order.symbol,
            error: stringifyUnknownError(error),
          };
        }
      }),
    );
  }

}

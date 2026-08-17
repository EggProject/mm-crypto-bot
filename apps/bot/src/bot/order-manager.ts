/**
 * apps/bot/src/bot/order-manager.ts
 *
 * Phase 33 Track C — `OrderManager` — a rendelés-végrehajtás központi
 * eleme a futó botban.
 *
 * ===========================================================================
 * 1:10 LEVERAGE MANDATE — 2ND DEFENSE-IN-DEPTH LAYER (L2)
 * ===========================================================================
 * Minden `placeOrder` hívás ELŐTT ellenőrzi, hogy a kért notional nem
 * haladja meg a `PositionManager` által szolgáltatott equity × `maxLeverage`
 * küszöböt. A 3 rétegű védelmi vonal (L1: config Zod, L2: itt,
 * L3: PositionManager.recordFill) a Phase 10G §"3-layer defense-in-depth"
 * mintát követi.
 *
 * ===========================================================================
 * BEMENETEK ÉS KIMENETEK
 * ===========================================================================
 *   - `placeOrder(intent)` — egy `OrderIntent` (StrategySignal + sizing
 *     context) alapján hív `feed.placeOrder`-t. A teljes méretellenőrzés
 *     és a `clientOrderId` generálás itt történik.
 *   - `cancelOrder(clientOrderId, symbol)` — visszavonás az exchange-en.
 *   - `getOpenOrders(symbol)` — nyitott rendelések listája.
 *
 * A `StrategyRunner` (lásd strategy-runner.ts) az egyetlen hívója; a
 * feed-et a Bot indítja el, az `OrderManager` a feed wrapper-e.
 *
 * ===========================================================================
 * HIBAKEZELÉS
 * ===========================================================================
 * A `feed.placeOrder` által dobott bármilyen hibát `OrderManagerError`
 * formájában csomagoljuk, hogy a felsőbb rétegek (Telemetry, Bot)
 * típus-szinten meg tudják különböztetni a saját hibáinkat a feed
 * hibáitól. Az eredeti `cause` megmarad a stack trace megőrzéséhez.
 */

import type { Brand } from "@mm-crypto-bot/shared";
import type {
  Balance,
  ClientOrderId,
  ExchangeFeed,
  ExchangeOrderId,
  ExchangePosition,
  Execution,
  FeedEvent,
  MarketMeta,
  Order,
  OrderRequest,
  ProtectiveOrderKind,
  Symbol,
  Ticker,
} from "@mm-crypto-bot/exchange";
import type { SubscriptionId } from "@mm-crypto-bot/exchange";
import {
  assertLeverageInvariant,
  type LeverageInvariantConfig,
  type Position as LeveragePosition,
} from "@mm-crypto-bot/core";
import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";
import type { StrategySignal } from "@mm-crypto-bot/core";

// ============================================================================
// Public error type
// ============================================================================

/**
 * `OrderManagerError` — az `OrderManager` saját hibája. A `cause`
 * mezőben az eredeti hiba (pl. `ExchangeFeedError`) elérhető.
 */
export class OrderManagerError extends Error {
  public override readonly name = "OrderManagerError";
  public override readonly cause: unknown;

  public constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
    // Restore prototype chain (required when extending Error in TS + ESM).
    Object.setPrototypeOf(this, OrderManagerError.prototype);
  }
}

// ============================================================================
// Public input types
// ============================================================================

/**
 * `OrderType` — az OrderManager által elfogadott order-típus. A
 * feed wrapper-e a `OrderType` exchange-beli típust használja, de
 * itt a felsőbb réteg (StrategyRunner) szempontjából aggregálunk.
 */
export type OrderType = "market" | "limit";

/**
 * `OrderIntent` — egy konkrétan végrehajtandó order leírása. A
 * `StrategyRunner` állítja össze a `StrategySignal` + a per-strategy
 * sizing + az aktuális market context alapján.
 *
 * - `signal`           — a stratégia által adott `StrategySignal`.
 * - `symbol`           — branded `Symbol` (CCXT unified formátum).
 * - `amount`           — a kért méret (instrument unit, pl. BTC).
 * - `referencePrice`   — az a price, amihez a notional-t számoljuk
 *                         (market esetén a ticker last/ask, limit esetén
 *                         maga a `limitPrice`).
 * - `type`             — `market` (azonnali végrehajtás) vagy
 *                         `limit` (limit áras).
 * - `limitPrice`       — csak `type === "limit"`-nél kötelező.
 * - `clientOrderIdHint` — opcionális prefix a `clientOrderId`-hoz
 *                         (a `StrategyRunner` adja, hogy trace-elhető
 *                         legyen, melyik stratégia küldte).
 */
export interface OrderIntent {
  readonly signal: StrategySignal;
  readonly symbol: Symbol;
  readonly amount: number;
  readonly referencePrice: number;
  readonly type: OrderType;
  readonly limitPrice?: number;
  readonly clientOrderIdHint?: string;
  /** Safety closes are reduce-only and must never be rejected as added exposure. */
  readonly reduceOnly?: boolean;
  /** The resolved config value, recorded with the request boundary for auditability. */
  readonly leverage?: number;
  /** Strategy owner, required to validate a strategy-attributed safety close. */
  readonly strategy?: string;
  /** Native post-fill conditional exit semantics. */
  readonly protectiveKind?: ProtectiveOrderKind;
  readonly triggerPrice?: number;
}

/**
 * `PositionSizeQuery` — a `PositionManager`-től lekérdezett equity-aggregátum.
 * Az `OrderManager` ezt használja az L2 leverage-check előtt.
 *
 * - `equityUsd`   — a teljes portfolió-egyenleg (USD).
 * - `positions`   — a jelenleg nyitott pozíciók listája (az új order
 *                   nélkül). A L2 check a `notional + sum(|existing|) ≤ equity × maxLeverage`
 *                   formát ellenőrzi.
 */
export interface PositionSizeQuery {
  readonly equityUsd: number;
  readonly positions: readonly LeveragePosition[];
}

export type OrderLifecycleEvent =
  | { readonly kind: "order"; readonly order: Order; readonly deltaFilled: number }
  | {
      readonly kind: "execution";
      readonly order: Order;
      readonly execution: Execution;
      readonly deltaFilled: number;
    };

export type OrderLifecycleListener = (event: OrderLifecycleEvent) => void;

// ============================================================================
// OrderManagerOptions
// ============================================================================

/**
 * `OrderManagerOptions` — az OrderManager konfigurációja.
 *
 * - `feed`          — az exchange feed wrapper (paper/live).
 * - `getPositionContext` — equity-lekérdező callback. A L2 check
 *                          ELŐTT hívódik, így mindig friss állapotot
 *                          látunk.
 * - `leverage`      — a leverage invariant config (default: 1:10 cap).
 * - `logger`        — opcionális structured logger (alap: a `shared` default).
 */
export interface OrderManagerOptions {
  readonly feed: ExchangeFeed;
  readonly getPositionContext: () => PositionSizeQuery;
  /** Exact local quantity/side for reduce-only validation when a position book is available. */
  readonly getReduciblePosition?: (
    symbol: Symbol,
    strategy: string | undefined,
  ) => { readonly side: "long" | "short"; readonly quantity: number } | undefined;
  readonly leverage?: LeverageInvariantConfig;
  readonly logger?: Logger;
  /**
   * Phase 66: when `true`, the `placeOrder` does NOT call `feed.placeOrder`
   * (which requires API credentials on bybit.eu). Instead, it simulates a
   * filled order locally — the L2 leverage check still runs, the
   * `clientOrderId` is still generated, and the synthetic Order is
   * returned with `status: "filled"` so the `StrategyRunner.recordFill`
   * path runs normally and the position is tracked. The `feed` is still
   * required for the constructor signature but is never called.
   */
  readonly paperMode?: boolean;
}

// ============================================================================
// OrderManager class
// ============================================================================

/**
 * `OrderManager` — központi order-végrehajtó. A `Bot` indítja el, a
 * `StrategyRunner` hívja minden nem-null `StrategySignal`-ra.
 *
 * Felelősségek:
 *   1. L2 leverage check (1:10 MANDATE)
 *   2. `clientOrderId` generálás (determinisztikus + egyedi)
 *   3. `OrderRequest` összeállítás + `feed.placeOrder` hívás
 *   4. In-flight order tracking (`Map<ClientOrderId, Order>`)
 *   5. Hibakezelés: minden hiba `OrderManagerError` formájában
 *
 * A `cancelOrder` és a `getOpenOrders` egyszerű wrapper-ek a feed
 * köré, ahol a hibákat szintén `OrderManagerError` formájában adjuk
 * tovább.
 */
export class OrderManager {
  private readonly feed: ExchangeFeed;
  private readonly getPositionContext: () => PositionSizeQuery;
  private readonly getReduciblePosition:
    | ((
        symbol: Symbol,
        strategy: string | undefined,
      ) => { readonly side: "long" | "short"; readonly quantity: number } | undefined)
    | undefined;
  private readonly leverage: LeverageInvariantConfig;
  private readonly logger: Logger;
  private readonly inFlight = new Map<ClientOrderId, Order>();
  /** Cancel ACK is asynchronous on Bybit; retain identity for a late fill. */
  private readonly cancelRaceOrders = new Map<ClientOrderId, Order>();
  private readonly paperMode: boolean;
  private readonly lifecycleListeners = new Set<OrderLifecycleListener>();
  private readonly lifecycleSubscriptions: SubscriptionId[] = [];
  private readonly seenExecutionIds = new Set<string>();
  /** Total quantity already exposed to lifecycle consumers (or returned filled by placeOrder). */
  private readonly bookedCumulative = new Map<ClientOrderId, number>();
  /** Quantity booked from order snapshots which later executions must absorb, not re-emit. */
  private readonly snapshotRecoveryCoverage = new Map<ClientOrderId, number>();
  /** Sum of unique private executions observed for audit/recovery correlation. */
  private readonly executionCumulative = new Map<ClientOrderId, number>();
  /** Bounded identity ledger so late executions can correlate after terminal order updates. */
  private readonly knownOrders = new Map<ClientOrderId, Order>();
  private readonly counters = {
    placed: 0,
    filled: 0,
    cancelled: 0,
    rejected: 0,
  };

  public constructor(opts: OrderManagerOptions) {
    this.feed = opts.feed;
    this.getPositionContext = opts.getPositionContext;
    this.getReduciblePosition = opts.getReduciblePosition;
    this.leverage = opts.leverage ?? { maxLeverage: 10, tolerance: 1e-6, warnOnApproach: 0.95 };
    this.logger = opts.logger ?? createLogger("info");
    this.paperMode = opts.paperMode ?? false;
  }

  // --------------------------------------------------------------------------
  // L2: Pre-place leverage check + placeOrder
  // --------------------------------------------------------------------------

  /**
   * `placeOrder` — végrehajt egy `OrderIntent`-et.
   *
   * 1) L2 leverage check: `assertLeverageInvariant(intent.notional, equity, leverage)`.
   *    Ha a meglévő pozíciók + az új notional együttesen túllépik a
   *    cap-et, a `placeOrder` ELŐTT dobunk — ekkor a feed sosem kapja meg.
   * 2) `clientOrderId` generálás: a hint + timestamp + counter kombinációból.
   * 3) `OrderRequest` összeállítás.
   * 4) `feed.placeOrder(req)` hívás; bármilyen hiba `OrderManagerError` lesz.
   * 5) In-flight tracking.
   *
   * A `takeProfitPrice` / `stopLossPrice` a feed-en keresztül a
   * CCXT Pro natív TP/SL paramétere (lásd `OrderRequest`).
   */
  public async placeOrder(intent: OrderIntent): Promise<Order> {
    if (!Number.isFinite(intent.amount) || intent.amount <= 0) {
      throw new OrderManagerError(
        `[order-manager] invalid amount=${String(intent.amount)} for ${intent.symbol}`,
        new Error("invalid amount"),
      );
    }
    if (!Number.isFinite(intent.referencePrice) || intent.referencePrice <= 0) {
      throw new OrderManagerError(
        `[order-manager] invalid referencePrice=${String(intent.referencePrice)} for ${intent.symbol}`,
        new Error("invalid price"),
      );
    }
    if (intent.type === "limit" && (intent.limitPrice === undefined || intent.limitPrice <= 0)) {
      throw new OrderManagerError(
        `[order-manager] limit order requires positive limitPrice (got ${String(intent.limitPrice)})`,
        new Error("missing limit price"),
      );
    }
    if (
      intent.protectiveKind !== undefined &&
      (!Number.isFinite(intent.triggerPrice) || (intent.triggerPrice ?? 0) <= 0)
    ) {
      throw new OrderManagerError(
        `[order-manager] ${intent.protectiveKind} requires a positive triggerPrice`,
        new Error("invalid trigger price"),
      );
    }
    const effectiveLeverage = intent.leverage ?? 1;
    if (
      !Number.isFinite(effectiveLeverage) ||
      effectiveLeverage <= 0 ||
      effectiveLeverage > this.leverage.maxLeverage
    ) {
      throw new OrderManagerError(
        `[order-manager] invalid effective leverage=${String(effectiveLeverage)} (global max=${String(this.leverage.maxLeverage)})`,
        new Error("invalid effective leverage"),
      );
    }

    // -----------------------------------------------------------------------
    // L2: LEVERAGE INVARIANT CHECK — 2nd defense-in-depth layer.
    //
    // A teljes notional (a meglévő pozíciók abszolút összege + az új
    // intent notional) nem haladhatja meg a `equity × maxLeverage`
    // küszöböt. A `assertLeverageInvariant` dob, ha a cap átlépődne —
    // ekkor a `feed.placeOrder` SOHA nem hívódik meg, és a hiba a
    // felsőbb rétegbe (Telemetry, Bot) száll, mint `OrderManagerError`.
    // -----------------------------------------------------------------------
    const ctx = this.getPositionContext();
    const notional = intent.amount * intent.referencePrice;
    const effectiveNotional = notional * effectiveLeverage;
    const existingNotional = ctx.positions.reduce((acc, p) => acc + Math.abs(p.effectiveNotionalUsd), 0);
    // A reduce-only order can only shrink an opposite-signed existing
    // exposure.  It is deliberately excluded from the new-exposure cap, but
    // still rejected if it would flip a position or has the wrong side.
    const reducing = intent.reduceOnly === true;
    const matchingExposure = ctx.positions
      .filter((position) => position.symbol === String(intent.symbol))
      .reduce((sum, position) => sum + position.effectiveNotionalUsd, 0);
    if (reducing) {
      const expectedSell = matchingExposure > 0;
      const sideMatches = expectedSell ? intent.signal.side === "sell" : intent.signal.side === "buy";
      const local = this.getReduciblePosition?.(intent.symbol, intent.strategy);
      const exactSideMatches =
        local === undefined ||
        (local.side === "long" ? intent.signal.side === "sell" : intent.signal.side === "buy");
      const exactQuantityMatches =
        local === undefined || intent.amount <= local.quantity + this.leverage.tolerance;
      // The production Bot supplies exact local position metadata.  A generic
      // caller without it may still submit an emergency close; rejecting a
      // hedged/net-zero symbol would be less safe than allowing the exchange
      // reduce-only invariant to reject it.  Such callers cannot claim a
      // confirmed local close until reconciliation succeeds.
      if (
        (local !== undefined && (!exactSideMatches || !exactQuantityMatches)) ||
        (local === undefined && matchingExposure !== 0 && !sideMatches)
      ) {
        this.counters.rejected++;
        throw new OrderManagerError(
          `[order-manager] invalid reduce-only close for ${intent.symbol}: side/quantity does not match open exposure`,
          new Error("invalid reduce-only close"),
        );
      }
    }
    const totalNotional = reducing ? existingNotional : existingNotional + effectiveNotional;

    try {
      assertLeverageInvariant(totalNotional, ctx.equityUsd, this.leverage);
    } catch (err) {
      this.counters.rejected++;
      this.logger.error("[order-manager] L2 leverage check rejected order", {
        symbol: intent.symbol,
        amount: intent.amount,
        referencePrice: intent.referencePrice,
        notional,
        effectiveLeverage,
        effectiveNotional,
        existingNotional,
        totalNotional,
        equityUsd: ctx.equityUsd,
        reason: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof Error) {
        throw new OrderManagerError(
          `[order-manager] L2 leverage breach for ${intent.symbol}: ${err.message}`,
          err,
        );
      }
      throw new OrderManagerError("[order-manager] L2 leverage breach", err);
    }

    // -----------------------------------------------------------------------
    // `clientOrderId` generálás — deterministic + egyedi.
    //
    // A `hint ?? "bot"` prefixből + timestampból + counters.placed
    // számlálóból építkezünk. A feed-en a CCXT Pro `clientOrderId`-t
    // a szerver-oldali dedup-hoz használja — így a bot újraindításkor
    // sem keletkezik duplikátum.
    // -----------------------------------------------------------------------
    const clientOrderId = this.generateClientOrderId(intent.clientOrderIdHint);

    // -----------------------------------------------------------------------
    // `OrderRequest` összeállítás + `feed.placeOrder`.
    // -----------------------------------------------------------------------
    const orderRequest: OrderRequest = {
      clientOrderId,
      symbol: intent.symbol,
      side: intent.signal.side,
      type: intent.type,
      amount: intent.amount,
      ...(intent.type === "limit" ? { price: intent.limitPrice ?? intent.referencePrice } : {}),
      ...(reducing ? { reduceOnly: true } : {}),
      ...(intent.protectiveKind !== undefined
        ? { protectiveKind: intent.protectiveKind, triggerPrice: intent.triggerPrice }
        : {}),
    };

    let order: Order;
    if (this.paperMode) {
      // Phase 66: paper mode — simulate a filled order locally. The bybit.eu
      // `feed.placeOrder` requires API credentials we don't have, but the
      // strategy logic + L2 leverage check + recordFill path must still run
      // so the position book reflects the simulated trade.
      //
      // The Order shape follows the `Order` type in
      // `packages/exchange/src/types.ts:91` (the only normalized shape the
      // rest of the codebase consumes). The OrderStatus union is
      // `"open" | "closed" | "canceled"` (no `"filled"`) — the codebase
      // normalizes bybit's `"filled"` response to `"closed"` in
      // `bybitEuFeed.ts:606`. We use `"closed"` here for consistency.
      //
      // NOTE: the `Order` type does NOT carry `fee` / `feeCurrency` /
      // `remaining` / `createdAt` / `averagePrice` — those are tracked
      // separately in the position book (`PositionManager.recordFill`
      // computes fee from the fill amount + a 10bps spot-taker estimate
      // in `position-manager.ts`).
      order = {
        clientOrderId,
        exchangeId:
          `paper-${String(Date.now())}-${String(this.counters.placed)}` as unknown as ExchangeOrderId,
        symbol: intent.symbol,
        side: intent.signal.side,
        type: intent.type,
        amount: intent.amount,
        price: intent.referencePrice,
        status: "closed" as const,
        filled: intent.amount,
        average: intent.referencePrice,
        submitTimestamp: Date.now(),
        updateTimestamp: Date.now(),
      };
      this.logger.info("[order-manager] paper-mode order simulated (no exchange call)", {
        symbol: intent.symbol,
        clientOrderId,
        side: order.side,
        amount: order.amount,
        price: order.price,
      });
    } else {
      try {
        order = await this.feed.placeOrder(orderRequest);
      } catch (err) {
        this.counters.rejected++;
        this.logger.error("[order-manager] feed.placeOrder failed", {
          symbol: intent.symbol,
          clientOrderId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new OrderManagerError(
          `[order-manager] placeOrder failed for ${intent.symbol} (clientOrderId=${clientOrderId}): ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
    }

    this.inFlight.set(clientOrderId, order);
    this.bookedCumulative.set(clientOrderId, order.filled);
    this.snapshotRecoveryCoverage.set(clientOrderId, order.filled);
    this.rememberOrder(order);
    this.counters.placed++;
    this.logger.info("[order-manager] order placed", {
      symbol: intent.symbol,
      side: order.side,
      type: order.type,
      amount: order.amount,
      price: order.price,
      clientOrderId,
    });
    return order;
  }

  /**
   * `cancelOrder` — visszavonás az exchange-en. A feed wrapper-e
   * a `cancelOrder`-t hívja. Az in-flight tracking-ből töröljük a
   * clientOrderId-t, ha sikeresen zártuk.
   */
  public async cancelOrder(clientOrderId: ClientOrderId, symbol: Symbol): Promise<Order> {
    try {
      const prior = this.inFlight.get(clientOrderId);
      const order = await this.feed.cancelOrder(clientOrderId, symbol);
      this.inFlight.delete(clientOrderId);
      if (prior !== undefined) {
        this.cancelRaceOrders.set(clientOrderId, prior);
        if (this.cancelRaceOrders.size > 1_000) {
          const oldest = this.cancelRaceOrders.keys().next().value;
          if (oldest !== undefined) this.cancelRaceOrders.delete(oldest);
        }
      }
      this.counters.cancelled++;
      this.logger.info("[order-manager] order cancelled", {
        clientOrderId,
        symbol,
      });
      return order;
    } catch (err) {
      this.logger.error("[order-manager] cancelOrder failed", {
        clientOrderId,
        symbol,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new OrderManagerError(
        `[order-manager] cancelOrder failed for ${clientOrderId} on ${symbol}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  /**
   * `getOpenOrders` — wrapper a `feed.fetchOpenOrders` köré. A
   * visszatérési érték az exchange-en ténylegesen nyitott rendelések
   * listája. Az in-flight cache-ünk nem a single source of truth —
   * a feed-en lévő állapot a mérvadó.
   */
  public async getOpenOrders(symbol: Symbol): Promise<readonly Order[]> {
    try {
      return await this.feed.fetchOpenOrders(symbol);
    } catch (err) {
      this.logger.error("[order-manager] fetchOpenOrders failed", {
        symbol,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new OrderManagerError(
        `[order-manager] fetchOpenOrders failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  /**
   * `recordFill` — a PositionManager hívja, amikor egy order FILLED
   * státuszra vált. Az in-flight cache frissül, és a `filled` számláló
   * nő.
   *
   * Ez a metódus NEM ellenőrzi a leverage-et — az L3 a
   * `PositionManager.recordFill`-ben van. A kettős számlálás elkerülése
   * végett az OrderManager csak az adminisztrációért felel.
   */
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
    if (this.inFlight.has(clientOrderId)) {
      this.inFlight.set(clientOrderId, updated);
      if (updated.status === "closed") {
        this.counters.filled++;
        this.inFlight.delete(clientOrderId);
      } else if (updated.status === "canceled") {
        this.inFlight.delete(clientOrderId);
      }
    }
  }

  /**
   * Bounded REST reconciliation fallback for the private order stream.
   * `deltaFilled` is calculated from the monotonic cumulative CCXT `filled`
   * field, so repeated snapshots and late duplicate updates cannot book a
   * fill twice.  Without execution IDs the delta is valued at the latest
   * exchange cumulative average; this limitation is explicit at this boundary.
   */
  public async reconcileOrder(
    clientOrderId: ClientOrderId,
    symbol: Symbol,
  ): Promise<{ readonly order: Order; readonly deltaFilled: number }> {
    const previous = this.findKnownOrder(clientOrderId);
    let updated: Order;
    try {
      updated = await this.feed.fetchOrder(clientOrderId, symbol);
    } catch (err) {
      throw new OrderManagerError(
        `[order-manager] reconcile fetchOrder failed for ${clientOrderId}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    const { merged, deltaFilled } = this.applyOrderSnapshot(updated, previous);
    updated = merged;
    this.inFlight.set(clientOrderId, updated);
    if (updated.status === "closed") {
      this.counters.filled++;
      this.inFlight.delete(clientOrderId);
    } else if (updated.status === "canceled") {
      this.counters.cancelled++;
      this.inFlight.delete(clientOrderId);
    }
    return { order: updated, deltaFilled };
  }

  /** Register a consumer for normalized private order/execution progress. */
  public onLifecycle(listener: OrderLifecycleListener): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  /** Start authenticated WS reconciliation; REST fetchOrder stays recovery-only. */
  public async startLifecycle(): Promise<void> {
    if (this.paperMode || this.lifecycleSubscriptions.length > 0) return;
    if (this.feed.subscribeOrderUpdates !== undefined) {
      this.lifecycleSubscriptions.push(
        await this.feed.subscribeOrderUpdates((event) => {
          this.handleLifecycleFeedEvent(event);
        }),
      );
    }
    if (this.feed.subscribeExecutions !== undefined) {
      this.lifecycleSubscriptions.push(
        await this.feed.subscribeExecutions((event) => {
          this.handleLifecycleFeedEvent(event);
        }),
      );
    }
  }

  /** Stop/unwatch private streams before the exchange connection is closed. */
  public async stopLifecycle(): Promise<void> {
    const ids = this.lifecycleSubscriptions.splice(0);
    await Promise.all(ids.map(async (id) => this.feed.unsubscribe(id)));
  }

  private handleLifecycleFeedEvent(event: FeedEvent): void {
    if (event.kind === "order") {
      const updated = event.payload;
      const previous = this.findKnownOrder(updated.clientOrderId);
      if (previous === undefined) return;
      const { merged, deltaFilled } = this.applyOrderSnapshot(updated, previous);
      this.updateTrackedOrder(merged);
      this.emitLifecycle({ kind: "order", order: merged, deltaFilled });
      return;
    }
    if (event.kind !== "execution") return;
    const execution = event.payload;
    if (this.seenExecutionIds.has(execution.executionId)) return;
    this.seenExecutionIds.add(execution.executionId);
    const clientOrderId =
      execution.clientOrderId ??
      [...this.knownOrders.values()].find((order) => order.exchangeId === execution.exchangeOrderId)
        ?.clientOrderId;
    if (clientOrderId === undefined) return;
    const previous = this.findKnownOrder(clientOrderId);
    if (previous === undefined) return;
    const prior = this.bookedCumulative.get(clientOrderId) ?? 0;
    const recoveryCoverage = this.snapshotRecoveryCoverage.get(clientOrderId) ?? 0;
    const absorbedByRecovery = Math.min(recoveryCoverage, execution.quantity);
    this.snapshotRecoveryCoverage.set(clientOrderId, recoveryCoverage - absorbedByRecovery);
    this.executionCumulative.set(
      clientOrderId,
      (this.executionCumulative.get(clientOrderId) ?? 0) + execution.quantity,
    );
    const deltaFilled = Math.max(
      0,
      Math.min(execution.quantity - absorbedByRecovery, previous.amount - prior),
    );
    const cumulative = prior + deltaFilled;
    const previousValue = prior * (previous.average ?? execution.price);
    const average =
      cumulative > 0 ? (previousValue + deltaFilled * execution.price) / cumulative : previous.average;
    const merged: Order = {
      ...previous,
      filled: cumulative,
      average,
      status: cumulative >= previous.amount ? "closed" : previous.status === "canceled" ? "canceled" : "open",
      updateTimestamp: execution.timestamp,
    };
    this.bookedCumulative.set(clientOrderId, cumulative);
    this.updateTrackedOrder(merged);
    this.emitLifecycle({ kind: "execution", order: merged, execution, deltaFilled });
  }

  private updateTrackedOrder(order: Order): void {
    this.rememberOrder(order);
    if (order.status === "open") {
      if (this.cancelRaceOrders.has(order.clientOrderId))
        this.cancelRaceOrders.set(order.clientOrderId, order);
      else this.inFlight.set(order.clientOrderId, order);
    } else if (order.status === "canceled" && this.cancelRaceOrders.has(order.clientOrderId)) {
      this.cancelRaceOrders.set(order.clientOrderId, order);
    } else {
      this.inFlight.delete(order.clientOrderId);
      this.cancelRaceOrders.delete(order.clientOrderId);
    }
  }

  /**
   * Order cumulative fill is a recovery checkpoint, never an independent fill
   * stream.  Only the part not yet booked by executions/snapshots is emitted.
   * If the matching execution arrives later, `snapshotRecoveryCoverage`
   * absorbs it so order->execution and execution->order converge identically.
   */
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
    while (this.knownOrders.size > 5_000) {
      const oldest = this.knownOrders.keys().next().value;
      if (oldest === undefined) break;
      this.knownOrders.delete(oldest);
      this.bookedCumulative.delete(oldest);
      this.snapshotRecoveryCoverage.delete(oldest);
      this.executionCumulative.delete(oldest);
    }
  }

  private emitLifecycle(event: OrderLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch (err) {
        this.logger.error("[order-manager] lifecycle listener failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * `getCounters` — a counters snapshot-ja a Telemetry számára.
   */
  public getCounters(): {
    readonly placed: number;
    readonly filled: number;
    readonly cancelled: number;
    readonly rejected: number;
  } {
    return { ...this.counters };
  }

  /**
   * `getInFlightCount` — hány in-flight order van a cache-ben.
   */
  public getInFlightCount(): number {
    return this.inFlight.size;
  }

  /** True only for the deterministic local paper executor. */
  public isPaperMode(): boolean {
    return this.paperMode;
  }

  /** Snapshot for lifecycle coordinators; exchange state remains authoritative. */
  public getInFlightOrderIds(): readonly ClientOrderId[] {
    return [...this.inFlight.keys()];
  }

  /**
   * Read the venue's position state for an emergency operation.  `undefined`
   * is never used for "no positions": it means the venue cannot authoritatively
   * answer, and the caller must leave its emergency latch retryable.
   */
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
    } catch (err) {
      throw new OrderManagerError(
        `[order-manager] authoritative position query failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  /** Venue wallet state, used to reconcile spot inventory where positions do not exist. */
  public async getAuthoritativeBalances(): Promise<readonly Balance[]> {
    try {
      return await this.feed.fetchBalances();
    } catch (err) {
      throw new OrderManagerError(
        `[order-manager] authoritative balance query failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  /** Market metadata used to distinguish spot inventory from contracts. */
  public async getMarketMeta(symbol: Symbol): Promise<MarketMeta> {
    try {
      return await this.feed.fetchMarketMeta(symbol);
    } catch (err) {
      throw new OrderManagerError(
        `[order-manager] market metadata query failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  /** Latest executable reference price for a venue-only spot emergency close. */
  public async getTickerSnapshot(symbol: Symbol): Promise<Ticker> {
    try {
      return await this.feed.fetchTickerSnapshot(symbol);
    } catch (err) {
      throw new OrderManagerError(
        `[order-manager] ticker query failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  /** Cancel every locally tracked unfilled order before an emergency flatten. */
  public async cancelTrackedOrders(
    preserve: ReadonlySet<ClientOrderId> = new Set(),
  ): Promise<
    readonly { readonly clientOrderId: ClientOrderId; readonly symbol: Symbol; readonly error?: string }[]
  > {
    const tracked = [...this.inFlight.values()].filter((order) => !preserve.has(order.clientOrderId));
    return Promise.all(
      tracked.map(async (order) => {
        if (order.status !== "open") return { clientOrderId: order.clientOrderId, symbol: order.symbol };
        try {
          await this.cancelOrder(order.clientOrderId, order.symbol);
          return { clientOrderId: order.clientOrderId, symbol: order.symbol };
        } catch (err) {
          return {
            clientOrderId: order.clientOrderId,
            symbol: order.symbol,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
  }

  /**
   * `generateClientOrderId` — a `clientOrderId` előállítása. A `hint`
   * opcionális prefix; ha nincs, a default `"bot"`. A végén egy
   * sorszám biztosítja az egyediséget.
   */
  private generateClientOrderId(hint: string | undefined): ClientOrderId {
    const prefix = hint ?? "bot";
    const ts = Date.now().toString(36);
    const seq = this.counters.placed.toString(36);
    const id = `${prefix}-${ts}-${seq}`;
    return id as Brand<string, "ClientOrderId">;
  }
}

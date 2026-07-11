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
import type { ClientOrderId, ExchangeFeed, Order, OrderRequest, Symbol } from "@mm-crypto-bot/exchange";
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
  readonly leverage?: LeverageInvariantConfig;
  readonly logger?: Logger;
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
  private readonly leverage: LeverageInvariantConfig;
  private readonly logger: Logger;
  private readonly inFlight = new Map<ClientOrderId, Order>();
  private readonly counters = {
    placed: 0,
    filled: 0,
    cancelled: 0,
    rejected: 0,
  };

  public constructor(opts: OrderManagerOptions) {
    this.feed = opts.feed;
    this.getPositionContext = opts.getPositionContext;
    this.leverage = opts.leverage ?? { maxLeverage: 10, tolerance: 1e-6, warnOnApproach: 0.95 };
    this.logger = opts.logger ?? createLogger("info");
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
    const existingNotional = ctx.positions.reduce((acc, p) => acc + Math.abs(p.effectiveNotionalUsd), 0);
    const totalNotional = existingNotional + notional;

    try {
      assertLeverageInvariant(totalNotional, ctx.equityUsd, this.leverage);
    } catch (err) {
      this.counters.rejected++;
      this.logger.error("[order-manager] L2 leverage check rejected order", {
        symbol: intent.symbol,
        amount: intent.amount,
        referencePrice: intent.referencePrice,
        notional,
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
      ...(intent.signal.takeProfit > 0 ? { takeProfitPrice: intent.signal.takeProfit } : {}),
      ...(intent.signal.stopLoss > 0 ? { stopLossPrice: intent.signal.stopLoss } : {}),
    };

    let order: Order;
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

    this.inFlight.set(clientOrderId, order);
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
      const order = await this.feed.cancelOrder(clientOrderId, symbol);
      this.inFlight.delete(clientOrderId);
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
   * `getCounters` — a counters snapshot-ja a Telemetry számára.
   */
  public getCounters(): { readonly placed: number; readonly filled: number; readonly cancelled: number; readonly rejected: number } {
    return { ...this.counters };
  }

  /**
   * `getInFlightCount` — hány in-flight order van a cache-ben.
   */
  public getInFlightCount(): number {
    return this.inFlight.size;
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

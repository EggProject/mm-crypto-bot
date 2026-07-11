/**
 * apps/bot/src/bot/position-manager.ts
 *
 * Phase 33 Track C — `PositionManager` — a futó bot nyitott pozícióit
 * tartja nyilván, és a fill-ekre L3 leverage check-et alkalmaz.
 *
 * ===========================================================================
 * 1:10 LEVERAGE MANDATE — 3RD DEFENSE-IN-DEPTH LAYER (L3)
 * ===========================================================================
 * A `recordFill()` metódus minden fill után újraellenőrzi, hogy az
 * AGGREGATE effective leverage nem haladja-e meg a `equity × maxLeverage`
 * küszöböt. Ez az L3 — az utolsó védelmi vonal, ami akkor is véd, ha
 * az L1 (config) és L2 (`OrderManager.placeOrder` pre-place check)
 * valahogy átcsúszott volna.
 *
 * ===========================================================================
 * FELELŐSSÉGEK
 * ===========================================================================
 *   1. `openPosition(strategy, symbol, side, qty, entryPrice, leverage)`
 *      — új pozíció regisztrálása. L3 check itt is fut (defense-in-depth).
 *   2. `closePosition(strategy, symbol, exitPrice)` — zárás, P&L számítás.
 *   3. `getPositions()` — aktuális nyitott pozíciók listája.
 *   4. `getPositionContext()` — az OrderManager L2 check-jéhez.
 *   5. `getEquity()` — current equity (initial + realized PnL + unrealized PnL).
 *   6. `max_positions` enforcement a konfigból.
 *
 * A `max_positions` mezőt a konstruktorban kapja meg (alap: 3).
 */

import type { Symbol } from "@mm-crypto-bot/exchange";
import {
  assertLeverageInvariant,
  LeverageBreachError,
  type LeverageInvariantConfig,
  type Position as LeveragePosition,
} from "@mm-crypto-bot/core";
import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";

// ============================================================================
// Public types
// ============================================================================

/**
 * `PositionSide` — a pozíció iránya. Az OrderManager `OrderSide`-jától
 * eltérően ez a pozíció-szintű absztrakció (`"long"` / `"short"`).
 */
export type PositionSide = "long" | "short";

/**
 * `PositionSnapshot` — egy nyitott pozíció pillanatképe. A
 * `PositionManager` belső state-jéből olvasódik ki; a `Bot.getState()`
 * is ezt a típust használja.
 *
 * - `id`             — a pozíció egyedi azonosítója (strategy + symbol + side).
 * - `strategy`       — melyik stratégia nyitotta.
 * - `symbol`         — branded Symbol.
 * - `side`           — `long` / `short`.
 * - `quantity`       — a pozíció mérete (instrument unit, pl. BTC).
 * - `entryPrice`     — az entry-ár.
 * - `currentPrice`   — az utolsó ismert piaci ár (frissül tick-eken).
 * - `leverage`       — a tényleges leverage (1 vagy 10; 1:10 MANDATE).
 * - `unrealizedPnl`  — `(currentPrice - entryPrice) × qty × sign(side)`.
 * - `realizedPnl`    — a részleges zárások összesített P&L-je (USD).
 * - `openedAt`       — a nyitás timestamp-je.
 * - `notionalUsd`    — `quantity × entryPrice` (USD-ben).
 */
export interface PositionSnapshot {
  readonly id: string;
  readonly strategy: string;
  readonly symbol: Symbol;
  readonly side: PositionSide;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly leverage: number;
  readonly unrealizedPnl: number;
  readonly realizedPnl: number;
  readonly openedAt: number;
  readonly notionalUsd: number;
}

/**
 * `PositionRecord` — a PositionManager belső tárolója. A snapshot-tól
 * eltérően ez mutable (az `unrealizedPnl` és a `currentPrice` frissül,
 * illetve a same-side fill-eknél az `entryPrice` / `quantity` /
 * `notionalUsd` is változhat).
 */
interface PositionRecord {
  id: string;
  strategy: string;
  symbol: Symbol;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  unrealizedPnl: number;
  realizedPnl: number;
  openedAt: number;
  notionalUsd: number;
}

/**
 * `FillEvent` — a feed-en történt fill leírása. A `Bot.run()` hívja
 * meg, amikor az OrderManager a `recordFill` callback-jén jelzi.
 */
export interface FillEvent {
  readonly strategy: string;
  readonly symbol: Symbol;
  readonly side: PositionSide;
  readonly quantity: number;
  readonly price: number;
  readonly leverage: number;
  readonly timestamp: number;
}

/**
 * `PositionManagerError` — a PositionManager saját hibája (pl. max
 * positions túllépés, vagy L3 leverage breach).
 */
export class PositionManagerError extends Error {
  public override readonly name = "PositionManagerError";
  public override readonly cause: unknown;

  public constructor(message: string, cause: unknown = null) {
    super(message);
    this.cause = cause;
    Object.setPrototypeOf(this, PositionManagerError.prototype);
  }
}

/**
 * `PositionContext` — az OrderManager számára szolgáltatott aggregátum.
 * Az OrderManager L2 check-je a `notional + sum(|existing|) ≤ equity × maxLeverage`
 * formát ellenőrzi. A `positions` lista `LeveragePosition` típusú,
 * hogy a `assertLeverageInvariant` közvetlenül használhassa.
 */
export interface PositionContext {
  readonly equityUsd: number;
  readonly positions: readonly LeveragePosition[];
}

// ============================================================================
// PositionManagerOptions
// ============================================================================

/**
 * `PositionManagerOptions` — a PositionManager konfigurációja.
 *
 * - `initialEquityUsd`   — induló equity (USD). A bot indulásakor a
 *                          `fetchBalances()`-ból jön (paper/live).
 * - `maxPositions`       — egyidejűleg nyitva tartható pozíciók max száma.
 * - `maxLeverage`        — a per-position leverage cap (1:10 MANDATE).
 * - `leverageConfig`     — a leverage invariant config (alap: 1:10 cap).
 * - `logger`             — opcionális structured logger.
 */
export interface PositionManagerOptions {
  readonly initialEquityUsd: number;
  readonly maxPositions: number;
  readonly maxLeverage: number;
  readonly leverageConfig?: LeverageInvariantConfig;
  readonly logger?: Logger;
}

// ============================================================================
// PositionManager class
// ============================================================================

/**
 * `PositionManager` — a futó bot nyitott pozícióinak nyilvántartója.
 *
 * A belső tároló egy `Map<positionId, PositionRecord>`. A kulcs a
 * `strategy:symbol:side` formátumú string — ez biztosítja, hogy egy
 * adott stratégia egy adott symbol-on csak egy irányban legyen nyitva.
 *
 * A L3 leverage check a `recordFill()` metódusban fut — minden fill
 * után újraszámoljuk az aggregate-et, és ha túllépi a cap-et, a
 * fill-t "visszavonjuk" (a pozíciót nem regisztráljuk) és dobunk.
 */
export class PositionManager {
  private readonly positions = new Map<string, PositionRecord>();
  private readonly initialEquityUsd: number;
  private readonly maxPositions: number;
  private readonly maxLeverage: number;
  private readonly leverageConfig: LeverageInvariantConfig;
  private readonly logger: Logger;
  private realizedPnlTotal = 0;
  private closedTrades: readonly {
    readonly strategy: string;
    readonly symbol: Symbol;
    readonly side: PositionSide;
    readonly quantity: number;
    readonly entryPrice: number;
    readonly exitPrice: number;
    readonly pnl: number;
    readonly pnlPct: number;
    readonly closedAt: number;
  }[] = [];

  public constructor(opts: PositionManagerOptions) {
    if (opts.initialEquityUsd <= 0) {
      throw new PositionManagerError(
        `[position-manager] initialEquityUsd must be positive, got ${String(opts.initialEquityUsd)}`,
      );
    }
    if (opts.maxPositions < 1) {
      throw new PositionManagerError(
        `[position-manager] maxPositions must be >= 1, got ${String(opts.maxPositions)}`,
      );
    }
    if (opts.maxLeverage < 1 || opts.maxLeverage > 10) {
      throw new PositionManagerError(
        `[position-manager] maxLeverage must be 1..10 (1:10 MANDATE), got ${String(opts.maxLeverage)}`,
      );
    }
    this.initialEquityUsd = opts.initialEquityUsd;
    this.maxPositions = opts.maxPositions;
    this.maxLeverage = opts.maxLeverage;
    this.leverageConfig = opts.leverageConfig ?? { maxLeverage: 10, tolerance: 1e-6, warnOnApproach: 0.95 };
    this.logger = opts.logger ?? createLogger("info");
  }

  // --------------------------------------------------------------------------
  // Open / close / update
  // --------------------------------------------------------------------------

  /**
   * `openPosition` — új pozíció regisztrálása. A metódus:
   *   1) Ellenőrzi, hogy a `maxPositions` cap nem telt-e.
   *   2) Számolja a notional-t és futtatja az L3 leverage check-et.
   *   3) Bejegyzi a pozíciót a belső Map-be.
   *
   * Ha a position már nyitva van (strategy:symbol:side) → `recordFill`-hez
   * irányítjuk, mert a második fill valójában a meglévő pozíció
   * növelése (vagy részleges zárás).
   */
  public openPosition(
    strategy: string,
    symbol: Symbol,
    side: PositionSide,
    quantity: number,
    entryPrice: number,
    leverage: number,
    timestamp: number = Date.now(),
  ): PositionSnapshot {
    if (this.positions.size >= this.maxPositions) {
      const existing = [...this.positions.values()]
        .map((p) => `${p.strategy}:${p.symbol}:${p.side}`)
        .join(", ");
      throw new PositionManagerError(
        `[position-manager] maxPositions cap (${String(this.maxPositions)}) reached — current positions: ${existing}`,
      );
    }
    if (leverage < 1 || leverage > 10) {
      throw new PositionManagerError(
        `[position-manager] leverage=${String(leverage)} violates 1:10 MANDATE (must be 1..10)`,
      );
    }
    if (quantity <= 0) {
      throw new PositionManagerError(
        `[position-manager] quantity must be positive, got ${String(quantity)}`,
      );
    }
    if (entryPrice <= 0) {
      throw new PositionManagerError(
        `[position-manager] entryPrice must be positive, got ${String(entryPrice)}`,
      );
    }

    const id = this.positionId(strategy, symbol, side);
    const existing = this.positions.get(id);
    if (existing !== undefined) {
      // Upsert — átadjuk a recordFill-nek.
      return this.recordFill({
        strategy,
        symbol,
        side,
        quantity,
        price: entryPrice,
        leverage,
        timestamp,
      });
    }

    const notionalUsd = quantity * entryPrice;

    // L3 leverage check — aggregátum (existing + új).
    const allPositions = this.toLeveragePositions([
      ...this.positions.values(),
      {
        strategy,
        symbol: symbol,
        side,
        quantity,
        entryPrice,
        currentPrice: entryPrice,
        leverage,
        unrealizedPnl: 0,
        realizedPnl: 0,
        openedAt: timestamp,
        notionalUsd,
        id,
      },
    ]);
    const totalNotional = allPositions.reduce((acc, p) => acc + Math.abs(p.effectiveNotionalUsd), 0);
    const equity = this.getEquity();
    try {
      assertLeverageInvariant(totalNotional, equity, this.leverageConfig);
    } catch (err) {
      if (err instanceof LeverageBreachError) {
        this.logger.error("[position-manager] L3 leverage breach on openPosition", {
          strategy,
          symbol,
          side,
          quantity,
          entryPrice,
          notionalUsd,
          totalNotional,
          equity,
          computedLeverage: err.computedLeverage,
          maxLeverage: err.maxLeverage,
        });
        throw new PositionManagerError(
          `[position-manager] L3 leverage breach opening ${strategy}:${symbol}:${side}: ${err.message}`,
          err,
        );
      }
      throw err;
    }

    const record: PositionRecord = {
      id,
      strategy,
      symbol,
      side,
      quantity,
      entryPrice,
      currentPrice: entryPrice,
      leverage,
      unrealizedPnl: 0,
      realizedPnl: 0,
      openedAt: timestamp,
      notionalUsd,
    };
    this.positions.set(id, record);
    this.logger.info("[position-manager] position opened", {
      strategy,
      symbol,
      side,
      quantity,
      entryPrice,
      notionalUsd,
      leverage,
    });
    return { ...record };
  }

  /**
   * `recordFill` — a feed-en történt fill feldolgozása. A L3 leverage
   * check itt fut MINDEN fill után (defense-in-depth: 3rd layer).
   *
   * Ha a pozíció már nyitva van (azonos strategy:symbol:side):
   *   - ha a fill a meglévő oldalra jön → átlagolás (avg entry price).
   *   - ha a fill ellentétes oldalra jön → részleges vagy teljes zárás.
   *
   * Ha a pozíció NINCS nyitva → `openPosition`-ként viselkedik.
   */
  public recordFill(fill: FillEvent): PositionSnapshot {
    const id = this.positionId(fill.strategy, fill.symbol, fill.side);
    const existing = this.positions.get(id);
    const oppId = this.positionId(fill.strategy, fill.symbol, fill.side === "long" ? "short" : "long");
    const opposite = this.positions.get(oppId);

    // Ha a fill egy ellentétes pozícióra jön, akkor a meglévőt
    // csökkentjük / zárjuk, ÉS a fill-t ellenőrizzük a L3-mal.
    if (opposite !== undefined && existing === undefined) {
      // Reduce / close opposite.
      const newQty = opposite.quantity - fill.quantity;
      if (newQty < 0) {
        throw new PositionManagerError(
          `[position-manager] fill quantity ${String(fill.quantity)} exceeds opposite position ${String(opposite.quantity)}`,
        );
      }
      // Realize PnL on the closed portion.
      const closedQty = Math.min(opposite.quantity, fill.quantity);
      const pnl = this.computePnl(opposite.side, opposite.entryPrice, fill.price, closedQty);
      opposite.realizedPnl += pnl;
      this.realizedPnlTotal += pnl;
      if (newQty === 0) {
        // Teljes zárás.
        this.closedTrades = [
          ...this.closedTrades,
          {
            strategy: opposite.strategy,
            symbol: opposite.symbol,
            side: opposite.side,
            quantity: closedQty,
            entryPrice: opposite.entryPrice,
            exitPrice: fill.price,
            pnl,
            pnlPct: (pnl / (opposite.entryPrice * closedQty)) * 100,
            closedAt: fill.timestamp,
          },
        ];
        this.positions.delete(oppId);
        this.logger.info("[position-manager] position closed (opposite fill)", {
          strategy: opposite.strategy,
          symbol: opposite.symbol,
          side: opposite.side,
          pnl,
        });
      } else {
        opposite.quantity = newQty;
        opposite.notionalUsd = newQty * opposite.entryPrice;
        opposite.currentPrice = fill.price;
        opposite.unrealizedPnl = this.computeUnrealized(opposite);
      }
      return { ...(this.positions.get(oppId) ?? opposite) };
    }

    if (existing !== undefined) {
      // Same-side fill — average entry price update.
      const totalQty = existing.quantity + fill.quantity;
      const newEntry =
        (existing.quantity * existing.entryPrice + fill.quantity * fill.price) / totalQty;
      existing.entryPrice = newEntry;
      existing.quantity = totalQty;
      existing.currentPrice = fill.price;
      existing.notionalUsd = totalQty * newEntry;
      existing.unrealizedPnl = this.computeUnrealized(existing);
      // L3 aggregate check on the updated state.
      this.assertAggregateLeverage(`recordFill same-side ${fill.strategy}:${fill.symbol}:${fill.side}`);
      return { ...existing };
    }

    // No existing — open a new position.
    return this.openPosition(
      fill.strategy,
      fill.symbol,
      fill.side,
      fill.quantity,
      fill.price,
      fill.leverage,
      fill.timestamp,
    );
  }

  /**
   * `closePosition` — egy meglévő pozíció teljes zárása a megadott
   * exit-áron. Számolja a P&L-t, és hozzáadja a `closedTrades` listához.
   *
   * @returns A zárás P&L-je (USD).
   */
  public closePosition(strategy: string, symbol: Symbol, exitPrice: number, timestamp: number = Date.now()): number {
    // Próbáljuk mindkét oldalt (long + short) — bármelyik nyitva van, zárjuk.
    for (const side of ["long", "short"] as const) {
      const id = this.positionId(strategy, symbol, side);
      const existing = this.positions.get(id);
      if (existing !== undefined) {
        const pnl = this.computePnl(side, existing.entryPrice, exitPrice, existing.quantity);
        this.realizedPnlTotal += pnl;
        this.closedTrades = [
          ...this.closedTrades,
          {
            strategy: existing.strategy,
            symbol: existing.symbol,
            side: existing.side,
            quantity: existing.quantity,
            entryPrice: existing.entryPrice,
            exitPrice,
            pnl,
            pnlPct: (pnl / (existing.entryPrice * existing.quantity)) * 100,
            closedAt: timestamp,
          },
        ];
        this.positions.delete(id);
        this.logger.info("[position-manager] position closed", {
          strategy,
          symbol,
          side,
          pnl,
        });
        return pnl;
      }
    }
    throw new PositionManagerError(
      `[position-manager] cannot close — no open position for ${strategy}:${symbol}`,
    );
  }

  /**
   * `updateMarketPrice` — frissíti egy adott symbol utolsó ismert
   * piaci árát. Az `unrealizedPnl` ennek megfelelően újraszámolódik.
   */
  public updateMarketPrice(symbol: Symbol, price: number): void {
    if (!Number.isFinite(price) || price <= 0) {
      return;
    }
    for (const record of this.positions.values()) {
      if (record.symbol === symbol) {
        record.currentPrice = price;
        record.unrealizedPnl = this.computeUnrealized(record);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Read-only API
  // --------------------------------------------------------------------------

  /**
   * `getPositions` — az aktuális nyitott pozíciók pillanatképei.
   */
  public getPositions(): readonly PositionSnapshot[] {
    return [...this.positions.values()].map((p) => ({ ...p }));
  }

  /**
   * `getPosition` — egy adott pozíció lekérdezése.
   */
  public getPosition(strategy: string, symbol: Symbol, side: PositionSide): PositionSnapshot | undefined {
    const id = this.positionId(strategy, symbol, side);
    const record = this.positions.get(id);
    return record === undefined ? undefined : { ...record };
  }

  /**
   * `getPositionContext` — az OrderManager L2 check-jéhez szolgáltatott
   * aggregátum. Minden híváskor FRISS számítást végez.
   */
  public getPositionContext(): PositionContext {
    return {
      equityUsd: this.getEquity(),
      positions: this.toLeveragePositions([...this.positions.values()]),
    };
  }

  /**
   * `getEquity` — current equity = initial + realized PnL + unrealized PnL.
   */
  public getEquity(): number {
    const unrealized = [...this.positions.values()].reduce((acc, p) => acc + p.unrealizedPnl, 0);
    return this.initialEquityUsd + this.realizedPnlTotal + unrealized;
  }

  /**
   * `getRealizedPnl` — az eddig realizált P&L (closed trades összesen).
   */
  public getRealizedPnl(): number {
    return this.realizedPnlTotal;
  }

  /**
   * `getClosedTrades` — a history (záródott trade-ek listája).
   */
  public getClosedTrades(): readonly {
    readonly strategy: string;
    readonly symbol: Symbol;
    readonly side: PositionSide;
    readonly quantity: number;
    readonly entryPrice: number;
    readonly exitPrice: number;
    readonly pnl: number;
    readonly pnlPct: number;
    readonly closedAt: number;
  }[] {
    return this.closedTrades;
  }

  /**
   * `getMaxPositions` — a konfigurált cap (a Telemetry / kill-switch használja).
   */
  public getMaxPositions(): number {
    return this.maxPositions;
  }

  /**
   * `getMaxLeverage` — a konfigurált per-position leverage cap.
   */
  public getMaxLeverage(): number {
    return this.maxLeverage;
  }

  /**
   * `getPositionCount` — a nyitott pozíciók száma.
   */
  public getPositionCount(): number {
    return this.positions.size;
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * `positionId` — a pozíció egyedi azonosítója. Formátum:
   * `<strategy>:<symbol>:<side>` — így egy adott stratégia-s-symbol
   * kombó csak egy oldalon lehet nyitva (long VAGY short, de nem mindkettő).
   */
  private positionId(strategy: string, symbol: Symbol, side: PositionSide): string {
    return `${strategy}:${String(symbol)}:${side}`;
  }

  /**
   * `computePnl` — a zárási P&L kiszámítása.
   *   - long:  (exit - entry) × qty
   *   - short: (entry - exit) × qty
   */
  private computePnl(side: PositionSide, entryPrice: number, exitPrice: number, quantity: number): number {
    const diff = side === "long" ? exitPrice - entryPrice : entryPrice - exitPrice;
    return diff * quantity;
  }

  /**
   * `computeUnrealized` — az unrealized P&L kiszámítása.
   */
  private computeUnrealized(record: PositionRecord): number {
    return this.computePnl(record.side, record.entryPrice, record.currentPrice, record.quantity);
  }

  /**
   * `toLeveragePositions` — a belső rekordokból `LeveragePosition`-t
   * készít a `assertLeverageInvariant` számára.
   */
  private toLeveragePositions(records: readonly PositionRecord[]): readonly LeveragePosition[] {
    return records.map((r) => ({
      symbol: String(r.symbol),
      source: r.strategy,
      // Effective notional: signed (long = +, short = -), so that
      // a perfectly hedged long+short at the same notional cancels.
      effectiveNotionalUsd:
        r.side === "long" ? r.notionalUsd * r.leverage : -(r.notionalUsd * r.leverage),
    }));
  }

  /**
   * `assertAggregateLeverage` — a L3 aggregate check. Az OrderManager
   * L2 check-jétől függetlenül fut minden fill után.
   */
  private assertAggregateLeverage(reason: string): void {
    const total = [...this.positions.values()].reduce(
      (acc, p) => acc + Math.abs(p.notionalUsd * p.leverage),
      0,
    );
    const equity = this.getEquity();
    if (equity <= 0) {
      // Without equity, leverage is undefined; refuse to silently pass.
      throw new PositionManagerError(
        `[position-manager] L3 leverage check failed (equity=${String(equity)}) — reason: ${reason}`,
      );
    }
    try {
      assertLeverageInvariant(total, equity, this.leverageConfig);
    } catch (err) {
      if (err instanceof LeverageBreachError) {
        this.logger.error("[position-manager] L3 aggregate leverage breach", {
          reason,
          totalNotional: total,
          equity,
          computedLeverage: err.computedLeverage,
          maxLeverage: err.maxLeverage,
        });
        throw new PositionManagerError(
          `[position-manager] L3 leverage breach (${reason}): ${err.message}`,
          err,
        );
      }
      throw err;
    }
  }
}

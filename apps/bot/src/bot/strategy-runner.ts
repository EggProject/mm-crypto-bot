/**
 * apps/bot/src/bot/strategy-runner.ts
 *
 * Phase 33 Track C — `StrategyRunner` — a futó stratégiák + signal-
 * center plugin-ok esemény-loopja.
 *
 * ===========================================================================
 * FELELŐSSÉGEK
 * ===========================================================================
 *   1) Nyilvántartja az aktív stratégiákat + plugin-okat (a Track B
 *      `createStrategyInstances` Map-jéből jön).
 *   2) A feed-en érkező `FeedEvent`-et átalakítja a megfelelő formátumra:
 *      - `ohlcv` event → `StrategyContext` (candle + HTF/MTF/LTF indikátorok).
 *      - `ticker` event → market price update (a PositionManager `updateMarketPrice`).
 *      - `trade` event → figyelmen kívül hagyjuk (a StrategySignal a primary trigger).
 *   3) A `Strategy.onCandle` visszatérési `StrategySignal`-ját átadja
 *      az `OrderManager.placeOrder`-nek.
 *   4) Per-strategy state: utolsó signal idő, utolsó candle timestamp.
 *
 * ===========================================================================
 * TERVEZÉS
 * ===========================================================================
 * A StrategyRunner nem tartja a HTF/MTF indikátor-állapotot (a
 * `DonchianPivotComposition` saját maga számolja az M15-ön — lásd
 * `packages/core/src/strategy/donchian-pivot-composition.ts`). A
 * `StrategyContext` HTF/MTF mezői `undefined` maradnak, mert a
 * jelenlegi production stratégiák (Phase 18+) M15-native-ok. A
 * future track-ek (M5 breakout, M1 grid) kerülnek ide.
 *
 * A signal-center plugin-ok (`StrategyPlugin`) a `SignalBus`-on
 * keresztül kapják a feed-et — itt a jelenlegi fázisban NEM
 * iratkozunk fel a bus-ra (a Phase 11+ drop-in-ek jelenleg backtest-
 * only-k, lásd Phase 32 cleanup). A StrategyRunner a `kind: "strategy"`
 * instance-okra koncentrál; a `kind: "plugin"` instance-ok
 * nyilvántartva vannak, de a jelen fázisban nem aktívak (a Phase 33
 * scope plan §"Track C" ezt írja elő).
 */

import type { FeedEvent, Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
import type {
  Strategy,
  StrategyContext,
  StrategySignal,
} from "@mm-crypto-bot/core";
import type { Candle, Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";
import type { Brand } from "@mm-crypto-bot/shared";

import type { StrategyName } from "../config/schema.js";
import type { BotStrategyInstance } from "../config/strategy-registry.js";
import type { RiskManager } from "../risk/index.js";
import type { PortfolioManager } from "../portfolio/index.js";
import type { OrderIntent, OrderManager } from "./order-manager.js";
import type { PositionManager } from "./position-manager.js";
import type { BotState } from "./state-store.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * `StrategyRunnerOptions` — a runner konfigurációja.
 *
 * - `instances`           — a `createStrategyInstances` Map-je.
 * - `orderManager`        — a kitöltendő OrderManager.
 * - `positionManager`     — a nyilvántartó.
 * - `sizingFn`            — a position-sizing függvény (signal + symbol + price → qty).
 * - `enabledSymbols`      — a `config.symbols.enabled` listája.
 * - `riskManager`         — opcionális Phase 37 Track 1 `RiskManager`.
 *                          Ha be van állítva, a Kelly + drawdown scaler
 *                          által javasolt mérettel írja felül a
 *                          `sizingFn` kimenetét.
 * - `portfolioManager`    — opcionális `PortfolioManager` (Phase 37
 *                            Track 4). Ha megadva, a sizing a
 *                            portfolió-büdzsé CAP-jét is figyelembe
 *                            veszi, és a `recordFill` a korreláció-
 *                            mátrixot is frissíti.
 * - `logger`              — opcionális structured logger.
 */
export interface StrategyRunnerOptions {
  readonly instances: ReadonlyMap<StrategyName, BotStrategyInstance>;
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
  readonly sizingFn: SizingFn;
  readonly enabledSymbols: readonly string[];
  readonly riskManager?: RiskManager;
  readonly portfolioManager?: PortfolioManager | null;
  readonly logger?: Logger;
}

/**
 * `SizingFn` — a position-sizing függvény. A `Bot` adja át, és
 * tipikusan a `risk_per_trade × equity / referencePrice` mintát
 * követi. A `referencePrice` azonnali piaci ár.
 */
export type SizingFn = (params: {
  readonly signal: StrategySignal;
  readonly symbol: ExchangeSymbol;
  readonly referencePrice: number;
  readonly equityUsd: number;
  readonly riskPerTrade: number;
}) => number;

/**
 * `StrategyRunnerStats` — a runner statisztikái. A Telemetry / a
 * `Bot.getState()` használja.
 */
export interface StrategyRunnerStats {
  readonly activeStrategies: readonly string[];
  readonly totalSignals: number;
  readonly lastSignalAt: number | null;
  readonly lastSignalStrategy: StrategyName | null;
  readonly ticksProcessed: number;
}

// ============================================================================
// StrategyRunner class
// ============================================================================

/**
 * `StrategyRunner` — a futó stratégiák + plugin-ok esemény-loopja.
 *
 * A `Bot.run()` ciklusban minden bejövő `FeedEvent`-et a `onFeedEvent()`
 * metóduson keresztül dolgoz fel. Az OHLCV event-eket candle-ökké
 * alakítja, és minden `kind: "strategy"` instance `onCandle`-jét
 * meghívja. A visszakapott `StrategySignal`-t az OrderManager-re bízza.
 */
export class StrategyRunner {
  private readonly instances: ReadonlyMap<StrategyName, BotStrategyInstance>;
  private readonly orderManager: OrderManager;
  private readonly positionManager: PositionManager;
  private readonly sizingFn: SizingFn;
  private readonly enabledSymbols: ReadonlySet<ExchangeSymbol>;
  private readonly portfolioManager: PortfolioManager | null;
  private readonly logger: Logger;
  private totalSignals = 0;
  private lastSignalAt: number | null = null;
  private lastSignalStrategy: StrategyName | null = null;
  private ticksProcessed = 0;
  private readonly perStrategyLastSignal = new Map<StrategyName, number>();
  // Cached per-strategy latest close price (for sizing reference).
  private readonly latestPrice = new Map<ExchangeSymbol, number>();

  // Sizing constants
  private readonly riskPerTrade: number = 0.01;

  /**
   * `riskManager` — Phase 37 Track 1. Optional. If set, the runner
   * queries `riskManager.evaluateNewPositionSize(...)` BEFORE
   * calling `sizingFn`, and uses the returned fraction (after
   * dividing by `referencePrice` and multiplying by `equity`).
   * If unset, the legacy `sizingFn` path is used.
   */
  private riskManager: RiskManager | null = null;

  public constructor(opts: StrategyRunnerOptions) {
    this.instances = opts.instances;
    this.orderManager = opts.orderManager;
    this.positionManager = opts.positionManager;
    this.sizingFn = opts.sizingFn;
    this.enabledSymbols = new Set(
      opts.enabledSymbols.map((s) => s as Brand<string, "ExchangeSymbol"> as unknown as ExchangeSymbol),
    );
    this.riskManager = opts.riskManager ?? null;
    this.portfolioManager = opts.portfolioManager ?? null;
    this.logger = opts.logger ?? createLogger("info");
  }

  /**
   * `setRiskManager` — Phase 37 Track 1 wiring. Attach / detach the
   * `RiskManager` that recomputes position size before every order.
   * Detach with `null` to revert to the legacy `sizingFn` path.
   */
  public setRiskManager(rm: RiskManager | null): void {
    this.riskManager = rm;
  }

  // --------------------------------------------------------------------------
  // Event loop
  // --------------------------------------------------------------------------

  /**
   * `onFeedEvent` — a feed-en érkező event feldolgozása.
   *
   * - `ticker`   → frissíti a `latestPrice` cache-t, és a
   *                PositionManager `updateMarketPrice`-ját hívja.
   * - `ohlcv`    → a candle-t `StrategyContext`-té alakítja, és
   *                minden `kind: "strategy"` instance `onCandle`-jét
   *                meghívja. A nem-null `StrategySignal`-t az
   *                OrderManager-re bízza.
   * - `orderbook`/`trade` → figyelmen kívül hagyjuk a jelen fázisban
   *   (a StrategySignal a primary trigger, nem a microstructure).
   */
  public async onFeedEvent(event: FeedEvent): Promise<void> {
    this.ticksProcessed++;
    if (event.kind === "ticker") {
      const t = event.payload;
      if (this.enabledSymbols.has(t.symbol)) {
        this.latestPrice.set(t.symbol, t.last);
        this.positionManager.updateMarketPrice(t.symbol, t.last);
      }
      return;
    }
    if (event.kind === "ohlcv") {
      const { symbol, timeframe, candle } = event.payload;
      if (!this.enabledSymbols.has(symbol)) {
        return;
      }
      this.latestPrice.set(symbol, candle[4]); // close price
      this.positionManager.updateMarketPrice(symbol, candle[4]);
      const ctx: StrategyContext = {
        // exchange Symbol/Timeframe are structurally identical to shared
        // Symbol/Timeframe; the cast is required only because they are
        // distinct brand types in TypeScript.
        symbol: symbol as unknown as StrategyContext["symbol"],
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- brand type difference
        timeframe,
        candleIndex: this.ticksProcessed,
        candle: this.toCandle(candle),
        mtfState: {
          htf: { close: candle[4] },
          mtf: { close: candle[4] },
          ltf: { close: candle[4] },
        },
        pricePrecision: 2,
      };
      for (const instance of this.instances.values()) {
        if (instance.kind !== "strategy") continue;
        try {
          const signal = instance.instance.onCandle(ctx);
          if (signal !== null) {
            await this.handleSignal(
              instance.name,
              instance.instance,
              signal,
              symbol,
              candle[4],
            );
          }
        } catch (err) {
          this.logger.error("[strategy-runner] onCandle threw", {
            strategy: instance.name,
            symbol,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return;
    }
    // orderbook / trade — no-op in this phase.
  }

  /**
   * `getStats` — a runner statisztikái.
   */
  public getStats(): StrategyRunnerStats {
    return {
      activeStrategies: [...this.instances.keys()],
      totalSignals: this.totalSignals,
      lastSignalAt: this.lastSignalAt,
      lastSignalStrategy: this.lastSignalStrategy,
      ticksProcessed: this.ticksProcessed,
    };
  }

  /**
   * `getActiveStrategyNames` — az aktív stratégiák nevei.
   */
  public getActiveStrategyNames(): readonly StrategyName[] {
    return [...this.instances.keys()];
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * `handleSignal` — egy `StrategySignal` feldolgozása: sizing → intent → place.
   *
   * Phase 37 Track 4 — a sizing a `PortfolioManager` büdzsé-CAP-jéhez
   * igazodik:
   *   1) Ha a circuit breaker tüzel (`portfolioManager.isTripped()`),
   *      a signal kihagyásra kerül — semmilyen új order nem indul.
   *   2) A büdzsé (USD) a `getBudgetFor(strategyName)` — ha 0 vagy
   *      kisebb mint a kért notional, a méret a büdzsé / ár arányára
   *      skálázódik (vagy skip, ha a büdzsé 0).
   */
  private async handleSignal(
    strategyName: StrategyName,
    strategy: Strategy,
    signal: StrategySignal,
    symbol: ExchangeSymbol,
    referencePrice: number,
  ): Promise<void> {
    this.totalSignals++;
    this.lastSignalAt = Date.now();
    this.lastSignalStrategy = strategyName;
    this.perStrategyLastSignal.set(strategyName, this.lastSignalAt);

    // Phase 37 Track 4 — circuit breaker check. Ha a portfolio-stop
    // tüzelt, a StrategyRunner NEM küld új order-t (a bot leállásáig).
    if (this.portfolioManager?.isTripped() === true) {
      this.logger.warn("[strategy-runner] portfolio-stop tripped — skipping signal", {
        strategy: strategyName,
        symbol,
      });
      return;
    }

    // Sizing — Phase 37 Track 1 (RiskManager) + Track 4 (Portfolio budget cap)
    const equity = this.positionManager.getEquity();
    let amount: number;
    if (this.riskManager !== null) {
      // Phase 37 Track 1 — query the RiskManager for the final
      // size fraction. If it returns 0, the drawdown scaler or
      // Kelly says "do not open" — respect that.
      const baseFraction = this.riskPerTrade;
      const fraction = this.riskManager.evaluateNewPositionSize({
        equityUsd: equity,
        baseSizeFraction: baseFraction,
      });
      amount = fraction > 0 && referencePrice > 0
        ? (fraction * equity) / referencePrice
        : 0;
    } else {
      amount = this.sizingFn({
        signal,
        symbol,
        referencePrice,
        equityUsd: equity,
        riskPerTrade: this.riskPerTrade,
      });
    }
    if (amount <= 0) {
      this.logger.debug("[strategy-runner] sizing returned 0 — skipping order", {
        strategy: strategyName,
        symbol,
      });
      return;
    }

    // Phase 37 Track 4 — büdzsé-CAP alkalmazása. A kért notional
    // (amount * referencePrice) nem haladhatja meg a
    // `portfolioManager.getBudgetFor(strategyName)`-et.
    amount = this.applyBudgetCap(
      strategyName,
      amount,
      referencePrice,
    );
    if (amount <= 0) {
      this.logger.debug("[strategy-runner] budget cap shrunk amount to 0 — skipping", {
        strategy: strategyName,
        symbol,
        baseAmount,
        referencePrice,
      });
      return;
    }

    // Build OrderIntent
    const intent: OrderIntent = {
      signal,
      symbol,
      amount,
      referencePrice,
      type: "market",
      clientOrderIdHint: strategyName,
    };
    try {
      const order = await this.orderManager.placeOrder(intent);
      // Optimistic fill (paper mode fills immediately; live mode
      // will receive the fill via the order update stream and call
      // PositionManager.recordFill separately).
      this.positionManager.recordFill({
        strategy: strategyName,
        symbol,
        side: signal.side === "buy" ? "long" : "short",
        quantity: amount,
        price: referencePrice,
        leverage: 10, // 1:10 MANDATE
        timestamp: Date.now(),
      });
      this.orderManager.recordFill(order.clientOrderId, order);
      // Phase 37 Track 4 — a portfolió-menedzser is megkapja a fill-t
      // (a korreláció-stream frissítéséhez). A return% itt 0, mert
      // ez egy NYITÓ fill (nincs realizált P&L); a ZÁRÓ fill a
      // position-manager-en keresztül a position teljes zárásakor
      // kerül rögzítésre — a StrategyRunner a `Bot.run` heartbeat-
      // jében kérdezi le a `closedTrades` listát és hívja a
      // `portfolioManager.recordFill`-t a ZÁRÁS pillanatában.
      if (this.portfolioManager !== null) {
        this.portfolioManager.recordFill({ strategyId: strategyName, returnPct: 0 });
      }
      if (strategy.onPositionOpened !== undefined) {
        strategy.onPositionOpened({
          side: signal.side,
          entryTime: Date.now(),
          entryPrice: referencePrice,
          quantity: amount,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          holdingBars: 0,
        });
      }
    } catch (err) {
      this.logger.error("[strategy-runner] order placement failed", {
        strategy: strategyName,
        symbol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * `applyBudgetCap` — a kért méretet a portfolió-büdzsé CAP-jéhez
   * skálázza. Ha a CAP kisebb mint a kért notional, a méret a CAP
   * / referencePrice arányára csökken. Ha a CAP 0, a visszatérés 0
   * (a hívó kihagyja az order-t).
   *
   * A CAP nélküli esetben (nincs PortfolioManager vagy a büdzsé
   * nagyobb mint a kért notional) a baseAmount változatlanul
   * visszatér.
   */
  private applyBudgetCap(
    strategyName: StrategyName,
    baseAmount: number,
    referencePrice: number,
  ): number {
    if (this.portfolioManager === null) {
      return baseAmount;
    }
    const capUsd = this.portfolioManager.getBudgetFor(strategyName);
    if (capUsd <= 0 || referencePrice <= 0) {
      return 0;
    }
    const requestedNotional = baseAmount * referencePrice;
    if (requestedNotional <= capUsd) {
      return baseAmount;
    }
    const scaled = capUsd / referencePrice;
    this.logger.debug("[strategy-runner] budget cap shrunk order", {
      strategy: strategyName,
      baseAmount,
      scaledAmount: scaled,
      capUsd,
      requestedNotional,
    });
    return scaled;
  }

  /**
   * `toCandle` — az OHLCV tuple-ből `Candle` típust készít.
   */
  private toCandle(ohlcv: readonly [number, number, number, number, number, number]): Candle {
    return {
      timestamp: ohlcv[0],
      open: ohlcv[1],
      high: ohlcv[2],
      low: ohlcv[3],
      close: ohlcv[4],
      volume: ohlcv[5],
    };
  }
}

// ============================================================================
// Position-sizing helpers
// ============================================================================

/**
 * `defaultSizingFn` — a legegyszerűbb sizing: equity × risk_per_trade
 * / referencePrice. A `Bot` default-ja; a `mm-bot` CLI override-olhatja
 * (a Phase 33 Track D CLI-ban).
 */
export const defaultSizingFn: SizingFn = (params) => {
  const { referencePrice, equityUsd, riskPerTrade } = params;
  if (referencePrice <= 0) return 0;
  return (equityUsd * riskPerTrade) / referencePrice;
};

/**
 * `appendRunnerStatsToState` — a runner statisztikáit hozzáfűzi a
 * `BotState`-hez (külön mezők nélkül, a counters-en keresztül).
 */
export function runnerStatsToState(
  _stats: StrategyRunnerStats,
  state: BotState,
): BotState {
  return {
    ...state,
    counters: state.counters,
  };
}

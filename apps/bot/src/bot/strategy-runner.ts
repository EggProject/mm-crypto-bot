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
 * - `logger`              — opcionális structured logger.
 */
export interface StrategyRunnerOptions {
  readonly instances: ReadonlyMap<StrategyName, BotStrategyInstance>;
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
  readonly sizingFn: SizingFn;
  readonly enabledSymbols: readonly string[];
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

  public constructor(opts: StrategyRunnerOptions) {
    this.instances = opts.instances;
    this.orderManager = opts.orderManager;
    this.positionManager = opts.positionManager;
    this.sizingFn = opts.sizingFn;
    this.enabledSymbols = new Set(
      opts.enabledSymbols.map((s) => s as Brand<string, "ExchangeSymbol"> as unknown as ExchangeSymbol),
    );
    this.logger = opts.logger ?? createLogger("info");
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

    // Sizing
    const equity = this.positionManager.getEquity();
    const amount = this.sizingFn({
      signal,
      symbol,
      referencePrice,
      equityUsd: equity,
      riskPerTrade: this.riskPerTrade,
    });
    if (amount <= 0) {
      this.logger.debug("[strategy-runner] sizing returned 0 — skipping order", {
        strategy: strategyName,
        symbol,
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

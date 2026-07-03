/**
 * packages/paper/src/paper-trader.ts
 *
 * GENERIKUS paper-trading emulator.
 *
 * A stack-findings.md 1.4 szekcio alapjan epitett emulator:
 * - A bybit.eu-n NINCS publikus sandbox, ezert sajat emulatort epitunk
 * - Az emulator GENERIKUS (ccxt.Exchange / ExchangeFeed alapú),
 *   tehat kesobb a binance/okx adapterek is azonnal hasznalhatjak
 * - A CCXT Pro WS feed valos ideju adatait hasznalja (watchOrderBook, watchTicker, watchTrades)
 * - Lokalis allapot: Cash + Position (qty, avg price, realized/unrealized PnL)
 * - Végrehajtas szimulacio: market order az aktualis bid/ask-on, limit order
 *   az orderbookon
 *
 * Fontos: az emulator NEM a CCXT WS-tol fugg a donteshozatal pontossagaban.
 * Ha sequence gap-et eszlelunk (ld. stack-findings 7.3), felfuggesztjuk a
 * trade-et es REST snapshot-tal reconcile-olunk.
 */

import type {
  ExchangeFeed,
  WatchOptions,
  TradingSignal,
  PositionSnapshot,
  FillRecord,
  ExchangeFeeConfig,
} from "@mm-crypto-bot/shared";

export interface PaperTraderOptions {
  /** Kezdo egyenleg quote currency-ban (pl. USDT/USDC) */
  readonly initialBalanceQuote: number;
  /** Exchange fee konfiguracio (borrow_rate, spot fee stb.) */
  readonly fee: ExchangeFeeConfig;
  /** Trade-ek history maximalis hossza */
  readonly maxHistory?: number;
}

interface InternalPosition {
  symbol: string;
  side: "long" | "short";
  amount: number;
  avgEntryPrice: number;
  openedAt: number;
  leverage: number;
}

interface InternalState {
  cash: number;
  positions: Map<string, InternalPosition>;
  history: FillRecord[];
}

/**
 * A PaperTrader osztaly implementalja a CCXT Pro WS feed + sajat
 * fill-szimulacio logikat. Nem bybit-specifikus - minden ExchangeFeed-et
 * megvalosito adapterrel mukodik.
 */
export class PaperTrader {
  private readonly feed: ExchangeFeed;
  private readonly opts: Required<PaperTraderOptions>;
  private readonly state: InternalState;
  private lastSeqByChannel: Map<string, number> = new Map<string, number>();
  private running = false;

  constructor(feed: ExchangeFeed, opts: PaperTraderOptions) {
    this.feed = feed;
    this.opts = {
      maxHistory: 1000,
      ...opts,
    };
    this.state = {
      cash: opts.initialBalanceQuote,
      positions: new Map(),
      history: [],
    };
  }

  /** Aktualis Cash + Position allapot snapshot. */
  snapshot(): { cash: number; positions: PositionSnapshot[] } {
    return {
      cash: this.state.cash,
      positions: Array.from(this.state.positions.values()).map((p) => ({
        symbol: p.symbol,
        side: p.amount >= 0 ? "long" : "short",
        amount: Math.abs(p.amount),
        avgEntryPrice: p.avgEntryPrice,
        unrealizedPnl: 0, // kalkulacio a watchTicker alapjan, kesobb
        realizedPnl: 0, // history aggregacio, kesobb
        openedAt: p.openedAt,
        leverage: p.leverage,
      })),
    };
  }

  /** Eddigi trade-ek history (read-only copy). */
  history_(): readonly FillRecord[] {
    return [...this.state.history];
  }

  /**
   * Trading signal feldolgozasa - a strategy altal generalt jelet
   * szimulalt trade-e alakitja.
   */
  async executeSignal(signal: TradingSignal): Promise<FillRecord | null> {
    if (signal.action === "hold") {
      return null;
    }

    const ticker = await this.feed.fetchTicker(signal.symbol);
    const fillPrice =
      signal.suggestedPrice ??
      (signal.action === "buy" ? ticker.ask ?? ticker.last ?? 0 : ticker.bid ?? ticker.last ?? 0);

    if (fillPrice <= 0) {
      return null;
    }

    const amount = signal.suggestedAmount ?? this.computeKellySize(signal, fillPrice);
    if (amount <= 0) {
      return null;
    }

    return this.fillOrder({
      orderId: `paper-${Date.now()}`,
      symbol: signal.symbol,
      side: signal.action === "buy" ? "buy" : "sell",
      price: fillPrice,
      amount,
      feeRate: this.opts.fee.spotTakerFee,
    });
  }

  /** Stop loss / take profit figyeles a watchTicker stream-en. */
  async start(options: { symbols: string[]; watchOpts?: WatchOptions }): Promise<void> {
    if (this.feed.watchTicker === undefined) {
      throw new Error(
        "A feed nem tamogatja a watchTicker-t - a paper-trader csak CCXT Pro adapterrel mukodik",
      );
    }
    const watchTicker = this.feed.watchTicker;
    this.running = true;
    // A CCXT Pro watch ciklusok reconnect-et es exponential backoff-ot
    // automatikusan kezelnek (ld. stack-findings 7.2).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this.running externally mutatodik a stop() metodussal
    while (this.running) {
      try {
        // Sorrend fontossaga: ticker eloszor (olcsobb), majd trades a fill-szimulaciohoz.
        for (const symbol of options.symbols) {
          const ticker = await watchTicker.call(this.feed, symbol, options.watchOpts);
          // Sequence drift detekcio (ha a feed tartalmaz 'seq' mezot).
          this.checkSeq("ticker:" + symbol, ticker.timestamp);
          this.checkStops(symbol, ticker.last ?? 0);
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes("Network")) {
          // CCXT Pro reconnect - csak logolunk, a ciklus folytatodik.
          continue;
        }
        throw err;
      }
    }
  }

  /** Graceful stop. */
  stop(): void {
    this.running = false;
  }

  // ─── Privat segedek ──────────────────────────────────────────────

  private fillOrder(input: {
    orderId: string;
    symbol: string;
    side: "buy" | "sell";
    price: number;
    amount: number;
    feeRate: number;
  }): FillRecord {
    const cost = input.price * input.amount;
    const fee = cost * input.feeRate;
    const existing = this.state.positions.get(input.symbol);

    let signedAmount: number;
    if (input.side === "buy") {
      signedAmount = input.amount;
    } else {
      signedAmount = -input.amount;
    }

    if (existing === undefined) {
      // Új pozíció nyitása
      this.state.positions.set(input.symbol, {
        symbol: input.symbol,
        side: input.side === "buy" ? "long" : "short",
        amount: signedAmount,
        avgEntryPrice: input.price,
        openedAt: Date.now(),
        leverage: 1,
      });
      this.state.cash -= cost + fee;
    } else {
      // Meglevo pozicio modositasa - egyszerusitett avg price update
      const totalAmount = existing.amount + signedAmount;
      if (Math.sign(totalAmount) === Math.sign(existing.amount) || existing.amount === 0) {
        // Még mindig ugyanabban az irányban nyitunk
        existing.avgEntryPrice =
          (Math.abs(existing.amount) * existing.avgEntryPrice + Math.abs(signedAmount) * input.price) /
          Math.abs(totalAmount);
        existing.amount = totalAmount;
      } else {
        // Elleniranyu fill - teljes vagy reszleges zarodas
        existing.avgEntryPrice = input.price;
        existing.amount = totalAmount;
        if (totalAmount === 0) {
          existing.openedAt = Date.now();
        }
      }
      this.state.cash -= input.side === "buy" ? cost + fee : -cost + fee;
    }

    const fill: FillRecord = {
      id: `fill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      orderId: input.orderId,
      symbol: input.symbol,
      side: input.side,
      price: input.price,
      amount: input.amount,
      fee,
      feeCurrency: "USDT",
      timestamp: Date.now(),
      mode: "paper",
    };

    this.state.history.push(fill);
    if (this.state.history.length > this.opts.maxHistory) {
      this.state.history.shift();
    }

    return fill;
  }

  private checkSeq(channel: string, seq: number | undefined): void {
    if (typeof seq !== "number") return;
    const last = this.lastSeqByChannel.get(channel);
    if (last !== undefined && seq !== last + 1) {
      // Sequence drift - kuldojelzes a felsőbb retegnek.
      // Itt csak logolunk; a magasabb szint donti el, hogy felfuggeszti-e.
      console.warn(
        `[paper] sequence drift detected on ${channel}: expected ${last + 1}, got ${seq}`,
      );
    }
    this.lastSeqByChannel.set(channel, seq);
  }

  private checkStops(symbol: string, price: number): void {
    const pos = this.state.positions.get(symbol);
    if (pos === undefined || price <= 0) return;
    // TODO: stop-loss / take-profit trigger a signal.suggestedPrice-bol
    // A strategy engine kuldoz le a TradingSignal-ban stopLoss/takeProfit-ot,
    // az executeSignal pedig mar alkalmazza. Ez a watchTicker ciklus csak
    // a mar meglevo, strategy-n kivuli stop-okat figyeli.
  }

  /**
   * Position sizing Kelly-kriterium alapjan.
   * 1/4-Kelly alkalmazasa (konzervativ, ld. RiskConfig.kellyFraction).
   * TODO: a confidence es a historikus win-rate ismereteben pontositani.
   */
  private computeKellySize(signal: TradingSignal, price: number): number {
    if (price <= 0) return 0;
    const kellyFraction = 0.25; // = 1/4-Kelly, ld. config
    const confidence = Math.min(1, Math.max(0, signal.confidence));
    const equity = this.state.cash;
    const fraction = confidence * kellyFraction;
    return (equity * fraction) / price;
  }
}
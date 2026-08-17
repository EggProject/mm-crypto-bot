// packages/exchange/src/ohlc-stream.ts — `OhlcStream`
//
// Phase 37 Track 3: real OHLC stream that aggregates live trades into
// OHLC bars for configurable timeframes, stores the last N bars in a
// per-(symbol, timeframe) ring buffer, and emits a "bar" event whenever
// a bar closes so runtime consumers can react and the `ohlc-trend`
// strategy can read bars from history.
//
// Design choices:
//   1. The class subscribes to a `ExchangeFeed` instance — we use
//      `subscribeTrades` because the live CCXT Pro watchTrades gives
//      the highest-frequency ticks and is the most reliable source
//      for OHLC aggregation (CCXT Pro `watchOHLCV` only emits on bar
//      close, so we couldn't build bars ourselves from it).
//   2. Aggregation is done in-memory: a `Map<(symbol, tf), ActiveBar>`
//      tracks the currently-forming bar, and a `RingBuffer` keeps the
//      last N completed bars per (symbol, tf).
//   3. We emit a `bar` event on the supplied `EventEmitter` whenever
//      a bar closes so downstream consumers can process finalized data.
//   4. The `getBars(symbol, timeframe, since?)` query method is what
//      the `ohlc-trend` strategy and the backtest fixture test use to
//      pull the buffered bars for indicator computation.
//   5. The `close()` method unsubscribes from the feed and clears the
//      internal state (no leaks across test runs).

import type { EventEmitter } from "node:events";

import type { ExchangeFeed, SubscriptionId } from "./feed.js";
import type { Ohlcv, Symbol, Timeframe, Trade } from "./types.js";
import type { Candle } from "@mm-crypto-bot/shared/types";
import { TIMEFRAME_MS } from "@mm-crypto-bot/shared/types";

/** A single completed OHLC bar, normalized for the consumer. */
export interface OhlcBar {
  /** Bar open timestamp (ms), aligned to the timeframe grid. */
  readonly timestamp: number;
  readonly symbol: Symbol;
  readonly timeframe: Timeframe;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  /** Number of trades aggregated into this bar. */
  readonly tradeCount: number;
}

/** The internal, currently-forming OHLC bar (mutable while in progress). */
interface ActiveBar {
  timestamp: number;
  symbol: Symbol;
  timeframe: Timeframe;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
}

/** Configuration for `OhlcStream`. */
export interface OhlcStreamConfig {
  /** Timeframes to maintain bars for. Default: 1m, 5m, 15m, 1h, 4h, 1d. */
  readonly timeframes: readonly Timeframe[];
  /** Ring-buffer size per (symbol, timeframe). Default: 1000. */
  readonly bufferSize: number;
  /** Symbols to subscribe to trades for. Default: BTC/USDT. */
  readonly symbols: readonly Symbol[];
}

export const DEFAULT_OHLC_STREAM_CONFIG: OhlcStreamConfig = {
  timeframes: ["1m", "5m", "15m", "1h", "4h", "1d"],
  bufferSize: 1000,
  symbols: ["BTC/USDT" as Symbol],
};

/**
 * `BACKFILL_LIMIT` — a `start()` hívásakor ennyi lezárt bar-ral tölti
 * fel a `OhlcStream` a ring buffer-t a REST backfill során. A 200-as
 * érték a `ohlc-trend` strategy `slowEma` periódusával egyezik
 * (`packages/core/src/strategy/ohlc-trend.ts`). Kisebb limit → az EMA
 * az első N trade-en instabil, nagyobb limit → fölösleges REST forgalom.
 */
export const OHLC_STREAM_BACKFILL_LIMIT = 200;

/** Payload of the `bar` event emitted on close. */
export interface OhlcStreamBarEvent {
  readonly bar: OhlcBar;
}

/** Payload of the `error` event emitted on a non-fatal error. */
export interface OhlcStreamErrorEvent {
  readonly error: Error;
}

/**
 * Map typed for the per-(symbol, timeframe) ring buffer key.
 * The `Symbol` is a branded string, the `Timeframe` is a literal union,
 * so the joined string is unique per bar.
 */
type BarKey = string;

const TIMEFRAME_DURATIONS = new Map<Timeframe, number>([
  ["1m", TIMEFRAME_MS["1m"]],
  ["5m", TIMEFRAME_MS["5m"]],
  ["15m", TIMEFRAME_MS["15m"]],
  ["1h", TIMEFRAME_MS["1h"]],
  ["4h", TIMEFRAME_MS["4h"]],
  ["1d", TIMEFRAME_MS["1d"]],
]);

function barKey(symbol: Symbol, timeframe: Timeframe): BarKey {
  return `${symbol}::${timeframe}`;
}

/**
 * `alignToTimeframe` — aligns a timestamp (ms) down to the timeframe grid.
 * For a 1m timeframe, this returns the timestamp of the start of the
 * containing minute; for 1h, the start of the containing hour; etc.
 */
export function alignToTimeframe(timestamp: number, timeframe: Timeframe): number {
  const ms = TIMEFRAME_DURATIONS.get(timeframe);
  if (ms === undefined) throw new Error(`Unsupported timeframe: ${timeframe}`);
  return timestamp - (timestamp % ms);
}

/**
 * `RingBuffer` — a fixed-size, push-on-overflow FIFO. We use it to
 * cap the per-(symbol, timeframe) history at `bufferSize` bars.
 *
 * Implemented as a plain array + a write-cursor so we can `push`/`toArray`
 * in O(1) amortized. When the buffer is full, the oldest bar is dropped
 * (true ring semantics).
 */
export class RingBuffer<T> {
  private readonly buf: (T | undefined)[];
  private cursor = 0;
  private filled = 0;

  constructor(public readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`RingBuffer: capacity must be a positive integer, got ${capacity}`);
    }
    this.buf = new Array<T | undefined>(capacity);
  }

  /** Push one element; if full, overwrite the oldest one. */
  push(item: T): void {
    if (this.cursor < 0 || this.cursor >= this.buf.length) {
      throw new Error(`RingBuffer cursor out of bounds: ${this.cursor}`);
    }
    this.buf[this.cursor] = item;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  /** Number of elements currently in the buffer (≤ capacity). */
  get size(): number {
    return this.filled;
  }

  /** Iterate the elements in insertion order (oldest → newest). */
  *values(): IterableIterator<T> {
    if (this.filled < this.capacity) {
      // Buffer not yet full: yield the contiguous [0..filled).
      for (let i = 0; i < this.filled; i++) {
        const v = this.buf.at(i);
        if (v !== undefined) yield v;
      }
      return;
    }
    // Buffer full: yield from cursor (oldest) → end, then 0 → cursor-1 (newest).
    for (let i = 0; i < this.capacity; i++) {
      const idx = (this.cursor + i) % this.capacity;
      const v = this.buf.at(idx);
      if (v !== undefined) yield v;
    }
  }

  /** Snapshot the buffer to an array (oldest → newest). */
  toArray(): T[] {
    return [...this.values()];
  }
}

/**
 * `OhlcStream` — aggregates live trades into OHLC bars and exposes a
 * ring-buffered history per (symbol, timeframe).
 *
 * Lifecycle:
 *
 *   const stream = new OhlcStream(feed, emitter, { timeframes, bufferSize, symbols });
 *   await stream.start();   // subscribes to trades
 *   // ... emits "bar" events on the emitter ...
 *   await stream.stop();    // unsubscribes + clears state
 *
 * Events emitted on the supplied `EventEmitter`:
 *   - `bar`  — `{ bar: OhlcBar }` on each bar close
 *   - `error` — `{ error: Error }` on a non-fatal aggregation error
 *
 * The class is intentionally not a singleton — multiple instances can
 * serve independent consumers, and the tests instantiate a fresh stream per
 * `it()` block.
 */
export class OhlcStream {
  readonly config: OhlcStreamConfig;
  private readonly feed: ExchangeFeed;
  private readonly emitter: EventEmitter;
  private readonly buffers = new Map<BarKey, RingBuffer<OhlcBar>>();
  private readonly active = new Map<BarKey, ActiveBar>();
  private subscriptions = new Map<SubscriptionId, Symbol>();
  private running = false;
  /**
   * `droppedLateTrades` — számláló, hány out-of-order trade-et dobtunk
   * el a C5 fix óta. Publikus, hogy a tesztek és a diagnosztika
   * (pl. health check) lássák. A WS reconnect backlog, CCXT micro-batch
   * és clock-skew egyaránt okozhat ilyen trade-eket; a normál üzemben
   * a counter 0 vagy nagyon alacsony.
   */
  private droppedLateTradesCount = 0;

  constructor(feed: ExchangeFeed, emitter: EventEmitter, config: Partial<OhlcStreamConfig> = {}) {
    this.feed = feed;
    this.emitter = emitter;
    this.config = {
      ...DEFAULT_OHLC_STREAM_CONFIG,
      ...config,
    };
    // Pre-allocate ring buffers for every (symbol, timeframe) pair.
    for (const symbol of this.config.symbols) {
      for (const tf of this.config.timeframes) {
        this.buffers.set(barKey(symbol, tf), new RingBuffer<OhlcBar>(this.config.bufferSize));
      }
    }
  }

  /**
   * `start` — open the feed (if not open), backfill the ring buffer with
   * the most recent historical bars (C4 fix), then subscribe to trades
   * for every symbol in `config.symbols`. Idempotent: a second `start()`
   * while running is a no-op.
   *
   * **C4 fix (REST backfill on start):** the strategy's 200-period EMA
   * needs 200 bars of history. Without this backfill, the bot waits
   * 8.3 days (1h bars) before emitting any signal. We seed the ring
   * buffer up to `OHLC_STREAM_BACKFILL_LIMIT` bars BEFORE opening the
   * trade subscription, so the strategy can compute its indicator
   * immediately.
   */
  async start(): Promise<void> {
    if (this.running) return;
    await this.feed.open();
    // C4 fix: backfill every (symbol, timeframe) ring buffer with the
    // most recent historical bars. The 200 limit matches the strategy's
    // `slowEma` period — see `packages/core/src/strategy/ohlc-trend.ts`.
    for (const symbol of this.config.symbols) {
      for (const tf of this.config.timeframes) {
        await this.backfill(symbol, tf, OHLC_STREAM_BACKFILL_LIMIT);
      }
    }
    for (const symbol of this.config.symbols) {
      const id = await this.feed.subscribeTrades(symbol, (event) => {
        if (event.kind !== "trade") return;
        this.handleTrade(event.payload);
      });
      this.subscriptions.set(id, symbol);
    }
    this.running = true;
  }

  /**
   * `stop` — unsubscribe from all feeds and clear internal state.
   * Safe to call multiple times (no-op when not running).
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    for (const id of this.subscriptions.keys()) {
      try {
        await this.feed.unsubscribe(id);
      } catch (err) {
        // Don't let one failed unsubscribe block the rest — log + continue.
        this.emitter.emit("error", {
          error: err instanceof Error ? err : new Error(String(err)),
        } satisfies OhlcStreamErrorEvent);
      }
    }
    this.subscriptions.clear();
    this.active.clear();
    this.buffers.clear();
    for (const symbol of this.config.symbols) {
      for (const tf of this.config.timeframes) {
        this.buffers.set(barKey(symbol, tf), new RingBuffer<OhlcBar>(this.config.bufferSize));
      }
    }
    this.running = false;
  }

  /** `isRunning` — true between `start()` and `stop()`. */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * `getBars` — return the ring-buffered bars for `(symbol, timeframe)`,
   * optionally filtered to `since` (ms) and later. Returns a fresh
   * array; the caller may safely mutate it.
   */
  getBars(symbol: Symbol, timeframe: Timeframe, since?: number): OhlcBar[] {
    const buf = this.buffers.get(barKey(symbol, timeframe));
    if (buf === undefined) return [];
    const all = buf.toArray();
    if (since === undefined) return all;
    return all.filter((b) => b.timestamp >= since);
  }

  /**
   * `lastBar` — return the most-recent completed bar for `(symbol, timeframe)`,
   * or `undefined` if none. Useful for "what's the current 1h close?" checks.
   */
  lastBar(symbol: Symbol, timeframe: Timeframe): OhlcBar | undefined {
    const bars = this.getBars(symbol, timeframe);
    return bars.length === 0 ? undefined : bars[bars.length - 1];
  }

  /**
   * `ingest` — programmatic feed of trades (bypasses the live
   * subscription). Used by tests and by the historical backtest fixture
   * to replay a recorded trade tape into the OHLC aggregator.
   */
  ingest(trade: Trade): void {
    this.handleTrade(trade);
  }

  /**
   * `backfill` — REST history lekérése a feed-en keresztül, és a ring
   * buffer feltöltése. A `start()` hívja a C4 fix részeként, hogy a
   * strategy (pl. 200-as EMA) azonnal kapjon elegendő history-t.
   *
   * A `tradeCount` mezőt 0-ra állítjuk, mert a backfillből nem tudjuk,
   * hogy az egyes bar-ok hány trade-ből álltak össze (csak az OHLCV
   * végösszegeket kapjuk). A `ohlc-trend` strategy nem használja a
   * `tradeCount`-ot, így ez nem okoz regressziót.
   *
   * Publikus, hogy a tesztek közvetlenül is hívhassák.
   */
  async backfill(symbol: Symbol, timeframe: Timeframe, limit: number): Promise<void> {
    const ohlcv = await this.feed.fetchOHLCV(symbol, timeframe, undefined, limit);
    const buf = this.buffers.get(barKey(symbol, timeframe));
    if (buf === undefined) return;
    for (const candle of ohlcv) {
      const [ts, open, high, low, close, volume] = candle;
      const bar: OhlcBar = {
        timestamp: ts,
        symbol,
        timeframe,
        open,
        high,
        low,
        close,
        volume,
        tradeCount: 0,
      };
      buf.push(bar);
    }
  }

  /**
   * `droppedLateTrades` — hány out-of-order trade-et dobtunk el a C5
   * fix óta. Publikus getter, hogy a tesztek és a diagnosztika
   * (pl. health check) lássák a normál üzemtől való eltérést.
   * Normál esetben 0; tartósan magas érték clock-skew-re vagy
   * WS reconnect backlog-ra utal.
   */
  droppedLateTrades(): number {
    return this.droppedLateTradesCount;
  }

  /**
   * `bufferSize` — return the current size of the ring buffer for
   * `(symbol, timeframe)`. Exposed for tests + diagnostics.
   */
  bufferSizeOf(symbol: Symbol, timeframe: Timeframe): number {
    const buf = this.buffers.get(barKey(symbol, timeframe));
    return buf === undefined ? 0 : buf.size;
  }

  // --------------------------------------------------------------------------
  // Internal — trade handling + bar aggregation
  // --------------------------------------------------------------------------

  /**
   * `handleTrade` — single-trade aggregation path. For every enabled
   * timeframe, either fold the trade into the active bar (if same bucket),
   * close the active bar and start a new one (bucket rollover), or
   * drop the trade if it is out-of-order (C5 fix).
   *
   * **C5 fix (out-of-order trade handling):** a késői trade-ek
   * (bucketStart < current.timestamp) mostantól warning + counter
   * mellett eldobásra kerülnek. Korábban az `else` ág vakon
   * végrehajtotta a rollover-t, és a lezárt bar-t egy új, múltbeli
   * bar-ral írta felül — ez az EMA-t és a backtest fixture-t is
   * csendben elrontotta.
   */
  private handleTrade(trade: Trade): void {
    for (const tf of this.config.timeframes) {
      const bucketStart = alignToTimeframe(trade.timestamp, tf);
      const key = barKey(trade.symbol, tf);
      const current = this.active.get(key);
      if (current === undefined) {
        this.active.set(key, {
          timestamp: bucketStart,
          symbol: trade.symbol,
          timeframe: tf,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volume: trade.amount,
          tradeCount: 1,
        });
        continue;
      }
      if (bucketStart === current.timestamp) {
        // Same bucket — fold.
        current.high = Math.max(current.high, trade.price);
        current.low = Math.min(current.low, trade.price);
        current.close = trade.price;
        current.volume += trade.amount;
        current.tradeCount += 1;
      } else if (bucketStart > current.timestamp) {
        // Bucket rolled over — close the previous bar, push to ring, start new.
        this.pushBar(current);
        this.active.set(key, {
          timestamp: bucketStart,
          symbol: trade.symbol,
          timeframe: tf,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volume: trade.amount,
          tradeCount: 1,
        });
      } else {
        // C5 fix: out-of-order trade (bucketStart < current.timestamp).
        // A trade a korábbi bucketbe tartozik, mint az aktív bar.
        // Okozói lehetnek: WS reconnect backlog, CCXT micro-batch,
        // clock-skew. Dobjuk el, hogy a lezált bar-t ne rontsuk el.
        this.droppedLateTradesCount += 1;
        console.warn(
          `[OhlcStream] dropped late trade: ${trade.symbol}/${tf} trade.ts=${trade.timestamp} bucketStart=${bucketStart} activeBar.ts=${current.timestamp} (price=${trade.price}, amount=${trade.amount})`,
        );
      }
    }
  }

  /**
   * `pushBar` — freeze an `ActiveBar` into an `OhlcBar`, push it to
   * the ring buffer, and emit a `bar` event.
   */
  private pushBar(active: ActiveBar): void {
    const bar: OhlcBar = {
      timestamp: active.timestamp,
      symbol: active.symbol,
      timeframe: active.timeframe,
      open: active.open,
      high: active.high,
      low: active.low,
      close: active.close,
      volume: active.volume,
      tradeCount: active.tradeCount,
    };
    const buf = this.buffers.get(barKey(active.symbol, active.timeframe));
    if (buf !== undefined) buf.push(bar);
    this.emitter.emit("bar", { bar } satisfies OhlcStreamBarEvent);
  }
}

/**
 * `barsToCandles` — convert a `OhlcBar[]` to the `Candle` shape used
 * by the backtest engine. Convenience for the `ohlc-trend` strategy
 * and backtest fixture tests.
 */
export function barsToCandles(bars: readonly OhlcBar[]): Candle[] {
  return bars.map((b) => ({
    timestamp: b.timestamp,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

/**
 * `barsToOhlcv` — convert a `OhlcBar[]` to the `Ohlcv` tuple shape
 * used by the exchange `FeedEvent`.
 */
export function barsToOhlcv(bars: readonly OhlcBar[]): Ohlcv[] {
  return bars.map((b) => [b.timestamp, b.open, b.high, b.low, b.close, b.volume] as Ohlcv);
}

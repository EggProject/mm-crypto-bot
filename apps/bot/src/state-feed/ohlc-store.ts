/**
 * apps/bot/src/state-feed/ohlc-store.ts
 *
 * ============================================================================
 * PHASE 45B — OHLC RING BUFFER STORE
 * ============================================================================
 *
 * A `OhlcStore` a state-feed snapshot-ok OHLC bootstrappel való
 * feltöltésére szolgál. A `StrategyRunner` a bar close event-ekből
 * tölti (`pushBar`), és a SNAPSHOT message `ohlcBootstrap` mezője a
 * `getAll()`-ból jön.
 *
 * ============================================================================
 * DESIGN
 * ============================================================================
 *
 *   - A store egy `Map<(symbol|tf), RingBuffer<OhlcBar>>` adatszerkezet.
 *   - A ring buffer kapacitása `DEFAULT_CAPACITY = 200` (per Phase 44
 *     terv).
 *   - A push O(1), a `getOHLC(symbol, tf, count)` O(count).
 *   - A `subscribeOHLC(symbol, tf, listener)` callback-et ad vissza,
 *     amit a StrategyRunner hívhat a bar close-oknál — a listener a
 *     bar tömb utolsó elemét kapja.
 *
 * ============================================================================
 * WHY 200-BAR CAPACITY
 * ============================================================================
 *   A legnagyobb chart-timeframe (1d) 200 napja = 6.5 hónap. Ez
 *   elegendő a legtöbb indikátor (Donchian 50/100, MA 200) bootstrap-
 *   éhez. Ha egy kliens több bar-t kér, a `getOHLC(symbol, tf, 500)`
 *   csak a legutóbbi 200-at adja.
 */

import type { StateFeedOHLC } from "./protocol.js";

// ============================================================================
// Constants
// ============================================================================

/** Az alapértelmezett ring buffer kapacitás. */
export const DEFAULT_CAPACITY = 200 as const;

// ============================================================================
// Types
// ============================================================================

/** A belső OHLC bar típus (a StateFeedOHLC-val megegyező). */
export type OhlcBar = StateFeedOHLC;

/** A store-ba kerülő bar (pushBar argumentuma). */
export interface OhlcBarInput {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** A `subscribeOHLC` listener-típusa. */
export type OhlcListener = (bar: OhlcBar) => void;

// ============================================================================
// Ring buffer (private)
// ============================================================================

/**
 * `RingBuffer` — egy egyszerű, fix kapacitású FIFO. Az `arr.shift()` O(n)
 * lenne, ezért a `cursor` + `filled` mintát használjuk: O(1) push,
 * O(n) drain (amit a `toArray()` csinál).
 */
class RingBuffer<T> {
  private readonly buf: (T | undefined)[];
  private cursor = 0;
  private filled = 0;

  public constructor(public readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`RingBuffer: capacity must be a positive integer, got ${String(capacity)}`);
    }
    this.buf = new Array<T | undefined>(capacity);
  }

  public push(item: T): void {
    this.buf[this.cursor] = item;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  public get size(): number {
    return this.filled;
  }

  public toArray(): T[] {
    const out: T[] = [];
    if (this.filled < this.capacity) {
      for (let i = 0; i < this.filled; i++) {
        const v = this.buf[i];
        if (v !== undefined) out.push(v);
      }
      return out;
    }
    for (let i = 0; i < this.capacity; i++) {
      const idx = (this.cursor + i) % this.capacity;
      const v = this.buf[idx];
      if (v !== undefined) out.push(v);
    }
    return out;
  }
}

// ============================================================================
// OhlcStore
// ============================================================================

/**
 * `OhlcStore` — a per-(symbol, tf) OHLC bar-okat tároló ring buffer
 * kollekció.
 *
 * A SNAPSHOT üzenet az `OhlcStore.getAll()`-ból tölti a `ohlcBootstrap`
 * mezőt. A `pushBar()` a `StrategyRunner`-ból jön (Phase 45B wire-up).
 */
export class OhlcStore {
  private readonly capacity: number;
  private readonly buffers = new Map<string, RingBuffer<OhlcBar>>();
  private readonly listeners = new Map<string, Set<OhlcListener>>();

  public constructor(options: { readonly capacity?: number } = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
  }

  /**
   * A `(symbol, tf)` kulcs kiszámítása. Belső segédfüggvény.
   */
  private keyOf(symbol: string, timeframe: string): string {
    return `${symbol}|${timeframe}`;
  }

  /**
   * `pushBar` — egy új OHLC bar hozzáadása a (symbol, tf) buffer-hez.
   *
   * Ha a buffer kapacitása megtelt, a legrégebbi bar eldobódik (true
   * ring buffer semantics). A `subscribeOHLC` listener-ei meghívódnak
   * a friss bar-ral.
   */
  public pushBar(symbol: string, timeframe: string, bar: OhlcBarInput): void {
    const key = this.keyOf(symbol, timeframe);
    let buf = this.buffers.get(key);
    if (buf === undefined) {
      buf = new RingBuffer<OhlcBar>(this.capacity);
      this.buffers.set(key, buf);
    }
    const fullBar: OhlcBar = {
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    };
    buf.push(fullBar);
    // A listener-ek hívása (a copy-on-write iterálás miatt biztonságos).
    const listeners = this.listeners.get(key);
    if (listeners !== undefined && listeners.size > 0) {
      for (const listener of [...listeners]) {
        try {
          listener(fullBar);
        } catch {
          // best-effort: egy listener hibája nem állítja le a többit.
        }
      }
    }
  }

  /**
   * `getOHLC` — a (symbol, tf) buffer utolsó `count` bar-ját adja vissza
   * (vagy kevesebbet, ha a buffer még nem telt meg).
   *
   * Ha a `count` undefined, a teljes buffert adja.
   */
  public getOHLC(symbol: string, timeframe: string, count?: number): readonly OhlcBar[] {
    const buf = this.buffers.get(this.keyOf(symbol, timeframe));
    if (buf === undefined) return [];
    const all = buf.toArray();
    if (count === undefined) return all;
    return all.slice(-count);
  }

  /**
   * `getAll` — az összes (symbol, tf) buffer tartalma, a SNAPSHOT
   * `ohlcBootstrap` mezőjéhez.
   *
   * A visszatérési érték `Record<symbol, Record<tf, readonly OhlcBar[]>>`
   * formátumú.
   */
  public getAll(): Readonly<Record<string, Readonly<Record<string, readonly OhlcBar[]>>>> {
    const out: Record<string, Record<string, readonly OhlcBar[]>> = {};
    for (const [key, buf] of this.buffers) {
      const sepIdx = key.indexOf("|");
      if (sepIdx < 0) continue;
      const symbol = key.slice(0, sepIdx);
      const timeframe = key.slice(sepIdx + 1);
      let symbolBucket = out[symbol];
      if (symbolBucket === undefined) {
        symbolBucket = {};
        out[symbol] = symbolBucket;
      }
      symbolBucket[timeframe] = buf.toArray();
    }
    return out;
  }

  /**
   * `subscribeOHLC` — feliratkozás a (symbol, tf) bar push event-jeire.
   *
   * A visszatérési érték egy `unsubscribe` függvény (idempotens).
   */
  public subscribeOHLC(
    symbol: string,
    timeframe: string,
    listener: OhlcListener,
  ): () => void {
    const key = this.keyOf(symbol, timeframe);
    let set = this.listeners.get(key);
    if (set === undefined) {
      set = new Set<OhlcListener>();
      this.listeners.set(key, set);
    }
    set.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const s = this.listeners.get(key);
      if (s !== undefined) {
        s.delete(listener);
        if (s.size === 0) this.listeners.delete(key);
      }
    };
  }

  /**
   * `bufferSize` — a (symbol, tf) buffer jelenlegi mérete.
   */
  public bufferSize(symbol: string, timeframe: string): number {
    const buf = this.buffers.get(this.keyOf(symbol, timeframe));
    return buf === undefined ? 0 : buf.size;
  }

  /**
   * `clear` — az összes buffer és listener törlése (a tesztek + a
   * feed-server shutdown hívja).
   */
  public clear(): void {
    this.buffers.clear();
    this.listeners.clear();
  }
}

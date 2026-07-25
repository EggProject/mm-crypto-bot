/**
 * apps/bot/src/state-feed/ohlc-store.ts
 *
 * ============================================================================
 * PHASE 45B — OHLC RING BUFFER STORE
 * PHASE 73  — historical bootstrap map (CSV → in-memory, no capacity cap)
 * PHASE 74  — `getAll()` returns historical ++ live (concat) so the SNAPSHOT
 *             message carries the full 30-month OHLCV history (BTC/USDC 1h:
 *             22100 bars, × 3 symbols × 3 timeframes = 85638 bars).
 * ============================================================================
 *
 * A `OhlcStore` a state-feed snapshot-ok OHLC bootstrappel való
 * feltöltésére szolgál. Két adatszerkezet:
 *
 *   1. `historical: Map<key, OhlcBar[]>` — a CSV-ből betöltött régi bar-ok,
 *      kapacitás NINCS limitálva (a teljes 30 hónap elfér).
 *   2. `buffers: Map<key, RingBuffer<OhlcBar>>` — a `pushBar` által adott
 *      LIVE bar-ok, kapacitás `DEFAULT_CAPACITY = 200` (per Phase 44 terv).
 *
 * A `getAll()` a `[...historical, ...live]` konkatenációját adja minden
 * kulcsra, így a SNAPSHOT `ohlcBootstrap` mezője a TELJES history-t
 * tartalmazza.
 *
 * ============================================================================
 * DESIGN — WHY THE HISTORICAL MAP
 * ============================================================================
 *   A ring buffer kapacitása 200 (Phase 44 terv: 1d × 200 nap = 6.5 hónap,
 *   elég a Donchian 50/100, MA 200 indikátorokhoz). A `data/ohlcv/`-ben
 *   viszont 85638 bar van BTC+ETH+SOL × 1h+4h+1d (≈ 30 hónap). A Phase 73
 *   hozzáadta a `historical` map-ot, ami kapacitás nélküli — a CSV-ből
 *   indul, a `getAll()` hozzáfűzi a live ring bufferhez.
 *
 * ============================================================================
 * API
 * ============================================================================
 *
 *   - `bootstrapHistorical(symbol, tf, bars)` — a CSV-reader hívja a
 *     bot indításakor. A `bars` tömböt a `historical` map-ba másolja.
 *   - `pushBar(symbol, tf, bar)` — a StrategyRunner hívja bar close-nál.
 *     A `buffers` ring bufferbe ír (200-as kapacitás, régi élő bar eldobódik).
 *   - `getAll()` — a `[historical + live]` konkatenációját adja minden
 *     kulcsra. Ezt olvassa a `FeedServer.resolveOhlcBootstrap()` a SNAPSHOT-ba.
 *   - `getOHLC(symbol, tf, count?)` — az utolsó N bar, vagy az összes ha
 *     count undefined.
 *   - `subscribeOHLC(symbol, tf, listener)` — a live bar push event-jeire.
 */

import type { StateFeedOHLC } from "./protocol.js";

// ============================================================================
// Constants
// ============================================================================

/** Az alapértelmezett ring buffer kapacitás (csak a LIVE bar-okra). */
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
 * `OhlcStore` — a per-(symbol, tf) OHLC bar-okat tároló historikus + live
 * adatszerkezet.
 *
 * Phase 73: két adatszerkezet — a `historical` map (kapacitás nélküli) a
 * CSV-ből jövő bar-okat tárolja, a `buffers` map (200-as ring buffer) a
 * LIVE bar-okat. A `getAll()` a kettő konkatenációját adja, hogy a SNAPSHOT
 * `ohlcBootstrap` mezője a TELJES history-t tartalmazza.
 */
export class OhlcStore {
  private readonly capacity: number;
  private readonly buffers = new Map<string, RingBuffer<OhlcBar>>();
  private readonly historical = new Map<string, OhlcBar[]>();
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
   * `bootstrapHistorical` — a CSV-ből betöltött OHLC bar-ok tárolása.
   * Phase 73: a `historical` map-ba kerülnek (kapacitás nélkül). A
   * `getAll()` a historical + live konkatenációját adja.
   *
   * A `bars` tömb time-ascending sorrendben kell legyen (a CSV reader
   * biztosítja). A függvény DEEP COPY-t csinál, hogy a caller által
   * később módosított tömb ne szennyezze a store-t.
   *
   * Ha a kulcshoz már van historical adat, FELÜLÍRJUK — a bot indításakor
   * a CSV-reader egyszer hívja, nincs inkrementális update.
   */
  public bootstrapHistorical(symbol: string, timeframe: string, bars: readonly OhlcBarInput[]): void {
    const key = this.keyOf(symbol, timeframe);
    const cloned: OhlcBar[] = bars.map((b) => ({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    this.historical.set(key, cloned);
  }

  /**
   * `pushBar` — egy új LIVE OHLC bar hozzáadása a (symbol, tf) ring bufferhez.
   *
   * A historical NEM frissül — csak a live ring bufferbe írunk. A
   * `getAll()` a `historical ++ live` konkatenációt adja.
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
   * **Phase 74**: a historical + live konkatenációjából adja a tail N
   * bar-t, hogy a REST `/api/ohlc?count=N` endpoint és a WS subscriber
   * is a TELJES history utolsó N bar-ját lássák.
   */
  public getOHLC(symbol: string, timeframe: string, count?: number): readonly OhlcBar[] {
    const key = this.keyOf(symbol, timeframe);
    const hist = this.historical.get(key) ?? [];
    const buf = this.buffers.get(key);
    const live = buf === undefined ? [] : buf.toArray();
    const all = hist.length === 0 ? live : hist.concat(live);
    if (count === undefined) return all;
    return all.slice(-count);
  }

  /**
   * `getAll` — az összes (symbol, tf) buffer tartalma, a SNAPSHOT
   * `ohlcBootstrap` mezőjéhez. Phase 74: a historical + live
   * konkatenációját adja, hogy a 85638 bar eljusson a web app-ba.
   *
   * A visszatérési érték `Record<symbol, Record<tf, readonly OhlcBar[]>>`
   * formátumú.
   */
  public getAll(): Readonly<Record<string, Readonly<Record<string, readonly OhlcBar[]>>>> {
    const out: Record<string, Record<string, readonly OhlcBar[]>> = {};
    // Összegyűjtjük az összes kulcsot (historical + live).
    const allKeys = new Set<string>([...this.historical.keys(), ...this.buffers.keys()]);
    for (const key of allKeys) {
      const sepIdx = key.indexOf("|");
      if (sepIdx < 0) continue;
      const symbol = key.slice(0, sepIdx);
      const timeframe = key.slice(sepIdx + 1);
      let symbolBucket = out[symbol];
      if (symbolBucket === undefined) {
        symbolBucket = {};
        out[symbol] = symbolBucket;
      }
      const hist = this.historical.get(key) ?? [];
      const buf = this.buffers.get(key);
      const live = buf === undefined ? [] : buf.toArray();
      symbolBucket[timeframe] = hist.length === 0 ? live : hist.concat(live);
    }
    return out;
  }

  /**
   * `subscribeOHLC` — feliratkozás a (symbol, tf) LIVE bar push event-jeire.
   *
   * A historical bar-okra NEM iratkozik fel (azok a bootstrap-ből jönnek,
   * a `getAll()` egyszeri hívással elérhetők). A visszatérési érték egy
   * `unsubscribe` függvény (idempotens).
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
   * `bufferSize` — a (symbol, tf) LIVE ring buffer jelenlegi mérete.
   * (A historical méretet NEM adja — a `historicalSize()` adja.)
   */
  public bufferSize(symbol: string, timeframe: string): number {
    const buf = this.buffers.get(this.keyOf(symbol, timeframe));
    return buf === undefined ? 0 : buf.size;
  }

  /**
   * `historicalSize` — a (symbol, tf) historical map mérete.
   * Phase 73: a bootstrap-ből betöltött bar-ok száma.
   */
  public historicalSize(symbol: string, timeframe: string): number {
    return this.historical.get(this.keyOf(symbol, timeframe))?.length ?? 0;
  }

  /**
   * `clear` — az összes buffer és listener törlése (a tesztek + a
   * feed-server shutdown hívja).
   */
  public clear(): void {
    this.buffers.clear();
    this.historical.clear();
    this.listeners.clear();
  }
}

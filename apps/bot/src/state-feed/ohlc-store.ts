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
  /**
   * Phase 73: historical OHLC bars per (symbol, tf) — these are
   * loaded once at bot start from `data/ohlcv/*.csv` and persist
   * for the lifetime of the process. The ring buffer (`buffers`)
   * holds the live (most recent) bars on top of the historical
   * baseline. The state-feed SNAPSHOT's `ohlcBootstrap` field
   * includes BOTH layers via `getAll()`.
   */
  private readonly historical = new Map<string, readonly OhlcBar[]>();
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
   * `bootstrapHistorical` — Phase 73. Feltölti a (symbol, tf)
   * historical map-ot a letöltött OHLCV bar-okkal. A bot start
   * során hívódik, miután a `data/ohlcv/*.csv` fájlok feldolgozása
   * megtörtént (lásd `ohlc-bootstrap.ts`).
   *
   * A historical map-ot CSAK egyszer szabad feltölteni — ismételt
   * hívás felülírja az előző értéket. A live ring buffer érintetlen
   * marad; ha a history utolsó bar-hoz képest a `pushBar` egy
   * régebbi időpontú bar-t kapna, az a history és a ring buffer
   * között inkonzisztenciát okozna — ez a StrategyRunner
   * felelőssége, hogy time-ascending bar-okat küldjön.
   *
   * A bar-ok idősorrendben érkeznek (a CSV time-ascending); a
   * `getAll()` a historical és a ring buffer konkatenációját adja.
   */
  public bootstrapHistorical(
    symbol: string,
    timeframe: string,
    bars: readonly OhlcBar[],
  ): void {
    const key = this.keyOf(symbol, timeframe);
    // Defensive copy — a hívó által adott tömböt később módosíthatja,
    // és a historical map immutable referenciákat tárol.
    const frozen: readonly OhlcBar[] = bars.map((b) => ({ ...b }));
    this.historical.set(key, frozen);
  }

  /**
   * `getOHLC` — a (symbol, tf) historical + ring buffer összes bar-ját
   * adja vissza time-ascending sorrendben (vagy az utolsó `count`
   * bar-t, ha `count` meg van adva).
   *
   * Phase 73: a korábbi 200-bar limit megszűnt — mostantól a
   * teljes backtest history elérhető.
   *
   * Ha a `count` undefined, a teljes (historical + live) listát adja.
   */
  public getOHLC(symbol: string, timeframe: string, count?: number): readonly OhlcBar[] {
    const key = this.keyOf(symbol, timeframe);
    const hist = this.historical.get(key) ?? [];
    const buf = this.buffers.get(key);
    const live: readonly OhlcBar[] = buf === undefined ? [] : buf.toArray();
    // A history és a live mind time-ascending; konkatenálásuk is.
    const all: readonly OhlcBar[] = hist.length === 0 ? live : live.length === 0 ? hist : [...hist, ...live];
    if (count === undefined) return all;
    return all.slice(-count);
  }

  /**
   * `getAll` — az összes (symbol, tf) buffer tartalma, a SNAPSHOT
   * `ohlcBootstrap` mezőjéhez.
   *
   * A visszatérési érték `Record<symbol, Record<tf, readonly OhlcBar[]>>`
   * formátumú. Phase 73 óta a historical és a live (ring buffer)
   * konkatenációját adja minden (symbol, tf) kulcshoz.
   */
  public getAll(): Readonly<Record<string, Readonly<Record<string, readonly OhlcBar[]>>>> {
    const out: Record<string, Record<string, readonly OhlcBar[]>> = {};
    // Iterálunk a historical ÉS a buffers map-ok unionján.
    const allKeys = new Set<string>([...this.historical.keys(), ...this.buffers.keys()]);
    for (const key of allKeys) {
      const sepIdx = key.indexOf("|");
      if (sepIdx < 0) continue;
      const symbol = key.slice(0, sepIdx);
      const timeframe = key.slice(sepIdx + 1);
      const hist = this.historical.get(key) ?? [];
      const buf = this.buffers.get(key);
      const live: readonly OhlcBar[] = buf === undefined ? [] : buf.toArray();
      const combined: readonly OhlcBar[] =
        hist.length === 0 ? live : live.length === 0 ? hist : [...hist, ...live];
      let symbolBucket = out[symbol];
      if (symbolBucket === undefined) {
        symbolBucket = {};
        out[symbol] = symbolBucket;
      }
      symbolBucket[timeframe] = combined;
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
   * `bufferSize` — a (symbol, tf) historical + live együttes mérete.
   * Phase 73: a historical bootstrap után ez akár több ezer is lehet.
   */
  public bufferSize(symbol: string, timeframe: string): number {
    const key = this.keyOf(symbol, timeframe);
    const histLen = this.historical.get(key)?.length ?? 0;
    const buf = this.buffers.get(key);
    const liveLen = buf === undefined ? 0 : buf.size;
    return histLen + liveLen;
  }

  /**
   * `clear` — az összes buffer, historical és listener törlése
   * (a tesztek + a feed-server shutdown hívja).
   *
   * Phase 73: a historical map is törlődik — a teljes bootstrap
   * újrafuttatható egy `clear()` után.
   */
  public clear(): void {
    this.buffers.clear();
    this.historical.clear();
    this.listeners.clear();
  }
}

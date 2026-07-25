/**
 * apps/bot/src/state-feed/__tests__/ohlc-store.test.ts
 *
 * PHASE 45B — OhlcStore tests.
 *
 * Lefedi:
 *   - A pushBar() a (symbol, tf) bufferhez adja a bar-t.
 *   - A ring buffer túlcsorduláskor a legrégebbi bar-t eldobja.
 *   - A getOHLC(symbol, tf, count) a legutóbbi N bar-t adja.
 *   - A subscribeOHLC listener a pushBar során hívódik.
 *   - A getAll() az összes (symbol, tf) buffert adja.
 *   - A bufferSize a buffer aktuális méretét adja.
 *   - A clear() mindent töröl.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { DEFAULT_CAPACITY, OhlcStore, type OhlcBarInput } from "../ohlc-store.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeBar(time: number, close: number): OhlcBarInput {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

// ============================================================================
// Constants
// ============================================================================

describe("OhlcStore constants", () => {
  it("DEFAULT_CAPACITY is 200", () => {
    expect(DEFAULT_CAPACITY).toBe(200);
  });
});

// ============================================================================
// pushBar + getOHLC
// ============================================================================

describe("OhlcStore — pushBar + getOHLC", () => {
  let store: OhlcStore;

  beforeEach(() => {
    store = new OhlcStore();
  });

  it("pushBar adds the bar to the (symbol, tf) buffer", () => {
    store.pushBar("BTC/USDC", "1h", makeBar(1000, 60_000));
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(1);
  });

  it("getOHLC returns the pushed bar", () => {
    store.pushBar("BTC/USDC", "1h", makeBar(1000, 60_000));
    const bars = store.getOHLC("BTC/USDC", "1h");
    expect(bars.length).toBe(1);
    expect(bars[0]?.close).toBe(60_000);
  });

  it("getOHLC returns an empty array for an unseen (symbol, tf)", () => {
    expect(store.getOHLC("BTC/USDC", "1h")).toEqual([]);
  });

  it("getOHLC with count returns the most recent N bars", () => {
    for (let i = 0; i < 10; i++) {
      store.pushBar("BTC/USDC", "1h", makeBar(1000 + i, 60_000 + i));
    }
    const last3 = store.getOHLC("BTC/USDC", "1h", 3);
    expect(last3.length).toBe(3);
    expect(last3[0]?.close).toBe(60_007);
    expect(last3[2]?.close).toBe(60_009);
  });

  it("getOHLC with count larger than the buffer returns all bars", () => {
    for (let i = 0; i < 3; i++) {
      store.pushBar("BTC/USDC", "1h", makeBar(1000 + i, 60_000 + i));
    }
    const all = store.getOHLC("BTC/USDC", "1h", 100);
    expect(all.length).toBe(3);
  });

  // Phase 77: the REST /api/ohlc endpoint and the WS subscriber
  // consume getOHLC(); both require time-ascending data (chart
  // invariant). The historical+live concat is sorted by the same fix
  // as in getAll().
  it("getOHLC returns bars sorted by time ascending when historical overlaps live", () => {
    store.bootstrapHistorical("BTC/USDC", "1h", [
      makeBar(1000, 60_000),
      makeBar(2000, 60_100),
      makeBar(5000, 60_400),
    ]);
    store.pushBar("BTC/USDC", "1h", makeBar(3000, 60_250));
    store.pushBar("BTC/USDC", "1h", makeBar(6000, 60_500));

    const all = store.getOHLC("BTC/USDC", "1h");
    const times = all.map((b) => b.time);
    expect(times).toEqual([1000, 2000, 3000, 5000, 6000]);
  });
});

// ============================================================================
// Ring buffer overflow
// ============================================================================

describe("OhlcStore — ring buffer overflow", () => {
  it("overwrites the oldest bar when capacity is exceeded", () => {
    const store = new OhlcStore({ capacity: 5 });
    for (let i = 0; i < 10; i++) {
      store.pushBar("BTC/USDC", "1h", makeBar(1000 + i, 60_000 + i));
    }
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(5);
    // A legrégebbi 5 bar (1000-1004) eldobódott; az utolsó 5 maradt.
    const all = store.getOHLC("BTC/USDC", "1h");
    expect(all.length).toBe(5);
    expect(all[0]?.time).toBe(1005);
    expect(all[4]?.time).toBe(1009);
  });

  it("uses DEFAULT_CAPACITY when no capacity is specified", () => {
    const store = new OhlcStore();
    for (let i = 0; i < DEFAULT_CAPACITY + 5; i++) {
      store.pushBar("BTC/USDC", "1h", makeBar(1000 + i, 60_000 + i));
    }
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(DEFAULT_CAPACITY);
  });
});

// ============================================================================
// Multi-symbol-multi-tf isolation
// ============================================================================

describe("OhlcStore — multi-symbol-multi-tf isolation", () => {
  let store: OhlcStore;

  beforeEach(() => {
    store = new OhlcStore();
  });

  it("buffers for different (symbol, tf) pairs are isolated", () => {
    store.pushBar("BTC/USDC", "1h", makeBar(1000, 60_000));
    store.pushBar("BTC/USDC", "4h", makeBar(2000, 60_100));
    store.pushBar("ETH/USDC", "1h", makeBar(3000, 3_000));

    expect(store.bufferSize("BTC/USDC", "1h")).toBe(1);
    expect(store.bufferSize("BTC/USDC", "4h")).toBe(1);
    expect(store.bufferSize("ETH/USDC", "1h")).toBe(1);

    expect(store.getOHLC("BTC/USDC", "1h")[0]?.close).toBe(60_000);
    expect(store.getOHLC("BTC/USDC", "4h")[0]?.close).toBe(60_100);
    expect(store.getOHLC("ETH/USDC", "1h")[0]?.close).toBe(3_000);
  });
});

// ============================================================================
// getAll
// ============================================================================

describe("OhlcStore — getAll (SNAPSHOT bootstrap)", () => {
  it("returns an empty object when no bars are pushed", () => {
    const store = new OhlcStore();
    expect(store.getAll()).toEqual({});
  });

  it("returns a nested record organized by symbol → tf", () => {
    const store = new OhlcStore();
    store.pushBar("BTC/USDC", "1h", makeBar(1000, 60_000));
    store.pushBar("BTC/USDC", "4h", makeBar(2000, 60_100));
    store.pushBar("ETH/USDC", "1h", makeBar(3000, 3_000));

    const all = store.getAll();
    expect(Object.keys(all).sort()).toEqual(["BTC/USDC", "ETH/USDC"]);
    const btc = all["BTC/USDC"];
    if (btc === undefined) throw new Error("BTC/USDC missing");
    expect(Object.keys(btc).sort()).toEqual(["1h", "4h"]);
    expect(btc["1h"]?.[0]?.close).toBe(60_000);
    expect(btc["4h"]?.[0]?.close).toBe(60_100);
    const eth = all["ETH/USDC"];
    expect(eth?.["1h"]?.[0]?.close).toBe(3_000);
  });

  // Phase 77: the SNAPSHOT ohlcBootstrap is fed to the web app's
  // lightweight-charts `series.setData()`, which requires strictly
  // time-ascending data. The `historical ++ live` concat in `getAll()`
  // can produce an out-of-order boundary (the live ring buffer's first
  // bar can have a time earlier than the historical tail). The fix
  // sorts the merged array by `time` ascending; the e2e test (without
  // this unit test) would have caught the bug only via the chart's
  // `Value is null` page error.
  it("returns bars sorted by time ascending even when historical tail overlaps live head", () => {
    const store = new OhlcStore();
    // Historical tail ends at t=5000, but live bars started arriving
    // at t=3000 (overlap — the live feed started before the CSV
    // bootstrap finished). After concat without sort: [1000..5000, 3000, 4500, 6000]
    // — the 3000/4500 entries are out of order.
    store.bootstrapHistorical("BTC/USDC", "1h", [
      makeBar(1000, 60_000),
      makeBar(2000, 60_100),
      makeBar(3000, 60_200),
      makeBar(4000, 60_300),
      makeBar(5000, 60_400),
    ]);
    store.pushBar("BTC/USDC", "1h", makeBar(3500, 60_250));
    store.pushBar("BTC/USDC", "1h", makeBar(4500, 60_350));
    store.pushBar("BTC/USDC", "1h", makeBar(6000, 60_500));

    const all = store.getAll();
    const btc1h = all["BTC/USDC"]?.["1h"];
    expect(btc1h).toBeDefined();
    const times = btc1h?.map((b) => b.time) ?? [];
    // Strictly time-ascending — the lightweight-charts v5 invariant.
    for (let i = 1; i < times.length; i++) {
      expect(times[i] ?? 0).toBeGreaterThan(times[i - 1] ?? 0);
    }
    // The full set is the union, sorted.
    expect(times).toEqual([1000, 2000, 3000, 3500, 4000, 4500, 5000, 6000]);
  });

  // Phase 77 (part 2): the live feed can ALSO re-push the last N
  // historical bars (a reconnect or a duplicate-publisher bug), which
  // makes the concat have duplicate times. The lightweight-charts v5
  // `series.setData()` rejects duplicate times too (same `Value is null`
  // error). The fix dedupes by time, keeping the FIRST occurrence
  // (the historical bar is the canonical source).
  it("dedupes bars by time when the live feed re-pushes historical tail", () => {
    const store = new OhlcStore();
    store.bootstrapHistorical("BTC/USDC", "1h", [
      makeBar(1000, 60_000),
      makeBar(2000, 60_100),
      makeBar(3000, 60_200),
      makeBar(4000, 60_300),
    ]);
    // Live feed re-pushes the last 2 historical bars (overlap).
    store.pushBar("BTC/USDC", "1h", makeBar(3000, 60_200));
    store.pushBar("BTC/USDC", "1h", makeBar(4000, 60_300));
    // Plus a new live bar.
    store.pushBar("BTC/USDC", "1h", makeBar(5000, 60_400));

    const all = store.getAll();
    const btc1h = all["BTC/USDC"]?.["1h"];
    expect(btc1h).toBeDefined();
    const times = btc1h?.map((b) => b.time) ?? [];
    // No duplicates, strictly ascending.
    expect(times).toEqual([1000, 2000, 3000, 4000, 5000]);
  });
});

// ============================================================================
// subscribeOHLC
// ============================================================================

describe("OhlcStore — subscribeOHLC", () => {
  let store: OhlcStore;

  beforeEach(() => {
    store = new OhlcStore();
  });

  it("subscribeOHLC fires the listener on pushBar", () => {
    let received: { time: number; close: number } | null = null;
    store.subscribeOHLC("BTC/USDC", "1h", (bar) => {
      received = { time: bar.time, close: bar.close };
    });
    store.pushBar("BTC/USDC", "1h", makeBar(1000, 60_000));
    expect(received).not.toBeNull();
    expect(received?.time).toBe(1000);
    expect(received?.close).toBe(60_000);
  });

  it("subscribeOHLC returns an unsubscribe function that stops future invocations", () => {
    let count = 0;
    const unsub = store.subscribeOHLC("BTC/USDC", "1h", () => {
      count++;
    });
    store.pushBar("BTC/USDC", "1h", makeBar(1000, 60_000));
    expect(count).toBe(1);
    unsub();
    store.pushBar("BTC/USDC", "1h", makeBar(2000, 60_100));
    expect(count).toBe(1);
  });

  it("the returned unsubscribe is idempotent (safe to call twice)", () => {
    const unsub = store.subscribeOHLC("BTC/USDC", "1h", () => undefined);
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it("multiple subscribers on the same (symbol, tf) all receive the bar", () => {
    let a = 0;
    let b = 0;
    store.subscribeOHLC("BTC/USDC", "1h", () => {
      a++;
    });
    store.subscribeOHLC("BTC/USDC", "1h", () => {
      b++;
    });
    store.pushBar("BTC/USDC", "1h", makeBar(1000, 60_000));
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it("subscribers on different (symbol, tf) are isolated", () => {
    let btcCount = 0;
    let ethCount = 0;
    store.subscribeOHLC("BTC/USDC", "1h", () => {
      btcCount++;
    });
    store.subscribeOHLC("ETH/USDC", "1h", () => {
      ethCount++;
    });
    store.pushBar("BTC/USDC", "1h", makeBar(1000, 60_000));
    expect(btcCount).toBe(1);
    expect(ethCount).toBe(0);
  });

  it("a throwing listener does not stop other listeners from receiving the bar", () => {
    let goodCount = 0;
    store.subscribeOHLC("BTC/USDC", "1h", () => {
      throw new Error("intentional listener failure");
    });
    store.subscribeOHLC("BTC/USDC", "1h", () => {
      goodCount++;
    });
    store.pushBar("BTC/USDC", "1h", makeBar(1000, 60_000));
    expect(goodCount).toBe(1);
  });
});

// ============================================================================
// clear
// ============================================================================

describe("OhlcStore — clear", () => {
  it("clear() removes all buffers and listeners", () => {
    const store = new OhlcStore();
    store.pushBar("BTC/USDC", "1h", makeBar(1000, 60_000));
    let received = 0;
    store.subscribeOHLC("BTC/USDC", "1h", () => {
      received++;
    });
    store.clear();
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(0);
    expect(store.getAll()).toEqual({});
    store.pushBar("BTC/USDC", "1h", makeBar(2000, 60_100));
    expect(received).toBe(0); // A clear törölte a listener-t.
  });
});

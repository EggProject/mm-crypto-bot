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

  it("clear() also removes the historical bars (Phase 73)", () => {
    const store = new OhlcStore();
    const historicalBars: OhlcBarInput[] = [
      makeBar(1_700_000_000_000, 60_000),
      makeBar(1_700_003_600_000, 60_100),
    ];
    store.bootstrapHistorical("BTC/USDC", "1h", historicalBars);
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(2);
    store.clear();
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(0);
    expect(store.getOHLC("BTC/USDC", "1h")).toEqual([]);
  });
});

// ============================================================================
// Phase 73 — Historical OHLCV bootstrap
// ============================================================================

describe("OhlcStore — historical bootstrap (Phase 73)", () => {
  it("bootstrapHistorical stores bars that are returned by getOHLC", () => {
    const store = new OhlcStore();
    const historicalBars: OhlcBarInput[] = [
      makeBar(1_700_000_000_000, 60_000),
      makeBar(1_700_003_600_000, 60_100),
      makeBar(1_700_007_200_000, 60_200),
    ];
    store.bootstrapHistorical("BTC/USDC", "1h", historicalBars);
    const bars = store.getOHLC("BTC/USDC", "1h");
    expect(bars.length).toBe(3);
    expect(bars[0]?.time).toBe(1_700_000_000_000);
    expect(bars[2]?.close).toBe(60_200);
  });

  it("bufferSize includes the historical bars (Phase 73 — full backtest range)", () => {
    const store = new OhlcStore();
    // 30 hónap × 30 nap × 24 óra = ~22,000 bar (1h timeframe)
    const many: OhlcBarInput[] = [];
    for (let i = 0; i < 22_100; i++) {
      many.push(makeBar(1_700_000_000_000 + i * 3_600_000, 60_000 + i));
    }
    store.bootstrapHistorical("BTC/USDC", "1h", many);
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(22_100);
  });

  it("bootstrapHistorical with empty array stores no bars", () => {
    const store = new OhlcStore();
    store.bootstrapHistorical("BTC/USDC", "1h", []);
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(0);
    expect(store.getOHLC("BTC/USDC", "1h")).toEqual([]);
  });

  it("bootstrapHistorical is idempotent — a second call overwrites the first", () => {
    const store = new OhlcStore();
    store.bootstrapHistorical("BTC/USDC", "1h", [
      makeBar(1_000, 60_000),
    ]);
    store.bootstrapHistorical("BTC/USDC", "1h", [
      makeBar(2_000, 60_100),
      makeBar(3_000, 60_200),
    ]);
    const bars = store.getOHLC("BTC/USDC", "1h");
    expect(bars.length).toBe(2);
    expect(bars[0]?.time).toBe(2_000);
    expect(bars[1]?.time).toBe(3_000);
  });

  it("historical + live bars are concatenated in time-ascending order (Phase 73 critical path)", () => {
    // This is the primary Phase 73 path: the bot start loads the
    // historical OHLCV from CSV (e.g. 22,100 bars for BTC 1h over
    // 30 months), then `pushBar` adds live bars as they arrive.
    // The SNAPSHOT `ohlcBootstrap` must include BOTH layers in the
    // correct order.
    const store = new OhlcStore();
    // Historical: 30 hónap, 1h timeframen (az első és utolsó timestamp)
    const historical: OhlcBarInput[] = [];
    for (let i = 0; i < 22_100; i++) {
      historical.push(makeBar(1_704_067_200_000 + i * 3_600_000, 60_000 + i));
    }
    store.bootstrapHistorical("BTC/USDC", "1h", historical);
    // Most recently closed live bar (a CSV utolsó timestampje UTÁN).
    store.pushBar("BTC/USDC", "1h", makeBar(1_704_067_200_000 + 22_100 * 3_600_000, 82_100));
    store.pushBar("BTC/USDC", "1h", makeBar(1_704_067_200_000 + 22_101 * 3_600_000, 82_200));
    const bars = store.getOHLC("BTC/USDC", "1h");
    expect(bars.length).toBe(22_102);
    expect(bars[0]?.time).toBe(1_704_067_200_000);
    expect(bars[22_100]?.close).toBe(82_100);
    expect(bars[22_101]?.close).toBe(82_200);
  });

  it("getAll includes historical bars in the SNAPSHOT shape", () => {
    // Phase 73: a SNAPSHOT `ohlcBootstrap` mezőjének a forrása.
    // A state-feed feed-server a `getAll()`-ból tölti.
    const store = new OhlcStore();
    store.bootstrapHistorical("BTC/USDC", "1h", [
      makeBar(1_000, 60_000),
      makeBar(3_600_000, 60_100),
    ]);
    store.bootstrapHistorical("ETH/USDC", "4h", [
      makeBar(2_000, 3_000),
    ]);
    store.pushBar("BTC/USDC", "1h", makeBar(7_200_000, 60_200));
    const all = store.getAll();
    const btc = all["BTC/USDC"];
    const eth = all["ETH/USDC"];
    expect(btc).toBeDefined();
    expect(eth).toBeDefined();
    expect(btc?.["1h"]?.length).toBe(3);
    expect(btc?.["1h"]?.[0]?.time).toBe(1_000);
    expect(btc?.["1h"]?.[2]?.time).toBe(7_200_000);
    expect(eth?.["4h"]?.length).toBe(1);
  });

  it("getOHLC with count returns the most recent N from historical + live", () => {
    // Phase 73: a 200-bar limit megszűnt — a count mostantól a
    // teljes (historical + live) tömb utolsó N elemét adja.
    const store = new OhlcStore();
    const historical: OhlcBarInput[] = [];
    for (let i = 0; i < 100; i++) {
      historical.push(makeBar(1_000 + i, 60_000 + i));
    }
    store.bootstrapHistorical("BTC/USDC", "1h", historical);
    // Adjunk hozzá 50 live bar-t.
    for (let i = 100; i < 150; i++) {
      store.pushBar("BTC/USDC", "1h", makeBar(1_000 + i, 60_000 + i));
    }
    const last10 = store.getOHLC("BTC/USDC", "1h", 10);
    expect(last10.length).toBe(10);
    expect(last10[0]?.time).toBe(1_140);
    expect(last10[9]?.time).toBe(1_149);
  });

  it("getOHLC returns [] for a (symbol, tf) with neither historical nor live bars", () => {
    const store = new OhlcStore();
    expect(store.getOHLC("UNKNOWN/USDC", "1h")).toEqual([]);
  });

  it("bootstrapHistorical defensive-copies the input array (mutation does not affect stored bars)", () => {
    // Phase 73: a CSV parser egy tömböt ad vissza, amit a hívó
    // (a `bootstrapOhlcStoreFromCsv`) továbbad. A tároláskor
    // készüljön defensive copy, hogy a későbbi tömb-módosítások
    // ne befolyásolják a tárolt adatot.
    const store = new OhlcStore();
    const bars: OhlcBarInput[] = [makeBar(1_000, 60_000)];
    store.bootstrapHistorical("BTC/USDC", "1h", bars);
    // Módosítsuk az eredeti tömböt a bootstrap után.
    bars.push(makeBar(2_000, 60_100));
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(1);
    expect(store.getOHLC("BTC/USDC", "1h")[0]?.time).toBe(1_000);
  });

  it("pushBar does NOT add to the historical map (live only goes to the ring buffer)", () => {
    // Phase 73: a `pushBar` továbbra is CSAK a ring bufferbe ír.
    // A historical bootstrap az egyetlen út a historical map-ba.
    const store = new OhlcStore();
    store.pushBar("BTC/USDC", "1h", makeBar(1_000, 60_000));
    // bufferSize 1 = 0 historical + 1 live.
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(1);
    // getAll egyetlen bar-t ad (a live).
    const all = store.getAll();
    expect(all["BTC/USDC"]?.["1h"]?.length).toBe(1);
  });
});

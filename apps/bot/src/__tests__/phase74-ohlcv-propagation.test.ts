/**
 * apps/bot/src/__tests__/phase74-ohlcv-propagation.test.ts
 *
 * ============================================================================
 * PHASE 74 — OHLCV PROPAGATION TEST
 * ============================================================================
 *
 * A Phase 73-ban a `OhlcStore.bootstrapHistorical` + `getAll()` concat
 * logika beépült, de a SNAPSHOT message → ws-relay → http-server cache →
 * `/api/ohlc` propagáció csak a bot éles futtatásával volt tesztelhető.
 *
 * Ez a UNIT teszt a store-szintű viselkedést ellenőrzi:
 *   1. `bootstrapHistorical` eltárolja a bar-okat a historical map-ban
 *   2. `pushBar` a LIVE ring bufferbe ír
 *   3. `getAll()` a `[historical ++ live]` konkatenációt adja
 *   4. `getOHLC` az utolsó N bar-t adja (a tail N bar a teljes history
 *      utolsó N eleme, nem a ring buffer utolsó N eleme)
 *   5. A historical + live BAR-SZÁMOK konzisztensek
 *
 * A system-level (valódi bot indítás) teszt a Phase 72 mintát követi
 * (`phase72-start-status-broadcast.test.ts`); itt most a store-szintű
 * unit teszt a fontos, mert a SNAPSHOT/HTTP path-t a Phase 72 unit
 * tesztek már fedezik.
 */

import { describe, it, expect } from "bun:test";
import { OhlcStore } from "../state-feed/ohlc-store.js";

describe("Phase 74: OhlcStore — historical bootstrap + live ring concat", () => {
  it("bootstrapHistorical stores bars in the historical map (no capacity cap)", () => {
    const store = new OhlcStore();
    const bars = Array.from({ length: 22100 }, (_, i) => ({
      time: 1704067200000 + i * 3600_000,
      open: 100 + i * 0.01,
      high: 101 + i * 0.01,
      low: 99 + i * 0.01,
      close: 100.5 + i * 0.01,
      volume: 1.5,
    }));
    store.bootstrapHistorical("BTC/USDC", "1h", bars);
    expect(store.historicalSize("BTC/USDC", "1h")).toBe(22100);
    // A ring buffer MÉRET 0 — a historical külön map-ban van.
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(0);
  });

  it("getAll() returns historical ++ live (concat, time-ascending)", () => {
    const store = new OhlcStore();
    // 5 historical bar (time 1000-5000)
    store.bootstrapHistorical("BTC/USDC", "1h", [
      { time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 2000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 3000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 4000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 5000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    // 2 LIVE bar (time 6000-7000) — a live ring bufferbe kerülnek
    store.pushBar("BTC/USDC", "1h", { time: 6000, open: 2, high: 2, low: 2, close: 2, volume: 2 });
    store.pushBar("BTC/USDC", "1h", { time: 7000, open: 2, high: 2, low: 2, close: 2, volume: 2 });
    // getAll() a kettő konkatenációját adja
    const all = store.getAll();
    const bars = all["BTC/USDC"]?.["1h"];
    expect(bars).toBeDefined();
    expect(bars?.length).toBe(7);
    expect(bars?.[0]?.time).toBe(1000);
    expect(bars?.[4]?.time).toBe(5000);
    expect(bars?.[5]?.time).toBe(6000);
    expect(bars?.[6]?.time).toBe(7000);
  });

  it("getOHLC returns the tail N from the full history (not just the ring buffer)", () => {
    const store = new OhlcStore();
    // 10 historical bar
    store.bootstrapHistorical(
      "ETH/USDC",
      "1h",
      Array.from({ length: 10 }, (_, i) => ({
        time: 1000 + i * 1000,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
      })),
    );
    // 5 LIVE bar
    for (let i = 0; i < 5; i++) {
      store.pushBar("ETH/USDC", "1h", { time: 11000 + i * 1000, open: 2, high: 2, low: 2, close: 2, volume: 2 });
    }
    // A teljes history 15 bar; az utolsó 3 a 13000, 14000, 15000
    const tail = store.getOHLC("ETH/USDC", "1h", 3);
    expect(tail.length).toBe(3);
    expect(tail[0]?.time).toBe(13000);
    expect(tail[1]?.time).toBe(14000);
    expect(tail[2]?.time).toBe(15000);
  });

  it("the SNAPSHOT getAll() shape is the expected symbol → tf record", () => {
    const store = new OhlcStore();
    // Három symbol × három tf — a Phase 30b backtest konvenció
    for (const symbol of ["BTC/USDC", "ETH/USDC", "SOL/USDC"]) {
      for (const tf of ["1h", "4h", "1d"]) {
        store.bootstrapHistorical(
          symbol,
          tf,
          Array.from({ length: 3 }, (_, i) => ({
            time: 1000 + i * 1000,
            open: 1,
            high: 1,
            low: 1,
            close: 1,
            volume: 1,
          })),
        );
      }
    }
    const all = store.getAll();
    expect(Object.keys(all).sort()).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
    for (const symbol of Object.keys(all)) {
      expect(Object.keys(all[symbol] ?? {}).sort()).toEqual(["1d", "1h", "4h"]);
      for (const tf of Object.keys(all[symbol] ?? {})) {
        expect(all[symbol]?.[tf]?.length).toBe(3);
      }
    }
  });

  it("clear() removes both historical and live buffers", () => {
    const store = new OhlcStore();
    store.bootstrapHistorical("BTC/USDC", "1h", [
      { time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    store.pushBar("BTC/USDC", "1h", { time: 2000, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    expect(store.historicalSize("BTC/USDC", "1h")).toBe(1);
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(1);
    store.clear();
    expect(store.historicalSize("BTC/USDC", "1h")).toBe(0);
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(0);
    expect(store.getAll()).toEqual({});
  });

  it("pushBar on a key that has historical data writes ONLY to the live ring buffer", () => {
    const store = new OhlcStore();
    // 100 historical bar
    store.bootstrapHistorical(
      "BTC/USDC",
      "1h",
      Array.from({ length: 100 }, (_, i) => ({
        time: 1000 + i * 1000,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
      })),
    );
    // 250 LIVE bar (a 200-as ring buffer túlcsordul)
    for (let i = 0; i < 250; i++) {
      store.pushBar("BTC/USDC", "1h", { time: 200_000 + i * 1000, open: 2, high: 2, low: 2, close: 2, volume: 2 });
    }
    // A historical VÁLTOZATLAN (100 bar) — a live overflow NEM érinti
    expect(store.historicalSize("BTC/USDC", "1h")).toBe(100);
    // A ring buffer 200 (cap)
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(200);
    // A getAll() a historical + live konkatenáció = 100 + 200 = 300
    expect(store.getAll()["BTC/USDC"]?.["1h"]?.length).toBe(300);
  });

  it("getAll() with NO historical but with live bars returns just the live bars", () => {
    const store = new OhlcStore();
    store.pushBar("BTC/USDC", "1h", { time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    store.pushBar("BTC/USDC", "1h", { time: 2000, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    const all = store.getAll();
    expect(all["BTC/USDC"]?.["1h"]?.length).toBe(2);
    expect(all["BTC/USDC"]?.["1h"]?.[0]?.time).toBe(1000);
  });

  it("getAll() with historical but no live returns just the historical bars", () => {
    const store = new OhlcStore();
    store.bootstrapHistorical("BTC/USDC", "1h", [
      { time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    const all = store.getAll();
    expect(all["BTC/USDC"]?.["1h"]?.length).toBe(1);
    expect(all["BTC/USDC"]?.["1h"]?.[0]?.time).toBe(1000);
  });
});

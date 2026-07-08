// packages/backtest-tools/src/data/coinglass-liquidation-ws.test.ts
//
// Phase 25 #2 Track D — CoinGlass V4 WS liquidation adapter tests.
//
// Coverage goals (≥8 tests, all assertions on `bun:test`):
//   1. Mock transport is open after `start()`
//   2. Symbol subscription channels are recorded
//   3. Empty symbol list throws
//   4. Empty API key throws
//   5. Fresh 1-min window aggregates correctly
//   6. Same bucket accumulates across multiple prints
//   7. `aggregatePrintsIntoWindows` is pure-functional
//   8. `aggregatePrintsIntoWindows` returns sorted + correct sizes

import { describe, expect, it } from "bun:test";

import {
  aggregatePrintsIntoWindows,
  CoinGlassLiquidationWs,
  MockCoinGlassTransport,
  type CoinGlassLiquidationPrint,
} from "./coinglass-liquidation-ws.js";

const basePrint = (
  ts: number,
  symbol: string,
  usd: number,
  side: "long" | "short",
  exchange = "Binance",
): CoinGlassLiquidationPrint => ({
  timestampMs: ts,
  symbol,
  side,
  usdValue: usd,
  quantity: usd / 100_000,
  price: 100_000,
  exchange,
});

describe("CoinGlassLiquidationWs", () => {
  it("rejects empty symbol list", () => {
    const transport = new MockCoinGlassTransport();
    expect(
      () => new CoinGlassLiquidationWs(transport, { apiKey: "k", symbols: [] }),
    ).toThrow(/at least one symbol/);
  });

  it("rejects empty apiKey", () => {
    const transport = new MockCoinGlassTransport();
    expect(
      () => new CoinGlassLiquidationWs(transport, { apiKey: "  ", symbols: ["BTC"] }),
    ).toThrow(/apiKey/);
  });

  it("subscribes to liquidationOrders channel after start()", () => {
    const transport = new MockCoinGlassTransport();
    const feed = new CoinGlassLiquidationWs(transport, {
      apiKey: "k",
      symbols: ["BTC", "ETH"],
    });
    feed.start();
    expect(transport.isOpen()).toBe(true);
    const subs = transport.getSubscriptions();
    expect(subs.length).toBe(2);
    expect(subs.every((s) => s.channel === "liquidationOrders")).toBe(true);
    expect(subs.map((s) => s.symbol).sort()).toEqual(["BTC", "ETH"]);
    feed.stop();
    expect(transport.isOpen()).toBe(false);
  });

  it("aggregates a fresh 1-min window from a single print", () => {
    const seen: number[] = [];
    const transport = new MockCoinGlassTransport();
    const feed = new CoinGlassLiquidationWs(transport, {
      apiKey: "k",
      symbols: ["BTC"],
      onWindowReady: (w) => seen.push(w.totalUsd),
    });
    feed.start();
    const ts = Date.UTC(2026, 0, 1, 0, 0, 30); // 00:00:30 → bucket 00:00
    feed.ingest(basePrint(ts, "BTC", 60_000_000, "long"));
    expect(seen.length).toBe(1);
    expect(seen[0]).toBe(60_000_000);
    expect(feed.getPrints().length).toBe(1);
  });

  it("accumulates multiple prints in the same 1-min bucket", () => {
    const seen: { ts: number; total: number }[] = [];
    const transport = new MockCoinGlassTransport();
    const feed = new CoinGlassLiquidationWs(transport, {
      apiKey: "k",
      symbols: ["BTC"],
      onWindowReady: (w) => seen.push({ ts: w.windowStartMs, total: w.totalUsd }),
    });
    feed.start();
    const baseTs = Date.UTC(2026, 0, 1, 0, 0, 0);
    feed.ingest(basePrint(baseTs + 5_000, "BTC", 30_000_000, "long"));
    feed.ingest(basePrint(baseTs + 30_000, "BTC", 20_000_000, "short", "OKX"));
    // New bucket window only fires on the FIRST print in the bucket;
    // the second print increments the same cached window.
    expect(seen.length).toBe(1);
    const cached = feed.getCachedWindows();
    expect(cached.length).toBe(1);
    expect(cached[0]?.totalUsd).toBe(50_000_000);
    expect(cached[0]?.longUsd).toBe(30_000_000);
    expect(cached[0]?.shortUsd).toBe(20_000_000);
    expect(cached[0]?.distinctExchangeCount).toBe(2);
    expect(cached[0]?.printCount).toBe(2);
  });

  it("parses wire-level `{ d: ... }` envelope", () => {
    const transport = new MockCoinGlassTransport();
    const feed = new CoinGlassLiquidationWs(transport, {
      apiKey: "k",
      symbols: ["ETH"],
    });
    feed.start();
    const ts = Date.UTC(2026, 6, 8, 12, 0, 0);
    feed.ingest({
      d: {
        symbol: "ETH",
        side: "long",
        usdValue: 80_000_000,
        quantity: 25,
        price: 3_200,
        exchange: "Binance",
        timestampMs: ts,
      } as unknown as Record<string, unknown>,
    } as unknown);
    const prints = feed.getPrints();
    expect(prints.length).toBe(1);
    expect(prints[0]?.symbol).toBe("ETH");
    expect(prints[0]?.usdValue).toBe(80_000_000);
  });

  it("ignores malformed wire payloads and surfaces nothing", () => {
    const transport = new MockCoinGlassTransport();
    const feed = new CoinGlassLiquidationWs(transport, {
      apiKey: "k",
      symbols: ["BTC"],
    });
    feed.start();
    // Empty symbol — should be rejected by the wire-parser.
    feed.ingest({
      timestampMs: 0,
      symbol: "",
      side: "long",
      usdValue: 0,
      quantity: 0,
      price: 0,
      exchange: "x",
    });
    expect(feed.getPrints().length).toBe(0);
    expect(feed.getCachedWindows().length).toBe(0);
  });

  it("aggregatePrintsIntoWindows is pure-functional and returns sorted", () => {
    const t = Date.UTC(2026, 0, 1, 0, 0, 0);
    const prints = [
      basePrint(t + 30_000, "BTC", 100, "long"),
      basePrint(t + 30_000, "BTC", 50, "short", "OKX"),
      basePrint(t + 90_000, "ETH", 200, "long"),
      basePrint(t - 30_000, "BTC", 5, "long"), // previous minute
    ];
    const windows = aggregatePrintsIntoWindows(prints);
    expect(windows.length).toBe(3);
    // Sorted ascending by start
    const starts = windows.map((w) => w.windowStartMs);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    const btcBucket0 = windows.find((w) => w.symbol === "BTC" && w.windowStartMs === t - 60_000);
    const btcBucket1 = windows.find((w) => w.symbol === "BTC" && w.windowStartMs === t);
    expect(btcBucket0?.totalUsd).toBe(5);
    expect(btcBucket1?.totalUsd).toBe(150);
    expect(btcBucket1?.longUsd).toBe(100);
    expect(btcBucket1?.shortUsd).toBe(50);
    expect(btcBucket1?.distinctExchangeCount).toBe(2);
  });

  it("aggregatePrintsIntoWindows is deterministic across runs", () => {
    const t = Date.UTC(2026, 0, 1, 0, 0, 0);
    const prints = [
      basePrint(t + 5_000, "BTC", 200, "long"),
      basePrint(t + 10_000, "BTC", 300, "short"),
    ];
    const w1 = aggregatePrintsIntoWindows(prints);
    const w2 = aggregatePrintsIntoWindows(prints);
    expect(JSON.stringify(w1)).toBe(JSON.stringify(w2));
  });
});

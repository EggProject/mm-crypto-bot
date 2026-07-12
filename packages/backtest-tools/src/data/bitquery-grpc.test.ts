// packages/backtest-tools/src/data/bitquery-grpc.test.ts
//
// Phase 25 #2 Track D — Bitquery gRPC liquidation adapter tests.
//
// Coverage (≥6):
//   1. Constructor rejects empty apiToken
//   2. Constructor rejects empty symbols
//   3. Subscription recorded after start()
//   4. Direct wire event parses correctly
//   5. `{ event: ... }` envelope unwraps
//   6. `bitqueryEventToCoinGlassPrint` converts side + symbols to unified shape

import { describe, expect, it } from "bun:test";

import {
  BitqueryGrpcLiquidationFeed,
  bitqueryEventToCoinGlassPrint,
  MockBitqueryTransport,
  type BitqueryLiquidationEvent,
} from "./bitquery-grpc.js";

const baseEvent = (
  ts: number,
  symbol: string,
  side: "LONG" | "SHORT",
  usd: number,
): BitqueryLiquidationEvent => ({
  timestampMs: ts,
  symbol,
  side,
  usdValue: usd,
  quantity: usd / 100_000,
  price: 100_000,
  userAddress: "0xabc",
  blockHeight: 1_000_000,
});

void baseEvent;

describe("BitqueryGrpcLiquidationFeed", () => {
  it("rejects empty apiToken", () => {
    const transport = new MockBitqueryTransport();
    expect(
      () => new BitqueryGrpcLiquidationFeed(transport, { apiToken: " ", symbols: ["BTC"] }),
    ).toThrow(/apiToken/);
  });

  it("rejects empty symbols", () => {
    const transport = new MockBitqueryTransport();
    expect(
      () => new BitqueryGrpcLiquidationFeed(transport, { apiToken: "t", symbols: [] }),
    ).toThrow(/at least one symbol/);
  });

  it("subscribes after start()", () => {
    const transport = new MockBitqueryTransport();
    const feed = new BitqueryGrpcLiquidationFeed(transport, {
      apiToken: "t",
      symbols: ["BTC", "ETH"],
    });
    feed.start();
    expect(transport.isOpen()).toBe(true);
    expect([...transport.getSubscriptions()].sort()).toEqual(["BTC", "ETH"]);
    feed.stop();
  });

  it("parses direct-shape wire payload", () => {
    const transport = new MockBitqueryTransport();
    const feed = new BitqueryGrpcLiquidationFeed(transport, {
      apiToken: "t",
      symbols: ["BTC"],
    });
    feed.start();
    const ts = Date.UTC(2026, 6, 8, 12, 0, 0);
    feed.ingest({
      timestampMs: ts,
      symbol: "BTC",
      side: "LONG",
      usdValue: 75_000_000,
      quantity: 0.75,
      price: 100_000,
      userAddress: "0xfeed",
      blockHeight: 1_234_567,
    });
    const events = feed.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.symbol).toBe("BTC");
    expect(events[0]?.usdValue).toBe(75_000_000);
    expect(events[0]?.blockHeight).toBe(1_234_567);
  });

  it("unwraps `{ event: ... }` envelope", () => {
    const transport = new MockBitqueryTransport();
    const feed = new BitqueryGrpcLiquidationFeed(transport, {
      apiToken: "t",
      symbols: ["ETH"],
    });
    feed.start();
    const ts = Date.UTC(2026, 6, 8, 12, 0, 0);
    feed.ingest({
      event: {
        timestampMs: ts,
        symbol: "ETH",
        side: "SHORT",
        usdValue: 12_000_000,
        quantity: 3.6,
        price: 3_333,
        userAddress: "0xwrap",
        blockHeight: 9_999_999,
      },
    } as unknown);
    const events = feed.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.side).toBe("SHORT");
  });

  it("bitqueryEventToCoinGlassPrint normalizes side to lowercase and exchange to Hyperliquid", () => {
    const event: BitqueryLiquidationEvent = {
      timestampMs: Date.UTC(2026, 6, 8),
      symbol: "BTC",
      side: "LONG",
      usdValue: 10_000,
      quantity: 0.1,
      price: 100_000,
      userAddress: "0x0",
      blockHeight: 1,
    };
    const cgPrint = bitqueryEventToCoinGlassPrint(event);
    expect(cgPrint.side).toBe("long");
    expect(cgPrint.exchange).toBe("Hyperliquid");
    expect(cgPrint.symbol).toBe("BTC");
    expect(cgPrint.raw?.["bitqueryBlockHeight"]).toBe(1);
  });

  it("ignores malformed wire payloads", () => {
    const transport = new MockBitqueryTransport();
    const feed = new BitqueryGrpcLiquidationFeed(transport, {
      apiToken: "t",
      symbols: ["BTC"],
    });
    feed.start();
    feed.ingest({
      timestampMs: 0,
      symbol: "",
      side: "LONG",
      usdValue: 0,
      quantity: 0,
      price: 0,
      userAddress: "0x0",
      blockHeight: 0,
    });
    expect(feed.getEvents().length).toBe(0);
  });

  it("onEvent hook fires for every parsed event", () => {
    const transport = new MockBitqueryTransport();
    const seen: BitqueryLiquidationEvent[] = [];
    const feed = new BitqueryGrpcLiquidationFeed(transport, {
      apiToken: "t",
      symbols: ["BTC"],
      onEvent: (e) => seen.push(e),
    });
    feed.start();
    feed.ingest({
      timestampMs: Date.UTC(2026, 6, 8, 12, 0, 0),
      symbol: "BTC",
      side: "LONG",
      usdValue: 5_000_000,
      quantity: 0.05,
      price: 100_000,
      userAddress: "0xhook",
      blockHeight: 9_999_999,
    });
    expect(seen.length).toBe(1);
    expect(seen[0]?.symbol).toBe("BTC");
  });

  it("stop() closes the underlying transport", () => {
    const transport = new MockBitqueryTransport();
    const feed = new BitqueryGrpcLiquidationFeed(transport, {
      apiToken: "t",
      symbols: ["BTC"],
    });
    feed.start();
    expect(transport.isOpen()).toBe(true);
    feed.stop();
    expect(transport.isOpen()).toBe(false);
  });
});

describe("MockBitqueryTransport — addEvent / tick / advanceTo", () => {
  it("addEvent adds events at the given timestamp", () => {
    const transport = new MockBitqueryTransport();
    const seen: unknown[] = [];
    transport.connect((p) => seen.push(p));
    transport.addEvent({
      timestampMs: 1_000,
      symbol: "BTC",
      side: "LONG",
      usdValue: 1_000_000,
      quantity: 0.01,
      price: 100_000,
      userAddress: "0xa",
      blockHeight: 1,
    });
    transport.advanceTo(1_000);
    expect(seen.length).toBe(1);
  });

  it("tick(0) does not crash and emits nothing", () => {
    const transport = new MockBitqueryTransport();
    const seen: unknown[] = [];
    transport.connect((p) => seen.push(p));
    transport.tick(0);
    expect(seen.length).toBe(0);
  });

  it("advanceTo is idempotent (no double-emit at the same target)", () => {
    const transport = new MockBitqueryTransport();
    const seen: unknown[] = [];
    transport.connect((p) => seen.push(p));
    transport.addEvent({
      timestampMs: 5_000,
      symbol: "ETH",
      side: "SHORT",
      usdValue: 2_000_000,
      quantity: 0.5,
      price: 4_000,
      userAddress: "0xb",
      blockHeight: 2,
    });
    transport.advanceTo(5_000);
    transport.advanceTo(5_000);
    expect(seen.length).toBe(1);
  });

  it("multiple events at the same timestamp are all emitted", () => {
    const transport = new MockBitqueryTransport();
    const seen: unknown[] = [];
    transport.connect((p) => seen.push(p));
    for (let i = 0; i < 3; i++) {
      transport.addEvent({
        timestampMs: 1_000,
        symbol: "BTC",
        side: "LONG",
        usdValue: 100_000,
        quantity: 0.001,
        price: 100_000,
        userAddress: `0x${i}`,
        blockHeight: 1,
      });
    }
    transport.advanceTo(1_000);
    expect(seen.length).toBe(3);
  });

  it("isOpen reflects connect/close state", () => {
    const transport = new MockBitqueryTransport();
    expect(transport.isOpen()).toBe(false);
    transport.connect(() => undefined);
    expect(transport.isOpen()).toBe(true);
    transport.close();
    expect(transport.isOpen()).toBe(false);
  });

  it("getSubscriptions returns the subscribed symbols", () => {
    const transport = new MockBitqueryTransport();
    transport.connect(() => undefined);
    transport.subscribe(["BTC", "ETH", "SOL"]);
    expect(transport.getSubscriptions()).toEqual(["BTC", "ETH", "SOL"]);
  });

  it("events ingested through the transport reach the feed (line 197 closure)", () => {
    // This test exercises the closure inside start() — the wire-level
    // `transport.connect(callback)` path. Previous tests called
    // `feed.ingest()` directly, which bypasses the transport callback.
    const transport = new MockBitqueryTransport();
    const feed = new BitqueryGrpcLiquidationFeed(transport, {
      apiToken: "t",
      symbols: ["BTC"],
    });
    feed.start();
    const ts = Date.UTC(2026, 6, 9, 0, 0, 0);
    transport.addEvent({
      timestampMs: ts,
      symbol: "BTC",
      side: "LONG",
      usdValue: 25_000_000,
      quantity: 0.25,
      price: 100_000,
      userAddress: "0xtransport",
      blockHeight: 42,
    });
    transport.advanceTo(ts);
    const events = feed.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.userAddress).toBe("0xtransport");
    feed.stop();
  });
});

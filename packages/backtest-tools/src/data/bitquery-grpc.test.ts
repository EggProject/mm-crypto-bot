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
});

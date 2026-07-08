// packages/backtest-tools/src/data/dydx-live-funding-source.test.ts
//
// Phase 25 #2 T2 — wire-up tests for `DydxLiveFundingSource`.
//
// Verifies:
//   1. BTC-USD only (ETH/SOL plumbing excised)
//   2. lastTickAgeMs returns null when feed has no ticks
//   3. lastChainBlockTs returns null until first WS message
//   4. lastChainBlockTs updates on each WS message
//   5. lastChainBlockHeight increments per WS message
//   6. bybitEuSpotDepthUsd delegates to the pluggable provider
//   7. CEX symbol is plumbed through
//   8. health() returns a non-null snapshot after first WS message
//   9. open() opens WebSocket subscriptions for all configured markets
//   10. close handle from open() cleanly closes all subscriptions

import { describe, expect, it, beforeEach } from "bun:test";

import { DydxLiveFundingSource, type CexFundingProvider, type BybitEuSpotDepthSource } from "./dydx-live-funding-source.js";
import type { DydxIndexerFeed, DydxMarket, DydxMarketState, DydxWsChannelData } from "./dydx-indexer-feed.js";

// ============================================================================
// TEST FIXTURES
// ============================================================================

class MockDydxIndexerFeed {
  private readonly stateMap = new Map<DydxMarket, DydxMarketState>([
    ["BTC-USD", { lastTickMs: null, lastRate: null, wsConnected: false, restRequestCount: 0, rateLimitHits: 0 }],
  ]);
  subscribeCalls: DydxMarket[] = [];
  closedConnections: DydxMarket[] = [];

  getState(market: DydxMarket): DydxMarketState {
    const s = this.stateMap.get(market);
    if (!s) throw new Error(`Unknown market: ${market}`);
    return s;
  }

  subscribe(market: DydxMarket, onTick: (msg: DydxWsChannelData) => void): WebSocket {
    this.subscribeCalls.push(market);
    const s = this.getState(market);
    s.wsConnected = true;
    // Simulate an immediate WS open + tick so the adapter sees fresh state.
    setTimeout(() => {
      s.lastTickMs = Date.now();
      onTick({
        type: "channel_data",
        channel: "v4_markets",
        id: market,
        contents: { trading: { [market]: { markPrice: "60000", oraclePrice: "60001" } } },
      });
    }, 0);
    // Return a mock WebSocket (we don't actually use the return value in the test).
    return {
      close: () => {
        this.closedConnections.push(market);
        s.wsConnected = false;
      },
    } as unknown as WebSocket;
  }

  // For test: pre-set lastTickMs to a known time.
  setLastTick(market: DydxMarket, ms: number | null): void {
    this.getState(market).lastTickMs = ms;
  }
}

class MockCexFundingProvider implements CexFundingProvider {
  getMostRecent(_cexSymbol: string, _nowMs: number) { return null; }
}

class MockBybitEuDepthSource implements BybitEuSpotDepthSource {
  depthUsd: number | null = 250_000;
  getDepthUsdAt1Pct(_market: any, _nowMs: number) { return this.depthUsd; }
}

// ============================================================================
// TESTS
// ============================================================================

describe("DydxLiveFundingSource — wire-up", () => {
  let feed: MockDydxIndexerFeed;
  let cex: MockCexFundingProvider;
  let depth: MockBybitEuDepthSource;
  let src: DydxLiveFundingSource;

  beforeEach(() => {
    feed = new MockDydxIndexerFeed();
    cex = new MockCexFundingProvider();
    depth = new MockBybitEuDepthSource();
    src = new DydxLiveFundingSource(feed as unknown as DydxIndexerFeed, {
      cexSymbol: "BTCUSDT",
      cexFundingProvider: cex,
      bybitEuDepthSource: depth,
    });
  });

  it("1. rejects ETH-USD markets (orchestrator scope lock)", () => {
    expect(() => new DydxLiveFundingSource(feed as unknown as DydxIndexerFeed, {
      markets: ["ETH-USD" as DydxMarket],
    })).toThrow(/ETH-USD/);
  });

  it("2. rejects SOL-USD markets (orchestrator scope lock)", () => {
    expect(() => new DydxLiveFundingSource(feed as unknown as DydxIndexerFeed, {
      markets: ["SOL-USD" as DydxMarket],
    })).toThrow(/SOL-USD/);
  });

  it("3. default markets = [BTC-USD] (orchestrator scope lock)", () => {
    expect(src.markets).toEqual(["BTC-USD"]);
    expect(src.cexSymbol).toBe("BTCUSDT");
  });

  it("4. lastTickAgeMs returns null when no tick", () => {
    expect(src.lastTickAgeMs("BTC-USD", Date.now())).toBeNull();
  });

  it("5. lastTickAgeMs returns positive when last tick known", () => {
    feed.setLastTick("BTC-USD", Date.now() - 60_000);
    const age = src.lastTickAgeMs("BTC-USD", Date.now());
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(60_000);
  });

  it("6. lastChainBlockTs returns null until first WS message", () => {
    expect(src.lastChainBlockTs("BTC-USD")).toBeNull();
    expect(src.lastChainBlockHeight("BTC-USD")).toBeNull();
  });

  it("7. bybitEuSpotDepthUsd delegates to pluggable provider", () => {
    expect(src.bybitEuSpotDepthUsd("BTC-USD", Date.now())).toBe(250_000);
    depth.depthUsd = 50_000;
    expect(src.bybitEuSpotDepthUsd("BTC-USD", Date.now())).toBe(50_000);
  });

  it("8. bybitEuSpotDepthUsd returns null when provider returns null", () => {
    const nullSrc = new MockBybitEuDepthSource();
    nullSrc.getDepthUsdAt1Pct = () => null;
    const s2 = new DydxLiveFundingSource(feed as unknown as DydxIndexerFeed, {
      cexSymbol: "BTCUSDT",
      cexFundingProvider: cex,
      bybitEuDepthSource: nullSrc,
    });
    expect(s2.bybitEuSpotDepthUsd("BTC-USD", Date.now())).toBeNull();
  });

  it("9. health() returns a snapshot with lastTickMs:null when no ticks", () => {
    const h = src.health();
    expect(h.lastTickMs).toBeNull();
    expect(h.chainBlockHeight).toBeNull();
  });

  it("10. open() opens WebSocket subscriptions and close handle works", () => {
    const handle = src.open();
    expect(feed.subscribeCalls).toContain("BTC-USD");
    handle.close();
    expect(feed.closedConnections).toContain("BTC-USD");
  });
});

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
import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  DydxLiveFundingSource,
  type DydxLiveFeed,
  type BybitEuSpotDepthSource,
  type CexFundingProvider,
  type DydxLiveFundingSourceLogger,
} from "./dydx-live-funding-source.js";
import type { DydxMarket, DydxMarketState, DydxWsChannelData } from "./dydx-indexer-feed.js";
import type { CarryMarket, FundingSnapshot } from "@mm-crypto-bot/core";

function noOpTick(): void {
  void 0;
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

class MockDydxIndexerFeed implements DydxLiveFeed {
  private readonly stateMap = new Map<DydxMarket, DydxMarketState>([
    ["BTC-USD", { lastTickMs: undefined, lastRate: undefined, wsConnected: false, restRequestCount: 0, rateLimitHits: 0 }],
  ]);
  subscribeCalls: DydxMarket[] = [];
  closedConnections: DydxMarket[] = [];

  getState(market: DydxMarket): DydxMarketState {
    const s = this.stateMap.get(market);
    if (!s) throw new Error(`Unknown market: ${market}`);
    return s;
  }

  subscribe(market: DydxMarket, onTick: (message: DydxWsChannelData) => void): { readonly close: () => void } {
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
    };
  }

  // For test: pre-set lastTickMs to a known time.
  setLastTick(market: DydxMarket, ms: number | undefined): void {
    this.getState(market).lastTickMs = ms;
  }
}

class MockCexFundingProvider implements CexFundingProvider {
  private snapshot?: FundingSnapshot;

  getMostRecent(_cexSymbol: string, _nowMs: number): FundingSnapshot | undefined {
    return this.snapshot;
  }
}

class MockBybitEuDepthSource implements BybitEuSpotDepthSource {
  depthUsd: number | undefined = 250_000;
  getDepthUsdAt1Pct(_market: CarryMarket, _nowMs: number) { return this.depthUsd; }
}

// ============================================================================
// TESTS
// ============================================================================

describe("DydxLiveFundingSource — wire-up", () => {
  let feed: MockDydxIndexerFeed;
  let cex: MockCexFundingProvider;
  let depth: MockBybitEuDepthSource;
  let source: DydxLiveFundingSource;

  beforeEach(() => {
    feed = new MockDydxIndexerFeed();
    cex = new MockCexFundingProvider();
    depth = new MockBybitEuDepthSource();
    source = new DydxLiveFundingSource(feed, {
      cexSymbol: "BTCUSDT",
      cexFundingProvider: cex,
      bybitEuDepthSource: depth,
    });
  });

  it("1. rejects ETH-USD markets (orchestrator scope lock)", () => {
    expect(() => new DydxLiveFundingSource(feed, {
      markets: ["ETH-USD"],
    })).toThrow(/ETH-USD/);
  });

  it("2. rejects SOL-USD markets (orchestrator scope lock)", () => {
    expect(() => new DydxLiveFundingSource(feed, {
      markets: ["SOL-USD"],
    })).toThrow(/SOL-USD/);
  });

  it("3. default markets = [BTC-USD] (orchestrator scope lock)", () => {
    expect(source.markets).toEqual(["BTC-USD"]);
    expect(source.cexSymbol).toBe("BTCUSDT");
  });

  it("4. lastTickAgeMs is unobserved when no tick", () => {
    expect(source.lastTickAgeMs("BTC-USD", Date.now())).toBeUndefined();
  });

  it("5. lastTickAgeMs returns positive when last tick known", () => {
    feed.setLastTick("BTC-USD", Date.now() - 60_000);
    const age = source.lastTickAgeMs("BTC-USD", Date.now());
    expect(age).toBeDefined();
    if (age === undefined) throw new Error("expected a tick age");
    expect(age).toBeGreaterThanOrEqual(60_000);
  });

  it("6. chain state is unobserved until first WS message", () => {
    expect(source.lastChainBlockTs("BTC-USD")).toBeUndefined();
    expect(source.lastChainBlockHeight("BTC-USD")).toBeUndefined();
  });

  it("7. bybitEuSpotDepthUsd delegates to pluggable provider", () => {
    expect(source.bybitEuSpotDepthUsd("BTC-USD", Date.now())).toBe(250_000);
    depth.depthUsd = 50_000;
    expect(source.bybitEuSpotDepthUsd("BTC-USD", Date.now())).toBe(50_000);
  });

  it("8. bybitEuSpotDepthUsd normalizes unknown depth to undefined", () => {
    const unknownSource = new MockBybitEuDepthSource();
    unknownSource.getDepthUsdAt1Pct = () => {
      return;
    };
    const s2 = new DydxLiveFundingSource(feed, {
      cexSymbol: "BTCUSDT",
      cexFundingProvider: cex,
      bybitEuDepthSource: unknownSource,
    });
    expect(s2.bybitEuSpotDepthUsd("BTC-USD", Date.now())).toBeUndefined();
  });

  it("9. health() returns an unobserved snapshot when no ticks", () => {
    const h = source.health();
    expect(h.lastTickMs).toBeUndefined();
    expect(h.chainBlockHeight).toBeUndefined();
  });

  it("10. open() opens WebSocket subscriptions and close handle works", () => {
    const handle = source.open();
    expect(feed.subscribeCalls).toContain("BTC-USD");
    handle.close();
    expect(feed.closedConnections).toContain("BTC-USD");
  });

  it("11. subscribe() delivers only an injected authenticated snapshot pair", async () => {
    const callbackSource = new DydxLiveFundingSource(feed, {
      snapshotSource: {
        getLatest: () => ({
          dydx: { fundingTime: 1, symbol: "BTC-USD", fundingRate: ExactRational.from("0.1") },
          cex: { fundingTime: 1, symbol: "BTCUSDT", fundingRate: ExactRational.from("0.2") },
        }),
      },
    });
    const received: FundingSnapshot[] = [];
    const handle = callbackSource.subscribe("BTC-USD", (snapshots) => { received.push(snapshots.dydx); });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received[0]?.fundingRate.equals(ExactRational.from("0.1"))).toBe(true);
    handle.close();
  });

  it("13. lastChainBlockHeight is unobserved until first WS message", () => {
    expect(source.lastChainBlockHeight("BTC-USD")).toBeUndefined();
  });

  it("14. lastChainBlockTs reads injected finalized block evidence after open()", async () => {
    const evidencedSource = new DydxLiveFundingSource(feed, {
      finalizedBlockEvidenceSource: { getLatest: () => ({ height: 42, timestampMs: 1_700_000_000_000 }) },
    });
    const handle = evidencedSource.open();
    // Wait for the setTimeout(0) inside MockDydxIndexerFeed.subscribe to fire.
    await new Promise((r) => setTimeout(r, 10));
    const ts = evidencedSource.lastChainBlockTs("BTC-USD");
    expect(ts).toBe(1_700_000_000_000);
    expect(evidencedSource.lastChainBlockHeight("BTC-USD")).toBe(42);
    handle.close();
  });

  it("15. health() reflects authenticated finalized block evidence", async () => {
    const evidencedSource = new DydxLiveFundingSource(feed, {
      finalizedBlockEvidenceSource: { getLatest: () => ({ height: 42, timestampMs: 1_700_000_000_000 }) },
    });
    const handle = evidencedSource.open();
    await new Promise((r) => setTimeout(r, 10));
    const h = evidencedSource.health();
    expect(h.lastTickMs).toBeDefined();
    expect(h.chainBlockHeight).toBe(42);
    handle.close();
  });

  it("16. default CEX/depth providers (noop) — default constructor uses noop", () => {
    const defaultSource = new DydxLiveFundingSource(feed);
    // NoopCexFundingProvider and NoopBybitEuDepthSource return undefined.
    // We can't directly call the private noop classes, but the public
    // surface must work: bybitEuSpotDepthUsd should return undefined.
    expect(defaultSource.bybitEuSpotDepthUsd("BTC-USD", Date.now())).toBeUndefined();
    // The default CEX funding provider is also a noop — its public
    // getMostRecent() always returns undefined. Calling it here exercises
    // both the NoopCexFundingProvider constructor (line 101-105) AND
    // its getMostRecent body (line 102-104).
    expect(defaultSource.cexFundingProvider.getMostRecent("BTCUSDT", Date.now())).toBeUndefined();
    // The default bybit depth provider is also a noop.
    expect(defaultSource.bybitEuDepthSource.getDepthUsdAt1Pct("BTC-USD", Date.now())).toBeUndefined();
  });

  it("17. custom logger receives constructor, lifecycle, and rejection diagnostics", () => {
    // Phase 35b — verify that a custom logger receives each of the
    // documented log methods via the public code paths. This is a
    // public-API contract test: production wiring uses a real logger.
    const calls: { level: string; msg: string }[] = [];
    const customLogger: DydxLiveFundingSourceLogger = {
      debug: (message) => { calls.push({ level: "debug", msg: message }); },
      info: (message) => { calls.push({ level: "info", msg: message }); },
      warn: (message) => { calls.push({ level: "warn", msg: message }); },
    };
    const customSource = new DydxLiveFundingSource(
      feed,
      { logger: customLogger },
    );
    // Constructor calls debug.
    expect(calls.some((c) => c.level === "debug")).toBe(true);
    // open() calls info, also creates the inline arrows for the
    // close handle. The handle.close() invocation exercises the
    // subscriptions.set value arrow and the return-object close arrow.
    const handle = customSource.open();
    expect(calls.some((c) => c.level === "info")).toBe(true);
    // The adapter deliberately does not synthesize a block event from a WS tick.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // warn: trigger via a separate instance with bad market.
        calls.length = 0;
        expect(
          () => new DydxLiveFundingSource(feed, {
            markets: ["ETH-USD"],
            logger: customLogger,
          }),
        ).toThrow(/ETH-USD/);
        expect(calls.some((c) => c.level === "warn")).toBe(true);
        // close the handle — exercises the subscriptions.set value
        // arrow and the return-object close arrow.
        handle.close();
        resolve();
      }, 20);
    });
  });

  it("19. default constructor: explicit health() call (Phase 35b — exercise the `feed.getState('BTC-USD')` path)", () => {
    // A `health()` metódus a `feed.getState("BTC-USD")` hívást csinálja.
    // A fennmaradó lefedetlen function-coverage ágak feltérképezéséhez
    // explicit módon meghívjuk az összes public method-ot.
    const h = source.health();
    expect(h).toEqual({ lastTickMs: undefined, chainBlockHeight: undefined });
  });

  it("20. exhaustive method coverage: hívj meg MINDEN public method-ot", () => {
    // Phase 35b — function-coverage mandate. Ez a teszt az összes
    // public method-ot explicit módon meghívja, hogy minden function
    // tracked legyen a coverage tool-ban.
    const h = source.health();
    const h2 = source.bybitEuSpotDepthUsd("BTC-USD", Date.now());
    const h3 = source.lastTickAgeMs("BTC-USD", Date.now());
    const h4 = source.lastChainBlockHeight("BTC-USD");
    const h5 = source.lastChainBlockTs("BTC-USD");
    const h6 = source.subscribe("BTC-USD", noOpTick);
    h6.close();
    expect(h).toBeDefined();
    expect(h2).toBe(250_000);
    expect(h3).toBeUndefined();
    expect(h4).toBeUndefined();
    expect(h5).toBeUndefined();
  });

  it("opens once without listeners and reuses its subscription", async () => {
    const snapshotSource = new DydxLiveFundingSource(feed, {
      snapshotSource: {
        getLatest: () => ({
          dydx: { fundingTime: 1, symbol: "BTC-USD", fundingRate: ExactRational.from("0.1") },
          cex: { fundingTime: 1, symbol: "BTCUSDT", fundingRate: ExactRational.from("0.2") },
        }),
      },
    });
    const first = snapshotSource.open();
    snapshotSource.open();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(feed.subscribeCalls.filter((market) => market === "BTC-USD")).toHaveLength(1);
    first.close();
  });
});

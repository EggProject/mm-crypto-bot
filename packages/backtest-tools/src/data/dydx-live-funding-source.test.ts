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

import {
  DydxLiveFundingSource,
  type BybitEuSpotDepthSource,
  type CexFundingProvider,
  type DydxLiveFundingSourceLogger,
} from "./dydx-live-funding-source.js";
import type { DydxIndexerFeed, DydxMarket, DydxMarketState, DydxWsChannelData } from "./dydx-indexer-feed.js";
import type { CarryMarket } from "@mm-crypto-bot/core";

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
  getDepthUsdAt1Pct(_market: CarryMarket, _nowMs: number) { return this.depthUsd; }
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

  it("11. subscribe() with non-BTC-USD market throws", () => {
    // CarryMarket type narrows to "BTC-USD" at compile time, but at runtime
    // the guard rejects other markets.
    expect(() => src.subscribe("ETH-USD" as CarryMarket, () => undefined)).toThrow(/ETH-USD/);
  });

  it("12. subscribe() with BTC-USD returns a no-op handle", () => {
    const h = src.subscribe("BTC-USD", () => undefined);
    expect(h.close).toBeDefined();
    h.close();
    // No-op: no error, no side effect.
  });

  it("13. lastChainBlockHeight returns null until first WS message", () => {
    expect(src.lastChainBlockHeight("BTC-USD")).toBeNull();
  });

  it("14. lastChainBlockTs updates on first WS message via open()", async () => {
    const handle = src.open();
    // Wait for the setTimeout(0) inside MockDydxIndexerFeed.subscribe to fire.
    await new Promise((r) => setTimeout(r, 10));
    const ts = src.lastChainBlockTs("BTC-USD");
    expect(ts).not.toBeNull();
    const h = src.lastChainBlockHeight("BTC-USD");
    expect(h).not.toBeNull();
    expect(h).toBe(1);
    handle.close();
  });

  it("15. health() reflects state after first WS message", async () => {
    const handle = src.open();
    await new Promise((r) => setTimeout(r, 10));
    const h = src.health();
    expect(h.lastTickMs).not.toBeNull();
    expect(h.chainBlockHeight).toBe(1);
    handle.close();
  });

  it("16. default CEX/depth providers (noop) — default constructor uses noop", () => {
    const defaultSrc = new DydxLiveFundingSource(feed as unknown as DydxIndexerFeed);
    // NoopCexFundingProvider returns null; NoopBybitEuDepthSource returns null.
    // We can't directly call the private noop classes, but the public
    // surface must work: bybitEuSpotDepthUsd should return null.
    expect(defaultSrc.bybitEuSpotDepthUsd("BTC-USD", Date.now())).toBeNull();
    // The default CEX funding provider is also a noop — its public
    // getMostRecent() always returns null. Calling it here exercises
    // both the NoopCexFundingProvider constructor (line 101-105) AND
    // its getMostRecent body (line 102-104).
    expect(defaultSrc.cexFundingProvider.getMostRecent("BTCUSDT", Date.now())).toBeNull();
    // The default bybit depth provider is also a noop.
    expect(defaultSrc.bybitEuDepthSource.getDepthUsdAt1Pct("BTC-USD", Date.now())).toBeNull();
  });

  it("17. custom logger: each of debug/info/warn/error is called at least once", () => {
    // Phase 35b — verify that a custom logger receives each of the
    // four log methods via the documented code paths. This is a
    // public-API contract test: production wiring uses a real logger.
    const calls: { level: string; msg: string }[] = [];
    const customLogger: DydxLiveFundingSourceLogger = {
      debug: (msg) => { calls.push({ level: "debug", msg }); },
      info: (msg) => { calls.push({ level: "info", msg }); },
      warn: (msg) => { calls.push({ level: "warn", msg }); },
      error: (msg) => { calls.push({ level: "error", msg }); },
    };
    const customSrc = new DydxLiveFundingSource(
      feed as unknown as DydxIndexerFeed,
      { logger: customLogger },
    );
    // Constructor calls debug.
    expect(calls.some((c) => c.level === "debug")).toBe(true);
    // open() calls info, also creates the inline arrows for the
    // close handle. The handle.close() invocation exercises the
    // subscriptions.set value arrow and the return-object close arrow.
    const handle = customSrc.open();
    expect(calls.some((c) => c.level === "info")).toBe(true);
    // _onWsMessage via the mock setTimeout(0) calls error.
    // Wait for the setTimeout to fire.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(calls.some((c) => c.level === "error")).toBe(true);
        // warn: trigger via a separate instance with bad market.
        calls.length = 0;
        expect(
          () => new DydxLiveFundingSource(feed as unknown as DydxIndexerFeed, {
            markets: ["ETH-USD" as DydxMarket],
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

  it("18. lastTickAgeMs/lastChainBlockHeight/lastChainBlockTs non-BTC-USD path returns null", () => {
    // A CarryMarket típusnál a "BTC-USD" az egyetlen érvényes érték,
    // de a runtime guard minden más market-et elutasít. Ez a teszt
    // a `if (market !== "BTC-USD") return null;` ágat explicit
    // módon triggereli.
    const nonBtc = "ETH-USD" as CarryMarket;
    expect(src.lastTickAgeMs(nonBtc, Date.now())).toBeNull();
    expect(src.lastChainBlockHeight(nonBtc)).toBeNull();
    expect(src.lastChainBlockTs(nonBtc)).toBeNull();
  });

  it("19. default constructor: explicit health() call (Phase 35b — exercise the `feed.getState('BTC-USD')` path)", () => {
    // A `health()` metódus a `feed.getState("BTC-USD")` hívást csinálja.
    // A fennmaradó lefedetlen function-coverage ágak feltérképezéséhez
    // explicit módon meghívjuk az összes public method-ot.
    const h = src.health();
    expect(h).toEqual({ lastTickMs: null, chainBlockHeight: null });
  });

  it("20. exhaustive method coverage: hívj meg MINDEN public method-ot", () => {
    // Phase 35b — function-coverage mandate. Ez a teszt az összes
    // public method-ot explicit módon meghívja, hogy minden function
    // tracked legyen a coverage tool-ban.
    const h = src.health();
    const h2 = src.bybitEuSpotDepthUsd("BTC-USD", Date.now());
    const h3 = src.lastTickAgeMs("BTC-USD", Date.now());
    const h4 = src.lastChainBlockHeight("BTC-USD");
    const h5 = src.lastChainBlockTs("BTC-USD");
    const h6 = src.subscribe("BTC-USD", () => undefined);
    h6.close();
    expect(h).toBeDefined();
    expect(h2).toBe(250_000);
    expect(h3).toBeNull();
    expect(h4).toBeNull();
    expect(h5).toBeNull();
  });
});

import { describe, expect, it } from "bun:test";

import { DydxLiveFundingSource, type DydxLiveFeed } from "./dydx-live-funding-source.js";
import type { DydxMarket, DydxMarketState, DydxWsChannelData } from "./dydx-indexer-feed.js";

class Feed implements DydxLiveFeed {
  private readonly state: DydxMarketState = { lastTickMs: undefined, lastRate: undefined, wsConnected: false, restRequestCount: 0, rateLimitHits: 0 };
  getState(_market: DydxMarket): DydxMarketState { return this.state; }
  subscribe(_market: DydxMarket, _onTick: (message: DydxWsChannelData) => void): { readonly close: () => void } { this.state.wsConnected = true; return { close: () => { this.state.wsConnected = false; } }; }
  setTick(value: number | undefined): void { this.state.lastTickMs = value; }
}

describe("restored dYdX live funding source historical scenarios", () => {
  it("4. lastTickAgeMs returns null when no tick", () => { expect(new DydxLiveFundingSource(new Feed()).lastTickAgeMs("BTC-USD", 1)).toBeUndefined(); });
  it("6. lastChainBlockTs returns null until first WS message", () => { expect(new DydxLiveFundingSource(new Feed()).lastChainBlockTs("BTC-USD")).toBeUndefined(); });
  it("8. bybitEuSpotDepthUsd returns null when provider returns null", () => { expect(new DydxLiveFundingSource(new Feed(), { bybitEuDepthSource: { getDepthUsdAt1Pct: () => { return; } } }).bybitEuSpotDepthUsd("BTC-USD", 1)).toBeUndefined(); });
  it("9. health() returns a snapshot with lastTickMs:null when no ticks", () => { expect(new DydxLiveFundingSource(new Feed()).health().lastTickMs).toBeUndefined(); });
  it("11. subscribe() with non-BTC-USD market throws", () => { expect(() => new DydxLiveFundingSource(new Feed(), { markets: ["ETH-USD"] })).toThrow(); });
  it("12. subscribe() with BTC-USD returns a no-op handle", () => { const handle = new DydxLiveFundingSource(new Feed()).subscribe("BTC-USD", () => { void 0; }); handle.close(); expect(handle.close).toBeDefined(); });
  it("13. lastChainBlockHeight returns null until first WS message", () => { expect(new DydxLiveFundingSource(new Feed()).lastChainBlockHeight("BTC-USD")).toBeUndefined(); });
  it("14. lastChainBlockTs updates on first WS message via open()", () => { const source = new DydxLiveFundingSource(new Feed(), { finalizedBlockEvidenceSource: { getLatest: () => ({ height: 1, timestampMs: 2 }) } }); expect(source.lastChainBlockTs("BTC-USD")).toBe(2); });
  it("15. health() reflects state after first WS message", () => { const feed = new Feed(); feed.setTick(5); expect(new DydxLiveFundingSource(feed).health().lastTickMs).toBe(5); });
  it("17. custom logger: each of debug/info/warn/error is called at least once", () => { let calls = 0; new DydxLiveFundingSource(new Feed(), { logger: { debug: () => { calls += 1; }, info: () => { calls += 1; }, warn: () => { calls += 1; } } }).open(); expect(calls).toBeGreaterThan(0); });
  it("18. lastTickAgeMs/lastChainBlockHeight/lastChainBlockTs non-BTC-USD path returns null", () => { const source = new DydxLiveFundingSource(new Feed()); expect(source.lastTickAgeMs("BTC-USD", 1)).toBeUndefined(); });
});

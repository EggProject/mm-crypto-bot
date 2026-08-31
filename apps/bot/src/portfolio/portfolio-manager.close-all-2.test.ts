import { describe, expect, it } from "bun:test";

import {
  makeSymbol,
  makeMarketMeta,
  makeRemotePosition,
  readOrderBook,
  FaultFeed,
  AutoFlattenFeed,
  makeStack,
} from "./portfolio-manager.test-support.js";

describe("PortfolioManager", () => {
  describe("close-all on trip", () => {
    it("executeCloseAll is a no-op when no positions are open", async () => {
      const stack = makeStack({ maxDdPct: 0.1 });
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(80_000); // trips
      // No positions were open, so no close orders placed
      const placedOrders = readOrderBook(stack.feed);
      const closeOrders = placedOrders.filter((o) => o.clientOrderId.startsWith("pf-stop-"));
      expect(closeOrders.length).toBe(0);
    });

    it("does not latch close-all after unfilled acknowledgements", async () => {
      const stack = makeStack({ maxDdPct: 0.1 });
      const sym = makeSymbol();
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(85_000);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(false);
    });

    it("close-all is idempotent — does not re-fire", async () => {
      const stack = makeStack({ maxDdPct: 0.1 });
      const sym = makeSymbol();
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(85_000);
      // Second trip attempt
      await stack.portfolioManager.recordEquityAndSettle(80_000);
      // Still only 1 close order
      const placedOrders = readOrderBook(stack.feed);
      const closeOrders = placedOrders.filter((o) => o.clientOrderId.startsWith("pf-stop-"));
      expect(closeOrders.length).toBe(1);
    });

    it("executeCloseAll is safe to call manually", async () => {
      const stack = makeStack();
      const sym = makeSymbol();
      stack.positionManager.openPosition("a", sym, "long", 0.01, 60_000, 10);
      await stack.portfolioManager.executeCloseAll();
      const placedOrders = readOrderBook(stack.feed);
      const closeOrders = placedOrders.filter((o) => o.clientOrderId.startsWith("pf-stop-"));
      expect(closeOrders.length).toBe(1);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(false);
    });

    it("validates the terminal evidence bound", () => {
      expect(() => makeStack({ terminalCloseEvidenceLimit: 0 })).toThrow(RangeError);
      expect(() => makeStack({ terminalCloseEvidenceLimit: 1.5 })).toThrow(RangeError);
    });

    it("reports Error and non-Error authoritative metadata, position, and balance failures", async () => {
      for (const failure of [new Error("authority Error"), "authority string"] as const) {
        const metaFeed = new FaultFeed({ positions: [] });
        metaFeed.marketMetaFailures.push(failure);
        const metaStack = makeStack({
          feed: metaFeed,
          requireAuthoritativeEmergencyState: true,
          configuredSymbols: [makeSymbol()],
        });
        const metadataReport = await metaStack.portfolioManager.executeCloseAll();
        expect(metadataReport.unresolved.join(" ")).toContain(
          typeof failure === "string" ? failure : failure.message,
        );

        const positionFeed = new FaultFeed({
          positions: [],
          marketMeta: new Map([[makeSymbol(), makeMarketMeta(false)]]),
        });
        positionFeed.positionFailures.push(failure);
        const positionStack = makeStack({
          feed: positionFeed,
          requireAuthoritativeEmergencyState: true,
          configuredSymbols: [makeSymbol()],
        });
        positionStack.positionManager.openPosition("unavailable", makeSymbol(), "long", 0.01, 60_000, 10);
        const positionReport = await positionStack.portfolioManager.executeCloseAll();
        expect(positionReport.unresolved.join(" ")).toContain("derivative position unavailable");

        const balanceFeed = new FaultFeed({ positions: [] });
        balanceFeed.balanceFailures.push(failure);
        const balanceStack = makeStack({
          feed: balanceFeed,
          requireAuthoritativeEmergencyState: true,
          configuredSymbols: [makeSymbol()],
        });
        const balanceReport = await balanceStack.portfolioManager.executeCloseAll();
        expect(balanceReport.unresolved.join(" ")).toContain(
          typeof failure === "string" ? failure : failure.message,
        );
      }
    });

    it("reports Error and non-Error failures from authoritative flat verification", async () => {
      for (const failure of [new Error("verification Error"), "verification string"] as const) {
        const feed = new FaultFeed({ positions: [] });
        feed.positionFailureOnCall = { call: 2, failure };
        feed.balanceFailureOnCall = { call: 2, failure };
        const stack = makeStack({
          feed,
          requireAuthoritativeEmergencyState: true,
          configuredSymbols: [makeSymbol()],
        });
        const report = await stack.portfolioManager.executeCloseAll();
        expect(report.unresolved.join(" ")).toContain("authoritative position verification");
        expect(report.unresolved.join(" ")).toContain("authoritative balance verification");
      }
    });

    it("reconciles invalid, unavailable, and stale local authoritative positions", async () => {
      const symbol = makeSymbol();
      const spotMeta = new Map([[symbol, makeMarketMeta(true)]]);

      const invalidSpot = makeStack({
        feed: new FaultFeed({
          positions: [],
          balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
          marketMeta: spotMeta,
        }),
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [symbol],
      });
      invalidSpot.positionManager.openPosition("spot", symbol, "short", 0.01, 60_000, 10);
      const invalidSpotReport = await invalidSpot.portfolioManager.executeCloseAll();
      expect(invalidSpotReport.unresolved.join(" ")).toContain("invalid local spot short removed");

      const unavailableSpotFeed = new FaultFeed({ positions: [], marketMeta: spotMeta });
      unavailableSpotFeed.balanceFailures.push("balances unavailable");
      const unavailableSpot = makeStack({
        feed: unavailableSpotFeed,
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [symbol],
      });
      unavailableSpot.positionManager.openPosition("spot", symbol, "long", 0.01, 60_000, 10);
      const unavailableSpotReport = await unavailableSpot.portfolioManager.executeCloseAll();
      expect(unavailableSpotReport.unresolved.join(" ")).toContain("spot inventory unavailable");

      const derivativeMarketMeta = new Map([[symbol, makeMarketMeta(false)]]);
      const staleDerivative = makeStack({
        feed: new FaultFeed({ positions: [], marketMeta: derivativeMarketMeta }),
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [symbol],
      });
      staleDerivative.positionManager.openPosition("derivative", symbol, "long", 0.01, 60_000, 10);
      await staleDerivative.portfolioManager.executeCloseAll();
      expect(staleDerivative.positionManager.getPositionCount()).toBe(0);
    });

    it("completes an immediately filled authoritative derivative close", async () => {
      const symbol = makeSymbol();
      const feed = new AutoFlattenFeed({
        positions: [makeRemotePosition()],
        marketMeta: new Map([[symbol, makeMarketMeta(false)]]),
      });
      const stack = makeStack({
        feed,
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [symbol],
      });
      stack.positionManager.openPosition("carry", symbol, "long", 0.01, 60_000, 10);
      const report = await stack.portfolioManager.executeCloseAll();
      expect(report.unresolved).toHaveLength(0);
      expect(report.closed).toContain("carry/BTC/USDC/long");
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(true);
      expect(await stack.portfolioManager.executeCloseAll()).toEqual({
        closed: [],
        unresolved: [],
        cancelledOrders: [],
      });
    });
  });
});

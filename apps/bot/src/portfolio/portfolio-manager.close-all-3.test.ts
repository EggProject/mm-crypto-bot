import { describe, expect, it } from "vitest";

import {
  asSymbol,
  makeSymbol,
  makeMarketMeta,
  makeRemotePosition,
  requirePlacedOrder,
  SequencedFillFeed,
  FaultFeed,
  LifecycleFeed,
  ImmediateFillFeed,
  makeStack,
} from "./portfolio-manager.test-support.js";

describe("PortfolioManager", () => {
  describe("close-all on trip", () => {
    it("settles a local close through REST reconciliation and current-price fallback", async () => {
      const feed = new FaultFeed();
      const stack = makeStack({ feed });
      const position = stack.positionManager.openPosition("carry", makeSymbol(), "long", 0.01, 60_000, 10);
      expect(await stack.portfolioManager.requestPositionClose(position, "manual")).toBe(false);
      const order = requirePlacedOrder(feed.placedOrders);
      feed.setOrderStatus(order.clientOrderId, {
        status: "closed",
        filled: 0.01,
        average: undefined,
        price: undefined,
        updateTimestamp: undefined,
      });
      expect(await stack.portfolioManager.requestPositionClose(position, "manual-reconcile")).toBe(true);
      expect(stack.positionManager.getPositionCount()).toBe(0);
    });

    it("settles immediately filled local closes across public price fallbacks", async () => {
      for (const pricing of ["average", "price", "position"] as const) {
        const feed = new ImmediateFillFeed(pricing);
        const stack = makeStack({ feed });
        const side = pricing === "average" ? "short" : "long";
        const position = stack.positionManager.openPosition(pricing, makeSymbol(), side, 0.01, 60_000, 10);
        expect(await stack.portfolioManager.requestPositionClose(position, pricing)).toBe(true);
        expect(stack.positionManager.getPositionCount()).toBe(0);
      }
    });

    it("reports both closed and unresolved local results in one retryable close-all", async () => {
      const feed = new SequencedFillFeed([1, 0], {});
      const stack = makeStack({ feed });
      stack.positionManager.openPosition("closed", makeSymbol(), "long", 0.01, 60_000, 10);
      stack.positionManager.openPosition("unresolved", makeSymbol(), "short", 0.01, 60_000, 10);
      const report = await stack.portfolioManager.executeCloseAll();
      expect(report.closed).toContain("closed/BTC/USDC");
      expect(report.unresolved).toContain("unresolved/BTC/USDC/short");
    });

    it("keeps pending and new local closes retryable after Error and non-Error feed failures", async () => {
      for (const failure of [new Error("close Error"), "close string"] as const) {
        const reconcileFeed = new FaultFeed();
        const reconcileStack = makeStack({ feed: reconcileFeed });
        const pending = reconcileStack.positionManager.openPosition(
          "carry",
          makeSymbol(),
          "long",
          0.01,
          60_000,
          10,
        );
        expect(await reconcileStack.portfolioManager.requestPositionClose(pending, "first")).toBe(false);
        reconcileFeed.orderFailures.push(failure);
        expect(await reconcileStack.portfolioManager.requestPositionClose(pending, "retry")).toBe(false);

        const placeFeed = new FaultFeed();
        placeFeed.placeFailures.push(failure);
        const placeStack = makeStack({ feed: placeFeed });
        const fresh = placeStack.positionManager.openPosition(
          "carry",
          makeSymbol(),
          "long",
          0.01,
          60_000,
          10,
        );
        expect(await placeStack.portfolioManager.requestPositionClose(fresh, "first")).toBe(false);
      }
    });

    it("derives authoritative spot and derivative close keys and reports metadata failures", async () => {
      const symbol = makeSymbol();
      for (const isSpot of [true, false]) {
        const marketMeta = new Map([[symbol, makeMarketMeta(isSpot)]]);
        const stack = makeStack({
          feed: new FaultFeed({ positions: [], marketMeta }),
          requireAuthoritativeEmergencyState: true,
          configuredSymbols: [symbol],
        });
        const position = stack.positionManager.openPosition(
          isSpot ? "spot" : "derivative",
          symbol,
          "long",
          0.01,
          60_000,
          10,
        );
        expect(await stack.portfolioManager.requestPositionClose(position, "manual")).toBe(false);
      }
      for (const failure of [new Error("metadata Error"), "metadata string"] as const) {
        const feed = new FaultFeed();
        feed.marketMetaFailures.push(failure);
        const stack = makeStack({ feed, requireAuthoritativeEmergencyState: true });
        const position = stack.positionManager.openPosition("carry", symbol, "long", 0.01, 60_000, 10);
        expect(await stack.portfolioManager.requestPositionClose(position, "manual")).toBe(false);
      }
    });

    it("books public private-lifecycle executions for long, short, missing, and exhausted attribution", async () => {
      const symbol = makeSymbol();
      const feed = new LifecycleFeed();
      const stack = makeStack({ feed, terminalCloseEvidenceLimit: 1 });
      await stack.orderManager.startLifecycle();

      for (const side of ["long", "short"] as const) {
        const position = stack.positionManager.openPosition(side, symbol, side, 0.01, 60_000, 10);
        expect(await stack.portfolioManager.requestPositionClose(position, `close-${side}`)).toBe(false);
        const order = feed.placedOrders.at(-1);
        if (order === undefined) throw new Error("expected lifecycle close order");
        feed.emitLifecycle({
          kind: "execution",
          payload: {
            executionId: `execution-${side}`,
            clientOrderId: order.clientOrderId,
            exchangeOrderId: order.exchangeId,
            symbol,
            side: order.side,
            quantity: 0.01,
            price: 59_900,
            fee: 0,
            feeCurrency: "USDC",
            timestamp: Date.now(),
          },
        });
        expect(stack.positionManager.getPositions().some((item) => item.id === position.id)).toBe(false);
        feed.emitLifecycle({
          kind: "execution",
          payload: {
            executionId: `execution-${side}-duplicate-terminal`,
            clientOrderId: order.clientOrderId,
            exchangeOrderId: order.exchangeId,
            symbol,
            side: order.side,
            quantity: 0.01,
            price: 59_900,
            fee: 0,
            feeCurrency: "USDC",
            timestamp: Date.now(),
          },
        });
      }

      const missing = stack.positionManager.openPosition("missing", symbol, "long", 0.01, 60_000, 10);
      await stack.portfolioManager.requestPositionClose(missing, "missing");
      const missingOrder = feed.placedOrders.at(-1);
      if (missingOrder === undefined) throw new Error("expected missing-position close order");
      stack.positionManager.reconcileVenueAbsent(missing.id);
      feed.emitLifecycle({
        kind: "execution",
        payload: {
          executionId: "execution-missing",
          clientOrderId: missingOrder.clientOrderId,
          exchangeOrderId: missingOrder.exchangeId,
          symbol,
          side: "sell",
          quantity: 0.01,
          price: 59_900,
          fee: 0,
          feeCurrency: "USDC",
          timestamp: Date.now(),
        },
      });

      const orderPosition = stack.positionManager.openPosition(
        "order-event",
        symbol,
        "long",
        0.01,
        60_000,
        10,
      );
      await stack.portfolioManager.requestPositionClose(orderPosition, "order-event");
      const orderUpdate = feed.placedOrders.at(-1);
      if (orderUpdate === undefined) throw new Error("expected order-update close order");
      feed.emitLifecycle({
        kind: "order",
        payload: {
          ...orderUpdate,
          status: "closed",
          filled: 0.01,
          average: 59_900,
          updateTimestamp: undefined,
        },
      });
      expect(stack.positionManager.getPositions().some((item) => item.id === orderPosition.id)).toBe(false);

      const lateOrderPosition = stack.positionManager.openPosition(
        "late-order-event",
        symbol,
        "long",
        0.01,
        60_000,
        10,
      );
      await stack.portfolioManager.requestPositionClose(lateOrderPosition, "late-order-event");
      const canceledOrder = feed.placedOrders.at(-1);
      if (canceledOrder === undefined) throw new Error("expected canceled lifecycle close order");
      feed.emitLifecycle({ kind: "order", payload: { ...canceledOrder, status: "canceled", filled: 0 } });
      await stack.portfolioManager.requestPositionClose(lateOrderPosition, "late-order-event-retry");
      const replacementOrder = feed.placedOrders.at(-1);
      if (replacementOrder === undefined) throw new Error("expected replacement lifecycle close order");
      feed.emitLifecycle({
        kind: "order",
        payload: {
          ...canceledOrder,
          status: "closed",
          filled: 0.004,
          average: 59_850,
          updateTimestamp: undefined,
        },
      });
      await Promise.resolve();
      expect(
        stack.positionManager.getPositions().find((item) => item.id === lateOrderPosition.id)?.quantity,
      ).toBeCloseTo(0.006);
      expect(feed.getOrder(replacementOrder.clientOrderId)?.status).toBe("canceled");
      await stack.orderManager.stopLifecycle();
    });

    it("matches all authoritative derivative predicates and stops attribution after quantity exhaustion", async () => {
      const symbol = makeSymbol();
      const other = asSymbol("ETH/USDC");
      const feed = new LifecycleFeed({
        positions: [
          { ...makeRemotePosition(), symbol: other },
          makeRemotePosition("short"),
          makeRemotePosition("long", 0),
          makeRemotePosition("long", 0.01),
        ],
        marketMeta: new Map([
          [symbol, makeMarketMeta(false)],
          [other, { ...makeMarketMeta(false), symbol: other, base: "ETH" }],
        ]),
      });
      const stack = makeStack({
        feed,
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [symbol, other],
      });
      await stack.orderManager.startLifecycle();
      stack.positionManager.openPosition("first", symbol, "long", 0.01, 60_000, 10);
      stack.positionManager.openPosition("second", symbol, "long", 0.01, 60_000, 10);
      await stack.portfolioManager.executeCloseAll();
      const btcClose = feed.placedOrders.find((order) => order.symbol === symbol && order.side === "sell");
      if (btcClose === undefined) throw new Error("expected authoritative BTC close");
      feed.emitLifecycle({
        kind: "execution",
        payload: {
          executionId: "authoritative-exhaustion",
          clientOrderId: btcClose.clientOrderId,
          exchangeOrderId: btcClose.exchangeId,
          symbol,
          side: "sell",
          quantity: 0.01,
          price: 59_900,
          fee: 0,
          feeCurrency: "USDC",
          timestamp: Date.now(),
        },
      });
      expect(stack.positionManager.getPositionCount()).toBe(1);
      await stack.orderManager.stopLifecycle();
    });

    it("handles derivative and spot venue-close edge outcomes without changing policy", async () => {
      const symbol = makeSymbol();
      const noPrice = new FaultFeed({
        positions: [{ ...makeRemotePosition(), entryPrice: undefined, markPrice: undefined }],
        marketMeta: new Map([[symbol, makeMarketMeta(false)]]),
      });
      const noPriceStack = makeStack({
        feed: noPrice,
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [symbol],
      });
      const noPriceReport = await noPriceStack.portfolioManager.executeCloseAll();
      expect(noPriceReport.unresolved).toContain("venue/BTC/USDC/long");

      const shortFeed = new FaultFeed({
        positions: [makeRemotePosition("short")],
        marketMeta: new Map([[symbol, makeMarketMeta(false)]]),
      });
      const shortStack = makeStack({
        feed: shortFeed,
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [symbol],
      });
      await shortStack.portfolioManager.executeCloseAll();
      expect(requirePlacedOrder(shortFeed.placedOrders).side).toBe("buy");

      for (const failure of [new Error("venue Error"), "venue string"] as const) {
        const derivativeFeed = new FaultFeed({
          positions: [makeRemotePosition()],
          marketMeta: new Map([[symbol, makeMarketMeta(false)]]),
        });
        derivativeFeed.placeFailures.push(failure);
        const derivative = makeStack({
          feed: derivativeFeed,
          requireAuthoritativeEmergencyState: true,
          configuredSymbols: [symbol],
        });
        const derivativeReport = await derivative.portfolioManager.executeCloseAll();
        expect(derivativeReport.unresolved).toContain("venue/BTC/USDC/long");

        const spotFeed = new FaultFeed({
          positions: [],
          balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
          marketMeta: new Map([[symbol, makeMarketMeta(true)]]),
        });
        spotFeed.placeFailures.push(failure);
        const spot = makeStack({
          feed: spotFeed,
          requireAuthoritativeEmergencyState: true,
          configuredSymbols: [symbol],
        });
        const spotReport = await spot.portfolioManager.executeCloseAll();
        expect(spotReport.unresolved).toContain("venue/BTC/USDC/spot");
      }

      const fallbackTickerFeed = new FaultFeed({
        positions: [],
        balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
        marketMeta: new Map([[symbol, makeMarketMeta(true)]]),
      });
      fallbackTickerFeed.setTicker(symbol, {
        symbol,
        timestamp: 1,
        bid: 0,
        ask: 60_001,
        last: 60_000,
        baseVolume: 0,
        quoteVolume: 0,
      });
      const fallbackTicker = makeStack({
        feed: fallbackTickerFeed,
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [symbol],
      });
      await fallbackTicker.portfolioManager.executeCloseAll();
      expect(fallbackTickerFeed.placedOrders).toHaveLength(1);

      const tooSmallFeed = new FaultFeed({
        positions: [],
        balances: [{ currency: "BTC", free: 0.0001, total: 0.0001 }],
        marketMeta: new Map([[symbol, makeMarketMeta(true, 1_000_000)]]),
      });
      const tooSmall = makeStack({
        feed: tooSmallFeed,
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [symbol],
      });
      await tooSmall.portfolioManager.executeCloseAll();
      expect(tooSmallFeed.placedOrders).toHaveLength(0);
    });

    it("handles terminal and unavailable pending authoritative closes", async () => {
      const symbol = makeSymbol();
      const meta = new Map([[symbol, makeMarketMeta(false)]]);
      for (const mode of ["terminal", "unavailable"] as const) {
        const feed = new FaultFeed({
          positions: [makeRemotePosition()],
          marketMeta: meta,
        });
        const stack = makeStack({
          feed,
          requireAuthoritativeEmergencyState: true,
          configuredSymbols: [symbol],
        });
        await stack.portfolioManager.executeCloseAll();
        const order = requirePlacedOrder(feed.placedOrders);
        if (mode === "terminal") feed.setOrderStatus(order.clientOrderId, { status: "canceled" });
        else feed.orderFailures.push("pending unavailable");
        await expect(stack.portfolioManager.executeCloseAll()).resolves.toBeDefined();
      }
    });
  });
});

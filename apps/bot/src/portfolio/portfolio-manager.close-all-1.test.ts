import { describe, expect, it } from "bun:test";

import {
  makeSymbol,
  requirePlacedOrder,
  requireDefined,
  readOrderBook,
  findOrder,
  SequencedFillFeed,
  FailOnceCancelFeed,
  makeStack,
  MockExchangeFeed,
  type Execution,
  type FeedEvent,
  type MarketMeta,
  type Logger,
} from "./portfolio-manager.test-support.js";

describe("PortfolioManager", () => {
  describe("close-all on trip", () => {
    it("journals one delayed close through partial and final private executions without ticker retries", async () => {
      const stack = makeStack();
      const symbol = makeSymbol();
      stack.positionManager.openPosition("carry", symbol, "long", 0.01, 60_000, 10);
      const first = await stack.portfolioManager.executeCloseAll();
      expect(first.unresolved).toContain("carry/BTC/USDC/long");
      const close = findOrder(
        readOrderBook(stack.feed),
        (order) => order.clientOrderId.startsWith("pf-stop-"),
        "expected portfolio stop order",
      );
      const dispatch = (execution: Execution): void => {
        (
          stack.orderManager as unknown as { handleLifecycleFeedEvent(event: FeedEvent): void }
        ).handleLifecycleFeedEvent({ kind: "execution", payload: execution });
      };
      const makeExecution = (id: string, quantity: number): Execution => ({
        executionId: id,
        clientOrderId: close.clientOrderId,
        exchangeOrderId: close.exchangeId,
        symbol,
        side: "sell",
        quantity,
        price: 59_900,
        fee: 0.01,
        feeCurrency: "USDC",
        timestamp: Date.now(),
      });
      dispatch(makeExecution("close-partial", 0.004));
      dispatch(makeExecution("close-partial", 0.004)); // duplicate is ignored
      expect(stack.positionManager.getPositions()[0]?.quantity).toBeCloseTo(0.006);
      dispatch(makeExecution("close-final", 0.006));
      expect(stack.positionManager.getPositionCount()).toBe(0);
      const settled = await stack.portfolioManager.executeCloseAll();
      expect(settled.unresolved).toHaveLength(0);
      expect(
        readOrderBook(stack.feed).filter((order) => order.clientOrderId.startsWith("pf-stop-")),
      ).toHaveLength(1);
    });

    it("deduplicates repeated close intents and retries only the remainder after terminal cancel", async () => {
      const stack = makeStack();
      const symbol = makeSymbol();
      const position = stack.positionManager.openPosition("carry", symbol, "long", 0.01, 60_000, 10);
      expect(await stack.portfolioManager.requestPositionClose(position, "trailing-stop")).toBe(false);
      expect(await stack.portfolioManager.requestPositionClose(position, "trailing-stop")).toBe(false);
      let closes = readOrderBook(stack.feed).filter((order) => order.clientOrderId.startsWith("pf-stop-"));
      expect(closes).toHaveLength(1);
      const firstClose = requirePlacedOrder(closes);
      stack.feed.setOrderStatus(firstClose.clientOrderId, { status: "canceled", filled: 0 });
      expect(await stack.portfolioManager.requestPositionClose(position, "trailing-stop-retry")).toBe(false);
      closes = readOrderBook(stack.feed).filter((order) => order.clientOrderId.startsWith("pf-stop-"));
      expect(closes).toHaveLength(2);
      expect(closes[1]?.amount).toBe(0.01);

      // A late execution for the terminal-canceled first order is still
      // attributed, and the replacement is canceled before retrying only the remainder.
      (
        stack.orderManager as unknown as { handleLifecycleFeedEvent(event: FeedEvent): void }
      ).handleLifecycleFeedEvent({
        kind: "execution",
        payload: {
          executionId: "late-after-cancel",
          clientOrderId: firstClose.clientOrderId,
          exchangeOrderId: firstClose.exchangeId,
          symbol,
          side: "sell",
          quantity: 0.004,
          price: 59_900,
          fee: 0.01,
          feeCurrency: "USDC",
          timestamp: Date.now(),
        },
      });
      await Promise.resolve();
      expect(stack.positionManager.getPositions()[0]?.quantity).toBeCloseTo(0.006);
      const replacementClose = requireDefined(closes.at(1), "expected replacement close order");
      expect(stack.feed.getOrder(replacementClose.clientOrderId)?.status).toBe("canceled");
      const remainingPosition = requireDefined(
        stack.positionManager.getPositions().at(0),
        "expected remaining position",
      );
      expect(await stack.portfolioManager.requestPositionClose(remainingPosition, "late-fill-retry")).toBe(
        false,
      );
      closes = readOrderBook(stack.feed).filter((order) => order.clientOrderId.startsWith("pf-stop-"));
      expect(closes).toHaveLength(3);
      expect(closes[2]?.amount).toBeCloseTo(0.006);
    });

    it("records a late terminal fill and reports when its replacement cancel fails", async () => {
      const errors: { readonly msg: string; readonly meta?: Readonly<Record<string, unknown>> }[] = [];
      const logger: Logger = {
        critical: (): void => void 0,
        debug: (): void => void 0,
        info: (): void => void 0,
        warn: (): void => void 0,
        error: (event, fields) => {
          errors.push({ msg: event, ...(fields !== undefined && { meta: fields }) });
        },
      };
      const feed = new FailOnceCancelFeed();
      const stack = makeStack({ feed, logger });
      await feed.open();
      const symbol = makeSymbol();
      const position = stack.positionManager.openPosition("carry", symbol, "long", 0.01, 60_000, 10);

      await stack.portfolioManager.requestPositionClose(position, "trailing-stop");
      let closes = readOrderBook(feed).filter((order) => order.clientOrderId.startsWith("pf-stop-"));
      const firstClose = requirePlacedOrder(closes);
      feed.setOrderStatus(firstClose.clientOrderId, { status: "canceled", filled: 0 });
      await stack.portfolioManager.requestPositionClose(position, "trailing-stop-retry");
      closes = readOrderBook(feed).filter((order) => order.clientOrderId.startsWith("pf-stop-"));
      const replacement = requireDefined(closes.at(1), "expected replacement close order");

      (
        stack.orderManager as unknown as { handleLifecycleFeedEvent(event: FeedEvent): void }
      ).handleLifecycleFeedEvent({
        kind: "execution",
        payload: {
          executionId: "late-cancel-failure",
          clientOrderId: firstClose.clientOrderId,
          exchangeOrderId: firstClose.exchangeId,
          symbol,
          side: "sell",
          quantity: 0.004,
          price: 59_900,
          fee: 0.01,
          feeCurrency: "USDC",
          timestamp: Date.now(),
        },
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(stack.positionManager.getPositions()[0]?.quantity).toBeCloseTo(0.006);
      expect(feed.getOrder(replacement.clientOrderId)?.status).toBe("open");
      expect(errors).toEqual([
        {
          msg: "portfolio.close.replacement.cancel.failed",
          meta: {
            key: `local:${position.id}`,
            clientOrderId: replacement.clientOrderId,
            error: `[order-manager] cancelOrder failed for ${replacement.clientOrderId} on ${symbol}: Error: injected cancel failure`,
          },
        },
      ]);
    });

    it("quarantines a stale local position absent from the authoritative venue without placing a close", async () => {
      const stack = makeStack({ requireAuthoritativeEmergencyState: true });
      stack.positionManager.openPosition("carry", makeSymbol(), "long", 0.01, 60_000, 10);
      const report = await stack.portfolioManager.executeCloseAll();
      expect(report.closed).toHaveLength(0);
      expect(report.unresolved).toHaveLength(0);
      expect(stack.positionManager.getPositionCount()).toBe(0);
      expect(stack.orderManager.getInFlightCount()).toBe(0);
    });

    it("submits a balance-derived sell for venue-only spot inventory", async () => {
      const stack = makeStack({
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: ["BTC/USDC"],
        balances: [
          { currency: "USDC", free: 1_000_000, total: 1_000_000 },
          { currency: "BTC", free: 0.02, total: 0.02 },
        ],
      });
      const report = await stack.portfolioManager.executeCloseAll();
      const order = readOrderBook(stack.feed).find((candidate) =>
        candidate.clientOrderId.startsWith("venue-spot-emergency"),
      );
      expect(order?.side).toBe("sell");
      expect(order?.amount).toBe(0.02);
      expect(report.unresolved).toContain("venue/BTC/USDC/spot");
    });

    it("uses the venue derivative side and size for exposure missing locally", async () => {
      const symbol = makeSymbol();
      const stack = makeStack({
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [symbol],
        positions: [
          {
            symbol,
            side: "long",
            quantity: 0.03,
            entryPrice: 60_000,
            markPrice: 59_900,
            unrealizedPnl: -3,
            updateTimestamp: Date.now(),
          },
        ],
        marketMeta: new Map([
          [
            symbol,
            {
              symbol,
              base: "BTC",
              quote: "USDC",
              amountPrecision: 4,
              pricePrecision: 2,
              minAmount: 0.0001,
              minCost: 1,
              isSpot: false,
            },
          ],
        ]),
      });
      await stack.portfolioManager.executeCloseAll();
      const order = readOrderBook(stack.feed).find((candidate) =>
        candidate.clientOrderId.startsWith("venue-emergency"),
      );
      expect(order?.side).toBe("sell");
      expect(order?.amount).toBe(0.03);
    });

    it("journals venue-only spot and derivative closes across repeated emergency heartbeats", async () => {
      const symbol = makeSymbol();
      for (const kind of ["spot", "derivative"] as const) {
        const meta: MarketMeta = {
          symbol,
          base: "BTC",
          quote: "USDC",
          amountPrecision: 4,
          pricePrecision: 2,
          minAmount: 0.0001,
          minCost: 1,
          isSpot: kind === "spot",
        };
        const feed = new MockExchangeFeed({
          balances:
            kind === "spot"
              ? [
                  { currency: "USDC", free: 1_000_000, total: 1_000_000 },
                  { currency: "BTC", free: 0.02, total: 0.02 },
                ]
              : [{ currency: "USDC", free: 1_000_000, total: 1_000_000 }],
          positions:
            kind === "derivative"
              ? [
                  {
                    symbol,
                    side: "long",
                    quantity: 0.02,
                    entryPrice: 60_000,
                    markPrice: 59_900,
                    unrealizedPnl: -2,
                    updateTimestamp: Date.now(),
                  },
                ]
              : [],
          marketMeta: new Map([[symbol, meta]]),
        });
        const stack = makeStack({
          requireAuthoritativeEmergencyState: true,
          configuredSymbols: [symbol],
          feed,
        });
        const first = await stack.portfolioManager.executeCloseAll();
        expect(first.unresolved).toContain("authoritative venue exposure remains open");
        expect(first.unresolved).toContain(kind === "spot" ? "venue/BTC/USDC/spot" : "venue/BTC/USDC/long");
        await stack.portfolioManager.executeCloseAll();
        let closes = readOrderBook(feed).filter((order) => order.side === "sell");
        expect(closes).toHaveLength(1);
        const close = requirePlacedOrder(closes);
        const dispatch = (id: string, quantity: number): void => {
          (
            stack.orderManager as unknown as { handleLifecycleFeedEvent(event: FeedEvent): void }
          ).handleLifecycleFeedEvent({
            kind: "execution",
            payload: {
              executionId: `${kind}-${id}`,
              clientOrderId: close.clientOrderId,
              exchangeOrderId: close.exchangeId,
              symbol,
              side: "sell",
              quantity,
              price: 59_900,
              fee: 0.01,
              feeCurrency: "USDC",
              timestamp: Date.now(),
            },
          });
        };
        dispatch("partial", 0.01);
        if (kind === "spot") feed.setBalance("BTC", 0.01, 0.01);
        else
          feed.setPositions([
            {
              symbol,
              side: "long",
              quantity: 0.01,
              entryPrice: 60_000,
              markPrice: 59_900,
              unrealizedPnl: -1,
              updateTimestamp: Date.now(),
            },
          ]);
        await stack.portfolioManager.executeCloseAll();
        closes = readOrderBook(feed).filter((order) => order.side === "sell");
        expect(closes).toHaveLength(1);
        dispatch("final", 0.01);
        if (kind === "spot") feed.setBalance("BTC", 0, 0);
        else feed.setPositions([]);
        const settled = await stack.portfolioManager.executeCloseAll();
        expect(settled.unresolved).toHaveLength(0);
        expect(readOrderBook(feed).filter((order) => order.side === "sell")).toHaveLength(1);
      }
    });

    it("keeps a partial spot close retryable without treating the remainder as venue-only inventory", async () => {
      const symbol = makeSymbol();
      const feed = new SequencedFillFeed([0.5, 1], {
        balances: [
          { currency: "USDC", free: 1_000_000, total: 1_000_000 },
          { currency: "BTC", free: 0.02, total: 0.02 },
        ],
      });
      const stack = makeStack({
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [symbol],
        feed,
      });
      stack.positionManager.openPosition("carry", symbol, "long", 0.02, 60_000, 10);

      const first = await stack.portfolioManager.executeCloseAll();
      const firstCloses = readOrderBook(feed).filter((order) => order.clientOrderId.startsWith("pf-stop-"));
      expect(first.unresolved).toContain("carry/BTC/USDC/long");
      expect(firstCloses).toHaveLength(1);
      expect(firstCloses[0]?.amount).toBe(0.02);
      expect(stack.positionManager.getPositions()[0]?.quantity).toBe(0.01);

      feed.setBalance("BTC", 0.01, 0.01);
      const second = await stack.portfolioManager.executeCloseAll();
      expect(second.unresolved).toContain("authoritative venue exposure remains open");
      expect(stack.positionManager.getPositionCount()).toBe(0);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(false);

      feed.setBalance("BTC", 0, 0);
      const settled = await stack.portfolioManager.executeCloseAll();
      expect(settled.unresolved).toHaveLength(0);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(true);
    });

    it("does not latch close-all after a cancellation failure and retries it", async () => {
      const feed = new FailOnceCancelFeed();
      const stack = makeStack({ feed });
      await feed.open();
      await stack.orderManager.placeOrder({
        signal: { side: "buy", confidence: 1, reason: "pending-entry", stopLoss: 0, takeProfit: 0 },
        symbol: makeSymbol(),
        amount: 0.01,
        referencePrice: 60_000,
        type: "market",
      });

      const first = await stack.portfolioManager.executeCloseAll();
      expect(first.unresolved[0]).toContain("cancel");
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(false);

      const second = await stack.portfolioManager.executeCloseAll();
      expect(second.unresolved).toHaveLength(0);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(true);
    });
    it("places MARKET orders to close all open positions when tripped", async () => {
      const stack = makeStack({ maxDdPct: 0.1 });
      const sym = makeSymbol();
      // Open 2 positions: 1 long (carry), 1 short (ohlc)
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      stack.positionManager.openPosition("ohlc", sym, "short", 0.01, 60_000, 10);
      expect(stack.positionManager.getPositionCount()).toBe(2);
      // Peak equity: 100k
      stack.portfolioManager.recordEquity(100_000);
      // Drop equity to trip
      await stack.portfolioManager.recordEquityAndSettle(85_000); // DD = 15%
      // The trip should have fired and placed close orders on the mock feed
      const placedOrders = readOrderBook(stack.feed);
      // Filter: only the closing orders (the placeOrder inside executeCloseAll)
      const closeOrders = placedOrders.filter((o) => o.clientOrderId.startsWith("pf-stop-"));
      expect(closeOrders.length).toBe(2);
      // Both should be MARKET orders
      for (const o of closeOrders) {
        expect(o.type).toBe("market");
      }
      // The closing sides should be opposite of the original positions
      const sides = new Set(closeOrders.map((o) => o.side));
      expect(sides.has("buy")).toBe(true); // closes the short
      expect(sides.has("sell")).toBe(true); // closes the long
    });
  });
});

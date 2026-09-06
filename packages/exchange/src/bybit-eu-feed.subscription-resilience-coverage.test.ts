import { describe, expect, it } from "vitest";

import {
  asSymbol,
  type RawOhlcvPayload,
  type RawOrderPayload,
  type RawOrderBookPayload,
  type RawTickerPayload,
  type RawTradePayload,
} from "./index.js";
import { BybitEuOriginAdmissionError } from "./bybit-eu-client.js";
import { ExchangeFeedError, type FeedListener } from "./feed.js";
import { BybitEuFeed } from "./bybit-eu-feed.js";
import { makeFakeExchange, type BybitEuClient } from "./bybit-eu-feed.test-support.js";

class NotSupportedError extends Error {
  override name = "NotSupported";
}

function notSupported(): Promise<never> {
  return Promise.reject(new NotSupportedError("not supported"));
}

describe("BybitEuFeed subscription resilience", () => {
  it("retries each transient REST fallback and emits the next successful poll", async () => {
    const oldCandle = Date.now() - 2 * 60 * 60 * 1000;
    const cases: readonly {
      readonly name: string;
      readonly overrides: Partial<BybitEuClient>;
      readonly subscribe: (feed: BybitEuFeed, listener: FeedListener) => Promise<number>;
    }[] = [
      {
        name: "ticker",
        overrides: {
          watchTicker: notSupported,
          fetchTicker: onceThen({ timestamp: 1, bid: 1, ask: 2, last: 1.5 }),
        },
        subscribe: (feed, listener) => feed.subscribeTicker(asSymbol("BTC/USDC"), listener),
      },
      {
        name: "order book",
        overrides: {
          watchOrderBook: notSupported,
          fetchOrderBook: onceThen({ timestamp: 1, nonce: 1, bids: [[1, 1]], asks: [[2, 1]] }),
        },
        subscribe: (feed, listener) => feed.subscribeOrderBook(asSymbol("BTC/USDC"), 10, listener),
      },
      {
        name: "trades",
        overrides: {
          watchTrades: notSupported,
          fetchTrades: onceThen([{ id: "recovered", timestamp: 1, price: 1, amount: 1, side: "buy" }]),
        },
        subscribe: (feed, listener) => feed.subscribeTrades(asSymbol("BTC/USDC"), listener),
      },
      {
        name: "OHLCV",
        overrides: {
          watchOHLCV: notSupported,
          fetchOHLCV: onceThen([[oldCandle, 1, 2, 1, 2, 1]]),
        },
        subscribe: (feed, listener) => feed.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", listener),
      },
    ];
    for (const item of cases) {
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        exchange: makeFakeExchange(item.overrides),
      });
      await feed.open();
      const { promise: received, resolve } = Promise.withResolvers<undefined>();
      const id = await item.subscribe(feed, () => {
        resolve(undefined);
      });
      const runner = feed.waitForSubscription(id);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      await received;
      await feed.unsubscribe(id);
      await runner;
      await feed.close();
    }
  });

  it("propagates an origin-admission failure from the order-book fallback", async () => {
    const originFailure = new BybitEuOriginAdmissionError(new Error("origin changed"));
    const feed = new BybitEuFeed({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 10,
      exchange: makeFakeExchange({
        watchOrderBook: notSupported,
        fetchOrderBook: () => Promise.reject(originFailure),
      }),
    });
    await feed.open();
    const id = await feed.subscribeOrderBook(asSymbol("BTC/USDC"), 10, () => {
      throw new Error("Origin failure must not emit an event");
    });
    await expect(feed.waitForSubscription(id)).rejects.toBe(originFailure);
    await feed.close();
  });

  it("propagates origin-admission failures from ticker, trade, and OHLCV fallbacks", async () => {
    const cases: readonly {
      readonly overrides: Partial<BybitEuClient>;
      readonly subscribe: (feed: BybitEuFeed) => Promise<number>;
    }[] = [
      {
        overrides: { watchTicker: notSupported, fetchTicker: originFailure },
        subscribe: (feed) => feed.subscribeTicker(asSymbol("BTC/USDC"), noEventListener),
      },
      {
        overrides: { watchTrades: notSupported, fetchTrades: originFailure },
        subscribe: (feed) => feed.subscribeTrades(asSymbol("BTC/USDC"), noEventListener),
      },
      {
        overrides: { watchOHLCV: notSupported, fetchOHLCV: originFailure },
        subscribe: (feed) => feed.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", noEventListener),
      },
    ];
    for (const item of cases) {
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        exchange: makeFakeExchange(item.overrides),
      });
      await feed.open();
      const id = await item.subscribe(feed);
      await expect(feed.waitForSubscription(id)).rejects.toBeInstanceOf(BybitEuOriginAdmissionError);
      await feed.close();
    }
  });

  it("wraps public and private watcher failures as feed errors", async () => {
    const cases: readonly {
      readonly overrides: Partial<BybitEuClient>;
      readonly subscribe: (feed: BybitEuFeed) => Promise<number>;
    }[] = [
      {
        overrides: { watchTicker: failedWatch },
        subscribe: (feed) => feed.subscribeTicker(asSymbol("BTC/USDC"), noEventListener),
      },
      {
        overrides: { watchOrderBook: failedWatch },
        subscribe: (feed) => feed.subscribeOrderBook(asSymbol("BTC/USDC"), 10, noEventListener),
      },
      {
        overrides: { watchTrades: failedWatch },
        subscribe: (feed) => feed.subscribeTrades(asSymbol("BTC/USDC"), noEventListener),
      },
      {
        overrides: { watchOHLCV: failedWatch },
        subscribe: (feed) => feed.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", noEventListener),
      },
      {
        overrides: { watchOrders: failedWatch },
        subscribe: (feed) => feed.subscribeOrderUpdates(noEventListener),
      },
      {
        overrides: { watchMyTrades: failedWatch },
        subscribe: (feed) => feed.subscribeExecutions(noEventListener),
      },
    ];
    for (const item of cases) {
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        exchange: makeFakeExchange(item.overrides),
      });
      await feed.open();
      const id = await item.subscribe(feed);
      await expect(feed.waitForSubscription(id)).rejects.toBeInstanceOf(ExchangeFeedError);
      await feed.close();
    }
  });

  it("contains private watcher rejections after unsubscribe", async () => {
    const order = Promise.withResolvers<readonly RawOrderPayload[]>();
    const execution = Promise.withResolvers<readonly RawTradePayload[]>();
    const feed = new BybitEuFeed({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 10,
      exchange: makeFakeExchange({
        watchOrders: () => order.promise,
        watchMyTrades: () => execution.promise,
      }),
    });
    await feed.open();
    const orderId = await feed.subscribeOrderUpdates(noEventListener);
    const executionId = await feed.subscribeExecutions(noEventListener);
    const orderRunner = feed.waitForSubscription(orderId);
    const executionRunner = feed.waitForSubscription(executionId);
    await feed.unsubscribe(orderId);
    await feed.unsubscribe(executionId);
    order.reject(new Error("closed order stream"));
    execution.reject(new Error("closed execution stream"));
    await expect(orderRunner).resolves.toBeUndefined();
    await expect(executionRunner).resolves.toBeUndefined();
    await feed.close();
  });

  it("keeps a non-origin private unwatch failure as best-effort cleanup", async () => {
    const feed = new BybitEuFeed({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 10,
      exchange: makeFakeExchange({
        has: { unWatchOrders: true },
        unWatchOrders: () => Promise.reject(new Error("unwatch transient failure")),
      }),
    });
    await feed.open();
    const id = await feed.subscribeOrderUpdates(noEventListener);
    await expect(feed.unsubscribe(id)).resolves.toBeUndefined();
    await feed.close();
  });

  it("contains rejected public watches after unsubscribe", async () => {
    const ticker = rejectedAfterAbort<RawTickerPayload>();
    const orderBook = rejectedAfterAbort<RawOrderBookPayload>();
    const trades = rejectedAfterAbort<readonly RawTradePayload[]>();
    const ohlcv = rejectedAfterAbort<readonly RawOhlcvPayload[]>();
    const cases: readonly {
      readonly overrides: Partial<BybitEuClient>;
      readonly reject: () => void;
      readonly subscribe: (feed: BybitEuFeed) => Promise<number>;
    }[] = [
      {
        overrides: { watchTicker: ticker.promise },
        reject: ticker.reject,
        subscribe: (feed) => feed.subscribeTicker(asSymbol("BTC/USDC"), noEventListener),
      },
      {
        overrides: { watchOrderBook: orderBook.promise },
        reject: orderBook.reject,
        subscribe: (feed) => feed.subscribeOrderBook(asSymbol("BTC/USDC"), 10, noEventListener),
      },
      {
        overrides: { watchTrades: trades.promise },
        reject: trades.reject,
        subscribe: (feed) => feed.subscribeTrades(asSymbol("BTC/USDC"), noEventListener),
      },
      {
        overrides: { watchOHLCV: ohlcv.promise },
        reject: ohlcv.reject,
        subscribe: (feed) => feed.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", noEventListener),
      },
    ];
    for (const item of cases) {
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        exchange: makeFakeExchange(item.overrides),
      });
      await feed.open();
      const id = await item.subscribe(feed);
      const runner = feed.waitForSubscription(id);
      await feed.unsubscribe(id);
      item.reject();
      await expect(runner).resolves.toBeUndefined();
      await feed.close();
    }
  });

  it("contains rejected REST fallbacks after unsubscribe", async () => {
    const ticker = rejectedAfterAbort<RawTickerPayload>();
    const orderBook = rejectedAfterAbort<RawOrderBookPayload>();
    const trades = rejectedAfterAbort<readonly RawTradePayload[]>();
    const ohlcv = rejectedAfterAbort<readonly RawOhlcvPayload[]>();
    const cases: readonly {
      readonly overrides: Partial<BybitEuClient>;
      readonly deferred: ReturnType<typeof rejectedAfterAbort>;
      readonly subscribe: (feed: BybitEuFeed) => Promise<number>;
    }[] = [
      {
        overrides: { watchTicker: notSupported, fetchTicker: ticker.promise },
        deferred: ticker,
        subscribe: (feed) => feed.subscribeTicker(asSymbol("BTC/USDC"), noEventListener),
      },
      {
        overrides: { watchOrderBook: notSupported, fetchOrderBook: orderBook.promise },
        deferred: orderBook,
        subscribe: (feed) => feed.subscribeOrderBook(asSymbol("BTC/USDC"), 10, noEventListener),
      },
      {
        overrides: { watchTrades: notSupported, fetchTrades: trades.promise },
        deferred: trades,
        subscribe: (feed) => feed.subscribeTrades(asSymbol("BTC/USDC"), noEventListener),
      },
      {
        overrides: { watchOHLCV: notSupported, fetchOHLCV: ohlcv.promise },
        deferred: ohlcv,
        subscribe: (feed) => feed.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", noEventListener),
      },
    ];
    for (const item of cases) {
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        exchange: makeFakeExchange(item.overrides),
      });
      await feed.open();
      const id = await item.subscribe(feed);
      const runner = feed.waitForSubscription(id);
      await item.deferred.started;
      await feed.unsubscribe(id);
      item.deferred.reject();
      await expect(runner).resolves.toBeUndefined();
      await feed.close();
    }
  });

  it("allows a fallback listener to unsubscribe itself", async () => {
    const ticker = Promise.withResolvers<RawTickerPayload>();
    const feed = new BybitEuFeed({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 10,
      exchange: makeFakeExchange({ watchTicker: notSupported, fetchTicker: () => ticker.promise }),
    });
    await feed.open();
    const subscription = { id: 0 };
    const id = await feed.subscribeTicker(asSymbol("BTC/USDC"), () => {
      void feed.unsubscribe(subscription.id);
    });
    subscription.id = id;
    ticker.resolve({ timestamp: 1, bid: 1, ask: 2, last: 1.5 });
    await expect(feed.waitForSubscription(id)).resolves.toBeUndefined();
    await feed.close();
  });

  it("filters incomplete private orders and executions before notifying a self-unsubscribing listener", async () => {
    const orders = Promise.withResolvers<readonly RawOrderPayload[]>();
    const executions = Promise.withResolvers<readonly RawTradePayload[]>();
    const feed = new BybitEuFeed({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 10,
      exchange: makeFakeExchange({
        watchOrders: () => orders.promise,
        watchMyTrades: () => executions.promise,
      }),
    });
    await feed.open();
    const orderSubscription = { id: 0 };
    const executionSubscription = { id: 0 };
    const received: string[] = [];
    const orderId = await feed.subscribeOrderUpdates((event) => {
      received.push(event.kind);
      void feed.unsubscribe(orderSubscription.id);
    });
    orderSubscription.id = orderId;
    const executionId = await feed.subscribeExecutions((event) => {
      received.push(event.kind);
      void feed.unsubscribe(executionSubscription.id);
    });
    executionSubscription.id = executionId;
    const orderRunner = feed.waitForSubscription(orderId);
    const executionRunner = feed.waitForSubscription(executionId);
    orders.resolve([
      { clientOrderId: "client-id" },
      { clientOrderId: "client-id", id: "venue-id", symbol: "BTC/USDC" },
    ]);
    executions.resolve([
      { amount: 1, id: "incomplete", price: 1, symbol: "BTC/USDC" },
      { amount: 1, id: "execution", price: 1, side: "buy", symbol: "BTC/USDC" },
    ]);
    await expect(orderRunner).resolves.toBeUndefined();
    await expect(executionRunner).resolves.toBeUndefined();
    expect(received).toEqual(["order", "execution"]);
    await feed.close();
  });
});

function onceThen<T>(value: T): () => Promise<T> {
  let calls = 0;
  return () => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error("temporary REST failure")) : Promise.resolve(value);
  };
}

function originFailure(): Promise<never> {
  return Promise.reject(new BybitEuOriginAdmissionError(new Error("origin changed")));
}

function failedWatch(): Promise<never> {
  return Promise.reject(new Error("websocket disconnected"));
}

function noEventListener(): void {
  // A failure-path test must prove that the stream never emits a valid event.
}

function rejectedAfterAbort<T>(): {
  readonly promise: () => Promise<T>;
  readonly reject: () => void;
  readonly started: Promise<undefined>;
} {
  const deferred = Promise.withResolvers<T>();
  const started = Promise.withResolvers<undefined>();
  return {
    promise: () => {
      started.resolve(undefined);
      return deferred.promise;
    },
    reject: () => {
      deferred.reject(new NotSupportedError("watch ended after unsubscribe"));
    },
    started: started.promise,
  };
}

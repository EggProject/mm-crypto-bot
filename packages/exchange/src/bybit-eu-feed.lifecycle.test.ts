import { describe, expect, it } from "bun:test";

import { asSymbol } from "./index.js";
import { CcxtBybitEuClientAdapter, type BybitEuClient } from "./bybit-eu-client.js";
import { BybitEuFeed } from "./bybit-eu-feed.js";
import {
  makeFakeExchange,
  officialBybitEuUrlMap,
  withCapturedBybitEuConstructor,
} from "./bybit-eu-feed.test-support.js";
import { ExchangeFeedError } from "./feed.js";

function replaceOriginMapValue(urls: Record<string, unknown>, path: readonly string[], value: unknown): void {
  const finalKey = path.at(-1);
  if (finalKey === undefined) throw new Error("An origin-map path requires a final key");
  let current: unknown = urls;
  const parentPath = path.slice(0, -1);
  for (const key of parentPath) {
    if (!isRecord(current)) throw new Error("The fixture origin map is malformed");
    current = Reflect.get(current, key);
  }
  if (!isRecord(current)) throw new Error("The fixture origin map is malformed");
  Reflect.set(current, finalKey, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type BybitEuClientExcludesSandboxActivation = "setSandboxMode" extends keyof BybitEuClient ? false : true;
type BybitEuFeedExcludesRawClient = "raw" extends keyof BybitEuFeed ? false : true;

const hasNoSandboxActivation: BybitEuClientExcludesSandboxActivation = true;
const hasNoRawClient: BybitEuFeedExcludesRawClient = true;

class NotSupportedError extends Error {
  override name = "NotSupported";
}

describe("bybitEuFeed", () => {
  describe("konstruktor", () => {
    it("exchangeId='bybiteu'", () => {
      const fake = makeFakeExchange();
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: fake,
      });
      expect(feed.exchangeId).toBe("bybiteu");
    });

    it("rejects sandbox before it can invoke an injected client", () => {
      const fake = makeFakeExchange({
        loadMarkets: () => {
          throw new Error("Sandbox rejection must precede client I/O");
        },
      });
      const options = {
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: fake,
      };
      Reflect.defineProperty(options, "sandbox", { enumerable: true, value: true });

      expect(() => new BybitEuFeed(options)).toThrow(/does not permit sandbox overrides/);
    });

    it("does not expose sandbox control through the client adapter or feed surface", () => {
      const nativeClient = {
        setSandboxMode: () => {
          throw new Error("The client adapter must not call sandbox control");
        },
      };
      const adapter = new CcxtBybitEuClientAdapter(nativeClient);
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: makeFakeExchange(),
      });

      expect(Reflect.has(adapter, "setSandboxMode")).toBe(false);
      expect(Reflect.has(feed, "raw")).toBe(false);
      expect(Reflect.has(feed, "client")).toBe(false);
      expect(Reflect.has(feed, "services")).toBe(false);
      expect(hasDescriptorGraphReach(adapter, nativeClient)).toBe(false);
      expect(hasDescriptorGraphReach(feed, nativeClient)).toBe(false);
      expect(hasNoSandboxActivation).toBe(true);
      expect(hasNoRawClient).toBe(true);
    });

    it("hides the constructed CCXT Pro client and rejects its sandbox-origin drift before I/O", async () => {
      await withCapturedBybitEuConstructor(async (capture) => {
        const feed = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100 });
        const nativeClient = capture.client();
        if (!isRecord(nativeClient)) throw new Error("The CCXT Pro constructor did not expose a client");
        const activateSandbox = Reflect.get(nativeClient, "setSandboxMode");
        if (typeof activateSandbox !== "function") throw new Error("CCXT sandbox control is unavailable");

        let loadMarketsCalls = 0;
        Reflect.set(nativeClient, "loadMarkets", () => {
          loadMarketsCalls += 1;
          return Promise.resolve({});
        });

        expect(hasDescriptorGraphReach(feed, nativeClient)).toBe(false);
        expect(hasDescriptorGraphReach(feed, activateSandbox)).toBe(false);
        Reflect.apply(activateSandbox, nativeClient, [true]);

        await expectOpenToRejectWithExchangeFeedError(feed);
        expect(loadMarketsCalls).toBe(0);
      });
    });

    it("rejects every invalid injected origin map before it can invoke client I/O", () => {
      const rejectedOrigins: readonly [string, Record<string, unknown>][] = [
        ["missing", {}],
        ["incomplete-api", { api: {} }],
        ["ambiguous", originMapWithSpotUrl("https://api.bybit.eu@hostile.invalid")],
        ["hostile", originMapWithSpotUrl("https://hostile.invalid")],
        ["path-confused", originMapWithSpotUrl("https://api.bybit.eu/credential-relay")],
        ["global", originMapWithSpotUrl("https://api.bybit.com")],
        ["testnet", originMapWithSpotUrl("https://api-testnet.bybit.eu")],
      ];
      for (const [kind, urls] of rejectedOrigins) {
        const calls = { authorization: 0, createOrder: 0, loadMarkets: 0, watchTicker: 0 };
        const fake = makeFakeExchange({
          urls,
          loadMarkets: () => {
            calls.loadMarkets += 1;
            return Promise.resolve({});
          },
          createOrder: (_symbol, type, side, amount, price, _parameters) => {
            calls.createOrder += 1;
            return Promise.resolve({
              amount,
              clientOrderId: "test-order",
              id: "mock",
              price,
              side,
              status: "open",
              symbol: "BTC/USDC",
              timestamp: 0,
              type,
            });
          },
          privateGetV5SpotMarginTradeState: () => {
            calls.authorization += 1;
            return Promise.resolve({});
          },
          watchTicker: (_symbol) => {
            calls.watchTicker += 1;
            return Promise.resolve({});
          },
        });

        const expectedError =
          kind === "incomplete-api"
            ? /Bybit EU API URL map is incomplete or contains unapproved endpoints/
            : ExchangeFeedError;
        expect(
          () =>
            new BybitEuFeed({
              apiKey: "k",
              secret: "s",
              rateLimitMs: 100,
              exchange: fake,
            }),
        ).toThrow(expectedError);
        expect(calls).toEqual({ authorization: 0, createOrder: 0, loadMarkets: 0, watchTicker: 0 });
      }
    });
  });

  describe("open / close", () => {
    it("rejects injected-client origin drift before a later open can invoke client I/O", async () => {
      let loadMarketsCalls = 0;
      const fake = makeFakeExchange({
        loadMarkets: () => {
          loadMarketsCalls += 1;
          return Promise.resolve({});
        },
      });
      const feed = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100, exchange: fake });
      replaceOriginMapValue(fake.urls, ["api", "private"], "https://api-testnet.bybit.eu");

      await expectOpenToRejectWithExchangeFeedError(feed);
      expect(loadMarketsCalls).toBe(0);
    });

    it("rejects a later ticker-stream iteration after listener-observed origin drift without a second watch", async () => {
      let watchTickerCalls = 0;
      const ticker = Promise.withResolvers<{
        symbol: string;
        timestamp: number;
        bid: number;
        ask: number;
        last: number;
      }>();
      const fake = makeFakeExchange({
        watchTicker: () => {
          watchTickerCalls += 1;
          return ticker.promise;
        },
      });
      const feed = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100, exchange: fake });
      await feed.open();
      let receivedEvents = 0;
      const id = await feed.subscribeTicker(asSymbol("BTC/USDC"), () => {
        receivedEvents += 1;
        replaceOriginMapValue(fake.urls, ["api", "private"], "https://api-testnet.bybit.eu");
      });
      const subscription = feed.waitForSubscription(id);
      ticker.resolve({ symbol: "BTC/USDC", timestamp: 1, bid: 1, ask: 2, last: 1.5 });

      await expectSubscriptionToRejectWithExchangeFeedError(subscription);
      expect(receivedEvents).toBe(1);
      expect(watchTickerCalls).toBe(1);
      replaceOriginMapValue(fake.urls, ["api", "private"], "https://api.bybit.eu");
      await feed.close();
    });

    it("rejects a fallback poll after origin drift without a second REST fetch", async () => {
      let fetchTickerCalls = 0;
      const ticker = Promise.withResolvers<{
        symbol: string;
        timestamp: number;
        bid: number;
        ask: number;
        last: number;
      }>();
      const fake = makeFakeExchange({
        watchTicker: () => Promise.reject(new NotSupportedError("watchTicker is not supported yet")),
        fetchTicker: () => {
          fetchTickerCalls += 1;
          return ticker.promise;
        },
      });
      const feed = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100, exchange: fake });
      await feed.open();
      const id = await feed.subscribeTicker(asSymbol("BTC/USDC"), () => {
        replaceOriginMapValue(fake.urls, ["api", "private"], "https://api-testnet.bybit.eu");
      });
      const subscription = feed.waitForSubscription(id);
      ticker.resolve({ symbol: "BTC/USDC", timestamp: 1, bid: 1, ask: 2, last: 1.5 });

      await expectSubscriptionToRejectWithExchangeFeedError(subscription);
      expect(fetchTickerCalls).toBe(1);
      replaceOriginMapValue(fake.urls, ["api", "private"], "https://api.bybit.eu");
      await feed.close();
    });

    it("rejects a representative REST fetch after origin drift before client invocation", async () => {
      let fetchTickerCalls = 0;
      const fake = makeFakeExchange({
        fetchTicker: () => {
          fetchTickerCalls += 1;
          return Promise.resolve({});
        },
      });
      const feed = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100, exchange: fake });
      await feed.open();
      replaceOriginMapValue(fake.urls, ["api", "private"], "https://api-testnet.bybit.eu");

      await expectSubscriptionToRejectWithExchangeFeedError(feed.fetchTickerSnapshot(asSymbol("BTC/USDC")));
      expect(fetchTickerCalls).toBe(0);
    });

    it("rethrows origin drift during order-unwatch cleanup before the native unwatch invocation", async () => {
      let unwatchCalls = 0;
      const fake = makeFakeExchange({
        unWatchOrders: () => {
          unwatchCalls += 1;
          return Promise.resolve();
        },
      });
      Object.defineProperty(fake, "has", {
        configurable: true,
        get: () => {
          replaceOriginMapValue(fake.urls, ["api", "private"], "https://api-testnet.bybit.eu");
          return { unWatchOrders: true };
        },
      });
      const feed = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100, exchange: fake });
      await feed.open();
      const id = await feed.subscribeOrderUpdates(() => {
        throw new Error("Unexpected order update");
      });

      await expectSubscriptionToRejectWithExchangeFeedError(feed.unsubscribe(id));
      expect(unwatchCalls).toBe(0);
      replaceOriginMapValue(fake.urls, ["api", "private"], "https://api.bybit.eu");
      await feed.close();
    });

    it("open() hívja a loadMarkets()-t és opened=true lesz", async () => {
      let isLoadMarketsCalled = false;
      const fake = makeFakeExchange({
        loadMarkets: () => {
          isLoadMarketsCalled = true;
          return Promise.resolve({});
        },
      });
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: fake,
      });
      await feed.open();
      expect(isLoadMarketsCalled).toBe(true);
    });

    it("open() idempotens (második hívás NEM hívja loadMarkets()-t)", async () => {
      let loadMarketsCount = 0;
      const fake = makeFakeExchange({
        loadMarkets: () => {
          loadMarketsCount++;
          return Promise.resolve({});
        },
      });
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: fake,
      });
      await feed.open();
      await feed.open();
      expect(loadMarketsCount).toBe(1);
    });

    it("close() törli a subscription-öket", async () => {
      const fake = makeFakeExchange();
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: fake,
      });
      await feed.open();
      const id = await feed.subscribeTicker(asSymbol("BTC/USDC"), () => {
        // The subscription is cancelled before the fixture emits.
      });
      expect(typeof id).toBe("number");
      await feed.close();
      await feed.unsubscribe(id);
    });
  });
});

function originMapWithSpotUrl(spotUrl: string): Record<string, unknown> {
  const urls = officialBybitEuUrlMap();
  replaceOriginMapValue(urls, ["api", "spot"], spotUrl);
  return urls;
}

async function expectOpenToRejectWithExchangeFeedError(feed: BybitEuFeed): Promise<void> {
  await expectSubscriptionToRejectWithExchangeFeedError(feed.open());
}

async function expectSubscriptionToRejectWithExchangeFeedError(operation: Promise<unknown>): Promise<void> {
  let didReject = false;
  try {
    await operation;
  } catch (error) {
    didReject = true;
    expect(error).toBeInstanceOf(ExchangeFeedError);
  }
  expect(didReject).toBe(true);
}

function hasDescriptorGraphReach(root: object, prohibitedValue: unknown): boolean {
  const visited = new Set<object>();
  const pending: object[] = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (let owner: object | null = current; owner !== null; owner = Reflect.getPrototypeOf(owner)) {
      for (const key of Reflect.ownKeys(owner)) {
        if (["client", "exchange", "services", "setSandboxMode"].includes(key)) return true;
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        if (descriptor !== undefined) {
          if (descriptor.value === prohibitedValue) return true;
          if (isRecord(descriptor.value)) pending.push(descriptor.value);
        }
      }
    }
  }
  return false;
}

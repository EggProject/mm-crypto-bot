// packages/backtest-tools/src/data/dydx-indexer-feed.test.ts — dYdX v4
// Indexer feed unit tests.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  BACKUP_RATE_LIMIT_PER_MINUTE,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  DEFAULT_STALE_THRESHOLD_MS,
  DydxIndexerFeed,
  parseFundingUpdate,
  type DydxHistoricalFunding,
  type DydxMarketState,
  type DydxWsChannelData,
} from "./dydx-indexer-feed.js";

describe("DydxIndexerFeed — constructor", () => {
  it("elfogadja az alapértelmezett konfigurációt", () => {
    const feed = new DydxIndexerFeed();
    expect(feed.rateLimitPerMinute).toBe(DEFAULT_RATE_LIMIT_PER_MINUTE);
    expect(feed.staleThresholdMs).toBe(DEFAULT_STALE_THRESHOLD_MS);
    expect(feed.fetchTimeoutMs).toBe(DEFAULT_FETCH_TIMEOUT_MS);
    expect(feed.baseUrl).toBe("https://indexer.dydx.trade");
    expect(feed.wsUrl).toBe("wss://indexer.dydx.trade/v4/ws");
  });

  it("elfogadja a Polkachu / KingNodes alternatív konfigurációt", () => {
    const feed = new DydxIndexerFeed({
      baseUrl: "https://polkachu-rpc.dydx.trade",
      wsUrl: "wss://kingnodes-rpc.dydx.trade/v4/ws",
      rateLimitPerMinute: BACKUP_RATE_LIMIT_PER_MINUTE,
      staleThresholdMs: 10 * 60 * 1000,
    });
    expect(feed.rateLimitPerMinute).toBe(BACKUP_RATE_LIMIT_PER_MINUTE);
    expect(feed.staleThresholdMs).toBe(10 * 60 * 1000);
  });

  it("elutasítja a nem-pozitív rateLimitPerMinute értéket", () => {
    expect(() => new DydxIndexerFeed({ rateLimitPerMinute: 0 })).toThrow();
    expect(() => new DydxIndexerFeed({ rateLimitPerMinute: -1 })).toThrow();
    expect(() => new DydxIndexerFeed({ rateLimitPerMinute: Number.NaN })).toThrow();
  });

  it("elutasítja a nem-pozitív staleThresholdMs értéket", () => {
    expect(() => new DydxIndexerFeed({ staleThresholdMs: 0 })).toThrow();
    expect(() => new DydxIndexerFeed({ staleThresholdMs: -100 })).toThrow();
  });

  it("normalizálja a baseUrl trailing slash-t", () => {
    const feed = new DydxIndexerFeed({ baseUrl: "https://example.com/" });
    expect(feed.baseUrl).toBe("https://example.com");
  });
});

describe("DydxIndexerFeed — state + isStale", () => {
  let feed: DydxIndexerFeed;
  beforeAll(() => {
    feed = new DydxIndexerFeed({ staleThresholdMs: 5 * 60 * 1000 });
  });

  it("kezdeti state: minden market stale", () => {
    const state = feed.getState("BTC-USD");
    expect(state.lastTickMs).toBeNull();
    expect(state.lastRate).toBeNull();
    expect(state.wsConnected).toBe(false);
    expect(feed.isStale("BTC-USD")).toBe(true);
    expect(feed.isStale("ETH-USD")).toBe(true);
    expect(feed.isStale("SOL-USD")).toBe(true);
  });

  it("isStale false ha a legutóbbi tick < staleThresholdMs", () => {
    const market = "ETH-USD" as const;
    const state: DydxMarketState = feed.getState(market);
    state.lastTickMs = Date.now() - 1000; // 1 sec ago
    expect(feed.isStale(market)).toBe(false);
  });

  it("isStale true ha a legutóbbi tick > staleThresholdMs", () => {
    const market = "SOL-USD" as const;
    const state: DydxMarketState = feed.getState(market);
    state.lastTickMs = Date.now() - (10 * 60 * 1000); // 10 min ago
    expect(feed.isStale(market)).toBe(true);
  });

  it("getHealth aggregálja a piaci stateket", () => {
    const health = feed.getHealth();
    expect(health.totalMarkets).toBe(3);
    expect(health.staleMarkets.length).toBeGreaterThan(0);
    expect(health.wsConnected).toBe(0);
  });
});

describe("DydxIndexerFeed — REST response parsing", () => {
  it("fetchHistoricalFunding a fetch mock-ot használja", async () => {
    const mockResponses: readonly { historicalFunding: readonly DydxHistoricalFunding[] }[] = [
      {
        historicalFunding: [
          {
            ticker: "BTC-USD",
            rate: "0.00004405",
            price: "82546.77",
            effectiveAt: "2026-04-01T01:00:00Z",
            effectiveAtHeight: "12345",
          },
          {
            ticker: "BTC-USD",
            rate: "0.00003125",
            effectiveAt: "2026-04-01T02:00:00Z",
          },
        ],
      },
      { historicalFunding: [] },
    ];

    // Replace global fetch for this test.
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (async () => {
      const resp = mockResponses[callCount];
      callCount += 1;
      return new Response(JSON.stringify(resp ?? { historicalFunding: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const feed = new DydxIndexerFeed();
      const snaps = await feed.fetchHistoricalFunding("BTC-USD", { effectiveBeforeMs: Date.now() });
      expect(snaps.length).toBe(2);
      expect(snaps[0]?.fundingRate).toBeCloseTo(0.00004405, 8);
      expect(snaps[0]?.symbol).toBe("BTC-USD");
      expect(snaps[0]?.markPrice).toBe(82546.77);
      expect(snaps[1]?.markPrice).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("429-re dob kivételt és számolja a rate-limit találatokat", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    try {
      const feed = new DydxIndexerFeed();
      try {
        await feed.getLatestFunding("BTC-USD");
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        expect(err instanceof Error).toBe(true);
        expect(feed.getState("BTC-USD").rateLimitHits).toBe(1);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("parseFundingUpdate — WS payload extraction", () => {
  it("null-t ad vissza üres contents esetén", () => {
    const msg: DydxWsChannelData = {
      channel: "v4_markets",
      id: "BTC-USD",
      type: "channel_data",
    };
    expect(parseFundingUpdate(msg, "BTC-USD")).toBeNull();
  });

  it("kiszedi a mark price-t a contents.trading-ből", () => {
    const msg: DydxWsChannelData = {
      channel: "v4_markets",
      id: "BTC-USD",
      contents: {
        trading: {
          "BTC-USD": { markPrice: "82500.00", oraclePrice: "82480.00" },
        },
      },
      type: "channel_data",
    };
    const snap = parseFundingUpdate(msg, "BTC-USD");
    expect(snap).not.toBeNull();
    expect(snap?.markPrice).toBe(82500);
    expect(snap?.symbol).toBe("BTC-USD");
  });

  it("null ha a kért market nincs a trading map-ben", () => {
    const msg: DydxWsChannelData = {
      channel: "v4_markets",
      id: "BTC-USD",
      contents: { trading: { "ETH-USD": { markPrice: "3000.00" } } },
      type: "channel_data",
    };
    expect(parseFundingUpdate(msg, "BTC-USD")).toBeNull();
  });
});

describe("DydxIndexerFeed — disconnectAll", () => {
  it("cleanup törli a WebSocket stateket", () => {
    const feed = new DydxIndexerFeed();
    feed.disconnectAll();
    const health = feed.getHealth();
    expect(health.wsConnected).toBe(0);
  });
});

describe("DydxIndexerFeed — disk cache fallback", () => {
  let cacheDir: string;
  beforeAll(() => {
    cacheDir = mkdtempSync(resolve(tmpdir(), "dydx-test-"));
  });
  afterAll(() => {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("REST hiba esetén fallback a legutóbbi WS tick-re", async () => {
    const originalFetch = globalThis.fetch;
    let invoked = 0;
    globalThis.fetch = (async () => {
      invoked += 1;
      return new Response("error", { status: 500 });
    }) as unknown as typeof fetch;
    try {
      const feed = new DydxIndexerFeed({ fetchTimeoutMs: 1000 });
      const state = feed.getState("BTC-USD");
      state.lastTickMs = Date.now() - 1000;
      state.lastRate = 0.000044;
      const snap = await feed.getLatestFunding("BTC-USD");
      expect(snap.fundingRate).toBeCloseTo(0.000044, 6);
      expect(snap.staleSinceTick).toBe(false);
      expect(invoked).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
// packages/backtest-tools/src/data/dydx-indexer-feed.test.ts — dYdX v4
// Indexer feed unit tests.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
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

  it("getLatestFunding throws when no REST data and no WS state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("not found", { status: 500 })) as unknown as typeof fetch;
    try {
      const feed = new DydxIndexerFeed();
      // No lastTickMs / lastRate set, no REST data → must throw.
      await expect(feed.getLatestFunding("BTC-USD")).rejects.toThrow(/No funding data/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("getLatestFunding throws when REST returns empty list", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ historicalFunding: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      const feed = new DydxIndexerFeed();
      await expect(feed.getLatestFunding("BTC-USD")).rejects.toThrow(/No funding data/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("getFundingRange returns snapshots in the range", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          historicalFunding: [
            {
              ticker: "BTC-USD",
              rate: "0.0001",
              price: "82000",
              effectiveAt: "2026-04-01T01:00:00Z",
            },
            {
              ticker: "BTC-USD",
              rate: "0.0002",
              effectiveAt: "2026-04-01T02:00:00Z",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;
    try {
      const feed = new DydxIndexerFeed();
      const start = Date.UTC(2026, 3, 1, 0, 0, 0);
      const end = Date.UTC(2026, 3, 1, 2, 0, 0);
      const snaps = await feed.getFundingRange("BTC-USD", start, end);
      expect(snaps.length).toBeGreaterThan(0);
      for (const s of snaps) {
        expect(s.fundingTime).toBeGreaterThanOrEqual(start - 1);
        expect(s.fundingTime).toBeLessThanOrEqual(end + 1);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("getFundingRange throws on invalid range", async () => {
    const feed = new DydxIndexerFeed();
    const start = Date.UTC(2026, 3, 1, 0, 0, 0);
    await expect(feed.getFundingRange("BTC-USD", start, start - 1)).rejects.toThrow(
      /Invalid range/,
    );
    await expect(feed.getFundingRange("BTC-USD", NaN, start)).rejects.toThrow();
  });

  it("getState throws on unknown market", () => {
    const feed = new DydxIndexerFeed();
    expect(() => feed.getState("FAKE-USD" as never)).toThrow(/Unknown market/);
  });

  it("HISTORICAL_FUNDING_PATH returns the canonical camelCase path", () => {
    expect(DydxIndexerFeed.HISTORICAL_FUNDING_PATH("BTC-USD")).toBe("/v4/historicalFunding/BTC-USD");
    expect(DydxIndexerFeed.HISTORICAL_FUNDING_PATH("ETH-USD")).toBe("/v4/historicalFunding/ETH-USD");
  });

  it("parseFundingUpdate handles channel_batch_data shape", () => {
    const msg = {
      channel: "v4_markets" as const,
      id: "BTC-USD",
      contents: [{ trading: { "BTC-USD": { markPrice: "82500.00" } } }] as const,
      type: "channel_batch_data" as const,
    };
    const snap = parseFundingUpdate(msg, "BTC-USD");
    expect(snap?.markPrice).toBe(82500);
  });

  it("parseFundingUpdate returns null when markPrice is invalid", () => {
    const msg: DydxWsChannelData = {
      channel: "v4_markets",
      id: "BTC-USD",
      contents: { trading: { "BTC-USD": { markPrice: "not-a-number" } } },
      type: "channel_data",
    };
    expect(parseFundingUpdate(msg, "BTC-USD")).toBeNull();
  });
});

describe("DydxIndexerFeed — subscribe() (mocked WebSocket)", () => {
  // Mock the global WebSocket so we can test subscribe() without a real
  // network connection. The real WebSocket would try to dial
  // wss://indexer.dydx.trade/v4/ws which is not available in tests.
  const realWS = globalThis.WebSocket;
  let created: { readyState: number; sentMessages: string[]; closeCalls: number; openHandler: (() => void) | null; messageHandler: ((e: { data: string }) => void) | null; closeHandler: (() => void) | null; errorHandler: ((e: unknown) => void) | null }[] = [];

  beforeEach(() => {
    created = [];
    class MockWS {
      public readyState = 0; // CONNECTING
      public sentMessages: string[] = [];
      public closeCalls = 0;
      public openHandler: (() => void) | null = null;
      public messageHandler: ((e: { data: string }) => void) | null = null;
      public closeHandler: (() => void) | null = null;
      public errorHandler: ((e: unknown) => void) | null = null;
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor(_url: string) {
        created.push(this as unknown as (typeof created)[number]);
        // Mark open on next tick.
        setTimeout(() => {
          this.readyState = 1;
          this.openHandler?.();
        }, 0);
      }
      send(msg: string) {
        this.sentMessages.push(msg);
      }
      close() {
        this.closeCalls += 1;
        this.readyState = 3;
        this.closeHandler?.();
      }
      addEventListener(ev: string, handler: (...args: unknown[]) => void) {
        if (ev === "open") this.openHandler = handler as () => void;
        else if (ev === "message") this.messageHandler = handler as (e: { data: string }) => void;
        else if (ev === "close") this.closeHandler = handler as () => void;
        else if (ev === "error") this.errorHandler = handler as (e: unknown) => void;
      }
    }
    globalThis.WebSocket = MockWS as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = realWS;
  });

  it("subscribe() opens a WebSocket, sends subscribe message, fires onTick on message", async () => {
    const feed = new DydxIndexerFeed({ wsUrl: "ws://mock" });
    let ticked: { type?: string; channel?: string } | null = null;
    const ws = feed.subscribe("BTC-USD", (msg) => {
      ticked = msg;
    });
    // Wait for the setTimeout(0) to fire the open handler.
    await new Promise((r) => setTimeout(r, 5));
    // The mock should have opened and sent a subscribe message.
    expect(ws.readyState).toBe(1);
    expect(feed.getState("BTC-USD").wsConnected).toBe(true);
    expect(created[0]?.sentMessages[0]).toContain('"channel":"v4_markets"');

    // Simulate an incoming message.
    const handler = created[0]?.messageHandler;
    if (handler) {
      handler({
        data: JSON.stringify({
          channel: "v4_markets",
          id: "BTC-USD",
          contents: { trading: { "BTC-USD": { markPrice: "82500.00" } } },
          type: "channel_data",
        }),
      });
    }
    expect(ticked).not.toBeNull();
    expect(feed.getState("BTC-USD").lastRate).toBe(82500);
    expect(feed.getState("BTC-USD").lastTickMs).not.toBeNull();
  });

  it("subscribe() returns the existing connection on a second call", async () => {
    const feed = new DydxIndexerFeed({ wsUrl: "ws://mock" });
    const ws1 = feed.subscribe("BTC-USD", () => undefined);
    await new Promise((r) => setTimeout(r, 5));
    const ws2 = feed.subscribe("BTC-USD", () => undefined);
    // Same instance should be returned (mock OPEN state).
    expect(ws1).toBe(ws2);
    expect(created.length).toBe(1);
  });

  it("subscribe() close event resets wsConnected", async () => {
    const feed = new DydxIndexerFeed({ wsUrl: "ws://mock" });
    feed.subscribe("BTC-USD", () => undefined);
    await new Promise((r) => setTimeout(r, 5));
    expect(feed.getState("BTC-USD").wsConnected).toBe(true);
    const closeHandler = created[0]?.closeHandler;
    if (closeHandler) closeHandler();
    expect(feed.getState("BTC-USD").wsConnected).toBe(false);
  });

  it("subscribe() error event resets wsConnected", async () => {
    const feed = new DydxIndexerFeed({ wsUrl: "ws://mock" });
    feed.subscribe("BTC-USD", () => undefined);
    await new Promise((r) => setTimeout(r, 5));
    const errHandler = created[0]?.errorHandler;
    if (errHandler) errHandler({});
    expect(feed.getState("BTC-USD").wsConnected).toBe(false);
  });

  it("subscribe() with empty message data is a no-op", async () => {
    const feed = new DydxIndexerFeed({ wsUrl: "ws://mock" });
    let ticked = false;
    feed.subscribe("BTC-USD", () => {
      ticked = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    const handler = created[0]?.messageHandler;
    if (handler) handler({ data: "" });
    expect(ticked).toBe(false);
  });

  it("subscribe() with malformed JSON does not crash", async () => {
    const feed = new DydxIndexerFeed({ wsUrl: "ws://mock" });
    feed.subscribe("BTC-USD", () => undefined);
    await new Promise((r) => setTimeout(r, 5));
    const handler = created[0]?.messageHandler;
    if (handler) handler({ data: "{ this is not json" });
    // No exception thrown, state still consistent.
    expect(feed.getState("BTC-USD")).toBeDefined();
  });
});
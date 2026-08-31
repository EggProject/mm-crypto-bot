import { describe, expect, it } from "bun:test";

import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  DEFAULT_STALE_THRESHOLD_MS,
  DydxIndexerFeed,
  parseFundingUpdate,
  type DydxWsChannelData,
} from "./dydx-indexer-feed.js";
import {
  exactOptionalMarkPrice,
  extractTradingMap,
  historicalFundingRows,
  historicalFundingSnapshot,
  parseIndexerWsMessage,
  tradingForMarket,
  validateIndexerFetchResponse,
  websocketErrorMessage,
  websocketText,
  type DydxIndexerFetchPage,
  type DydxIndexerWebSocket,
} from "./dydx-indexer-funding.js";

const exact = (value: string): ExactRational => ExactRational.from(value);

function update(markPrice: unknown, fundingRate: unknown = "0.0001"): DydxWsChannelData {
  return {
    channel: "v4_markets",
    id: "BTC-USD",
    type: "channel_data",
    contents: { trading: { "BTC-USD": { markPrice, fundingRate } } },
  };
}

function historical(effectiveAt: string, rate = "0.0001", price = "80000") {
  return { ticker: "BTC-USD", rate, price, effectiveAt };
}

function response(json: unknown, status = 200, statusText = "OK") {
  return { ok: status >= 200 && status < 300, status, statusText, json: () => Promise.resolve(json) };
}

async function failureMessage(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error: unknown) {
    return error instanceof Error ? error.message : "unknown";
  }
  return "no failure";
}

class FakeWebSocket implements DydxIndexerWebSocket {
  private readonly listeners = new Map<string, ((event: Event) => void)[]>();
  readyState = 0;
  readonly sent: string[] = [];
  wasClosed = false;

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.wasClosed = true;
  }

  emit(type: string, event: Event): void {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) listener(event);
  }
}

class SocketErrorEvent extends Event {
  constructor(readonly message: string) {
    super("error");
  }
}

describe("dYdX indexer exact funding boundary", () => {
  it("parses raw decimal transport into an exact funding snapshot", () => {
    const snapshot = parseFundingUpdate(update("82546.767340000000000001"), "BTC-USD", 1_700_000_000_000);
    expect(snapshot?.fundingRate.equals(exact("0.0001"))).toBe(true);
    expect(snapshot?.markPrice?.equals(exact("82546.767340000000000001"))).toBe(true);
    expect(snapshot?.symbol).toBe("BTC-USD");
  });

  it("rejects JSON numeric financial fields instead of relabeling them exact", () => {
    const snapshot = parseFundingUpdate(update(82_546.75), "BTC-USD", 1_700_000_000_000);
    expect(snapshot).toBeUndefined();
  });

  it("rejects malformed, hostile, and absent price transports", () => {
    expect(parseFundingUpdate(update("not-a-decimal", "not-a-decimal"), "BTC-USD", 1)).toBeUndefined();
    expect(parseFundingUpdate(update("80000", "1.2300"), "BTC-USD", 1)).toBeUndefined();
    expect(parseFundingUpdate(update("80000.0", "0.0001"), "BTC-USD", 1)).toBeUndefined();
    expect(parseFundingUpdate(update(Infinity, Infinity), "BTC-USD", 1)).toBeUndefined();
    expect(parseFundingUpdate({ channel: "v4_markets", id: "BTC-USD", contents: {} }, "BTC-USD", 1)).toBeUndefined();
  });

  it("validates Indexer transport and WebSocket payload boundaries without assertions", async () => {
    const validResponse = validateIndexerFetchResponse(response({ historicalFunding: [] }));
    expect(await validResponse.json()).toEqual({ historicalFunding: [] });
    for (const candidate of [undefined, {}, { ok: true, status: 200, statusText: "OK" }]) {
      expect(() => validateIndexerFetchResponse(candidate)).toThrow("Invalid dYdX Indexer transport response");
    }
    const single = parseIndexerWsMessage(update("1"));
    const batch = parseIndexerWsMessage({
      channel: "v4_markets",
      id: "BTC-USD",
      contents: [{ trading: { "BTC-USD": { markPrice: "1" } } }],
    });
    expect(single?.id).toBe("BTC-USD");
    expect(batch?.id).toBe("BTC-USD");
    expect(parseIndexerWsMessage({ channel: "wrong", id: "BTC-USD" })).toBeUndefined();
    expect(parseIndexerWsMessage({ channel: "v4_markets", id: "BTC-USD" })?.id).toBe("BTC-USD");
    expect(parseIndexerWsMessage({ channel: "v4_markets", id: "BTC-USD", contents: { trading: "bad" } })).toBeUndefined();
    expect(websocketText(undefined)).toBe("");
    expect(websocketText(new MessageEvent("message", { data: "payload" }))).toBe("payload");
    expect(websocketText(new Event("message"))).toBe("");
    expect(websocketErrorMessage(undefined)).toBe("unknown");
    expect(websocketErrorMessage(new SocketErrorEvent("failed"))).toBe("failed");
    expect(websocketErrorMessage(new Event("error"))).toBe("unknown");
  });

  it("handles exact optional marks, all supported markets, and strict historical rows", () => {
    expect(exactOptionalMarkPrice("80000").markPrice?.equals(exact("80000"))).toBe(true);
    expect(exactOptionalMarkPrice("bad").markPrice).toBeUndefined();
    const trading = {
      "BTC-USD": { markPrice: "1" },
      "ETH-USD": { markPrice: "2" },
      "SOL-USD": { markPrice: "3" },
    };
    expect(tradingForMarket(trading, "BTC-USD")?.markPrice).toBe("1");
    expect(tradingForMarket(trading, "ETH-USD")?.markPrice).toBe("2");
    expect(tradingForMarket(trading, "SOL-USD")?.markPrice).toBe("3");
    expect(extractTradingMap({ channel: "v4_markets", id: "BTC-USD", contents: [] })).toBeUndefined();
    expect(extractTradingMap({ channel: "v4_markets", id: "BTC-USD" })).toBeUndefined();
    expect(parseFundingUpdate({ channel: "v4_markets", id: "BTC-USD", contents: { trading: {} } }, "BTC-USD", 1)).toBeUndefined();
    const rows = historicalFundingRows({
      historicalFunding: [historical("2025-04-01T00:00:00.000Z", "0.1"), { ...historical("2025-04-01T01:00:00.000Z", "0.2"), price: undefined }],
    });
    const [firstRow, secondRow] = rows;
    if (firstRow === undefined || secondRow === undefined) throw new Error("expected historical fixture rows");
    expect(Object.isFrozen(rows)).toBe(true);
    expect(secondRow.price).toBeUndefined();
    for (const malformed of [undefined, {}, { historicalFunding: ["row"] }, { historicalFunding: [{ ticker: "BTC-USD" }] }]) {
      expect(() => historicalFundingRows(malformed)).toThrow();
    }
    expect(historicalFundingSnapshot(firstRow, Date.UTC(2025, 3, 2))).toBeUndefined();
    expect(historicalFundingSnapshot({ ...firstRow, effectiveAt: "invalid" }, undefined)).toBeUndefined();
    expect(historicalFundingSnapshot({ ...firstRow, rate: "invalid" }, undefined)).toBeUndefined();
    expect(historicalFundingSnapshot({ ...firstRow, price: "invalid" }, undefined)).toBeUndefined();
    expect(historicalFundingSnapshot(firstRow, undefined)?.markPrice?.equals(exact("80000"))).toBe(true);
    expect(historicalFundingSnapshot(secondRow, undefined)?.markPrice).toBeUndefined();
  });
});

describe("dYdX indexer feed fail-closed state", () => {
  it("starts stale and reports all markets as stale until observations arrive", () => {
    const feed = new DydxIndexerFeed();
    expect(feed.isStale("BTC-USD", Date.now())).toBe(true);
    expect(DydxIndexerFeed.HISTORICAL_FUNDING_PATH("BTC-USD")).toBe("/v4/historicalFunding/BTC-USD");
    expect(feed.getHealth().staleMarkets).toEqual(["BTC-USD", "ETH-USD", "SOL-USD"]);
    expect(feed.staleThresholdMs).toBe(DEFAULT_STALE_THRESHOLD_MS);
  });

  it("rejects invalid rate, burst, stale, and timeout configuration", () => {
    expect(() => new DydxIndexerFeed({ rateLimitPerMinute: 0 })).toThrow();
    expect(() => new DydxIndexerFeed({ burstCost: -1 })).toThrow();
    expect(() => new DydxIndexerFeed({ staleThresholdMs: NaN })).toThrow();
    expect(() => new DydxIndexerFeed({ fetchTimeoutMs: -1 })).toThrow();
  });

  it("fetches paginated historical funding through a frozen injected transport", async () => {
    const first = new Date(Date.UTC(2025, 3, 2)).toISOString();
    const second = new Date(Date.UTC(2025, 3, 1)).toISOString();
    const pages = [[historical(first), historical(second)], []];
    let calls = 0;
    const fetchPage: DydxIndexerFetchPage = (request) => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(request.url).toContain("BTC-USD");
      calls += 1;
      return Promise.resolve(response({ historicalFunding: pages.shift() ?? [] }));
    };
    const feed = new DydxIndexerFeed({ baseUrl: "https://fake.indexer", fetchPage });
    const rows = await feed.fetchHistoricalFunding("BTC-USD", { limit: 2 });
    expect(calls).toBe(2);
    expect(rows.map((row) => row.fundingRate.equals(exact("0.0001")))).toEqual([true, true]);
    expect(feed.getHealth().restRequestCount).toBe(2);
  });

  it("deduplicates an inclusive page boundary and advances the pagination cursor", async () => {
    const latest = historical("2025-04-03T00:00:00.000Z");
    const boundary = historical("2025-04-02T00:00:00.000Z");
    const oldest = historical("2025-04-01T00:00:00.000Z");
    const pages = [[latest, boundary], [boundary, oldest], []];
    const requestedUrls: string[] = [];
    const feed = new DydxIndexerFeed({
      fetchPage: (request) => {
        requestedUrls.push(request.url);
        return Promise.resolve(response({ historicalFunding: pages.shift() ?? [] }));
      },
    });
    const rows = await feed.fetchHistoricalFunding("BTC-USD", { limit: 2 });
    expect(rows.map((row) => row.fundingTime)).toEqual([
      Date.parse(latest.effectiveAt),
      Date.parse(boundary.effectiveAt),
      Date.parse(oldest.effectiveAt),
    ]);
    expect(requestedUrls[1]).not.toContain(encodeURIComponent(boundary.effectiveAt));
  });

  it("fails closed instead of returning a partial repeated or exhausted page sequence", async () => {
    const repeated = [historical("2025-04-03T00:00:00.000Z"), historical("2025-04-02T00:00:00.000Z")];
    const repeatedFeed = new DydxIndexerFeed({
      fetchPage: () => Promise.resolve(response({ historicalFunding: repeated })),
    });
    expect(await failureMessage(() => repeatedFeed.fetchHistoricalFunding("BTC-USD", { limit: 2 }))).toContain(
      "made no progress",
    );

    const exhaustedPages = Array.from({ length: 50 }, (_, index) => [
      historical(new Date(Date.UTC(2025, 3, 1) - index * 3_600_000).toISOString()),
    ]);
    const exhaustedFeed = new DydxIndexerFeed({
      fetchPage: () => Promise.resolve(response({ historicalFunding: exhaustedPages.shift() ?? [] })),
    });
    expect(await failureMessage(() => exhaustedFeed.fetchHistoricalFunding("BTC-USD", { limit: 1 }))).toContain(
      "exceeded the page limit",
    );
  });

  it("fails closed when a full historical page has an invalid effective timestamp", async () => {
    const feed = new DydxIndexerFeed({
      fetchPage: () => Promise.resolve(response({ historicalFunding: [historical("not-a-date")] })),
    });
    expect(await failureMessage(() => feed.fetchHistoricalFunding("BTC-USD", { limit: 1 }))).toContain(
      "invalid effectiveAt",
    );
  });

  it("paginates a historical row whose optional mark price is absent", async () => {
    const row = { ticker: "BTC-USD", rate: "0.0001", effectiveAt: "2025-04-01T00:00:00.000Z" };
    const pages = [[row], []];
    const feed = new DydxIndexerFeed({
      fetchPage: () => Promise.resolve(response({ historicalFunding: pages.shift() ?? [] })),
    });
    expect(await feed.fetchHistoricalFunding("BTC-USD", { limit: 1 })).toHaveLength(1);
  });

  it("stops a historical page at the requested range boundary and validates public ranges", async () => {
    const cutoff = Date.UTC(2025, 3, 2);
    const priorEvent = historical(new Date(cutoff - 1).toISOString());
    const priorPage = response({ historicalFunding: [priorEvent] });
    const feed = new DydxIndexerFeed({
      fetchPage: () => Promise.resolve(priorPage),
    });
    expect(await feed.fetchHistoricalFunding("BTC-USD", { effectiveAfterMs: cutoff })).toEqual([]);
    const boundedRows = await feed.getFundingRange("BTC-USD", cutoff, cutoff);
    expect(boundedRows.map((row) => row.fundingTime)).toEqual([cutoff - 1]);
    expect(await failureMessage(() => feed.getFundingRange("BTC-USD", Infinity, cutoff))).toContain("Invalid range");
    expect(await failureMessage(() => feed.getFundingRange("BTC-USD", cutoff + 1, cutoff))).toContain("Invalid range");
  });

  it("fails closed for malformed, non-OK, and rate-limited Indexer transport responses", async () => {
    const cases: readonly [string, DydxIndexerFetchPage][] = [
      ["malformed", () => Promise.resolve("not-a-response")],
      ["server", () => Promise.resolve(response({}, 503, "unavailable"))],
      ["rate-limited", () => Promise.resolve(response({}, 429, "slow down"))],
    ];
    for (const [name, fetchPage] of cases) {
      const feed = new DydxIndexerFeed({ fetchPage });
      expect(await failureMessage(() => feed.fetchHistoricalFunding("BTC-USD")), name).not.toBe("no failure");
      if (name === "rate-limited") expect(feed.getHealth().rateLimitHits).toBe(1);
    }
  });

  it("evicts expired buckets and rate-limits in a deterministic public lifecycle", async () => {
    const times = [0, 0, 60_000, 120_001];
    const warnings: string[] = [];
    const feed = new DydxIndexerFeed({
      rateLimitPerMinute: 2,
      now: () => times.shift() ?? 120_001,
      fetchPage: () => Promise.resolve(response({ historicalFunding: [] })),
      logger: {
        debug: () => { void 0; },
        info: () => { void 0; },
        warn: (message) => {
          warnings.push(message);
        },
        error: () => { void 0; },
      },
    });
    await feed.fetchHistoricalFunding("BTC-USD");
    await feed.fetchHistoricalFunding("BTC-USD");
    await feed.fetchHistoricalFunding("BTC-USD");
    await feed.fetchHistoricalFunding("BTC-USD");
    expect(warnings).toEqual(["dydx-indexer rate-limit throttling"]);
    expect(feed.getHealth().restRequestCount).toBe(4);
  });

  it("returns a fresh REST observation and falls back to a valid WebSocket observation after REST failure", async () => {
    let shouldFail = false;
    const socket = new FakeWebSocket();
    const restEvent = historical(new Date(Date.UTC(2025, 3, 1)).toISOString());
    const restPage = response({ historicalFunding: [restEvent] });
    const feed = new DydxIndexerFeed({
      fetchPage: () => {
        if (shouldFail) return Promise.reject(new Error("offline"));
        return Promise.resolve(restPage);
      },
      webSocketFactory: () => socket,
    });
    const rest = await feed.getLatestFunding("BTC-USD");
    expect(rest.staleSinceTick).toBe(false);
    const delivered: string[] = [];
    feed.subscribe("BTC-USD", (message) => {
      delivered.push(message.id);
    });
    socket.readyState = 1;
    socket.emit("open", new Event("open"));
    expect(feed.getHealth().wsConnected).toBe(1);
    const wsPayload = JSON.stringify(update("80000.0000000000000000001"));
    socket.emit("message", new MessageEvent("message", { data: wsPayload }));
    shouldFail = true;
    const fallback = await feed.getLatestFunding("BTC-USD");
    expect(fallback.staleSinceTick).toBe(false);
    expect(fallback.fundingRate.equals(exact("0.0001"))).toBe(true);
    expect(delivered).toEqual(["BTC-USD"]);
    expect(socket.sent).toEqual([JSON.stringify({ type: "subscribe", channel: "v4_markets", id: "BTC-USD" })]);
    const invalidEvent = historical(new Date(Date.UTC(2025, 3, 1)).toISOString(), "not-a-rate");
    const invalidPage = response({ historicalFunding: [invalidEvent] });
    const invalidFeed = new DydxIndexerFeed({ fetchPage: () => Promise.resolve(invalidPage) });
    expect(await failureMessage(() => invalidFeed.getLatestFunding("BTC-USD"))).toContain("No funding data");
    const stringFailureFeed = new DydxIndexerFeed({
      fetchPage: () => Promise.reject(new Error("offline")),
    });
    expect(await failureMessage(() => stringFailureFeed.getLatestFunding("BTC-USD"))).toContain("No funding data");
  });

  it("rejects empty WS state, reuses an open subscription, and resets all states on disconnect", async () => {
    const socket = new FakeWebSocket();
    const feed = new DydxIndexerFeed({
      fetchPage: () => Promise.resolve(response({ historicalFunding: [] })),
      webSocketFactory: () => socket,
    });
    expect(await failureMessage(() => feed.getLatestFunding("BTC-USD"))).toContain("No funding data");
    const first = feed.subscribe("BTC-USD", () => { void 0; });
    socket.readyState = 1;
    expect(feed.subscribe("BTC-USD", () => { void 0; })).toBe(first);
    socket.emit("message", new MessageEvent("message", { data: "{" }));
    socket.emit("message", new MessageEvent("message", { data: "" }));
    socket.emit("message", new MessageEvent("message", { data: JSON.stringify({ channel: "wrong", id: "BTC-USD" }) }));
    socket.emit("message", new MessageEvent("message", { data: JSON.stringify({ channel: "v4_markets", id: "BTC-USD" }) }));
    const invalidPricePayload = JSON.stringify(update("not-a-decimal"));
    socket.emit("message", new MessageEvent("message", { data: invalidPricePayload }));
    socket.emit("close", new Event("close"));
    socket.emit("error", new SocketErrorEvent("socket failed"));
    feed.disconnectAll();
    expect(socket.wasClosed).toBe(true);
    expect(feed.getHealth().wsConnected).toBe(0);
  });

  it("fails closed before a network request when the default transport receives an invalid configured URL", async () => {
    const feed = new DydxIndexerFeed({ baseUrl: ":" });
    expect(await failureMessage(() => feed.fetchHistoricalFunding("BTC-USD"))).not.toBe("no failure");
  });

  it("fails closed before a network connection when the default WebSocket factory receives an invalid URL", () => {
    const feed = new DydxIndexerFeed({ wsUrl: ":" });
    expect(() => feed.subscribe("BTC-USD", () => { void 0; })).toThrow();
  });

  it("contains non-Error callback failures inside the WebSocket boundary", () => {
    const socket = new FakeWebSocket();
    const feed = new DydxIndexerFeed({ webSocketFactory: () => socket });
    feed.subscribe("BTC-USD", () => {
      throw new Error("consumer failure");
    });
    const validPricePayload = JSON.stringify(update("80000"));
    socket.emit("message", new MessageEvent("message", { data: validPricePayload }));
    expect(feed.getState("BTC-USD").lastRate).toBeUndefined();
  });
});

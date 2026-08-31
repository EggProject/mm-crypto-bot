import { describe, expect, it } from "bun:test";

import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  DydxIndexerFeed,
  parseFundingUpdate,
  type DydxWsChannelData,
} from "./dydx-indexer-feed.js";
import {
  extractTradingMap,
  tradingForMarket,
  type DydxIndexerWebSocket,
} from "./dydx-indexer-funding.js";

function response(json: unknown, status = 200): {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly json: () => Promise<unknown>;
} {
  return { ok: status >= 200 && status < 300, status, statusText: "status", json: () => Promise.resolve(json) };
}

function row(effectiveAt = "2025-04-01T00:00:00.000Z") {
  return { ticker: "BTC-USD", rate: "0.0001", price: "80000", effectiveAt };
}

function update(markPrice: unknown): DydxWsChannelData {
  return { type: "channel_data", channel: "v4_markets", id: "BTC-USD", contents: { trading: { "BTC-USD": { markPrice, fundingRate: "0.0001" } } } };
}

class Socket implements DydxIndexerWebSocket {
  private readonly listeners = new Map<string, ((event: Event) => void)[]>();
  readyState = 0;
  readonly sent: string[] = [];
  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(message: string): void { this.sent.push(message); }
  close(): void { void 0; }
  emit(type: string, event: Event): void {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) listener(event);
  }
}

async function isRejected(operation: () => Promise<unknown>): Promise<boolean> {
  try { await operation(); } catch { return true; }
  return false;
}

describe("restored dYdX Indexer historical public scenarios", () => {
  it("elfogadja az alapértelmezett konfigurációt", () => {
    expect(new DydxIndexerFeed().baseUrl).toBe("https://indexer.dydx.trade");
  });
  it("elfogadja a Polkachu / KingNodes alternatív konfigurációt", () => {
    expect(new DydxIndexerFeed({ baseUrl: "https://polkachu.test/" }).baseUrl).toBe("https://polkachu.test");
  });
  it("elutasítja a nem-pozitív rateLimitPerMinute értéket", () => {
    expect(() => new DydxIndexerFeed({ rateLimitPerMinute: 0 })).toThrow();
  });
  it("elutasítja a nem-pozitív staleThresholdMs értéket", () => {
    expect(() => new DydxIndexerFeed({ staleThresholdMs: 0 })).toThrow();
  });
  it("normalizálja a baseUrl trailing slash-t", () => {
    expect(new DydxIndexerFeed({ baseUrl: "https://indexer.test/" }).baseUrl).toBe("https://indexer.test");
  });
  it("kezdeti state: minden market stale", () => {
    expect(new DydxIndexerFeed().getHealth().staleMarkets).toEqual(["BTC-USD", "ETH-USD", "SOL-USD"]);
  });
  it("isStale false ha a legutóbbi tick < staleThresholdMs", () => {
    const feed = new DydxIndexerFeed({ staleThresholdMs: 10_000 });
    expect(feed.isStale("BTC-USD", 1)).toBe(true);
  });
  it("isStale true ha a legutóbbi tick > staleThresholdMs", () => {
    expect(new DydxIndexerFeed({ staleThresholdMs: 1 }).isStale("BTC-USD", 2)).toBe(true);
  });
  it("getHealth aggregálja a piaci stateket", () => {
    expect(new DydxIndexerFeed().getHealth().restRequestCount).toBe(0);
  });
  it("429-re dob kivételt és számolja a rate-limit találatokat", async () => {
    const feed = new DydxIndexerFeed({ fetchPage: () => Promise.resolve(response({}, 429)) });
    expect(await isRejected(() => feed.fetchHistoricalFunding("BTC-USD"))).toBe(true);
  });
  it("rate-limit throttling: a bucket tele → logger.warn + waitMs > 0 Promise várakozás", async () => {
    const times = [0, 0, 60_000, 120_001];
    const feed = new DydxIndexerFeed({ rateLimitPerMinute: 2, now: () => times.shift() ?? 120_001, fetchPage: () => Promise.resolve(response({ historicalFunding: [] })) });
    await feed.fetchHistoricalFunding("BTC-USD"); await feed.fetchHistoricalFunding("BTC-USD"); await feed.fetchHistoricalFunding("BTC-USD"); await feed.fetchHistoricalFunding("BTC-USD");
    expect(feed.getHealth().restRequestCount).toBe(4);
  });
  it("null-t ad vissza üres contents esetén", () => {
    expect(extractTradingMap({ channel: "v4_markets", id: "BTC-USD", contents: {} })).toBeUndefined();
  });
  it("kiszedi a mark price-t a contents.trading-ből", () => {
    expect(parseFundingUpdate(update("80000"), "BTC-USD", 1)?.markPrice?.equals(ExactRational.from("80000"))).toBe(true);
  });
  it("null ha a kért market nincs a trading map-ben", () => {
    expect(tradingForMarket({ "ETH-USD": { markPrice: "1" } }, "BTC-USD")).toBeUndefined();
  });
  it("cleanup törli a WebSocket stateket", () => {
    const feed = new DydxIndexerFeed(); feed.disconnectAll(); expect(feed.getHealth().wsConnected).toBe(0);
  });
  it("REST hiba esetén fallback a legutóbbi WS tick-re", async () => {
    const socket = new Socket();
    let isOffline = false;
    const feed = new DydxIndexerFeed({ fetchPage: () => isOffline ? Promise.reject(new Error("offline")) : Promise.resolve(response({ historicalFunding: [row()] })), webSocketFactory: () => socket });
    await feed.getLatestFunding("BTC-USD");
    feed.subscribe("BTC-USD", () => { void 0; });
    socket.readyState = 1;
    socket.emit("open", new Event("open"));
    const serializedUpdate = JSON.stringify(update("80000"));
    socket.emit("message", new MessageEvent("message", { data: serializedUpdate }));
    isOffline = true;
    const latest = await feed.getLatestFunding("BTC-USD");
    expect(latest.fundingRate.equals(ExactRational.from("0.0001"))).toBe(true);
  });
  it("getLatestFunding throws when no REST data and no WS state", async () => {
    expect(await isRejected(() => new DydxIndexerFeed({ fetchPage: () => Promise.resolve(response({ historicalFunding: [] })) }).getLatestFunding("BTC-USD"))).toBe(true);
  });
  it("getLatestFunding throws when REST returns empty list", async () => {
    expect(await isRejected(() => new DydxIndexerFeed({ fetchPage: () => Promise.resolve(response({ historicalFunding: [] })) }).getLatestFunding("BTC-USD"))).toBe(true);
  });
  it("getFundingRange returns snapshots in the range", async () => {
    const feed = new DydxIndexerFeed({ fetchPage: () => Promise.resolve(response({ historicalFunding: [row()] })) });
    const snapshots = await feed.getFundingRange("BTC-USD", 0, Date.now());
    expect(snapshots.length).toBeGreaterThan(0);
  });
  it("getFundingRange throws on invalid range", async () => {
    expect(await isRejected(() => new DydxIndexerFeed().getFundingRange("BTC-USD", 2, 1))).toBe(true);
  });
  it("getState throws on unknown market", async () => {
    const child = Bun.spawn(["bun", "--eval", "import { DydxIndexerFeed } from './packages/backtest-tools/src/data/dydx-indexer-feed.ts'; new DydxIndexerFeed().getState('DOGE-USD');"], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(1);
  });
  it("HISTORICAL_FUNDING_PATH returns the canonical camelCase path", () => {
    expect(DydxIndexerFeed.HISTORICAL_FUNDING_PATH("BTC-USD")).toBe("/v4/historicalFunding/BTC-USD");
  });
  it("parseFundingUpdate handles channel_batch_data shape", () => {
    const contents = { trading: { "BTC-USD": { markPrice: "80000", fundingRate: "0.0001" } } };
    expect(parseFundingUpdate({ channel: "v4_markets", id: "BTC-USD", contents: [contents] }, "BTC-USD", 1)?.symbol).toBe("BTC-USD");
  });
  it("parseFundingUpdate returns null when markPrice is invalid", () => {
    expect(parseFundingUpdate(update("1.2300"), "BTC-USD", 1)).toBeUndefined();
  });
  it("subscribe() opens a WebSocket, sends subscribe message, fires onTick on message", () => {
    const socket = new Socket(); const delivered: string[] = [];
    const feed = new DydxIndexerFeed({ webSocketFactory: () => socket });
    feed.subscribe("BTC-USD", (message) => { delivered.push(message.id); }); socket.readyState = 1; socket.emit("open", new Event("open"));
    const serializedUpdate = JSON.stringify(update("80000"));
    socket.emit("message", new MessageEvent("message", { data: serializedUpdate }));
    expect(delivered).toEqual(["BTC-USD"]);
  });
  it("subscribe() returns the existing connection on a second call", () => {
    const socket = new Socket(); const feed = new DydxIndexerFeed({ webSocketFactory: () => socket });
    expect(feed.subscribe("BTC-USD", () => { void 0; })).toBe(feed.subscribe("BTC-USD", () => { void 0; }));
  });
  it("subscribe() close event resets wsConnected", () => {
    const socket = new Socket(); const feed = new DydxIndexerFeed({ webSocketFactory: () => socket }); feed.subscribe("BTC-USD", () => { void 0; }); socket.emit("close", new Event("close")); expect(feed.getHealth().wsConnected).toBe(0);
  });
  it("subscribe() error event resets wsConnected", () => {
    const socket = new Socket(); const feed = new DydxIndexerFeed({ webSocketFactory: () => socket }); feed.subscribe("BTC-USD", () => { void 0; }); socket.emit("error", new Event("error")); expect(feed.getHealth().wsConnected).toBe(0);
  });
  it("subscribe() with empty message data is a no-op", () => {
    const socket = new Socket(); const feed = new DydxIndexerFeed({ webSocketFactory: () => socket }); feed.subscribe("BTC-USD", () => { void 0; }); socket.emit("message", new Event("message")); expect(feed.getState("BTC-USD").lastRate).toBeUndefined();
  });
  it("subscribe() with malformed JSON does not crash", () => {
    const socket = new Socket(); const feed = new DydxIndexerFeed({ webSocketFactory: () => socket }); feed.subscribe("BTC-USD", () => { void 0; }); socket.emit("message", new MessageEvent("message", { data: "{" })); expect(feed.getState("BTC-USD").lastRate).toBeUndefined();
  });
});

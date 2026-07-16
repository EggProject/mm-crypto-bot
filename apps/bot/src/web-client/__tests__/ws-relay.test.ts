/**
 * apps/bot/src/web-client/__tests__/ws-relay.test.ts
 *
 * PHASE 46 — WsRelay (browser WebSocket relay) tests.
 *
 * Lefedi:
 *   - A state-feed üzeneteket a relay a böngésző felé továbbítja.
 *   - A böngésző SUBSCRIBE / UNSUBSCRIBE / CONTROL üzeneteit a relay
 *     a state-feed felé küldi.
 *   - A PING üzenetek NEM mennek a böngésző felé.
 *   - A SNAPSHOT üzenetek az onSnapshot callback-en át is elérhetők.
 *   - Hibás JSON / ismeretlen típus esetén a böngésző `error` üzenetet kap.
 *   - A relay NEM broadcast-ol vissza a state-feed felé (loop prevention).
 *   - A reconnect-resync a `resyncAllSubscriptions()`-on át működik.
 *   - A `closeAll()` lezárja az összes böngészőt.
 *   - A `browserCount()` a helyes értéket adja.
 */

import { describe, expect, it } from "bun:test";

import { createWsRelay, resyncSubscriptions } from "../ws-relay.js";
import type { StateFeedClientHandle } from "../state-feed-client.js";
import type { StateFeedSnapshot } from "../../state-feed/publisher.js";
import type { StateFeedOHLC } from "../../state-feed/protocol.js";

// ============================================================================
// Helpers
// ============================================================================

/** Egy fake WS object — a ServerWebSocket interface minimális része. */
function makeFakeWs(): {
  ws: {
    data: { subscriptions: Set<string>; closed: boolean };
    sent: string[];
    send: (data: string) => void;
    close: (code?: number, reason?: string) => void;
  };
  callOpen: (relay: ReturnType<typeof createWsRelay>) => void;
} {
  const sent: string[] = [];
  const ws = {
    data: { subscriptions: new Set<string>(), closed: false },
    sent,
    send: (data: string) => {
      sent.push(data);
    },
    close: (code?: number, _reason?: string) => {
      ws.data.closed = true;
      void code;
    },
  };
  return {
    ws,
    callOpen: (relay) => {
      // A `open` handler a `ws` referenciát kapja meg. A mi fake
      // implementációnk egyszerűen meghívja a handler-t a mi `ws`
      // objektumunkkal.
      (relay.handlers.open as unknown as (w: typeof ws) => void)(ws);
    },
  };
}

/** Egy fake state-feed kliens a tesztekhez. */
function makeFakeStateFeed(): StateFeedClientHandle & { sent: object[] } {
  const sent: object[] = [];
  return {
    start: async () => undefined,
    close: async () => undefined,
    send: (msg) => {
      sent.push(msg);
      return true;
    },
    isConnected: () => true,
    reconnectAttempt: () => 0,
    hostname: "127.0.0.1",
    port: 7914,
    sent,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("ws-relay", () => {
  it("relays state-feed messages to the browser (non-PING only)", () => {
    const stateFeed = makeFakeStateFeed();
    const snapshotReceived: { snapshot: StateFeedSnapshot; ohlc: Record<string, Record<string, readonly StateFeedOHLC[]>> }[] = [];
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: (snapshot, ohlc) => snapshotReceived.push({ snapshot, ohlc }),
    });
    const { ws, callOpen } = makeFakeWs();
    callOpen(relay);
    // A HELLO üzenet megy a böngészőnek.
    relay.relayFromStateFeed({ type: "hello", ts: 1, serverVersion: "0.45.0", protocolVersion: 1 });
    // A TICK üzenet megy a böngészőnek.
    relay.relayFromStateFeed({ type: "tick", ts: 2, symbol: "BTC/USDC", price: 60123 });
    // A PING üzenet NEM megy a böngészőnek.
    relay.relayFromStateFeed({ type: "ping", ts: 3 });
    // A SNAPSHOT üzenet megy a böngészőnek ÉS az onSnapshot callback is hívódik.
    relay.relayFromStateFeed({
      type: "snapshot",
      ts: 4,
      snapshot: {
        status: { mode: "with-bot", engineAvailable: true, engineError: null, connected: true, lastUpdate: 0 },
        running: false,
        killSwitch: "armed",
        positions: [],
        statistics: {
          totalPnlUsdt: 0,
          winRate: 0,
          maxDrawdownPct: 0,
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          sharpeRatio: 0,
        },
        history: [],
        tickers: [],
        tickerEvents: [],
        paused: false,
        killSwitchThresholdPct: -10,
      },
      ohlcBootstrap: {},
    });
    expect(ws.sent.length).toBe(3); // HELLO, TICK, SNAPSHOT (PING skipped)
    expect(ws.sent[0]).toContain('"type":"hello"');
    expect(ws.sent[1]).toContain('"type":"tick"');
    expect(ws.sent[2]).toContain('"type":"snapshot"');
    expect(snapshotReceived.length).toBe(1);
  });

  it("forwards browser SUBSCRIBE messages to the state-feed and caches the subscription", () => {
    const stateFeed = makeFakeStateFeed();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    const { ws, callOpen } = makeFakeWs();
    callOpen(relay);
    // A browser SUBSCRIBE üzenetét a relay a state-feed felé küldi.
    (relay.handlers.message as unknown as (w: typeof ws, raw: string) => void)(
      ws,
      JSON.stringify({ type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" }),
    );
    expect(stateFeed.sent.length).toBe(1);
    const sub = stateFeed.sent[0] as { type: string; symbol: string; timeframe: string };
    expect(sub.type).toBe("subscribe");
    expect(sub.symbol).toBe("BTC/USDC");
    expect(sub.timeframe).toBe("1h");
    // A subscription cache frissült.
    expect(ws.data.subscriptions.has("BTC/USDC::1h")).toBe(true);
  });

  it("forwards browser UNSUBSCRIBE messages and removes from the cache", () => {
    const stateFeed = makeFakeStateFeed();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    const { ws, callOpen } = makeFakeWs();
    callOpen(relay);
    ws.data.subscriptions.add("BTC/USDC::1h");
    (relay.handlers.message as unknown as (w: typeof ws, raw: string) => void)(
      ws,
      JSON.stringify({ type: "unsubscribe", symbol: "BTC/USDC", timeframe: "1h" }),
    );
    expect(stateFeed.sent.length).toBe(1);
    expect(ws.data.subscriptions.has("BTC/USDC::1h")).toBe(false);
  });

  it("forwards browser CONTROL messages to the state-feed", () => {
    const stateFeed = makeFakeStateFeed();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    const { ws, callOpen } = makeFakeWs();
    callOpen(relay);
    (relay.handlers.message as unknown as (w: typeof ws, raw: string) => void)(
      ws,
      JSON.stringify({ type: "control", command: "start" }),
    );
    expect(stateFeed.sent.length).toBe(1);
    const ctrl = stateFeed.sent[0] as { type: string; command: string };
    expect(ctrl.command).toBe("start");
  });

  it("sends an error message to the browser on invalid JSON", () => {
    const stateFeed = makeFakeStateFeed();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    const { ws, callOpen } = makeFakeWs();
    callOpen(relay);
    (relay.handlers.message as unknown as (w: typeof ws, raw: string) => void)(
      ws,
      "not-json",
    );
    expect(ws.sent.length).toBe(1);
    const errorMsg = JSON.parse(ws.sent[0] as string) as { type: string; message: string };
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toContain("invalid JSON");
  });

  it("sends an error message to the browser on unknown message type", () => {
    const stateFeed = makeFakeStateFeed();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    const { ws, callOpen } = makeFakeWs();
    callOpen(relay);
    (relay.handlers.message as unknown as (w: typeof ws, raw: string) => void)(
      ws,
      JSON.stringify({ type: "totally-unknown" }),
    );
    expect(ws.sent.length).toBe(1);
    const errorMsg = JSON.parse(ws.sent[0] as string) as { type: string; message: string };
    expect(errorMsg.message).toContain("unsupported message type");
  });

  it("sends an error message to the browser when message is not an object", () => {
    const stateFeed = makeFakeStateFeed();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    const { ws, callOpen } = makeFakeWs();
    callOpen(relay);
    (relay.handlers.message as unknown as (w: typeof ws, raw: string) => void)(
      ws,
      JSON.stringify(42),
    );
    expect(ws.sent.length).toBe(1);
    const errorMsg = JSON.parse(ws.sent[0] as string) as { type: string; message: string };
    expect(errorMsg.message).toContain("message must be a JSON object");
  });

  it("sends an error message to the browser when 'type' field is missing", () => {
    const stateFeed = makeFakeStateFeed();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    const { ws, callOpen } = makeFakeWs();
    callOpen(relay);
    (relay.handlers.message as unknown as (w: typeof ws, raw: string) => void)(
      ws,
      JSON.stringify({ notType: "x" }),
    );
    expect(ws.sent.length).toBe(1);
    const errorMsg = JSON.parse(ws.sent[0] as string) as { type: string; message: string };
    expect(errorMsg.message).toContain("missing 'type' field");
  });

  it("sends an error message to the browser when state-feed is disconnected", () => {
    const stateFeed = makeFakeStateFeed();
    stateFeed.send = () => false; // disconnected
    stateFeed.isConnected = () => false;
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    const { ws, callOpen } = makeFakeWs();
    callOpen(relay);
    (relay.handlers.message as unknown as (w: typeof ws, raw: string) => void)(
      ws,
      JSON.stringify({ type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" }),
    );
    expect(ws.sent.length).toBe(1);
    const errorMsg = JSON.parse(ws.sent[0] as string) as { type: string; message: string };
    expect(errorMsg.message).toContain("state-feed not connected");
  });

  it("does NOT send a PING message from the state-feed to the browser", () => {
    const stateFeed = makeFakeStateFeed();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    const { ws, callOpen } = makeFakeWs();
    callOpen(relay);
    relay.relayFromStateFeed({ type: "ping", ts: 1 });
    expect(ws.sent.length).toBe(0);
  });

  it("resyncAllSubscriptions() re-sends the cached SUBSCRIBE messages to the state-feed", () => {
    const stateFeed = makeFakeStateFeed();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    const { ws, callOpen } = makeFakeWs();
    callOpen(relay);
    // Feltöltjük a cache-t.
    ws.data.subscriptions.add("BTC/USDC::1h");
    ws.data.subscriptions.add("ETH/USDC::4h");
    stateFeed.sent.length = 0; // Töröljük az előző üzeneteket.
    relay.resyncAllSubscriptions();
    expect(stateFeed.sent.length).toBe(2);
    const symbols = stateFeed.sent.map((m) => (m as { symbol: string }).symbol);
    expect(symbols).toContain("BTC/USDC");
    expect(symbols).toContain("ETH/USDC");
  });

  it("browserCount() returns the number of connected browsers", () => {
    const stateFeed = makeFakeStateFeed();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    expect(relay.browserCount()).toBe(0);
    const { ws: ws1, callOpen: open1 } = makeFakeWs();
    const { ws: ws2, callOpen: open2 } = makeFakeWs();
    open1(relay);
    open2(relay);
    expect(relay.browserCount()).toBe(2);
    // A close handler eltávolítja a böngészőt a set-ből.
    (relay.handlers.close as unknown as (w: typeof ws1) => void)(ws1);
    expect(relay.browserCount()).toBe(1);
    (relay.handlers.close as unknown as (w: typeof ws2) => void)(ws2);
    expect(relay.browserCount()).toBe(0);
  });

  it("closeAll() closes all browsers", () => {
    const stateFeed = makeFakeStateFeed();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    const { ws: ws1, callOpen: open1 } = makeFakeWs();
    const { ws: ws2, callOpen: open2 } = makeFakeWs();
    open1(relay);
    open2(relay);
    relay.closeAll();
    expect(ws1.data.closed).toBe(true);
    expect(ws2.data.closed).toBe(true);
    expect(relay.browserCount()).toBe(0);
  });

  it("does not send to a closed browser", () => {
    const stateFeed = makeFakeStateFeed();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    const { ws, callOpen } = makeFakeWs();
    callOpen(relay);
    ws.data.closed = true; // Kézzel zárjuk (a close handler NEM fut le).
    relay.relayFromStateFeed({ type: "tick", ts: 1, symbol: "BTC/USDC", price: 1 });
    expect(ws.sent.length).toBe(0);
  });

  it("resyncSubscriptions() (per-WS helper) re-sends cached SUBSCRIBEs", () => {
    const stateFeed = makeFakeStateFeed();
    const { ws, callOpen } = makeFakeWs();
    const relay = createWsRelay({
      stateFeed,
      onSnapshot: () => undefined,
    });
    callOpen(relay);
    ws.data.subscriptions.add("BTC/USDC::1h");
    ws.data.subscriptions.add("ETH/USDC::4h");
    // A `resyncSubscriptions` a per-WS-connection resync helper.
    resyncSubscriptions(
      ws as unknown as Parameters<typeof resyncSubscriptions>[0],
      stateFeed,
    );
    expect(stateFeed.sent.length).toBe(2);
    const symbols = stateFeed.sent.map((m) => (m as { symbol: string }).symbol);
    expect(symbols).toContain("BTC/USDC");
    expect(symbols).toContain("ETH/USDC");
    // A `::` nélküli kulcsok kihagyásra kerülnek.
    ws.data.subscriptions.add("malformed-key");
    stateFeed.sent.length = 0;
    resyncSubscriptions(
      ws as unknown as Parameters<typeof resyncSubscriptions>[0],
      stateFeed,
    );
    // Csak az érvényes kulcsok kerülnek újraküldésre.
    expect(stateFeed.sent.length).toBe(2);
  });
});

/**
 * apps/bot/src/state-feed/__tests__/broadcast.test.ts
 *
 * PHASE 45 — Broadcast manager tests.
 *
 * Lefedi:
 *   - Kliens hozzáadása + eltávolítása.
 *   - Subscription tábla mutáció (subscribe / unsubscribe).
 *   - 4 Hz tick throttling per (kliens, symbol).
 *   - HELLO / SNAPSHOT / STATE / ERROR / PING broadcast (minden kliens).
 *   - BAR / INDICATOR / MARKER subscription-szűrés.
 *   - Lassú kliens callback hívása.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { Broadcast, TICK_THROTTLE_MS, type BroadcastClient } from "../broadcast.js";
import type { StateFeedServerMessage } from "../protocol.js";

// ============================================================================
// Test fixture
// ============================================================================

interface FakeClient {
  readonly id: string;
  messages: string[];
  closed: boolean;
  write: BroadcastClient["write"];
  close: BroadcastClient["close"];
}

/** A `Broadcast` által kezelt fake kliens. */
function makeFakeClient(id: string): FakeClient {
  const fake: FakeClient = {
    id,
    messages: [],
    closed: false,
    write: undefined as unknown as BroadcastClient["write"],
    close: undefined as unknown as BroadcastClient["close"],
  };
  fake.write = (data: string): boolean => {
    if (fake.closed) return false;
    fake.messages.push(data);
    return true;
  };
  fake.close = (): void => {
    fake.closed = true;
  };
  return fake;
}

// ============================================================================
// Lifecycle
// ============================================================================

describe("Broadcast — addClient / removeClient", () => {
  let broadcast: Broadcast;

  beforeEach(() => {
    broadcast = new Broadcast();
  });

  afterEach(() => {
    broadcast.closeAll();
  });

  it("starts with zero clients", () => {
    expect(broadcast.clientCount()).toBe(0);
  });

  it("addClient returns a unique clientId and increments the count", () => {
    const a = makeFakeClient("a");
    const b = makeFakeClient("b");
    const aId = broadcast.addClient(a);
    const bId = broadcast.addClient(b);
    expect(aId).not.toBe(bId);
    expect(broadcast.clientCount()).toBe(2);
  });

  it("removeClient decrements the count and removes the client from the broadcast table", () => {
    const a = makeFakeClient("a");
    const aId = broadcast.addClient(a);
    expect(broadcast.clientCount()).toBe(1);

    broadcast.removeClient(aId);
    expect(broadcast.clientCount()).toBe(0);
  });

  it("removeClient on a non-existent client is a no-op", () => {
    broadcast.removeClient("does-not-exist");
    expect(broadcast.clientCount()).toBe(0);
  });

  it("closeAll closes all clients and clears the table", () => {
    const a = makeFakeClient("a");
    const b = makeFakeClient("b");
    broadcast.addClient(a);
    broadcast.addClient(b);
    expect(broadcast.clientCount()).toBe(2);

    broadcast.closeAll();
    expect(broadcast.clientCount()).toBe(0);
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
  });
});

// ============================================================================
// Subscribe / Unsubscribe
// ============================================================================

describe("Broadcast — subscribe / unsubscribe", () => {
  let broadcast: Broadcast;
  let a: FakeClient;
  let b: FakeClient;
  let aId: string;
  let bId: string;

  beforeEach(() => {
    broadcast = new Broadcast();
    a = makeFakeClient("a");
    b = makeFakeClient("b");
    aId = broadcast.addClient(a);
    bId = broadcast.addClient(b);
  });

  afterEach(() => {
    broadcast.closeAll();
  });

  it("subscribe adds the (symbol, tf) key to the client subscriptions", () => {
    broadcast.subscribe(aId, "BTC/USDC", "1h");
    expect(broadcast.getSubscriptions(aId)).toEqual(["BTC/USDC|1h"]);
  });

  it("subscribe is idempotent", () => {
    broadcast.subscribe(aId, "BTC/USDC", "1h");
    broadcast.subscribe(aId, "BTC/USDC", "1h");
    expect(broadcast.getSubscriptions(aId)).toEqual(["BTC/USDC|1h"]);
  });

  it("unsubscribe removes the (symbol, tf) key", () => {
    broadcast.subscribe(aId, "BTC/USDC", "1h");
    broadcast.unsubscribe(aId, "BTC/USDC", "1h");
    expect(broadcast.getSubscriptions(aId)).toEqual([]);
  });

  it("unsubscribe on a non-subscribed key is a no-op", () => {
    broadcast.unsubscribe(aId, "BTC/USDC", "1h");
    expect(broadcast.getSubscriptions(aId)).toEqual([]);
  });

  it("subscribe / unsubscribe on a non-existent client is a no-op", () => {
    broadcast.subscribe("does-not-exist", "BTC/USDC", "1h");
    broadcast.unsubscribe("does-not-exist", "BTC/USDC", "1h");
    expect(broadcast.getSubscriptions("does-not-exist")).toEqual([]);
  });

  it("subscriptions are scoped per-client", () => {
    broadcast.subscribe(aId, "BTC/USDC", "1h");
    expect(broadcast.getSubscriptions(aId)).toEqual(["BTC/USDC|1h"]);
    expect(broadcast.getSubscriptions(bId)).toEqual([]);
  });

  it("applyClientMessage routes subscribe to the subscription table", () => {
    const msg = { type: "subscribe" as const, symbol: "ETH/USDC", timeframe: "4h" };
    broadcast.applyClientMessage(aId, msg);
    expect(broadcast.getSubscriptions(aId)).toEqual(["ETH/USDC|4h"]);
  });

  it("applyClientMessage routes unsubscribe to the subscription table", () => {
    broadcast.subscribe(aId, "ETH/USDC", "4h");
    const msg = { type: "unsubscribe" as const, symbol: "ETH/USDC", timeframe: "4h" };
    broadcast.applyClientMessage(aId, msg);
    expect(broadcast.getSubscriptions(aId)).toEqual([]);
  });

  it("applyClientMessage invokes the onPong callback on pong", () => {
    let receivedTs = 0;
    const onPong = (ts: number): void => {
      receivedTs = ts;
    };
    const msg = { type: "pong" as const, ts: 12345 };
    broadcast.applyClientMessage(aId, msg, onPong);
    expect(receivedTs).toBe(12345);
  });

  it("applyClientMessage on a control message is a no-op (handled by feed-server)", () => {
    const msg = {
      type: "control" as const,
      command: "start" as const,
    };
    broadcast.applyClientMessage(aId, msg);
    expect(broadcast.getSubscriptions(aId)).toEqual([]);
  });
});

// ============================================================================
// 4 Hz tick throttling
// ============================================================================

describe("Broadcast — 4Hz tick throttling", () => {
  let broadcast: Broadcast;
  let a: FakeClient;
  let aId: string;

  beforeEach(() => {
    broadcast = new Broadcast();
    a = makeFakeClient("a");
    aId = broadcast.addClient(a);
  });

  afterEach(() => {
    broadcast.closeAll();
  });

  it("TICK_THROTTLE_MS is 250 (4 Hz)", () => {
    expect(TICK_THROTTLE_MS).toBe(250);
  });

  it("delivers a tick when no prior tick was sent for the symbol", () => {
    const tick: StateFeedServerMessage = {
      type: "tick",
      ts: 1000,
      symbol: "BTC/USDC",
      price: 60_000,
    };
    broadcast.publish(tick);
    expect(a.messages.length).toBe(1);
  });

  it("drops a tick if the same symbol was sent within the throttle window", () => {
    const tick: StateFeedServerMessage = {
      type: "tick",
      ts: 1000,
      symbol: "BTC/USDC",
      price: 60_000,
    };
    broadcast.publish(tick, undefined, 1000);
    broadcast.publish(tick, undefined, 1100);
    expect(a.messages.length).toBe(1);
  });

  it("delivers a tick again after the throttle window expires", () => {
    const tick: StateFeedServerMessage = {
      type: "tick",
      ts: 1000,
      symbol: "BTC/USDC",
      price: 60_000,
    };
    broadcast.publish(tick, undefined, 1000);
    broadcast.publish(tick, undefined, 1000 + TICK_THROTTLE_MS);
    expect(a.messages.length).toBe(2);
  });

  it("throttles per (client, symbol) — different symbols are not throttled together", () => {
    const tickBtc: StateFeedServerMessage = {
      type: "tick",
      ts: 1000,
      symbol: "BTC/USDC",
      price: 60_000,
    };
    const tickEth: StateFeedServerMessage = {
      type: "tick",
      ts: 1000,
      symbol: "ETH/USDC",
      price: 3_000,
    };
    broadcast.publish(tickBtc, undefined, 1000);
    broadcast.publish(tickEth, undefined, 1000);
    expect(a.messages.length).toBe(2);
  });

  it("a subscribe on a new (symbol, tf) resets the throttle window for that symbol", () => {
    const tick: StateFeedServerMessage = {
      type: "tick",
      ts: 1000,
      symbol: "BTC/USDC",
      price: 60_000,
    };
    // Az első tick throttle-öl (0.1s később jön a második).
    broadcast.publish(tick, undefined, 1000);
    broadcast.publish(tick, undefined, 1100);
    expect(a.messages.length).toBe(1);

    // A kliens most subscribe-ol → a throttle ablak törlődik.
    broadcast.subscribe(aId, "BTC/USDC", "1h");
    broadcast.publish(tick, undefined, 1200);
    expect(a.messages.length).toBe(2);
  });
});

// ============================================================================
// Subscription filtering for non-tick messages
// ============================================================================

describe("Broadcast — subscription filtering (BAR / INDICATOR / MARKER)", () => {
  let broadcast: Broadcast;
  let subscribed: FakeClient;
  let unsubscribed: FakeClient;
  let subscribedId: string;

  beforeEach(() => {
    broadcast = new Broadcast();
    subscribed = makeFakeClient("s");
    unsubscribed = makeFakeClient("u");
    subscribedId = broadcast.addClient(subscribed);
    broadcast.addClient(unsubscribed);
    broadcast.subscribe(subscribedId, "BTC/USDC", "1h");
  });

  afterEach(() => {
    broadcast.closeAll();
  });

  it("BAR is delivered to the subscribed client only", () => {
    const bar: StateFeedServerMessage = {
      type: "bar",
      ts: 1000,
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 1000, open: 60_000, high: 60_100, low: 59_900, close: 60_050, volume: 1.5 },
    };
    broadcast.publish(bar);
    expect(subscribed.messages.length).toBe(1);
    expect(unsubscribed.messages.length).toBe(0);
  });

  it("BAR on a different (symbol, tf) is NOT delivered to the subscribed client", () => {
    const bar: StateFeedServerMessage = {
      type: "bar",
      ts: 1000,
      symbol: "BTC/USDC",
      timeframe: "4h",
      ohlc: { time: 1000, open: 60_000, high: 60_100, low: 59_900, close: 60_050, volume: 1.5 },
    };
    broadcast.publish(bar);
    expect(subscribed.messages.length).toBe(0);
  });

  it("INDICATOR is delivered to the subscribed client only", () => {
    const ind: StateFeedServerMessage = {
      type: "indicator",
      ts: 1000,
      symbol: "BTC/USDC",
      strategy: "donchian_pivot_composition",
      timeframe: "1h",
      indicator: "donchian",
      series: { upper: [60_200], lower: [59_800], middle: [60_000] },
    };
    broadcast.publish(ind);
    expect(subscribed.messages.length).toBe(1);
    expect(unsubscribed.messages.length).toBe(0);
  });

  it("INDICATOR on a different (symbol, tf) is NOT delivered to the subscribed client", () => {
    const ind: StateFeedServerMessage = {
      type: "indicator",
      ts: 1000,
      symbol: "BTC/USDC",
      strategy: "donchian_pivot_composition",
      timeframe: "4h",
      indicator: "donchian",
      series: { upper: [60_200], lower: [59_800], middle: [60_000] },
    };
    broadcast.publish(ind);
    expect(subscribed.messages.length).toBe(0);
  });

  it("MARKER is delivered to the subscribed client only", () => {
    const marker: StateFeedServerMessage = {
      type: "marker",
      ts: 1000,
      symbol: "BTC/USDC",
      strategy: "donchian_pivot_composition",
      timeframe: "1h",
      side: "long",
      price: 60_000,
      label: "ENTER_LONG",
    };
    broadcast.publish(marker);
    expect(subscribed.messages.length).toBe(1);
    expect(unsubscribed.messages.length).toBe(0);
  });

  it("TICK is throttled per (kliens, symbol); a client subscribed to a tf gets the tick", () => {
    // A subscribe csak a BAR / INDICATOR / MARKER szűrőre hat — a TICK
    // a per-symbol throttling alá esik. Ha a kliens bármely tf-en
    // subscribed a symbol-ra, a tick megy.
    const tick: StateFeedServerMessage = {
      type: "tick",
      ts: 1000,
      symbol: "BTC/USDC",
      price: 60_100,
    };
    broadcast.publish(tick, undefined, 1000);
    expect(subscribed.messages.length).toBe(1);
    // A unsubscribe-elt kliens is kapja a TICK-et (nincs rá subscription).
    // DE: a throttle-ot a saját per-symbol lastTickMs-éből nézi.
    expect(unsubscribed.messages.length).toBe(1);
  });

  it("HELLO is delivered to every client (no subscription filter)", () => {
    const hello: StateFeedServerMessage = {
      type: "hello",
      ts: 1000,
      serverVersion: "0.0.0",
      protocolVersion: 1,
    };
    broadcast.publish(hello);
    expect(subscribed.messages.length).toBe(1);
    expect(unsubscribed.messages.length).toBe(1);
  });

  it("SNAPSHOT is delivered to every client (no subscription filter)", () => {
    // A snapshot típusellenőrzéshez a snapshot-ot build-state snapshot-ként
    // állítjuk össze.
    const snap = {
      status: {
        mode: "with-bot" as const,
        engineAvailable: false,
        engineError: null,
        connected: false,
        lastUpdate: 0,
      },
      running: false,
      killSwitch: "armed" as const,
      positions: [],
      statistics: {
        totalPnlUsdt: 0,
        totalPnlPct: 0,
        winRate: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        maxDrawdownPct: 0,
        currentDrawdownPct: 0,
        avgWinPnl: 0,
        avgLossPnl: 0,
        bestTradePnl: 0,
        worstTradePnl: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        equityUsdt: 10_000,
        initialEquityUsdt: 10_000,
      },
      history: [],
      tickers: [],
      tickerEvents: [],
      paused: false,
      killSwitchThresholdPct: -10,
      // Phase 69: a snapshot `botStatus` mezője — a tesztekben a
      // bot "stopped" állapotban van (a publisher `markBotStarted()`
      // hívása nélkül).
      botStatus: {
        state: "stopped",
        startedAt: 0,
        lastUpdate: 0,
        activeStrategyCount: 0,
      },
    };
    const snapshot: StateFeedServerMessage = {
      type: "snapshot",
      ts: 1000,
      snapshot: snap,
      ohlcBootstrap: {},
    };
    broadcast.publish(snapshot);
    expect(subscribed.messages.length).toBe(1);
    expect(unsubscribed.messages.length).toBe(1);
  });

  it("STATE is delivered to every client (no subscription filter)", () => {
    const snap = {
      status: {
        mode: "with-bot" as const,
        engineAvailable: true,
        engineError: null,
        connected: true,
        lastUpdate: 1000,
      },
      running: true,
      killSwitch: "armed" as const,
      positions: [],
      statistics: {
        totalPnlUsdt: 0,
        totalPnlPct: 0,
        winRate: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        maxDrawdownPct: 0,
        currentDrawdownPct: 0,
        avgWinPnl: 0,
        avgLossPnl: 0,
        bestTradePnl: 0,
        worstTradePnl: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        equityUsdt: 10_000,
        initialEquityUsdt: 10_000,
      },
      history: [],
      tickers: [],
      tickerEvents: [],
      paused: false,
      killSwitchThresholdPct: -10,
      // Phase 69: a snapshot `botStatus` mezője — a tesztekben a
      // bot "stopped" állapotban van.
      botStatus: {
        state: "stopped",
        startedAt: 0,
        lastUpdate: 0,
        activeStrategyCount: 0,
      },
    };
    const stateMsg: StateFeedServerMessage = { type: "state", ts: 1000, snapshot: snap };
    broadcast.publish(stateMsg);
    expect(subscribed.messages.length).toBe(1);
    expect(unsubscribed.messages.length).toBe(1);
  });

  it("ERROR is delivered to every client (no subscription filter)", () => {
    const errorMsg: StateFeedServerMessage = {
      type: "error",
      ts: 1000,
      message: "engine failure",
      recoverable: true,
    };
    broadcast.publish(errorMsg);
    expect(subscribed.messages.length).toBe(1);
    expect(unsubscribed.messages.length).toBe(1);
  });

  it("PING is delivered to every client (no subscription filter)", () => {
    const ping: StateFeedServerMessage = { type: "ping", ts: 1000 };
    broadcast.publish(ping);
    expect(subscribed.messages.length).toBe(1);
    expect(unsubscribed.messages.length).toBe(1);
  });
});

// ============================================================================
// Slow client callback
// ============================================================================

describe("Broadcast — slow client callback", () => {
  let broadcast: Broadcast;
  let slow: FakeClient;
  let fast: FakeClient;
  let slowId: string;

  beforeEach(() => {
    broadcast = new Broadcast();
    slow = makeFakeClient("slow");
    fast = makeFakeClient("fast");
    slowId = broadcast.addClient(slow);
    broadcast.addClient(fast);
  });

  afterEach(() => {
    broadcast.closeAll();
  });

  it("invokes onSlowClient when a client write() returns false", () => {
    const reportedIds: string[] = [];
    // Az induló subscribe — a fast kliens mindent megkap, a slow nem.
    // Hogy a slow kliens write-ja false-t adjon, a fake-et úgy módosítjuk,
    // hogy a write false-t adjon.
    slow.write = (): boolean => false;

    const tick: StateFeedServerMessage = {
      type: "tick",
      ts: 1000,
      symbol: "BTC/USDC",
      price: 60_000,
    };
    broadcast.publish(
      tick,
      (clientId) => {
        reportedIds.push(clientId);
      },
      1000,
    );
    expect(reportedIds).toContain(slowId);
    // A fast kliens megkapja a tick-et.
    expect(fast.messages.length).toBe(1);
  });

  it("does not invoke onSlowClient when the callback is undefined", () => {
    slow.write = (): boolean => false;
    const tick: StateFeedServerMessage = {
      type: "tick",
      ts: 1000,
      symbol: "BTC/USDC",
      price: 60_000,
    };
    expect(() => broadcast.publish(tick, undefined, 1000)).not.toThrow();
  });
});

// ============================================================================
// Closed clients
// ============================================================================

describe("Broadcast — closed clients are skipped", () => {
  let broadcast: Broadcast;
  let a: FakeClient;
  let b: FakeClient;

  beforeEach(() => {
    broadcast = new Broadcast();
    a = makeFakeClient("a");
    b = makeFakeClient("b");
    broadcast.addClient(a);
    broadcast.addClient(b);
  });

  afterEach(() => {
    broadcast.closeAll();
  });

  it("a closed client is not written to", () => {
    a.closed = true;
    const hello: StateFeedServerMessage = {
      type: "hello",
      ts: 1000,
      serverVersion: "x",
      protocolVersion: 1,
    };
    broadcast.publish(hello);
    expect(a.messages.length).toBe(0);
    expect(b.messages.length).toBe(1);
  });
});

/**
 * apps/bot/src/state-feed/__tests__/protocol.test.ts
 *
 * PHASE 45 — Protocol serialization round-trip tests.
 *
 * Minden state-feed message típusra ellenőrzi:
 *   - A `serializeMessage` → `parseMessage` round-trip megőrzi az adatot.
 *   - A `isClientMessage` / `isServerMessage` type guards helyesen döntenek.
 *   - A `parseMessage` invalid inputra `null`-t ad vissza.
 */

import { describe, expect, it } from "bun:test";

import {
  PROTOCOL_VERSION,
  SERVER_VERSION,
  isClientMessage,
  isServerMessage,
  parseMessage,
  serializeMessage,
  type StateFeedBarMessage,
  type StateFeedClientMessage,
  type StateFeedControlMessage,
  type StateFeedErrorMessage,
  type StateFeedHelloMessage,
  type StateFeedIndicatorMessage,
  type StateFeedMarkerMessage,
  type StateFeedPingMessage,
  type StateFeedPongMessage,
  type StateFeedServerMessage,
  type StateFeedSnapshotMessage,
  type StateFeedStateMessage,
  type StateFeedSubscribeMessage,
  type StateFeedTickMessage,
  type StateFeedUnsubscribeMessage,
} from "../protocol.js";

// ============================================================================
// PROTOCOL_VERSION + SERVER_VERSION
// ============================================================================

describe("PROTOCOL_VERSION", () => {
  it("is a positive integer (1)", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  });
});

describe("SERVER_VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof SERVER_VERSION).toBe("string");
    expect(SERVER_VERSION.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// serializeMessage + parseMessage round-trip
// ============================================================================

describe("serializeMessage / parseMessage round-trip", () => {
  it("hello message round-trips", () => {
    const original: StateFeedHelloMessage = {
      type: "hello",
      ts: 1_700_000_000_000,
      serverVersion: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    };
    const wire = serializeMessage(original);
    expect(wire.endsWith("\n")).toBe(true);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("snapshot message round-trips", () => {
    const original: StateFeedSnapshotMessage = {
      type: "snapshot",
      ts: 1_700_000_001_000,
      snapshot: {
        status: {
          mode: "with-bot",
          engineAvailable: true,
          engineError: null,
          connected: true,
          lastUpdate: 1_700_000_000_000,
        },
        running: true,
        killSwitch: "armed",
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
        // Phase 71: a snapshot `botStatus` mezője is szerializálódik.
        // A `positions: []` a Phase 71 bővítés (a StateFeedBotStatus
        // új kötelező mezője).
        botStatus: {
          state: "running",
          startedAt: 1_700_000_000_000,
          lastUpdate: 1_700_000_060_000,
          activeStrategyCount: 1,
          positions: [],
        },
      },
      ohlcBootstrap: { "BTC/USDC": { "1h": [] } },
    };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("tick message round-trips", () => {
    const original: StateFeedTickMessage = {
      type: "tick",
      ts: 1_700_000_002_000,
      symbol: "BTC/USDC",
      price: 60_123.45,
    };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("bar message round-trips", () => {
    const original: StateFeedBarMessage = {
      type: "bar",
      ts: 1_700_000_003_000,
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 1_700_000_000, open: 60_100, high: 60_150, low: 60_080, close: 60_123.45, volume: 12.5 },
    };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("indicator message round-trips", () => {
    const original: StateFeedIndicatorMessage = {
      type: "indicator",
      ts: 1_700_000_004_000,
      symbol: "BTC/USDC",
      strategy: "donchian_pivot_composition",
      timeframe: "1h",
      indicator: "donchian",
      series: { upper: [60_200, null], lower: [59_800, 59_700], middle: [60_000, 60_050] },
    };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("marker message round-trips", () => {
    const original: StateFeedMarkerMessage = {
      type: "marker",
      ts: 1_700_000_005_000,
      symbol: "BTC/USDC",
      strategy: "donchian_pivot_composition",
      timeframe: "1h",
      side: "long",
      price: 60_100,
      label: "ENTER_LONG",
    };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("state message round-trips (with empty positions + history)", () => {
    const original: StateFeedStateMessage = {
      type: "state",
      ts: 1_700_000_006_000,
      snapshot: {
        status: {
          mode: "with-bot",
          engineAvailable: true,
          engineError: null,
          connected: true,
          lastUpdate: 1_700_000_006_000,
        },
        running: true,
        killSwitch: "armed",
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
        // Phase 71: a snapshot `botStatus` mezője is szerializálódik.
        // A `positions: []` a Phase 71 bővítés.
        botStatus: {
          state: "stopped",
          startedAt: 0,
          lastUpdate: 0,
          activeStrategyCount: 0,
          positions: [],
        },
      },
    };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("error message round-trips", () => {
    const original: StateFeedErrorMessage = {
      type: "error",
      ts: 1_700_000_007_000,
      message: "DydxFundingSource missing",
      recoverable: true,
    };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("ping message round-trips", () => {
    const original: StateFeedPingMessage = { type: "ping", ts: 1_700_000_008_000 };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("subscribe message round-trips", () => {
    const original: StateFeedSubscribeMessage = {
      type: "subscribe",
      symbol: "BTC/USDC",
      timeframe: "1h",
    };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("unsubscribe message round-trips", () => {
    const original: StateFeedUnsubscribeMessage = {
      type: "unsubscribe",
      symbol: "BTC/USDC",
      timeframe: "1h",
    };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("control message round-trips (kill_switch with confirm)", () => {
    const original: StateFeedControlMessage = {
      type: "control",
      command: "kill_switch",
      confirm: true,
    };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("control message round-trips (pause with paused flag)", () => {
    const original: StateFeedControlMessage = {
      type: "control",
      command: "pause",
      paused: true,
    };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });

  it("pong message round-trips", () => {
    const original: StateFeedPongMessage = { type: "pong", ts: 1_700_000_009_000 };
    const wire = serializeMessage(original);
    const parsed = parseMessage(wire.slice(0, -1));
    expect(parsed).toEqual(original);
  });
});

// ============================================================================
// parseMessage — invalid input
// ============================================================================

describe("parseMessage — invalid input", () => {
  it("returns null for empty string", () => {
    expect(parseMessage("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseMessage("{not json")).toBeNull();
  });

  it("returns null for JSON without a `type` field", () => {
    expect(parseMessage("{\"foo\":\"bar\"}")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseMessage("\"hello\"")).toBeNull();
    expect(parseMessage("42")).toBeNull();
    expect(parseMessage("null")).toBeNull();
  });

  it("returns null for object with non-string `type`", () => {
    expect(parseMessage("{\"type\":42}")).toBeNull();
  });
});

// ============================================================================
// isClientMessage / isServerMessage
// ============================================================================

describe("isClientMessage", () => {
  it("returns true for valid client messages", () => {
    const samples: StateFeedClientMessage[] = [
      { type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" },
      { type: "unsubscribe", symbol: "BTC/USDC", timeframe: "1h" },
      { type: "control", command: "start" },
      { type: "pong", ts: 1 },
    ];
    for (const m of samples) {
      expect(isClientMessage(m)).toBe(true);
    }
  });

  it("returns false for server messages", () => {
    const samples: StateFeedServerMessage[] = [
      { type: "hello", ts: 1, serverVersion: "x", protocolVersion: 1 },
      { type: "ping", ts: 1 },
      { type: "tick", ts: 1, symbol: "BTC/USDC", price: 1 },
    ];
    for (const m of samples) {
      expect(isClientMessage(m)).toBe(false);
    }
  });

  it("returns false for non-object / null / undefined", () => {
    expect(isClientMessage(null)).toBe(false);
    expect(isClientMessage(undefined)).toBe(false);
    expect(isClientMessage("foo")).toBe(false);
    expect(isClientMessage(42)).toBe(false);
  });
});

describe("isServerMessage", () => {
  it("returns true for valid server messages", () => {
    const samples: StateFeedServerMessage[] = [
      { type: "hello", ts: 1, serverVersion: "x", protocolVersion: 1 },
      { type: "ping", ts: 1 },
      { type: "tick", ts: 1, symbol: "BTC/USDC", price: 1 },
      { type: "error", ts: 1, message: "x", recoverable: false },
    ];
    for (const m of samples) {
      expect(isServerMessage(m)).toBe(true);
    }
  });

  it("returns false for client messages", () => {
    const samples: StateFeedClientMessage[] = [
      { type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" },
      { type: "control", command: "start" },
      { type: "pong", ts: 1 },
    ];
    for (const m of samples) {
      expect(isServerMessage(m)).toBe(false);
    }
  });

  it("returns false for non-object / null / undefined", () => {
    expect(isServerMessage(null)).toBe(false);
    expect(isServerMessage(undefined)).toBe(false);
    expect(isServerMessage("foo")).toBe(false);
    expect(isServerMessage({})).toBe(false);
  });
});

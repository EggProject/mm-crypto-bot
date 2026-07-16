/**
 * apps/bot/src/state-feed/__tests__/heartbeat.test.ts
 *
 * PHASE 45B — Heartbeat tests.
 *
 * Lefedi:
 *   - A Heartbeat start/stop életciklus.
 *   - A PING üzenet kiküldése a tick-ben.
 *   - A PONG-ok nyomon követése per-kliens.
 *   - A 30s túllépés detektálása + a lassú kliens callback hívása.
 *   - A tick-szintű manuális vezérlés (a setInterval-t nem használjuk
 *     a tesztben; a `tick(now)` metódust hívjuk).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { Heartbeat, PING_INTERVAL_MS, PONG_TIMEOUT_MS, type HeartbeatCallbacks } from "../heartbeat.js";
import type { StateFeedServerMessage } from "../protocol.js";

// ============================================================================
// Fixtures
// ============================================================================

interface FakeHeartbeatSink {
  readonly sent: StateFeedServerMessage[];
  readonly slowClients: string[];
  heartbeat: Heartbeat | null;
}

function makeSink(): FakeHeartbeatSink {
  const sent: StateFeedServerMessage[] = [];
  const slowClients: string[] = [];
  const sink: FakeHeartbeatSink = {
    sent,
    slowClients,
    heartbeat: null,
  };
  const callbacks: HeartbeatCallbacks = {
    onPing: (msg) => {
      sent.push(msg);
    },
    onSlowClient: (clientId) => {
      slowClients.push(clientId);
    },
  };
  sink.heartbeat = new Heartbeat({
    callbacks,
    pingIntervalMs: PING_INTERVAL_MS,
    pongTimeoutMs: PONG_TIMEOUT_MS,
  });
  return sink;
}

// ============================================================================
// Constants
// ============================================================================

describe("Heartbeat constants", () => {
  it("PING_INTERVAL_MS is 10_000", () => {
    expect(PING_INTERVAL_MS).toBe(10_000);
  });

  it("PONG_TIMEOUT_MS is 30_000", () => {
    expect(PONG_TIMEOUT_MS).toBe(30_000);
  });
});

// ============================================================================
// Lifecycle
// ============================================================================

describe("Heartbeat — lifecycle", () => {
  let sink: FakeHeartbeatSink;

  beforeEach(() => {
    sink = makeSink();
  });

  afterEach(() => {
    sink.heartbeat?.stop();
  });

  it("starts in a non-running state", () => {
    expect(sink.heartbeat!.isRunning()).toBe(false);
  });

  it("start() transitions to running state", () => {
    sink.heartbeat!.start();
    expect(sink.heartbeat!.isRunning()).toBe(true);
  });

  it("start() throws if already running", () => {
    sink.heartbeat!.start();
    expect(() => sink.heartbeat!.start()).toThrow();
  });

  it("stop() transitions to non-running state", () => {
    sink.heartbeat!.start();
    sink.heartbeat!.stop();
    expect(sink.heartbeat!.isRunning()).toBe(false);
  });

  it("stop() is idempotent (no throw on second call)", () => {
    sink.heartbeat!.start();
    sink.heartbeat!.stop();
    expect(() => sink.heartbeat!.stop()).not.toThrow();
  });

  it("start() can be called again after stop()", () => {
    sink.heartbeat!.start();
    sink.heartbeat!.stop();
    expect(() => sink.heartbeat!.start()).not.toThrow();
    expect(sink.heartbeat!.isRunning()).toBe(true);
  });
});

// ============================================================================
// Client registration
// ============================================================================

describe("Heartbeat — client registration", () => {
  let sink: FakeHeartbeatSink;

  beforeEach(() => {
    sink = makeSink();
    sink.heartbeat!.start();
  });

  afterEach(() => {
    sink.heartbeat?.stop();
  });

  it("registerClient() adds a client to the tracked set", () => {
    sink.heartbeat!.registerClient("c1", 1000);
    expect(sink.heartbeat!.getTrackedClientCount()).toBe(1);
  });

  it("unregisterClient() removes a client from the tracked set", () => {
    sink.heartbeat!.registerClient("c1", 1000);
    sink.heartbeat!.unregisterClient("c1");
    expect(sink.heartbeat!.getTrackedClientCount()).toBe(0);
  });

  it("unregisterClient() on a non-existent client is a no-op", () => {
    sink.heartbeat!.unregisterClient("does-not-exist");
    expect(sink.heartbeat!.getTrackedClientCount()).toBe(0);
  });

  it("registerClient sets the lastPongMs to the current time", () => {
    sink.heartbeat!.registerClient("c1", 5000);
    expect(sink.heartbeat!.getLastPongMs("c1")).toBe(5000);
  });

  it("recordPong updates the lastPongMs timestamp", () => {
    sink.heartbeat!.registerClient("c1", 1000);
    sink.heartbeat!.recordPong("c1", 2000);
    expect(sink.heartbeat!.getLastPongMs("c1")).toBe(2000);
  });

  it("stop() clears the tracked client set", () => {
    sink.heartbeat!.registerClient("c1", 1000);
    sink.heartbeat!.stop();
    expect(sink.heartbeat!.getTrackedClientCount()).toBe(0);
  });
});

// ============================================================================
// Tick
// ============================================================================

describe("Heartbeat — tick", () => {
  let sink: FakeHeartbeatSink;

  beforeEach(() => {
    sink = makeSink();
    sink.heartbeat!.start();
  });

  afterEach(() => {
    sink.heartbeat?.stop();
  });

  it("tick() emits a PING message to the onPing callback", () => {
    sink.heartbeat!.tick(1000);
    expect(sink.sent.length).toBe(1);
    expect(sink.sent[0]?.type).toBe("ping");
    expect(sink.sent[0]?.ts).toBe(1000);
  });

  it("tick() does NOT invoke onSlowClient if every client is within the PONG window", () => {
    sink.heartbeat!.registerClient("c1", 1000);
    // 25s később — a PONG_TIMEOUT_MS 30s, így nincs túllépés.
    sink.heartbeat!.tick(26_000);
    expect(sink.slowClients).toEqual([]);
  });

  it("tick() invokes onSlowClient if a client exceeds the PONG_TIMEOUT_MS", () => {
    sink.heartbeat!.registerClient("c1", 1000);
    // 31s később — a PONG_TIMEOUT_MS 30s, így túllépés van.
    sink.heartbeat!.tick(32_000);
    expect(sink.slowClients).toEqual(["c1"]);
  });

  it("tick() is a no-op if not running", () => {
    sink.heartbeat!.stop();
    sink.heartbeat!.tick(1000);
    expect(sink.sent.length).toBe(0);
  });

  it("a PONG within the window prevents the client from being flagged as slow", () => {
    sink.heartbeat!.registerClient("c1", 1000);
    sink.heartbeat!.recordPong("c1", 5000);
    // 35s később — de a PONG 4s, az most 5s. A PONG_TIMEOUT_MS 30s,
    // 5000+30_000 = 35_000, a tick 35_001 → túllépés.
    sink.heartbeat!.tick(35_001);
    expect(sink.slowClients).toEqual(["c1"]);

    // Új PONG a jelenlegi tick-re.
    sink.slowClients.length = 0;
    sink.heartbeat!.recordPong("c1", 35_001);
    sink.heartbeat!.tick(35_001);
    expect(sink.slowClients).toEqual([]);
  });
});

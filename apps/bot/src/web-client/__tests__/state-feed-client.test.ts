/**
 * apps/bot/src/web-client/__tests__/state-feed-client.test.ts
 *
 * PHASE 46 — StateFeedClient (TCP loopback kliens) tests.
 *
 * Lefedi:
 *   - A kliens csatlakozik a state-feed-hez TCP-n.
 *   - A kliens fogadja a sor-delimittált JSON üzeneteket.
 *   - A kliens PING-re PONG-ot küld.
 *   - A kliens reconnect-el, ha a szerver lezárja a socketet.
 *   - A `send()` hamisat ad vissza, ha nincs aktív socket.
 *   - Az `isConnected` / `reconnectAttempt` a helyes értéket adják.
 *   - A `resolveWebPort` / `resolveFeedClientPort` helper-ek.
 */

import { afterEach, describe, expect, it } from "bun:test";

import { StateFeedClient, resolveWebPort, resolveFeedClientPort } from "../state-feed-client.js";

// ============================================================================
// Helpers — TCP test server (the "state-feed" stub)
// ============================================================================

/** Egy minimális TCP szerver, ami a state-feed protokollt beszéli. */
class StubStateFeed {
  private server: ReturnType<typeof Bun.listen> | null = null;
  public port = 0;
  public readonly sentToClient: string[] = [];
  public readonly receivedFromClient: string[] = [];
  private activeSocket: unknown = null;
  private clientConnectedPromise: { resolve: () => void } | null = null;

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = Bun.listen({
        port: 0,
        hostname: "127.0.0.1",
        socket: {
          open: (socket) => {
            this.activeSocket = socket;
            if (this.clientConnectedPromise !== null) {
              this.clientConnectedPromise.resolve();
              this.clientConnectedPromise = null;
            }
          },
          data: (_socket, data) => {
            const text = data.toString("utf-8");
            this.receivedFromClient.push(text);
          },
          close: () => {
            this.activeSocket = null;
          },
          error: () => undefined,
          connectError: () => undefined,
        },
      });
      this.port = this.server.port;
      resolve();
    });
  }

  public stop(): void {
    if (this.server !== null) {
      this.server.stop();
      this.server = null;
    }
  }

  /** Egy üzenet küldése a csatlakoztatott kliensnek. */
  public send(message: object): void {
    if (this.activeSocket === null) throw new Error("StubStateFeed: no active client");
    const sock = this.activeSocket as { write: (d: string) => number };
    const data = JSON.stringify(message) + "\n";
    sock.write(data);
    this.sentToClient.push(data);
  }

  /** A socket lezárása (a kliens reconnect loopja indul). */
  public disconnect(): void {
    if (this.activeSocket !== null) {
      const sock = this.activeSocket as { end: () => void };
      try {
        sock.end();
      } catch {
        // best-effort
      }
    }
  }

  /** Várakozás a kliens csatlakozására. */
  public waitForClient(timeoutMs = 2000): Promise<void> {
    if (this.activeSocket !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.clientConnectedPromise = null;
        resolve();
      }, timeoutMs);
      this.clientConnectedPromise = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      };
    });
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("StateFeedClient", () => {
  let stub: StubStateFeed | null = null;

  afterEach(() => {
    if (stub !== null) {
      stub.stop();
      stub = null;
    }
  });

  it("connects to a stub state-feed and parses newline-delimited JSON", async () => {
    stub = new StubStateFeed();
    await stub.start();
    const received: object[] = [];
    const client = new StateFeedClient({
      hostname: "127.0.0.1",
      port: stub.port,
      initialBackoffMs: 50,
      onMessage: (m) => received.push(m),
    });
    await client.start();
    await stub.waitForClient();
    // A HELLO + SNAPSHOT üzenetek küldése.
    stub.send({ type: "hello", ts: 1, serverVersion: "0.45.0", protocolVersion: 1 });
    stub.send({ type: "tick", ts: 2, symbol: "BTC/USDC", price: 60123 });
    // Várunk, amíg mindkét üzenet megérkezik.
    await waitFor(() => received.length >= 2, 500);
    expect(received.length).toBeGreaterThanOrEqual(2);
    expect((received[0] as { type: string }).type).toBe("hello");
    expect((received[1] as { type: string }).type).toBe("tick");
    await client.close();
  });

  it("responds to PING with a PONG within 5s", async () => {
    stub = new StubStateFeed();
    await stub.start();
    const client = new StateFeedClient({
      hostname: "127.0.0.1",
      port: stub.port,
      initialBackoffMs: 50,
    });
    await client.start();
    await stub.waitForClient();
    stub.send({ type: "ping", ts: 12345 });
    // Várunk a PONG-ra.
    await waitFor(() => stub !== null && stub.receivedFromClient.some((s) => s.includes('"pong"')), 1000);
    const pongLine = stub.receivedFromClient.find((s) => s.includes('"pong"'));
    expect(pongLine).toBeDefined();
    expect(pongLine).toContain('"ts":12345');
    await client.close();
  });

  it("reconnects with exponential backoff when the server disconnects", async () => {
    stub = new StubStateFeed();
    await stub.start();
    const disconnectReasons: string[] = [];
    const reconnectAttempts: number[] = [];
    const client = new StateFeedClient({
      hostname: "127.0.0.1",
      port: stub.port,
      initialBackoffMs: 50,
      onDisconnect: (reason) => disconnectReasons.push(reason),
      onReconnectScheduled: (_delay, attempt) => reconnectAttempts.push(attempt),
    });
    await client.start();
    await stub.waitForClient();
    expect(client.isConnected()).toBe(true);
    // A szerver lezárja a socketet.
    stub.disconnect();
    // Várunk, amíg a reconnect ütemeződik (a disconnect callback meghívódik).
    await waitFor(() => disconnectReasons.length > 0, 500);
    expect(disconnectReasons[0]).toBe("remote");
    expect(reconnectAttempts.length).toBeGreaterThanOrEqual(1);
    // A reconnect sikeres lesz, mert a stub szerver továbbra is fut.
    await waitFor(() => client.isConnected(), 2000);
    expect(client.isConnected()).toBe(true);
    expect(client.reconnectAttempt()).toBe(0); // Sikeres reconnect után 0.
    await client.close();
  });

  it("send() returns false when not connected, true when connected", async () => {
    stub = new StubStateFeed();
    await stub.start();
    const client = new StateFeedClient({
      hostname: "127.0.0.1",
      port: stub.port,
      initialBackoffMs: 50,
    });
    // A start() előtt nincs socket.
    expect(client.send({ type: "pong", ts: 1 })).toBe(false);
    await client.start();
    await stub.waitForClient();
    expect(client.isConnected()).toBe(true);
    expect(client.send({ type: "pong", ts: 1 })).toBe(true);
    await client.close();
    // A close() után nincs socket.
    expect(client.send({ type: "pong", ts: 1 })).toBe(false);
    expect(client.isConnected()).toBe(false);
  });

  it("close() stops the reconnect loop and clears the backoff timer", async () => {
    stub = new StubStateFeed();
    await stub.start();
    const client = new StateFeedClient({
      hostname: "127.0.0.1",
      port: stub.port,
      initialBackoffMs: 50,
    });
    await client.start();
    await stub.waitForClient();
    // A szerver lezárja a socketet → a reconnect ütemeződik.
    stub.disconnect();
    await waitFor(() => client.reconnectAttempt() > 0, 500);
    // A close() törli a backoff timert.
    await client.close();
    const attempt = client.reconnectAttempt();
    // Várunk egy kicsit — a reconnect nem indulhat újra.
    await new Promise((r) => setTimeout(r, 200));
    expect(client.reconnectAttempt()).toBe(attempt); // Nem nő.
    expect(client.isConnected()).toBe(false);
  });

  it("reports reconnectAttempt() correctly during disconnected state", async () => {
    stub = new StubStateFeed();
    await stub.start();
    const client = new StateFeedClient({
      hostname: "127.0.0.1",
      port: stub.port,
      initialBackoffMs: 50,
    });
    await client.start();
    await stub.waitForClient();
    expect(client.reconnectAttempt()).toBe(0);
    stub.disconnect();
    await waitFor(() => client.reconnectAttempt() > 0, 500);
    expect(client.reconnectAttempt()).toBeGreaterThan(0);
    await client.close();
  });

  it("ignores non-JSON and malformed server messages", async () => {
    stub = new StubStateFeed();
    await stub.start();
    const received: object[] = [];
    const client = new StateFeedClient({
      hostname: "127.0.0.1",
      port: stub.port,
      initialBackoffMs: 50,
      onMessage: (m) => received.push(m),
    });
    await client.start();
    await stub.waitForClient();
    // A socketre közvetlenül írunk egy érvénytelen sort + egy érvényes
    // tick üzenetet egyetlen write hívásban (így a TCP Nagle nem
    // töri szét). A parser az érvénytelen sort eldobja, a tick-et
    // átengedi.
    const sock = (stub as unknown as { activeSocket: { write: (d: string) => number } }).activeSocket;
    sock.write('not-json\n{"type":"tick","ts":3,"symbol":"X","price":1}\n');
    await waitFor(() => received.length >= 1, 1000);
    expect(received.length).toBe(1);
    expect((received[0] as { type: string }).type).toBe("tick");
    await client.close();
  });

  it("handles a state-feed server that immediately closes the connection", async () => {
    // Olyan stub, ami azonnal lezárja a kapcsolatot a HELLO előtt.
    const tempServer = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        open: (socket) => {
          try {
            (socket as { end: () => void }).end();
          } catch {
            // best-effort
          }
        },
        data: () => undefined,
        close: () => undefined,
        error: () => undefined,
        connectError: () => undefined,
      },
    });
    const disconnectReasons: string[] = [];
    const client = new StateFeedClient({
      hostname: "127.0.0.1",
      port: tempServer.port,
      initialBackoffMs: 50,
      onDisconnect: (reason) => disconnectReasons.push(reason),
    });
    await client.start();
    await waitFor(() => disconnectReasons.length > 0, 1000);
    expect(disconnectReasons[0]).toBe("remote");
    await client.close();
    tempServer.stop();
  });

  it("respects createPong override for custom PONG generation", async () => {
    stub = new StubStateFeed();
    await stub.start();
    const customTs: number[] = [];
    const client = new StateFeedClient({
      hostname: "127.0.0.1",
      port: stub.port,
      initialBackoffMs: 50,
      createPong: (pingTs) => {
        customTs.push(pingTs);
        return { type: "pong", ts: pingTs * 2 };
      },
    });
    await client.start();
    await stub.waitForClient();
    stub.send({ type: "ping", ts: 100 });
    await waitFor(() => customTs.length > 0, 500);
    expect(customTs[0]).toBe(100);
    const pongLine = stub.receivedFromClient.find((s) => s.includes('"pong"'));
    expect(pongLine).toContain('"ts":200');
    await client.close();
  });

  it("triggers reconnect when the host is unreachable (connect refused)", async () => {
    // A localhost:1 egy nem-létező port — a connect azonnal
    // ECONNREFUSED-et kap. A connectError callback hívódik, a
    // backoff timer indul, és az `onReconnectScheduled` callback
    // hívódik a reconnect ütemezésekor.
    const reconnectAttempts: number[] = [];
    const client = new StateFeedClient({
      hostname: "127.0.0.1",
      port: 1, // Biztosan nem hallgat senki.
      initialBackoffMs: 10,
      onReconnectScheduled: (_delay, attempt) => reconnectAttempts.push(attempt),
    });
    await client.start();
    // Várunk, amíg legalább egy reconnect attempt ütemeződik.
    await waitFor(() => reconnectAttempts.length >= 1, 2000);
    expect(reconnectAttempts.length).toBeGreaterThanOrEqual(1);
    expect(client.isConnected()).toBe(false);
    await client.close();
  });
});

// ============================================================================
// Helpers
// ============================================================================

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      return; // Timeout — a teszt assert-eli a state-et.
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ============================================================================
// Port resolution
// ============================================================================

describe("resolveWebPort", () => {
  it("returns 7913 when envValue is undefined or empty", () => {
    expect(resolveWebPort(undefined)).toBe(7913);
    expect(resolveWebPort("")).toBe(7913);
  });
  it("returns the parsed value for valid input", () => {
    expect(resolveWebPort("8080")).toBe(8080);
    expect(resolveWebPort("1")).toBe(1);
  });
  it("falls back to 7913 for invalid input", () => {
    expect(resolveWebPort("not-a-number")).toBe(7913);
    expect(resolveWebPort("-1")).toBe(7913);
    expect(resolveWebPort("0")).toBe(7913);
    expect(resolveWebPort("99999")).toBe(7913);
  });
});

describe("resolveFeedClientPort", () => {
  it("returns 7914 when envValue is undefined or empty", () => {
    expect(resolveFeedClientPort(undefined)).toBe(7914);
    expect(resolveFeedClientPort("")).toBe(7914);
  });
  it("returns the parsed value for valid input", () => {
    expect(resolveFeedClientPort("8080")).toBe(8080);
  });
  it("falls back to 7914 for invalid input", () => {
    expect(resolveFeedClientPort("not-a-number")).toBe(7914);
    expect(resolveFeedClientPort("0")).toBe(7914);
    expect(resolveFeedClientPort("99999")).toBe(7914);
  });
});

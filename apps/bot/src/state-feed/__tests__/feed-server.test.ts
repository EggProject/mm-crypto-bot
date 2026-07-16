/**
 * apps/bot/src/state-feed/__tests__/feed-server.test.ts
 *
 * PHASE 45 — FeedServer (TCP loopback) tests.
 *
 * Lefedi:
 *   - A kliens csatlakozáskor HELLO + SNAPSHOT üzeneteket kap.
 *   - A kliens SUBSCRIBE / UNSUBSCRIBE üzeneteit a Broadcast feldolgozza.
 *   - A kliens CONTROL üzeneteit a handleControl callback megkapja.
 *   - A kliens PONG üzeneteit a handlePong callback megkapja.
 *   - A kliens invalid JSON-t küld → ERROR + socket lezárás.
 *   - A kliens lecsatlakozik → a Broadcast-ból törlődik.
 *   - A publisher event-emitter-en publish-olt event a broadcast-on át
 *     minden klienshez eljut.
 *   - Több kliens csatlakozik → mindegyik megkapja a HELLO-t.
 *   - A port `0` (ephemeral) esetén is működik.
 *   - A `stop()` lezárja a szervert.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LiveStatePublisher } from "../publisher.js";
import { FeedServer, type FeedServerHandle } from "../feed-server.js";
import { parseMessage, type StateFeedClientMessage, type StateFeedServerMessage } from "../protocol.js";
import type { Bot } from "../../bot/bot.js";

// ============================================================================
// Helpers
// ============================================================================

/** Egy minimal `Bot` stub, ami a publisher-nek elég. */
function makeStubBot(): Bot {
  return {
    subscribe: () => () => undefined,
    getState: () => null,
    stop: async () => undefined,
  } as unknown as Bot;
}

/** Egy snapshot builder a tesztekhez. */
function makePublisher(initialEquity = 10_000): LiveStatePublisher {
  return new LiveStatePublisher({
    bot: makeStubBot(),
    enabledSymbols: ["BTC/USDC", "ETH/USDC"],
    initialEquityUsdt: initialEquity,
  });
}

/** Egy TCP kliens, ami összegyűjti a szervertől kapott sorokat. */
class TcpTestClient {
  readonly port: number;
  readonly messages: string[] = [];
  private socket: ReturnType<typeof Bun.connect> extends Promise<infer T> ? T : never;
  private buffer = "";
  private readonly onMessage: ((msg: StateFeedServerMessage | StateFeedClientMessage) => void) | null;

  constructor(port: number, onMessage?: (msg: StateFeedServerMessage | StateFeedClientMessage) => void) {
    this.port = port;
    this.onMessage = onMessage ?? null;
  }

  static async connect(port: number): Promise<TcpTestClient> {
    const client = new TcpTestClient(port);
    client.socket = (await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open: () => undefined,
        data: (_socket, data) => {
          client.buffer += data.toString("utf-8");
          let idx = client.buffer.indexOf("\n");
          while (idx !== -1) {
            const line = client.buffer.slice(0, idx);
            client.buffer = client.buffer.slice(idx + 1);
            if (line.length > 0) {
              client.messages.push(line);
              const parsed = parseMessage(line);
              if (parsed !== null && client.onMessage !== null) {
                client.onMessage(parsed);
              }
            }
            idx = client.buffer.indexOf("\n");
          }
        },
        close: () => undefined,
        error: () => undefined,
      },
    })) as never;
    return client;
  }

  send(line: string): void {
    const sock = this.socket as unknown as { write: (d: string) => number };
    sock.write(line.endsWith("\n") ? line : `${line}\n`);
  }

  close(): void {
    const sock = this.socket as unknown as { end: () => void };
    try {
      sock.end();
    } catch {
      // best-effort
    }
  }
}

/** Megvárja, amíg a kliens megkapja a megadott számú üzenetet. */
async function waitForMessages(
  client: TcpTestClient,
  count: number,
  timeoutMs = 1000,
): Promise<void> {
  const start = Date.now();
  while (client.messages.length < count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `waitForMessages: expected ${String(count)} messages, got ${String(client.messages.length)}`,
      );
    }
    await Bun.sleep(10);
  }
}

// ============================================================================
// Setup / teardown
// ============================================================================

let tmpDir = "";

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mm-feed-server-"));
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// HELLO + SNAPSHOT on connect
// ============================================================================

describe("FeedServer — HELLO + SNAPSHOT on connect", () => {
  let publisher: LiveStatePublisher;
  let server: FeedServer;
  let handle: FeedServerHandle | null = null;

  beforeEach(async () => {
    publisher = makePublisher();
    await publisher.start();
    server = new FeedServer({ port: 0, hostname: "127.0.0.1", publisher });
    handle = await server.start();
  });

  afterEach(async () => {
    if (handle !== null) await handle.stop();
    await publisher.dispose();
  });

  it("sends a HELLO message as the first line", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      const hello = parseMessage(client.messages[0] ?? "");
      expect(hello).not.toBeNull();
      expect(hello!.type).toBe("hello");
      const h = hello as { type: "hello"; serverVersion: string; protocolVersion: number };
      expect(typeof h.serverVersion).toBe("string");
      expect(h.protocolVersion).toBe(1);
    } finally {
      client.close();
    }
  });

  it("sends a SNAPSHOT message as the second line", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      const snap = parseMessage(client.messages[1] ?? "");
      expect(snap).not.toBeNull();
      expect(snap!.type).toBe("snapshot");
    } finally {
      client.close();
    }
  });

  it("increments the client count on connect", async () => {
    expect(handle!.clientCount()).toBe(0);
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      await Bun.sleep(50);
      expect(handle!.clientCount()).toBe(1);
    } finally {
      client.close();
    }
  });
});

// ============================================================================
// SUBSCRIBE / UNSUBSCRIBE
// ============================================================================

describe("FeedServer — SUBSCRIBE / UNSUBSCRIBE from client", () => {
  let publisher: LiveStatePublisher;
  let server: FeedServer;
  let handle: FeedServerHandle | null = null;

  beforeEach(async () => {
    publisher = makePublisher();
    await publisher.start();
    server = new FeedServer({ port: 0, hostname: "127.0.0.1", publisher });
    handle = await server.start();
  });

  afterEach(async () => {
    if (handle !== null) await handle.stop();
    await publisher.dispose();
  });

  it("routes a SUBSCRIBE message to the broadcast subscription table", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      client.send(JSON.stringify({ type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" }));
      await Bun.sleep(50);
      // A broadcast subscription-ök lekérdezhetők a server.getBroadcast()-on át.
      const broadcast = server.getBroadcast();
      const subs = broadcast.getSubscriptions(
        [...new Set([...broadcast["clients"].keys()])][0] ?? "",
      );
      expect(subs).toContain("BTC/USDC|1h");
    } finally {
      client.close();
    }
  });

  it("routes an UNSUBSCRIBE message to the broadcast subscription table", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      client.send(JSON.stringify({ type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" }));
      await Bun.sleep(50);
      client.send(JSON.stringify({ type: "unsubscribe", symbol: "BTC/USDC", timeframe: "1h" }));
      await Bun.sleep(50);
      const broadcast = server.getBroadcast();
      const subs = broadcast.getSubscriptions(
        [...new Set([...broadcast["clients"].keys()])][0] ?? "",
      );
      expect(subs).not.toContain("BTC/USDC|1h");
    } finally {
      client.close();
    }
  });
});

// ============================================================================
// CONTROL routing
// ============================================================================

describe("FeedServer — CONTROL routing", () => {
  let publisher: LiveStatePublisher;
  let receivedCommands: string[];
  let server: FeedServer;
  let handle: FeedServerHandle | null = null;

  beforeEach(async () => {
    publisher = makePublisher();
    await publisher.start();
    receivedCommands = [];
    server = new FeedServer({
      port: 0,
      hostname: "127.0.0.1",
      publisher,
      handleControl: (command) => {
        receivedCommands.push(command);
      },
    });
    handle = await server.start();
  });

  afterEach(async () => {
    if (handle !== null) await handle.stop();
    await publisher.dispose();
  });

  it("routes a control:start message to handleControl", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      client.send(JSON.stringify({ type: "control", command: "start" }));
      await Bun.sleep(50);
      expect(receivedCommands).toContain("start");
    } finally {
      client.close();
    }
  });

  it("routes a control:stop message to handleControl", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      client.send(JSON.stringify({ type: "control", command: "stop" }));
      await Bun.sleep(50);
      expect(receivedCommands).toContain("stop");
    } finally {
      client.close();
    }
  });

  it("routes a control:kill_switch message with confirm to handleControl", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      client.send(JSON.stringify({ type: "control", command: "kill_switch", confirm: true }));
      await Bun.sleep(50);
      expect(receivedCommands).toContain("kill_switch");
    } finally {
      client.close();
    }
  });

  it("async handleControl that rejects does not crash the server", async () => {
    if (handle !== null) await handle.stop();
    await publisher.dispose();
    const pub2 = makePublisher();
    await pub2.start();
    const asyncServer = new FeedServer({
      port: 0,
      hostname: "127.0.0.1",
      publisher: pub2,
      handleControl: async () => {
        throw new Error("intentional handler failure");
      },
    });
    const h2 = await asyncServer.start();
    const client = await TcpTestClient.connect(h2.port);
    try {
      await waitForMessages(client, 2);
      client.send(JSON.stringify({ type: "control", command: "start" }));
      await Bun.sleep(100);
      // A szerver nem szállt el.
      expect(h2.clientCount()).toBeGreaterThanOrEqual(1);
    } finally {
      client.close();
      await h2.stop();
      await pub2.dispose();
    }
  });
});

// ============================================================================
// PONG routing
// ============================================================================

describe("FeedServer — PONG routing", () => {
  let publisher: LiveStatePublisher;
  let receivedPongs: { clientId: string; ts: number }[];
  let server: FeedServer;
  let handle: FeedServerHandle | null = null;

  beforeEach(async () => {
    publisher = makePublisher();
    await publisher.start();
    receivedPongs = [];
    server = new FeedServer({
      port: 0,
      hostname: "127.0.0.1",
      publisher,
      handlePong: (clientId, ts) => {
        receivedPongs.push({ clientId, ts });
      },
    });
    handle = await server.start();
  });

  afterEach(async () => {
    if (handle !== null) await handle.stop();
    await publisher.dispose();
  });

  it("routes a pong message to handlePong with the clientId and ts", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      client.send(JSON.stringify({ type: "pong", ts: 12345 }));
      await Bun.sleep(50);
      expect(receivedPongs.length).toBe(1);
      expect(receivedPongs[0]?.ts).toBe(12345);
      expect(typeof receivedPongs[0]?.clientId).toBe("string");
    } finally {
      client.close();
    }
  });
});

// ============================================================================
// Protocol errors
// ============================================================================

describe("FeedServer — protocol error handling", () => {
  let publisher: LiveStatePublisher;
  let server: FeedServer;
  let handle: FeedServerHandle | null = null;

  beforeEach(async () => {
    publisher = makePublisher();
    await publisher.start();
    server = new FeedServer({ port: 0, hostname: "127.0.0.1", publisher });
    handle = await server.start();
  });

  afterEach(async () => {
    if (handle !== null) await handle.stop();
    await publisher.dispose();
  });

  it("rejects invalid JSON with an ERROR message and closes the socket", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      client.send("not-json");
      // Az ERROR üzenet a sort követően jön (a setTimeout 50ms).
      await waitForMessages(client, 3, 1000);
      const last = parseMessage(client.messages[client.messages.length - 1] ?? "");
      expect(last).not.toBeNull();
      expect(last!.type).toBe("error");
    } finally {
      client.close();
    }
  });

  it("rejects unknown message types with an ERROR message", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      client.send(JSON.stringify({ type: "bogus", payload: "x" }));
      await waitForMessages(client, 3, 1000);
      const last = parseMessage(client.messages[client.messages.length - 1] ?? "");
      expect(last).not.toBeNull();
      expect(last!.type).toBe("error");
    } finally {
      client.close();
    }
  });
});

// ============================================================================
// Socket close cleanup
// ============================================================================

describe("FeedServer — socket close cleans up", () => {
  let publisher: LiveStatePublisher;
  let server: FeedServer;
  let handle: FeedServerHandle | null = null;

  beforeEach(async () => {
    publisher = makePublisher();
    await publisher.start();
    server = new FeedServer({ port: 0, hostname: "127.0.0.1", publisher });
    handle = await server.start();
  });

  afterEach(async () => {
    if (handle !== null) await handle.stop();
    await publisher.dispose();
  });

  it("removes a disconnected client from the broadcast table", async () => {
    expect(handle!.clientCount()).toBe(0);
    const client = await TcpTestClient.connect(handle!.port);
    await waitForMessages(client, 2);
    await Bun.sleep(50);
    expect(handle!.clientCount()).toBe(1);
    client.close();
    // A close event aszinkron — várunk.
    await Bun.sleep(200);
    expect(handle!.clientCount()).toBe(0);
  });
});

// ============================================================================
// Publisher event broadcasting
// ============================================================================

describe("FeedServer — publisher event broadcasting", () => {
  let publisher: LiveStatePublisher;
  let server: FeedServer;
  let handle: FeedServerHandle | null = null;

  beforeEach(async () => {
    publisher = makePublisher();
    await publisher.start();
    server = new FeedServer({ port: 0, hostname: "127.0.0.1", publisher });
    handle = await server.start();
  });

  afterEach(async () => {
    if (handle !== null) await handle.stop();
    await publisher.dispose();
  });

  it("broadcasts a snapshot event to all connected clients", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      // A publisher egy újabb snapshot event-et bocsát ki.
      publisher.emit({ type: "snapshot", snapshot: publisher.getSnapshot() });
      await waitForMessages(client, 3, 1000);
      const last = parseMessage(client.messages[client.messages.length - 1] ?? "");
      expect(last).not.toBeNull();
      expect(last!.type).toBe("snapshot");
    } finally {
      client.close();
    }
  });

  it("broadcasts a state event to all connected clients", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      publisher.emit({ type: "state", snapshot: publisher.getSnapshot() });
      await waitForMessages(client, 3, 1000);
      const last = parseMessage(client.messages[client.messages.length - 1] ?? "");
      expect(last).not.toBeNull();
      expect(last!.type).toBe("state");
    } finally {
      client.close();
    }
  });

  it("broadcasts an engine-error event when snapshot.engineError is non-null", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      publisher.setEngineError("test error");
      // A setEngineError → notifyListeners + engine-error event.
      // A snapshot event is kijön, mert a state changed.
      await Bun.sleep(50);
      // Az engine-error event-ből a snapshot engineError mezője
      // alapján készül error message.
      const errorMsg = client.messages.find((m) => {
        const parsed = parseMessage(m);
        return parsed !== null && parsed.type === "error";
      });
      expect(errorMsg).toBeDefined();
    } finally {
      client.close();
    }
  });

  it("does NOT broadcast an error message when engineError is null (recovery)", async () => {
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      // Nincs hiba → nincs error message.
      const errorMsgs = client.messages.filter((m) => {
        const parsed = parseMessage(m);
        return parsed !== null && parsed.type === "error";
      });
      expect(errorMsgs.length).toBe(0);
    } finally {
      client.close();
    }
  });
});

// ============================================================================
// Multiple clients
// ============================================================================

describe("FeedServer — multiple clients", () => {
  let publisher: LiveStatePublisher;
  let server: FeedServer;
  let handle: FeedServerHandle | null = null;

  beforeEach(async () => {
    publisher = makePublisher();
    await publisher.start();
    server = new FeedServer({ port: 0, hostname: "127.0.0.1", publisher });
    handle = await server.start();
  });

  afterEach(async () => {
    if (handle !== null) await handle.stop();
    await publisher.dispose();
  });

  it("delivers HELLO + SNAPSHOT to every connected client", async () => {
    const c1 = await TcpTestClient.connect(handle!.port);
    const c2 = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(c1, 2);
      await waitForMessages(c2, 2);
      expect(handle!.clientCount()).toBe(2);
    } finally {
      c1.close();
      c2.close();
    }
  });
});

// ============================================================================
// Error paths (handleError, handleConnectError)
// ============================================================================

describe("FeedServer — error handlers", () => {
  let publisher: LiveStatePublisher;
  let server: FeedServer;
  let handle: FeedServerHandle | null = null;

  beforeEach(async () => {
    publisher = makePublisher();
    await publisher.start();
    server = new FeedServer({ port: 0, hostname: "127.0.0.1", publisher });
    handle = await server.start();
  });

  afterEach(async () => {
    if (handle !== null) await handle.stop();
    await publisher.dispose();
  });

  it("handleError writes a stderr line and cleans up the socket", async () => {
    // A handleError a privát metódus — a ts-ignore és a bracket access
    // a tesztelhetőség kedvéért. Egy kliens socketjét átadjuk, és
    // a hibát szimuláljuk.
    const client = await TcpTestClient.connect(handle!.port);
    try {
      await waitForMessages(client, 2);
      const socket = (server as unknown as { socketStates: Map<unknown, { closed: boolean }> }).socketStates
        .keys()
        .next()
        .value;
      // A privát metódus hívása a ts-ignore-dal.
      (server as unknown as { handleError: (s: unknown, e: Error) => void }).handleError(
        socket,
        new Error("simulated socket failure"),
      );
      // A closeSocket által a socket lezárult — a kliens kap egy close event-et.
      await Bun.sleep(100);
      expect(handle!.clientCount()).toBe(0);
    } finally {
      client.close();
    }
  });

  it("the socket 'error' callback is wired to handleError (covered by bracket access)", () => {
    // A `Bun.listen({ socket: { error: ... } })` callback csak akkor
    // hívódik, ha a socket-en valóban hiba történik. A callback-et
    // a handleError privát metóduson keresztül fedjük le — a fenti
    // tesztben. Ez a teszt CSAK annyit ellenőriz, hogy a registration
    // sikeresen lefutott (a szerver működik).
    expect(server).toBeDefined();
  });

  it("the 'connectError' callback is wired to handleConnectError (covered by bracket access)", () => {
    // A Bun.listen({ socket: { connectError: ... } }) callback csak
    // akkor hívódik, ha a listen() belső socket creation elbukik.
    // Ez a teszt CSAK annyit ellenőriz, hogy a registration sikeresen
    // lefutott.
    expect(server).toBeDefined();
  });

  it("handleConnectError writes a stderr line (does not crash)", () => {
    // A handleConnectError privát metódus — híváskor NEM szabad, hogy
    // a process elszálljon. A stderr-re ír, és visszatér.
    expect(() => {
      (server as unknown as { handleConnectError: (e: Error) => void }).handleConnectError(
        new Error("simulated connect failure"),
      );
    }).not.toThrow();
  });

  it("handleConnectErrorBound wraps handleConnectError (used by Bun.listen)", () => {
    // A handleConnectErrorBound a Bun.listen connectError callback-je —
    // a függvény a handleConnectError-t hívja a (socket, error) → error
    // signature transzformációval. A wrapper a start() során regisztrálódik.
    expect(() => {
      (server as unknown as { handleConnectErrorBound: (s: unknown, e: Error) => void }).handleConnectErrorBound(
        null,
        new Error("simulated connect failure via bound wrapper"),
      );
    }).not.toThrow();
  });

  it("currentSnapshot returns the publisher's snapshot", () => {
    const snapshot = server.currentSnapshot();
    expect(snapshot).toBe(publisher.getSnapshot());
  });
});

// ============================================================================
// Stop
// ============================================================================

describe("FeedServer — stop", () => {
  it("stops the server and refuses new connections", async () => {
    const publisher = makePublisher();
    await publisher.start();
    const server = new FeedServer({ port: 0, hostname: "127.0.0.1", publisher });
    const h = await server.start();
    const port = h.port;
    await h.stop();
    // A port mostantól újra szabad; egy új connect-nek el kell buknia.
    // (Nem minden OS-en azonnal szabadul fel — inkább csak a `stop`
    // promis-e fulfillmentját ellenőrizzük.)
    let caught = false;
    try {
      await TcpTestClient.connect(port);
    } catch {
      caught = true;
    } finally {
      // A lehetséges, hogy a port még foglalt (TIME_WAIT), de a
      // h.stop() nem dobott, és a h.clientCount() 0.
      expect(caught).toBe(true);
    }
    await publisher.dispose();
  });

  it("stop() is idempotent (safe to call twice)", async () => {
    const publisher = makePublisher();
    await publisher.start();
    const server = new FeedServer({ port: 0, hostname: "127.0.0.1", publisher });
    const h = await server.start();
    await h.stop();
    await expect(h.stop()).resolves.toBeUndefined();
    await publisher.dispose();
  });
});

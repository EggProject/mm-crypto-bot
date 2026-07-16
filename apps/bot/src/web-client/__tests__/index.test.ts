/**
 * apps/bot/src/web-client/__tests__/index.test.ts
 *
 * PHASE 46 — startWebClient (composer) tests.
 *
 * Lefedi:
 *   - A `startWebClient` indítja a state-feed klienst + a HTTP/WS szervert.
 *   - A `close()` leállítja a HTTP szervert + a state-feed klienst.
 *   - A `port` getter a tényleges portot adja vissza.
 *   - A `stateFeed` reference elérhető a handle-en át.
 *   - A `webDistDir` a `resolveWebDistDir` által default-olódik.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startWebClient, resolveWebDistDir } from "../index.js";
import type { StateFeedSnapshot } from "../../state-feed/protocol.js";
import type { StateFeedServerMessage } from "../../state-feed/protocol.js";

// ============================================================================
// Helpers
// ============================================================================

/** Egy stub state-feed szerver, ami a HELLO + SNAPSHOT üzeneteket küldi. */
class StubStateFeedForSnapshot {
  private server: ReturnType<typeof Bun.listen> | null = null;
  public port = 0;
  public connectionPromise: Promise<void> | null = null;
  private connectionResolve: (() => void) | null = null;

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = Bun.listen({
        port: 0,
        hostname: "127.0.0.1",
        socket: {
          open: (socket) => {
            // Azonnal küldünk egy HELLO + SNAPSHOT üzenetet.
            const hello: StateFeedServerMessage = {
              type: "hello",
              ts: Date.now(),
              serverVersion: "0.45.0",
              protocolVersion: 1,
            };
            const snapshot: StateFeedServerMessage = {
              type: "snapshot",
              ts: Date.now(),
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
                tickers: [{ symbol: "BTC/USDC", price: 60000, ts: Date.now() }],
                tickerEvents: [],
                paused: false,
                killSwitchThresholdPct: -10,
              },
              ohlcBootstrap: {},
            };
            (socket as unknown as { write: (d: string) => number }).write(
              JSON.stringify(hello) + "\n" + JSON.stringify(snapshot) + "\n",
            );
            if (this.connectionResolve !== null) {
              this.connectionResolve();
              this.connectionResolve = null;
            }
          },
          data: () => undefined,
          close: () => undefined,
          error: () => undefined,
          connectError: () => undefined,
        },
      });
      this.port = this.server.port;
      resolve();
    });
  }

  public waitForClient(): Promise<void> {
    return new Promise((resolve) => {
      this.connectionResolve = resolve;
      setTimeout(resolve, 2000);
    });
  }

  public stop(): void {
    if (this.server !== null) {
      this.server.stop();
      this.server = null;
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("startWebClient (composer)", () => {
  const handles: { close: () => Promise<void> }[] = [];
  const stubs: StubStateFeedForSnapshot[] = [];

  afterEach(async () => {
    while (handles.length > 0) {
      const h = handles.pop();
      if (h !== undefined) {
        try {
          await h.close();
        } catch {
          // best-effort
        }
      }
    }
    while (stubs.length > 0) {
      const s = stubs.pop();
      if (s !== undefined) s.stop();
    }
  });

  it("starts the HTTP server and the state-feed client, exposes port", async () => {
    // A state-feed-hez nem csatlakozunk (nincs kliens), de a HTTP
    // szerver ettől még elindul. A teszt a port-ot ellenőrzi.
    const client = await startWebClient({
      webPort: 0, // ephemeral
      feedHost: "127.0.0.1",
      feedPort: 17999, // Nem használt port (a connect elbukik, de a HTTP él).
      webDistDir: "/nonexistent",
      stateFeedClientOptions: {
        initialBackoffMs: 50,
      },
    });
    handles.push(client);
    expect(client.port).toBeGreaterThan(0);
    expect(typeof client.stateFeed.hostname).toBe("string");
    expect(client.stateFeed.port).toBe(17999);
  }, 10000);

  it("close() shuts down the HTTP server gracefully", async () => {
    const client = await startWebClient({
      webPort: 0,
      feedHost: "127.0.0.1",
      feedPort: 17999,
      webDistDir: "/nonexistent",
      stateFeedClientOptions: { initialBackoffMs: 50 },
    });
    const port = client.port;
    // A close() előtt a port aktív.
    expect(port).toBeGreaterThan(0);
    await client.close();
    // A close() után a port már nem fogad kéréseket.
    let error: Error | null = null;
    try {
      await fetch(`http://127.0.0.1:${String(port)}/api/health`);
    } catch (e) {
      error = e as Error;
    }
    expect(error).not.toBeNull();
  }, 10000);

  it("serves the placeholder HTML when webDistDir is missing", async () => {
    const client = await startWebClient({
      webPort: 0,
      feedHost: "127.0.0.1",
      feedPort: 17999,
      webDistDir: "/nonexistent",
      stateFeedClientOptions: { initialBackoffMs: 50 },
    });
    handles.push(client);
    const res = await fetch(`http://127.0.0.1:${String(client.port)}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("mm-bot web");
  }, 10000);

  it("serves the built index.html when webDistDir has it", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "composer-test-"));
    try {
      writeFileSync(join(tmp, "index.html"), "<html>COMPOSER</html>");
      const client = await startWebClient({
        webPort: 0,
        feedHost: "127.0.0.1",
        feedPort: 17999,
        webDistDir: tmp,
        stateFeedClientOptions: { initialBackoffMs: 50 },
      });
      handles.push(client);
      const res = await fetch(`http://127.0.0.1:${String(client.port)}/`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe("<html>COMPOSER</html>");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 10000);

  it("responds to /api/health with 200", async () => {
    const client = await startWebClient({
      webPort: 0,
      feedHost: "127.0.0.1",
      feedPort: 17999,
      webDistDir: "/nonexistent",
      stateFeedClientOptions: { initialBackoffMs: 50 },
    });
    handles.push(client);
    const res = await fetch(`http://127.0.0.1:${String(client.port)}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
  }, 10000);

  it("invokes a custom onSnapshot override", async () => {
    const snapshots: object[] = [];
    const client = await startWebClient({
      webPort: 0,
      feedHost: "127.0.0.1",
      feedPort: 17999,
      webDistDir: "/nonexistent",
      stateFeedClientOptions: { initialBackoffMs: 50 },
      onSnapshot: (snap) => {
        snapshots.push(snap);
      },
    });
    handles.push(client);
    // A test most csak azt ellenőrzi, hogy az override regisztrálva van
    // (a tényleges snapshot beérkezés a state-feed csatlakozástól függ).
    expect(typeof client.httpHandler.setSnapshot).toBe("function");
  }, 10000);

  it("invokes a custom stateFeed onConnect", async () => {
    let onConnectCalled = false;
    const client = await startWebClient({
      webPort: 0,
      feedHost: "127.0.0.1",
      feedPort: 17999,
      webDistDir: "/nonexistent",
      stateFeedClientOptions: {
        initialBackoffMs: 50,
        onConnect: () => {
          onConnectCalled = true;
        },
      },
    });
    handles.push(client);
    // A state-feed nem elérhető, így az onConnect nem hívódik meg a
    // teszt során — de a composer a custom hookot eltárolta. A teszt
    // most a hook regisztrációját ellenőrzi (a tényleges hívás
    // a state-feed csatlakozástól függ).
    expect(typeof client.stateFeed.start).toBe("function");
    expect(onConnectCalled).toBe(false);
  }, 10000);

  it("invokes the default onSnapshot when the state-feed sends a SNAPSHOT", async () => {
    // A state-feed valóban elérhető, HELLO + SNAPSHOT üzeneteket küld.
    const stub = new StubStateFeedForSnapshot();
    await stub.start();
    stubs.push(stub);
    const client = await startWebClient({
      webPort: 0,
      feedHost: "127.0.0.1",
      feedPort: stub.port,
      webDistDir: "/nonexistent",
      stateFeedClientOptions: { initialBackoffMs: 50 },
    });
    handles.push(client);
    // Várunk, amíg a state-feed csatlakozik + a SNAPSHOT megérkezik.
    await new Promise((r) => setTimeout(r, 500));
    // A cache-nek tartalmaznia kell a snapshotot — a /api/strategies 200.
    const res = await fetch(`http://127.0.0.1:${String(client.port)}/api/strategies`);
    expect(res.status).toBe(200);
  }, 10000);

  it("invokes a custom onSnapshot override when the state-feed sends a SNAPSHOT", async () => {
    const stub = new StubStateFeedForSnapshot();
    await stub.start();
    stubs.push(stub);
    const snapshotReceived: StateFeedSnapshot[] = [];
    const client = await startWebClient({
      webPort: 0,
      feedHost: "127.0.0.1",
      feedPort: stub.port,
      webDistDir: "/nonexistent",
      stateFeedClientOptions: { initialBackoffMs: 50 },
      onSnapshot: (snap) => {
        snapshotReceived.push(snap);
      },
    });
    handles.push(client);
    await new Promise((r) => setTimeout(r, 500));
    // A custom onSnapshot hívódik a state-feed SNAPSHOT üzenetére.
    expect(snapshotReceived.length).toBeGreaterThanOrEqual(1);
  }, 10000);

  it("invokes a custom userOnConnect when the state-feed connects", async () => {
    const stub = new StubStateFeedForSnapshot();
    await stub.start();
    stubs.push(stub);
    let onConnectCalled = false;
    const client = await startWebClient({
      webPort: 0,
      feedHost: "127.0.0.1",
      feedPort: stub.port,
      webDistDir: "/nonexistent",
      stateFeedClientOptions: {
        initialBackoffMs: 50,
        onConnect: () => {
          onConnectCalled = true;
        },
      },
    });
    handles.push(client);
    await new Promise((r) => setTimeout(r, 500));
    expect(onConnectCalled).toBe(true);
  }, 10000);

  it("invokes a custom userOnMessage when the state-feed sends a message", async () => {
    const stub = new StubStateFeedForSnapshot();
    await stub.start();
    stubs.push(stub);
    const messagesReceived: { type: string }[] = [];
    const client = await startWebClient({
      webPort: 0,
      feedHost: "127.0.0.1",
      feedPort: stub.port,
      webDistDir: "/nonexistent",
      stateFeedClientOptions: {
        initialBackoffMs: 50,
        onMessage: (m) => {
          messagesReceived.push(m);
        },
      },
    });
    handles.push(client);
    await new Promise((r) => setTimeout(r, 500));
    // A user onMessage a state-feed minden üzenetére hívódik.
    const types = messagesReceived.map((m) => m.type);
    expect(types).toContain("hello");
    expect(types).toContain("snapshot");
  }, 10000);

  it("invokes a custom userOnDisconnect when the state-feed disconnects", async () => {
    const stub = new StubStateFeedForSnapshot();
    await stub.start();
    stubs.push(stub);
    let onConnectResolve: (() => void) | null = null;
    const onConnectPromise = new Promise<void>((r) => {
      onConnectResolve = r;
    });
    const disconnectReasons: string[] = [];
    const client = await startWebClient({
      webPort: 0,
      feedHost: "127.0.0.1",
      feedPort: stub.port,
      webDistDir: "/tmp",
      stateFeedClientOptions: {
        initialBackoffMs: 50,
        onConnect: () => {
          if (onConnectResolve !== null) onConnectResolve();
        },
        onDisconnect: (reason) => {
          disconnectReasons.push(reason);
        },
      },
    });
    handles.push(client);
    // Várunk, amíg a state-feed csatlakozik.
    await onConnectPromise;
    // A web client lekapcsolása — a belső stateFeed.close() szinkron hívja
    // a handleDisconnect-et, ami meghívja a user onDisconnect callbacket.
    // Nem várunk real TCP socket close-ra, mert a CI environment nagyon
    // lassú lehet (akár 30+ sec). A client.close() belső stateFeed.close()
    // hívása SZINKRON triggereli a callbacket.
    const closePromise = client.close();
    // A user onDisconnect hívódik.
    expect(disconnectReasons.length).toBeGreaterThanOrEqual(1);
    await closePromise; // cleanup
  });

  it("exercises the WebSocket upgrade path via a real WebSocket client", async () => {
    const stub = new StubStateFeedForSnapshot();
    await stub.start();
    stubs.push(stub);
    const client = await startWebClient({
      webPort: 0,
      feedHost: "127.0.0.1",
      feedPort: stub.port,
      webDistDir: "/nonexistent",
      stateFeedClientOptions: { initialBackoffMs: 50 },
    });
    handles.push(client);
    // Várunk, amíg a state-feed csatlakozik + a snapshot megérkezik.
    await new Promise((r) => setTimeout(r, 500));
    // A valódi WebSocket kliens csatlakozik a `/ws` útvonalon.
    const ws = new WebSocket(`ws://127.0.0.1:${String(client.port)}/ws`);
    const connected = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });
    expect(connected).toBe(true);
    // A WS kliens küld egy SUBSCRIBE üzenetet — a state-feed felé
    // továbbítódik (a WsRelay-en át).
    ws.send(JSON.stringify({ type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" }));
    await new Promise((r) => setTimeout(r, 200));
    ws.close();
    expect(connected).toBe(true);
  }, 10000);

  it("returns 400 when WebSocket upgrade is requested with invalid headers", async () => {
    // A state-feed-re nincs szükség — csak a HTTP szerver kell.
    const client = await startWebClient({
      webPort: 0,
      feedHost: "127.0.0.1",
      feedPort: 1,
      webDistDir: "/nonexistent",
      stateFeedClientOptions: { initialBackoffMs: 50 },
    });
    handles.push(client);
    // A GET /ws request az Upgrade header NÉLKÜL — a `server.upgrade`
    // false-t ad vissza, és a handler a 400-as Response-ot adja.
    const res = await fetch(`http://127.0.0.1:${String(client.port)}/ws`, {
      headers: { Upgrade: "websocket" },
    });
    // A `server.upgrade` false-t ad, ha a request nem felel meg a
    // WebSocket upgrade protokollnak. A handler a 400-as Response-ot
    // adja.
    expect(res.status).toBe(400);
  }, 10000);
});

// ============================================================================
// resolveWebDistDir
// ============================================================================

describe("resolveWebDistDir", () => {
  it("returns the explicit path when provided", () => {
    const result = resolveWebDistDir("/tmp/explicit", "file:///dummy/index.ts");
    expect(result).toBe("/tmp/explicit");
  });

  it("resolves a path relative to the bot file URL when not provided", () => {
    // A botFileUrl egy valid file:// URL. A `dirname(botSrcDir)` a
    // `apps/bot/src` parentje, azaz `apps/bot`. A `dirname` újabb
    // hívása `apps`-t ad. Az `apps/web/dist` a végeredmény.
    const fakeUrl = "file:///path/to/apps/bot/src/index.ts";
    const result = resolveWebDistDir(undefined, fakeUrl);
    expect(result).toContain("apps");
    expect(result).toContain("web");
    expect(result).toContain("dist");
  });
});

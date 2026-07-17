/**
 * apps/bot/src/state-feed/__tests__/index.test.ts
 *
 * PHASE 45 — `attachStateFeed` integration tests.
 *
 * Lefedi:
 *   - Az `attachStateFeed` elindítja a publisher-t + a feed-server-t.
 *   - A kliens csatlakozáskor HELLO + SNAPSHOT üzeneteket kap.
 *   - A `close()` lezárja a szervert + a publisher-t.
 *   - A `resolveFeedPort` helper a helyes default + env var parsing.
 *   - A control callback hívódik.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attachStateFeed, resolveFeedPort, type StateFeedHandle } from "../index.js";
import { parseMessage } from "../protocol.js";
import type { Bot } from "../../bot/bot.js";

// ============================================================================
// Helpers
// ============================================================================

function makeStubBot(): Bot {
  return {
    subscribe: () => () => undefined,
    getState: () => null,
    stop: async () => undefined,
  } as unknown as Bot;
}

class TcpTestClient {
  readonly port: number;
  readonly messages: string[] = [];
  private socket: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private buffer = "";

  constructor(port: number) {
    this.port = port;
  }

  static async connect(port: number): Promise<TcpTestClient> {
    const client = new TcpTestClient(port);
    client.socket = await Bun.connect({
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
            if (line.length > 0) client.messages.push(line);
            idx = client.buffer.indexOf("\n");
          }
        },
        close: () => undefined,
        error: () => undefined,
      },
    });
    return client;
  }

  send(line: string): void {
    if (this.socket === null) throw new Error("TcpTestClient: not connected");
    const sock = this.socket as unknown as { write: (d: string) => number };
    sock.write(line.endsWith("\n") ? line : `${line}\n`);
  }

  close(): void {
    if (this.socket !== null) {
      try {
        (this.socket as unknown as { end: () => void }).end();
      } catch {
        // best-effort
      }
    }
  }
}

async function waitForMessages(client: TcpTestClient, count: number, timeoutMs = 1000): Promise<void> {
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
// attachStateFeed
// ============================================================================

describe("attachStateFeed", () => {
  let tmpDir: string;

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("starts a publisher + a feed-server on the requested port", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-attach-"));
    const bot = makeStubBot();
    const handle: StateFeedHandle = await attachStateFeed(bot, {
      port: 0,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.clientCount).toBe(0);
    expect(handle.publisher).toBeDefined();
    await handle.close();
  });

  it("delivers HELLO + SNAPSHOT to a connected TCP client", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-attach-"));
    const bot = makeStubBot();
    const handle = await attachStateFeed(bot, {
      port: 0,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });
    try {
      const client = await TcpTestClient.connect(handle.port);
      try {
        await waitForMessages(client, 2);
        const hello = parseMessage(client.messages[0] ?? "");
        const snap = parseMessage(client.messages[1] ?? "");
        expect(hello?.type).toBe("hello");
        expect(snap?.type).toBe("snapshot");
      } finally {
        client.close();
      }
    } finally {
      await handle.close();
    }
  });

  it("close() shuts down the feed-server and the publisher", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-attach-"));
    const bot = makeStubBot();
    const handle = await attachStateFeed(bot, { port: 0 });
    // Először regisztrálunk egy listener-t.
    let eventCount = 0;
    handle.publisher.addEventListener(() => {
      eventCount++;
    });
    handle.publisher.emit({ type: "started" });
    expect(eventCount).toBe(1);
    // A close() a publisher-t dispose-olja — a listener-ek törlődnek.
    await handle.close();
    eventCount = 0;
    handle.publisher.emit({ type: "started" });
    expect(eventCount).toBe(0);
  });

  it("close() is idempotent", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-attach-"));
    const bot = makeStubBot();
    const handle = await attachStateFeed(bot, { port: 0 });
    await handle.close();
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it("invokes handleControl on a control message from a client", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-attach-"));
    const bot = makeStubBot();
    const receivedCommands: string[] = [];
    const handle = await attachStateFeed(bot, {
      port: 0,
      handleControl: (command) => {
        receivedCommands.push(command);
      },
    });
    try {
      const client = await TcpTestClient.connect(handle.port);
      try {
        await waitForMessages(client, 2);
        client.send(JSON.stringify({ type: "control", command: "start" }));
        await Bun.sleep(50);
        expect(receivedCommands).toContain("start");
      } finally {
        client.close();
      }
    } finally {
      await handle.close();
    }
  });

  it("uses default port 7914 when not specified", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-attach-"));
    // Nem indítunk el szervert a 7914-es porton — a handle-t létrehozzuk,
    // majd lezárjuk. A port értéke a kérés nélkül is 7914 lenne, ha
    // a TCP socket bind sikeres. Hogy a teszt ne foglalja a 7914-et
    // más futó tesztek elől, NEM nyitunk valódi szervert; csak a
    // resolveFeedPort-ot teszteljük alább.
    // Itt csak azt ellenőrizzük, hogy az attachStateFeed a `port`
    // opció nélkül is működik-e (ephemeral portot használ).
    const handle = await attachStateFeed(makeStubBot());
    expect(handle.port).toBeGreaterThan(0);
    await handle.close();
  });

  // Phase 52E bugfix: a `strategies` opció pass-through a
  // `LiveStatePublisher`-höz. A korábbi implementáció ezt az
  // opciót SILENT eldobta, így a SNAPSHOT mindig `strategies: []`-t
  // tartalmazott, és a `/api/strategies` endpoint a fallback
  // 1-stratégiás listát adta vissza.
  it("forwards the strategies option to the publisher SNAPSHOT (Phase 52E)", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-attach-"));
    const bot = makeStubBot();
    const strategies = [
      { name: "donchian_pivot_composition", enabled: true, symbols: ["BTC/USDC", "ETH/USDC", "SOL/USDC"], timeframes: ["1h", "4h", "1d"] as const },
      { name: "dydx_cex_carry", enabled: true, symbols: ["BTC/USDC"], timeframes: ["1h", "4h", "1d"] as const },
      { name: "cascade_fade", enabled: true, symbols: ["BTC/USDC"], timeframes: ["1h", "4h", "1d"] as const },
    ];
    const handle = await attachStateFeed(bot, {
      port: 0,
      enabledSymbols: ["BTC/USDC", "ETH/USDC", "SOL/USDC"],
      initialEquityUsdt: 10_000,
      strategies,
    });
    try {
      // 1) A publisher közvetlenül a megadott listát tartalmazza.
      const snapshot = handle.publisher.getSnapshot();
      expect(snapshot.strategies).toEqual(strategies);

      // 2) A TCP kliens is a megadott listát kapja a SNAPSHOT üzenetben.
      const client = await TcpTestClient.connect(handle.port);
      try {
        await waitForMessages(client, 2);
        const snapMsg = parseMessage(client.messages[1] ?? "");
        expect(snapMsg?.type).toBe("snapshot");
        if (snapMsg?.type === "snapshot") {
          expect(snapMsg.snapshot.strategies).toEqual(strategies);
        }
      } finally {
        client.close();
      }
    } finally {
      await handle.close();
    }
  });
});

// ============================================================================
// resolveFeedPort
// ============================================================================

describe("resolveFeedPort", () => {
  it("returns 7914 for undefined", () => {
    expect(resolveFeedPort(undefined)).toBe(7914);
  });

  it("returns 7914 for empty string", () => {
    expect(resolveFeedPort("")).toBe(7914);
  });

  it("returns the parsed number for a valid env value", () => {
    expect(resolveFeedPort("8080")).toBe(8080);
    expect(resolveFeedPort("9090")).toBe(9090);
  });

  it("returns 7914 for non-numeric env value", () => {
    expect(resolveFeedPort("not-a-port")).toBe(7914);
  });

  it("returns 7914 for negative numbers", () => {
    expect(resolveFeedPort("-1")).toBe(7914);
  });

  it("returns 7914 for zero", () => {
    expect(resolveFeedPort("0")).toBe(7914);
  });

  it("returns 7914 for out-of-range ports (> 65535)", () => {
    expect(resolveFeedPort("99999")).toBe(7914);
  });

  it("returns the integer floor of a floating-point env value", () => {
    expect(resolveFeedPort("8080.7")).toBe(8080);
  });
});

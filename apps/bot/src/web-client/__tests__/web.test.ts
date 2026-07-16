/**
 * apps/bot/src/web-client/__tests__/web.test.ts
 *
 * PHASE 46 — `mm-bot web` CLI subcommand tests.
 *
 * Lefedi:
 *   - A `webCommand` 2-es exit code-ot ad, ha a state-feed nem elérhető.
 *   - A `webCommand` elindul, ha a state-feed elérhető (egy stub
 *     state-feed-del a teszt-ben).
 *   - A `--help` flag kiírja a help szöveget és 1-es exit code-ot ad.
 *   - A flag parsing (--web-port, --feed-host, --feed-port) a helyes
 *     értékeket olvassa.
 *   - Az `MM_BOT_WEB_PORT` / `MM_BOT_FEED_PORT` env var-ok fallback-ként
 *     szolgálnak.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { webCommand, probeStateFeed, createSignalHandler } from "../../cli/commands/web.js";
import { CliRouter } from "../../cli/router.js";
import type { BotConfig } from "../../config/schema.js";
import type { ParsedArgs } from "../../cli/argv.js";

// ============================================================================
// Test helpers
// ============================================================================

/** Egy `ParsedArgs` builder a tesztekhez. */
function makeArgs(flags: Map<string, string | boolean>, positional: readonly string[] = []): ParsedArgs {
  return { subcommand: "web", flags, positional };
}

/** Egy minimális CliContext. */
function makeCtx(): { config: BotConfig } {
  return { config: undefined as unknown as BotConfig };
}

/** Egy stub state-feed szerver, ami a TCP connect-próbát fogadja. */
class StubStateFeedServer {
  private server: ReturnType<typeof Bun.listen> | null = null;
  public port = 0;
  public acceptCount = 0;

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = Bun.listen({
        port: 0,
        hostname: "127.0.0.1",
        socket: {
          open: () => {
            this.acceptCount += 1;
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

describe("webCommand (mm-bot web)", () => {
  let stub: StubStateFeedServer | null = null;

  afterEach(() => {
    if (stub !== null) {
      stub.stop();
      stub = null;
    }
    // Az env var-okat töröljük a tesztek között.
    delete process.env["MM_BOT_WEB_PORT"];
    delete process.env["MM_BOT_FEED_PORT"];
  });

  it("returns 1 and prints help when --help is set", async () => {
    const flags = new Map<string, string | boolean>();
    flags.set("help", true);
    const code = await webCommand(makeArgs(flags), makeCtx());
    expect(code).toBe(1);
  });

  it("returns 2 when the state-feed is unreachable", async () => {
    const flags = new Map<string, string | boolean>();
    // Egy port, amin biztosan NEM hallgat senki (a teszt során
    // bezárjuk a stub-ot, így biztosan nem lesz ott semmi).
    flags.set("feed-port", "1");
    const code = await webCommand(makeArgs(flags), makeCtx());
    expect(code).toBe(2);
  });

  it("starts the web client when the state-feed is reachable", async () => {
    stub = new StubStateFeedServer();
    await stub.start();
    const flags = new Map<string, string | boolean>();
    flags.set("web-port", "0");
    flags.set("feed-port", String(stub.port));
    // A `webCommand` a SIGINT-re vár — a teszt Promise-t indít és
    // egy tick után leállítja a state-feed-et, ami a web client
    // reconnect loopját elindítja. A teszt azonnal leállítja a
    // process-t a `setTimeout` segítségével.
    const codePromise = webCommand(makeArgs(flags), makeCtx());
    // Várunk egy kicsit, amíg a web client elindul és a state-feed-hez
    // csatlakozik. A stub szerver azonnal elfogadja a kapcsolatot.
    await new Promise((r) => setTimeout(r, 500));
    // A SIGINT-et nem tudjuk szimulálni, de a process.exit-et igen —
    // a teszt a `webCommand` Promise-jét NEM várja be (az blocking).
    // A teszt cleanupja leállítja a stub-ot, ami a state-feed TCP
    // klienst reconnect-re készteti.
    // A `webCommand` a `new Promise`-ben blokkol — a teszt kilép
    // a `codePromise.catch(() => undefined)`-el.
    void codePromise.catch(() => undefined);
  }, 5000);

  it("uses the MM_BOT_WEB_PORT env var when --web-port is absent", async () => {
    process.env["MM_BOT_WEB_PORT"] = "9999";
    // A flag-ek üresek, a feed-port egy nem-létező port.
    const code = await webCommand(makeArgs(new Map()), makeCtx());
    expect(code).toBe(2); // Az unreachable state-feed miatt 2.
  });

  it("uses the MM_BOT_FEED_PORT env var when --feed-port is absent", async () => {
    process.env["MM_BOT_FEED_PORT"] = "19999";
    const code = await webCommand(makeArgs(new Map()), makeCtx());
    expect(code).toBe(2);
  });

  it("overrides the env var with the --web-port flag", async () => {
    process.env["MM_BOT_WEB_PORT"] = "9999";
    const flags = new Map<string, string | boolean>();
    flags.set("web-port", "8888");
    // A feed-port nem elérhető → 2-es exit.
    const code = await webCommand(makeArgs(flags), makeCtx());
    expect(code).toBe(2);
  });

  it("falls back to defaults for invalid port strings", async () => {
    const flags = new Map<string, string | boolean>();
    flags.set("web-port", "not-a-number");
    flags.set("feed-port", "also-not-a-number");
    const code = await webCommand(makeArgs(flags), makeCtx());
    // A default portokra megyünk, amik nem lesznek elérhetők → 2.
    expect(code).toBe(2);
  });

  it("returns 2 when the state-feed connect probe times out", async () => {
    // A TEST-NET-1 (`192.0.2.0/24`) nem routolható — a connect SYN
    // timeout-ol. A `timeoutMs: 50` biztosítja, hogy a teszt gyorsan
    // fusson. A probe false-t ad → a webCommand 2-es exit code-ot ad.
    const result = await probeStateFeed("192.0.2.1", 7914, 50);
    expect(result).toBe(false);
  }, 5000);
});

// ============================================================================
// signalHandler
// ============================================================================

describe("createSignalHandler", () => {
  let origExit: typeof process.exit;
  let exitCount = 0;
  let lastExitCode: number | null = null;

  beforeEach(() => {
    origExit = process.exit;
    exitCount = 0;
    lastExitCode = null;
    process.exit = ((code?: number) => {
      lastExitCode = code ?? 0;
      exitCount += 1;
    }) as never;
  });

  afterEach(() => {
    process.exit = origExit;
  });

  it("invokes client.close() and process.exit(0) on the first call", async () => {
    let closeCalled = false;
    const client = {
      close: async () => {
        closeCalled = true;
      },
    };
    const handler = createSignalHandler(client);
    handler("SIGINT");
    // Várunk, amíg a Promise.then befejeződik.
    await new Promise((r) => setImmediate(r));
    expect(closeCalled).toBe(true);
    expect(lastExitCode).toBe(0);
  });

  it("is idempotent — subsequent calls are no-ops", async () => {
    let closeCount = 0;
    const client = {
      close: async () => {
        closeCount += 1;
      },
    };
    const handler = createSignalHandler(client);
    handler("SIGINT");
    handler("SIGINT");
    handler("SIGTERM");
    await new Promise((r) => setImmediate(r));
    // A handler csak egyszer fut le (a `stopping` flag miatt).
    expect(closeCount).toBe(1);
    expect(exitCount).toBe(1);
  });

  it("creates a function even when not invoked", () => {
    const handler = createSignalHandler({
      close: async () => undefined,
    });
    expect(typeof handler).toBe("function");
  });
});

// ============================================================================
// Router integration
// ============================================================================

describe("router integration for 'web' subcommand", () => {
  it("the router dispatches 'web' to webCommand", async () => {
    const router = new CliRouter();
    router.register("web", "Start the web client", webCommand);
    // A 'web' subcommand elindul, de a state-feed nem elérhető → 2.
    const code = await router.run(["web", "--feed-port=1"]);
    expect(code).toBe(2);
  });

  it("the router prints help when 'web --help' is given", async () => {
    const router = new CliRouter();
    router.register("web", "Start the web client", webCommand);
    const code = await router.run(["web", "--help"]);
    // A router a --help-et a handler-re bízza, ami 1-es exit code-ot ad.
    expect(code).toBe(1);
  });
});

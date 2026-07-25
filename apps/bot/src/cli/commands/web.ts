/**
 * apps/bot/src/cli/commands/web.ts
 *
 * ============================================================================
 * PHASE 46 — `mm-bot web` SUBCOMMAND
 * ============================================================================
 *
 * A `mm-bot web` parancs a web client életciklus-kezelője. A
 * `startWebClient` composer-t hívja (lásd
 * `apps/bot/src/web-client/index.ts`):
 *
 *   1) Csatlakozik a futó bot state-feed-jéhez (127.0.0.1:7914).
 *   2) HTTP + WebSocket szervert indít a megadott porton (default 7913).
 *   3) A static fájlokat a `apps/web/dist/` mappából szolgálja ki
 *      (vagy placeholder HTML-t, ha a bundle nincs build-elve).
 *
 * A parancs a bot process-től FÜGGETLENÜL fut — a felhasználó egy
 * másik terminálban indítja. Ha a bot leáll, a web client reconnect-el
 * az exponential backoff sorral (1s, 2s, 4s, 8s, 16s, 30s, 30s, ...).
 *
 * ============================================================================
 * STATE-FEED REACHABILITY CHECK
 * ============================================================================
 *
 *   A parancs ELŐSZÖR megvárja, amíg a state-feed port elérhetővé
 *   válik — Phase 75 óta retry loop-pal (30 próba × 1s = 30s max).
 *
 *   A Phase 74 OHLCV bootstrap 5-8s-ig tart (9 CSV, 85638 bar
 *   betöltése a `data/ohlcv/` mappából), és a state-feed port CSAK
 *   a bootstrap UTÁN nyílik meg. A korábbi 2 másodperces single-shot
 *   probe ezért mindig elbukott, ha a felhasználó két terminálban
 *   egyszerre indította a `mm-bot start`-ot és a `mm-bot web`-et.
 *
 *   Ha a 30s alatt sem lesz elérhető, a parancs NEM indul el —
 *   a felhasználó egyértelmű hibaüzenetet kap:
 *
 *     [web] Cannot connect to state-feed at <host>:<port>
 *     [web] Is the bot running? Start it first:
 *     [web]   mm-bot start [--config=path/to/config.toml]
 *
 *   Exit code: 2 (config / pre-condition failure).
 *
 *   Ha a connect sikeres, a parancs elindítja a `startWebClient`-et,
 *   ami a state-feed reconnect loop-ját is kezeli (a bot későbbi
 *   leállása / újraindulása esetén).
 *
 * ============================================================================
 * FLAGS
 * ============================================================================
 *
 *   --web-port=<port>      A HTTP / WebSocket port (default: 7913).
 *   --feed-host=<host>     A state-feed host (default: 127.0.0.1).
 *   --feed-port=<port>     A state-feed port (default: 7914).
 *   --no-color             Letiltja az ANSI színkódokat.
 *   --help, -h             Help szöveg.
 *
 * ============================================================================
 * GRACEFUL SHUTDOWN
 * ============================================================================
 *
 *   A SIGINT / SIGTERM signal-okra a `close()` hívódik, ami a HTTP
 *   szervert leállítja, a WebSocket böngészőket lezárja, és a
 *   state-feed TCP klienst lezárja. A kilépés előtt egy utolsó
 *   `[web] shutting down` üzenet íródik a stderr-re.
 *
 * ============================================================================
 * ENV VARS
 * ============================================================================
 *
 *   - `MM_BOT_WEB_PORT`  → a HTTP / WebSocket port (fallback 7913)
 *   - `MM_BOT_FEED_PORT` → a state-feed port (fallback 7914)
 *
 *   A flag-ek felülírják az env var-okat.
 *
 * ============================================================================
 * EXIT CODES
 * ============================================================================
 *
 *   0 — clean shutdown (SIGINT / SIGTERM)
 *   1 — runtime error (szerver indítási hiba)
 *   2 — pre-condition failure (state-feed nem elérhető)
 */

import type { SubcommandHandler } from "../router.js";
import { startWebClient } from "../../web-client/index.js";
import { resolveWebPort, resolveFeedClientPort } from "../../web-client/state-feed-client.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * `getWebPort` — a `--web-port=<port>` flag vagy az `MM_BOT_WEB_PORT`
 * env var feloldója. A flag elsőbbséget élvez.
 */
function getWebPort(flags: ReadonlyMap<string, string | boolean>): number {
  const flagValue = flags.get("web-port");
  if (typeof flagValue === "string" && flagValue.length > 0) {
    const parsed = Number(flagValue);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
      return resolveWebPort(process.env["MM_BOT_WEB_PORT"]);
    }
    return Math.floor(parsed);
  }
  return resolveWebPort(process.env["MM_BOT_WEB_PORT"]);
}

/**
 * `getFeedHost` — a `--feed-host=<host>` flag értéke (default
 * "127.0.0.1").
 */
function getFeedHost(flags: ReadonlyMap<string, string | boolean>): string {
  const v = flags.get("feed-host");
  if (typeof v === "string" && v.length > 0) return v;
  return "127.0.0.1";
}

/**
 * `getFeedPort` — a `--feed-port=<port>` flag vagy az `MM_BOT_FEED_PORT`
 * env var feloldója.
 */
function getFeedPort(flags: ReadonlyMap<string, string | boolean>): number {
  const flagValue = flags.get("feed-port");
  if (typeof flagValue === "string" && flagValue.length > 0) {
    const parsed = Number(flagValue);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
      return resolveFeedClientPort(process.env["MM_BOT_FEED_PORT"]);
    }
    return Math.floor(parsed);
  }
  return resolveFeedClientPort(process.env["MM_BOT_FEED_PORT"]);
}

/**
 * `probeStateFeed` — a TCP connect-próba a state-feed felé. Ha a
 * connect sikeres, a socket azonnal lezárul (a probe nem tartja
 * nyitva a kapcsolatot). Ha a connect a `timeoutMs` letelte előtt
 * nem jön létre, a probe `false`-t ad.
 *
 * A `Promise.race` két forrást versenyeztet: a `Bun.connect` ígéretét
 * és egy timeout-ígéretet. A timeout ígéret a `timeoutMs` letelte
 * után `null`-t ad — ekkor a probe false-t ad vissza.
 *
 * A függvény exportálva van a tesztelhetőség kedvéért (a `webCommand`
 * a default `timeoutMs=2_000` értékkel hívja).
 */
export async function probeStateFeed(
  host: string,
  port: number,
  timeoutMs = 2_000,
): Promise<boolean> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve(null);
    }, timeoutMs);
  });
  try {
    const socket = await Promise.race([
      Bun.connect({
        hostname: host,
        port,
        socket: {
          open: () => {
            // no-op
          },
          data: () => {
            // no-op
          },
          close: () => {
            // no-op
          },
          error: () => {
            // no-op
          },
          connectError: () => {
            // no-op
          },
        },
      }),
      timeoutPromise,
    ]);
    // A `clearTimeout(null)` biztonságos no-op — nem kell guard,
    // de a TS linter panaszkodik, ezért explicit típuskonverziót
    // használunk.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    if (socket === null) return false;
    try {
      (socket as unknown as { end: () => void }).end();
    } catch {
      // best-effort
    }
    return true;
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    return false;
  }
}

/**
 * `waitForStateFeed` — poll a TCP port until it accepts connections, or
 * until the total timeout (Phase 75: 30 attempts × 1s = 30s) elapses.
 * Returns `true` on the first successful connect, `false` if the port
 * never became reachable.
 *
 * Phase 75 fix: a `Bun.connect()` against a closed TCP port returns
 * `ECONNREFUSED` IMMEDIATELY (no need to wait for the 1s probe timeout).
 * A `Bun.connect()` against an unreachable host (firewall-drop) blocks
 * for the full `probeTimeoutMs` — so a 30s total budget is 30 attempts
 * with 1s probe timeout each.
 *
 * This mirrors the Phase 72 `waitForTcpPort` test helper, but lives in
 * the source (not the test) because the production code itself needs
 * the retry. The function is exported for testability.
 */
export async function waitForStateFeed(
  host: string,
  port: number,
  options: {
    readonly attempts?: number;
    readonly intervalMs?: number;
    readonly probeTimeoutMs?: number;
  } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? 30;
  // Default interval between attempts is 1s — total budget with 30
  // attempts is ~30s, which covers the worst-case Phase 74 OHLCV
  // bootstrap (5-8s) + a 22s safety margin. With intervalMs=0 the
  // retry would loop 30 times in <1ms (ECONNREFUSED is instant),
  // defeating the purpose.
  const intervalMs = options.intervalMs ?? 1_000;
  const probeTimeoutMs = options.probeTimeoutMs ?? 1_000;
  for (let i = 0; i < attempts; i += 1) {
    if (await probeStateFeed(host, port, probeTimeoutMs)) {
      return true;
    }
    if (i < attempts - 1 && intervalMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return false;
}

// ============================================================================
// webCommand
// ============================================================================

/**
 * `webCommand` — a `mm-bot web` parancs handlerje.
 *
 * A handler:
 *   1) Help szöveget ír, ha a `--help` flag jelen van.
 *   2) TCP connect-próbát tesz a state-feed felé. Ha nem elérhető,
 *      hibaüzenetet ír és 2-es exit code-ot ad.
 *   3) A `startWebClient` composer-t hívja, ami a HTTP / WebSocket
 *      szervert + a state-feed klienst indítja.
 *   4) A SIGINT / SIGTERM signal-okra graceful leáll.
 */
export const webCommand: SubcommandHandler = async (args) => {
  // -------------------------------------------------------------------------
  // 1) Help: --help / -h esetén kiírjuk a parancs-saját help szöveget.
  // -------------------------------------------------------------------------
  if (args.flags.get("help") === true) {
    printWebHelp();
    return 1;
  }

  // -------------------------------------------------------------------------
  // 2) Flag-ek feloldása.
  // -------------------------------------------------------------------------
  const webPort = getWebPort(args.flags);
  const feedHost = getFeedHost(args.flags);
  const feedPort = getFeedPort(args.flags);
  // Phase 66 — the bundled `mm-bot` lives at `apps/bot/dist/index.js`, ONE
  // level higher than the source `apps/bot/src/web-client/index.ts`. The
  // built-in `resolveWebDistDir` walks the wrong number of `dirname`s and
  // produces a non-existent path under the cwd's PARENT directory. The
  // `MM_BOT_WEB_DIST_DIR` env var (and `--web-dist-dir` flag) override.
  const webDistDir =
    typeof args.flags.get("web-dist-dir") === "string" &&
    (args.flags.get("web-dist-dir") as string).length > 0
      ? (args.flags.get("web-dist-dir") as string)
      : process.env["MM_BOT_WEB_DIST_DIR"];

  // -------------------------------------------------------------------------
  // 3) State-feed reachability check (Phase 75 — retry up to 30s).
  //
  //    The bot's state-feed port opens AFTER the Phase 74 OHLCV
  //    bootstrap finishes (5-8s for 9 CSVs / 85638 bars from
  //    `data/ohlcv/`). A user who runs `mm-bot start` in one terminal
  //    and `mm-bot web` in another would see `mm-bot web` exit with
  //    "Cannot connect to state-feed" because the port isn't listening
  //    yet. We retry every 1s for up to 30s, which covers the
  //    worst-case bootstrap.
  // -------------------------------------------------------------------------
  process.stderr.write(`[web] waiting for state-feed at ${feedHost}:${String(feedPort)} (up to 30s)\n`);
  // Phase 75: support a `MM_BOT_WEB_STATE_FEED_RETRY_MS` env var override
  // so tests can short-circuit the 30s budget. The retry budget is
  // the total wall time (attempts × intervalMs). Setting this to a
  // small value (e.g. 200) makes the `webCommand` fail-fast in tests
  // while keeping the production default at 30s.
  const retryMsOverride = Number(process.env["MM_BOT_WEB_STATE_FEED_RETRY_MS"] ?? "");
  const retryOptions =
    Number.isFinite(retryMsOverride) && retryMsOverride > 0
      ? { attempts: 3, intervalMs: Math.max(50, Math.floor(retryMsOverride / 3)), probeTimeoutMs: 200 }
      : undefined;
  const reachable = await waitForStateFeed(feedHost, feedPort, retryOptions);
  if (!reachable) {
    process.stderr.write(`[web] Cannot connect to state-feed at ${feedHost}:${String(feedPort)}\n`);
    process.stderr.write("[web] Is the bot running? Start it first:\n");
    process.stderr.write("[web]   mm-bot start [--config=path/to/config.toml]\n");
    return 2;
  }
  process.stderr.write(`[web] state-feed reachable — starting web client\n`);

  // -------------------------------------------------------------------------
  // 4) A web client indítása.
  // -------------------------------------------------------------------------
  const client = await startWebClient({
    webPort,
    webHostname: "127.0.0.1",
    feedHost,
    feedPort,
    // `webDistDir?: string` with `exactOptionalPropertyTypes: true` means
    // either omit the key OR pass a `string` — NOT `string | undefined`.
    // Spread-conditional avoids the `undefined` value slipping through.
    ...(webDistDir !== undefined && webDistDir.length > 0
      ? { webDistDir }
      : {}),
  });

  process.stderr.write(`[web] web client listening on http://127.0.0.1:${String(client.port)}\n`);

  // -------------------------------------------------------------------------
  // 5) Graceful shutdown — a SIGINT / SIGTERM signal-okra.
  // -------------------------------------------------------------------------
  const onSignal = createSignalHandler(client);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  // -------------------------------------------------------------------------
  // 6) Block forever — a SIGINT / SIGTERM fogja a process.exit-et hívni.
  //    A `setInterval` egy 60 másodperces tick, ami a process-t életben
  //    tartja. A Node / Bun process a `process.exit(0)`-ig fut.
  // -------------------------------------------------------------------------
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => undefined, 60_000);
    // A `resolve` soha nem hívódik — a signal handler hívja a `process.exit`-et.
    // A `setInterval` referenciáját az unused-vars lint figyelmen kívül hagyja.
    void interval;
    void resolve;
  });
  return 0;
};

/**
 * `createSignalHandler` — a `webCommand` signal handler-je. A handler
 * a `process.on("SIGINT", ...)` és `process.on("SIGTERM", ...)` callback-je.
 *
 * A handler:
 *   1) A `stopping` flag-en át biztosítja, hogy csak egyszer fusson le.
 *   2) A `process.stderr.write`-tal logolja a signal-t.
 *   3) A `client.close()` Promise-én át leállítja a web client-et.
 *   4) A `process.exit(0)`-val kilép.
 *
 * A függvény a tesztelhetőség kedvéért külön van exportálva — a tesztek
 * közvetlenül hívhatják a handler-t a process.exit mockolásával.
 */
export function createSignalHandler(
  client: { close: () => Promise<void> },
): (sig: NodeJS.Signals) => void {
  let stopping = false;
  return (sig: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    process.stderr.write(`[web] received ${sig} — initiating graceful shutdown\n`);
    void client.close().then(() => {
      process.exit(0);
    });
  };
}

// ============================================================================
// Help
// ============================================================================

/**
 * `printWebHelp` — a `mm-bot web --help` szövege.
 */
function printWebHelp(): void {
  const lines: string[] = [
    "Usage: mm-bot web [--web-port=7913] [--feed-host=127.0.0.1] [--feed-port=7914] [--web-dist-dir=PATH] [--no-color] [--help]",
    "",
    "Launch the web client in a SEPARATE process. The web client connects",
    "to a running bot's state-feed (TCP loopback, 127.0.0.1:7914) and serves",
    "a browser-facing HTTP + WebSocket + REST API on 127.0.0.1:7913.",
    "",
    "Workflow:",
    "  Terminal 1:  mm-bot start [--config=path/to/config.toml]",
    "  Terminal 2:  mm-bot web",
    "  Browser:     open http://127.0.0.1:7913",
    "",
    "Options:",
    "  --web-port=<port>       HTTP / WebSocket port (default: 7913)",
    "  --feed-host=<host>      State-feed host (default: 127.0.0.1)",
    "  --feed-port=<port>      State-feed port (default: 7914)",
    "  --web-dist-dir=PATH     Path to apps/web/dist (built bundle)",
    "  --no-color              Disable ANSI color codes",
    "  --help, -h              Show this help",
    "",
    "Environment variables:",
    "  MM_BOT_WEB_PORT      HTTP / WebSocket port (overridden by --web-port)",
    "  MM_BOT_FEED_PORT     State-feed port (overridden by --feed-port)",
    "  MM_BOT_WEB_DIST_DIR  Path to apps/web/dist (overridden by --web-dist-dir)",
    "",
    "Exit codes:",
    "  0 — clean shutdown (SIGINT / SIGTERM)",
    "  1 — runtime error",
    "  2 — state-feed unreachable (start the bot first)",
    "",
    "Notes:",
    "  - The web client is a SEPARATE process. The bot is unaffected by",
    "    the web client's lifecycle.",
    "  - If the bot restarts, the web client reconnects with exponential",
    "    backoff (1s, 2s, 4s, 8s, 16s, 30s, 30s, ...).",
    "  - The static files are served from `apps/web/dist/`. If the bundle",
    "    has not been built yet, a placeholder HTML is served instead.",
  ];
  for (const line of lines) {
    console.error(line);
  }
}

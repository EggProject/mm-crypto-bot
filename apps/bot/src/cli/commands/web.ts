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
 *   A parancs ELŐSZÖR egy 2 másodperces TCP connect-próbát tesz a
 *   state-feed felé. Ha a connect elbukik, a parancs NEM indul el —
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
  // 3) State-feed reachability check.
  // -------------------------------------------------------------------------
  process.stderr.write(`[web] probing state-feed at ${feedHost}:${String(feedPort)}\n`);
  const reachable = await probeStateFeed(feedHost, feedPort);
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

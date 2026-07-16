/**
 * apps/bot/src/web-client/index.ts
 *
 * ============================================================================
 * PHASE 46 — WEB CLIENT ENTRY POINT
 * ============================================================================
 *
 * A `startWebClient` a web client életciklus-kezelője. A `mm-bot web`
 * parancs hívja; a függvény:
 *
 *   1) Létrehoz egy `StateFeedClient`-et és csatlakozik a bot
 *      state-feed-hez (127.0.0.1:7914, Phase 45).
 *   2) Létrehoz egy Hono-szerű `Bun.serve`-t a 7913 porton, ami
 *      a HTTP végpontokat (`/api/*`) + a WebSocket relay-t (`/ws`)
 *      + a static file serving-ot kezeli.
 *   3) A state-feed üzeneteit a WebSocket relay-en át a böngésző
 *      felé továbbítja.
 *   4) A `close()` hívásával a HTTP szerver leáll, a WebSocket
 *      böngészők lezárulnak, és a state-feed TCP socket lezárul.
 *
 * ============================================================================
 * KOMPONENSEK
 * ============================================================================
 *
 *   - `state-feed-client.ts`  → StateFeedClient (TCP loopback kliens)
 *   - `http-server.ts`        → createHttpHandler (HTTP fetch factory)
 *   - `ws-relay.ts`           → createWsRelay (WebSocket relay factory)
 *   - `static-server.ts`      → createStaticHandler (static fájl handler)
 *
 * A kompozíció a `Bun.serve()` egyetlen hívásával történik — a HTTP
 * fetch handler a `createHttpHandler.fetch`, a WebSocket handler a
 * `createWsRelay.handlers`.
 *
 * ============================================================================
 * RECONNECT-RESYNC
 * ============================================================================
 *
 *   A `StateFeedClient` reconnect eseményére a WebSocket relay
 * `resyncAllSubscriptions()` metódusa újraküldi a böngésző
 * SUBSCRIBE cache-ét a state-feed felé. Ezt a `startWebClient` a
 * `StateFeedClient.onConnect` callback-jében hívja.
 *
 * ============================================================================
 * GRACEFUL SHUTDOWN
 * ============================================================================
 *
 *   A `close()` Promise hívásakor a composer:
 *     1) A HTTP szervert leállítja (`server.stop()`).
 *     2) A WebSocket böngészőket lezárja (`wsRelay.closeAll()`).
 *     3) A state-feed TCP klienst lezárja (`stateFeedClient.close()`).
 *
 *   A sorrend fontos: a HTTP szerver leállítása ELŐTT a WebSocket-eket
 *   le kell zárni, hogy a böngészők tiszta close code-ot kapjanak.
 *
 * ============================================================================
 * DEFAULT ÉRTÉKEK
 * ============================================================================
 *
 *   - `webPort`     → 7913
 *   - `feedHost`    → "127.0.0.1"
 *   - `feedPort`    → 7914
 *   - `webDistDir`  → a CWD-ből számítva: `<cwd>/apps/web/dist`
 *
 * ============================================================================
 * TESZTELHETŐSÉG
 * ============================================================================
 *
 *   A `startWebClient` a `Bun.serve`-t használja, és a tesztek
 *   közvetlenül hívják a függvényt. A `webPort: 0` (ephemeral) esetén
 *   a `webClient.port` getter a tényleges portot adja vissza.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { StateFeedClient, type StateFeedClientOptions, type StateFeedClientHandle } from "./state-feed-client.js";
import { createHttpHandler, type HttpHandlerFactory } from "./http-server.js";
import { createWsRelay, type WsRelayHandle } from "./ws-relay.js";
import type { StateFeedSnapshot } from "../state-feed/publisher.js";
import type { StateFeedOHLC } from "../state-feed/protocol.js";

// ============================================================================
// Types
// ============================================================================

/** A `startWebClient` opciói. */
export interface StartWebClientOptions {
  /** A HTTP / WebSocket port (default: 7913). */
  readonly webPort?: number;
  /** A HTTP hostname (default: "127.0.0.1"). */
  readonly webHostname?: string;
  /** A state-feed host (default: "127.0.0.1"). */
  readonly feedHost?: string;
  /** A state-feed port (default: 7914). */
  readonly feedPort?: number;
  /** A `apps/web/dist/` mappa path-ja. A `startWebClient` a `mm-bot`
   *  bináris melletti `apps/web/dist/` mappát használja, ha nincs megadva. */
  readonly webDistDir?: string;
  /** A `StateFeedClient` extra opciói (a reconnect / PONG viselkedés
   *  testreszabásához). */
  readonly stateFeedClientOptions?: Omit<StateFeedClientOptions, "hostname" | "port">;
  /** Az `onSnapshot` callback override (a tesztek használják a cache
   *  manipulálásához). */
  readonly onSnapshot?: (
    snapshot: StateFeedSnapshot,
    ohlcBootstrap: Readonly<Record<string, Readonly<Record<string, readonly StateFeedOHLC[]>>>>,
  ) => void;
}

/** A `startWebClient` visszatérési értéke. */
export interface WebClientHandle {
  /** A HTTP / WebSocket szerver leállítása + a state-feed kliens lezárása. */
  close(): Promise<void>;
  /** A HTTP / WebSocket port (a `startWebClient` után). */
  readonly port: number;
  /** Az aktuálisan csatlakoztatott böngészők száma. */
  browserCount(): number;
  /** A state-feed kliens handle (a tesztek / CLI használják). */
  readonly stateFeed: StateFeedClientHandle;
  /** A HTTP handler factory (a tesztek használják a cache manipulálásához). */
  readonly httpHandler: HttpHandlerFactory;
  /** A WebSocket relay handle (a tesztek használják a böngészők
   *  manipulálásához). */
  readonly wsRelay: WsRelayHandle;
}

// ============================================================================
// Default resolution
// ============================================================================

/**
 * `resolveWebDistDir` — a `apps/web/dist/` mappa path-ját oldja fel.
 * Ha a `webDistDir` nincs megadva, a `mm-bot` bináris melletti
 * `apps/web/dist/` mappát használja (a postinstall script
 * `install-mm-bot.sh` biztosítja, hogy a `mm-bot` symlink a
 * `apps/bot/src/index.ts` fájlra mutat).
 */
export function resolveWebDistDir(explicitPath: string | undefined, botFileUrl: string): string {
  if (explicitPath !== undefined) {
    return resolve(explicitPath);
  }
  // A `botFileUrl` az `import.meta.url` értéke, ami a `bin/mm-bot`
  // → `apps/bot/src/index.ts` symlink-en át a `apps/bot/src/index.ts`
  // fájlra mutat. A `dirname` ebből `apps/bot/src/`, és a parent
  // parent-je `apps/bot/`. Az `apps/web/dist` a `apps/bot/`-ból
  // `../../apps/web/dist`.
  const botSrcDir = dirname(fileURLToPath(botFileUrl));
  const botDir = dirname(botSrcDir);
  const repoRoot = dirname(botDir);
  return resolve(repoRoot, "apps", "web", "dist");
}

// ============================================================================
// startWebClient
// ============================================================================

/**
 * `startWebClient` — a web client életciklus-kezelője.
 *
 * A `Bun.serve()`-t a megadott porton indítja; a `fetch` callback a
 * HTTP + static handler, a `websocket` callback a WebSocket relay.
 * A state-feed kliens a `Bun.serve` indítása ELŐTT indul (a
 * reconnect-resync a `stateFeed.onConnect` callback-en át a WebSocket
 * relay-t hívja).
 */
export async function startWebClient(options: StartWebClientOptions = {}): Promise<WebClientHandle> {
  const webPort = options.webPort ?? 7913;
  const webHostname = options.webHostname ?? "127.0.0.1";
  const feedHost = options.feedHost ?? "127.0.0.1";
  const feedPort = options.feedPort ?? 7914;
  // A `webDistDir` a `createHttpHandler` belsejében a `createStaticHandler`
  // factory hívódik, ami a `webDistDir` értékét a `createHttpHandler`
  // belső state-jében tárolja. A `webDistDir` default-ja a `resolveWebDistDir`
  // által az `import.meta.url` alapján feloldott path.
  const webDistDir = options.webDistDir ?? resolveWebDistDir(undefined, import.meta.url);

  // A WebSocket relay referencia — a state-feed kliens `onConnect` +
  // `onMessage` callback-jeiből hívjuk a relay metódusait. A referenciát
  // azért tartjuk egy külső objektumban, mert a `stateFeed` options
  // a `wsRelay` ELŐTT jön létre (a `wsRelay` factory a `stateFeed`-re
  // hivatkozik, így a `stateFeed`-et ELŐBB kell létrehozni).
  const wsRelayRef: { current: WsRelayHandle | null } = { current: null };

  // 1) StateFeedClient — a state-feed TCP loopback kliens.
  //    A reconnect-resync-et a `wsRelayRef.current?.resyncAllSubscriptions()`
  //    hívásával kötjük össze a state-feed `onConnect` callback-jével.
  //    Az üzeneteket a `wsRelayRef.current?.relayFromStateFeed()`-en
  //    át küldjük a böngészőknek.
  //    Ha a user saját `onConnect` / `onMessage` callback-et adott meg,
  //    a mi hookjaink ELŐTTE hívódnak — a user a saját hookjában
  //    kapja meg a `resyncAllSubscriptions` / `relayFromStateFeed`
  //    hatását.
  const userOnConnect = options.stateFeedClientOptions?.onConnect;
  const userOnMessage = options.stateFeedClientOptions?.onMessage;
  const userOnDisconnect = options.stateFeedClientOptions?.onDisconnect;
  const stateFeedClientOptions: StateFeedClientOptions = {
    hostname: feedHost,
    port: feedPort,
    ...(options.stateFeedClientOptions ?? {}),
    onConnect: () => {
      // A reconnect sikeres volt — a WebSocket relay újraküldi a
      // böngésző SUBSCRIBE cache-ét a state-feed felé.
      wsRelayRef.current?.resyncAllSubscriptions();
      if (userOnConnect !== undefined) {
        userOnConnect();
      }
    },
    onMessage: (message) => {
      // A state-feed üzeneteit a WebSocket relay a böngészők felé
      // továbbítja. A relay a PING üzeneteket nem küldi a böngészőnek,
      // és a SNAPSHOT üzeneteket az `onSnapshot` callback-en át is
      // feldolgozza (a HTTP handler cache-éhez).
      wsRelayRef.current?.relayFromStateFeed(message);
      if (userOnMessage !== undefined) {
        userOnMessage(message);
      }
    },
    onDisconnect: (reason) => {
      // A state-feed lecsatlakozott — a HTTP snapshot cache és a
      // WebSocket relay cache is érvénytelen. A `clearSnapshot` +
      // `closeAll` a reconnect-resync során a reconnect sikeressége
      // után a `resyncAllSubscriptions` + a SNAPSHOT üzenet által
      // újraépül.
      if (userOnDisconnect !== undefined) {
        userOnDisconnect(reason);
      }
      // A snapshot cache törlése — a reconnect után az új SNAPSHOT
      // újra feltölti. A `httpHandler` és a `wsRelay` a lentebbi
      // blokkokban jönnek létre; itt a `wsRelayRef`-en át érjük el.
      wsRelayRef.current?.closeAll();
    },
  };
  const stateFeed: StateFeedClientHandle = new StateFeedClient(stateFeedClientOptions);

  // 2) HTTP handler factory — a fetch callback-ek. A `webDistDir` az
  //    `import.meta.url` alapján default-olódik.
  const httpHandler: HttpHandlerFactory = createHttpHandler(stateFeed, { webDistDir });

  // 3) WebSocket relay factory — a websocket callback-ek.
  const wsRelay: WsRelayHandle = createWsRelay({
    stateFeed,
    onSnapshot: (snapshot, ohlcBootstrap) => {
      if (options.onSnapshot !== undefined) {
        options.onSnapshot(snapshot, ohlcBootstrap);
      } else {
        httpHandler.setSnapshot(snapshot, ohlcBootstrap);
      }
    },
  });
  wsRelayRef.current = wsRelay;

  // 4) A state-feed kliens indítása.
  await stateFeed.start();

  // 5) A HTTP + WebSocket szerver indítása.
  return mountServer(stateFeed, httpHandler, wsRelay, webHostname, webPort);
}

/**
 * `mountServer` — a `Bun.serve()` indítása a HTTP + WebSocket
 * handler-ekkel. A belső helper a `startWebClient` kódjának
 * szervezéséhez.
 */
function mountServer(
  stateFeed: StateFeedClientHandle,
  httpHandler: HttpHandlerFactory,
  wsRelay: WsRelayHandle,
  webHostname: string,
  webPort: number,
): WebClientHandle {
  const server = Bun.serve({
    port: webPort,
    hostname: webHostname,
    fetch: (req, server) => {
      const url = new URL(req.url);
      // A WebSocket upgrade: a `/ws` útvonalon.
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req, { data: { subscriptions: new Set<string>(), closed: false } });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return httpHandler.fetch(req);
    },
    websocket: wsRelay.handlers,
  });

  // A state-feed snapshot cache-et a state-feed clear eseményére töröljük.
  // A `StateFeedClient` `onDisconnect` callback-jét használjuk — ha nincs,
  // a snapshot cache a reconnect-ig megmarad (a HELLO + SNAPSHOT újra
  // felülírja).
  return {
    close: async () => {
      // A sorrend: WebSocket böngészők → HTTP szerver → state-feed kliens.
      try {
        wsRelay.closeAll();
      } catch {
        // best-effort
      }
      try {
        void server.stop();
      } catch {
        // best-effort
      }
      try {
        stateFeed.close().catch(() => undefined);
      } catch {
        // best-effort
      }
      // Várunk egy microtask-et, hogy a `close()` promise true legyen.
      await Promise.resolve();
    },
    get port(): number {
      return server.port ?? webPort;
    },
    browserCount: () => wsRelay.browserCount(),
    stateFeed,
    httpHandler,
    wsRelay,
  };
}

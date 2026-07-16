/**
 * apps/bot/src/web-client/ws-relay.ts
 *
 * ============================================================================
 * PHASE 46 — WEB CLIENT WEBSOCKET RELAY
 * ============================================================================
 *
 * A `WsRelay` a web client böngésző-felé néző WebSocket végpontja
 * (`/ws` a 7913 porton). A `Bun.serve` `websocket` handler-ébe
 * illeszkedik, és a `Bun.serve` indítása után aktiválódik.
 *
 * ============================================================================
 * ARCHITEKTÚRA — TRANSPARENT RELAY
 * ============================================================================
 *
 *   A relay a state-feed (TCP loopback, 127.0.0.1:7914) és a böngésző
 *   (WebSocket, ws://127.0.0.1:7913/ws) között közvetít. A kétirányú
 *   adatforgalom:
 *
 *     state-feed  ────────►  web-client  ────────►  browser
 *                              ▲                       │
 *                              └───────────────────────┘
 *                                    (browser → web-client → state-feed)
 *
 *   A state-feed → böngésző irány:
 *     - A state-feed minden üzenete (HELLO, SNAPSHOT, TICK, BAR,
 *       INDICATOR, MARKER, STATE, ERROR, PING) továbbítódik a
 *       böngészőnek.
 *     - A PING üzenetek a state-feed-en belül a PONG-ra válaszolnak
 *       (a `StateFeedClient` maga kezeli), a böngésző NEM kap PING-et.
 *
 *   A böngésző → state-feed irány:
 *     - A böngésző SUBSCRIBE / UNSUBSCRIBE / CONTROL üzeneteket küld.
 *     - A relay a `stateFeed.send()`-en át a state-feed felé továbbítja.
 *     - A böngésző NEM küld PONG-ot (az a state-feed-en belüli, a
 *       web client maga kezeli).
 *
 * ============================================================================
 * ORIGIN TAGGING — RE-BROADCAST LOOP PREVENTION
 * ============================================================================
 *
 *   A loop prevention kulcsa az "origin" tag. A `StateFeedClient` az
 *   `onMessage` callback-et a state-feed felől hívja, a `ws` a böngésző
 *   felől. A relay SOHA nem küldi vissza a böngészőnek a böngésző által
 *   küldött üzenetet, és fordítva.
 *
 *   A loop-mentesítés a `relayFromStateFeed` és a `handleBrowserMessage`
 *   metódusokon át explicit: a state-feed üzenetek CSAK a böngésző felé
 *   mennek, a böngésző üzenetek CSAK a state-feed felé. Nincs echo,
 *   nincs re-broadcast.
 *
 * ============================================================================
 * SUBSCRIBE CACHE
 * ============================================================================
 *
 *   A böngésző a SUBSCRIBE üzenetekben a (symbol, tf) szűrőket küldi.
 *   A relay nyilvántartja az aktuális böngésző SUBSCRIBE-okat, és
 *   reconnect esetén újraküldi a state-feed-nek. Ez biztosítja, hogy
 *   a bot state-feed a böngésző által kért szűrőket alkalmazza a
 *   reconnect után.
 *
 *   A SUBSCRIBE cache per-böngésző (a `ws.data` property-n tárolva).
 *   Ha több böngésző van csatlakoztatva, mindegyik a saját cache-ét
 *   kapja.
 *
 * ============================================================================
 * TESZTELHETŐSÉG
 * ============================================================================
 *
 *   A `WsRelay` a `Bun.serve` `websocket` handler-jét adja vissza.
 *   A tesztek a `Bun.serve` indításával együtt tesztelik a relay-t
 *   (a `http-server.test.ts` integrációs tesztjeihez hasonlóan).
 */

import type { ServerWebSocket, WebSocketHandler } from "bun";
import {
  isClientMessage,
  type StateFeedOHLC,
  type StateFeedServerMessage,
} from "../state-feed/protocol.js";
import type { StateFeedClientHandle } from "./state-feed-client.js";
import type { StateFeedSnapshot } from "../state-feed/publisher.js";

// ============================================================================
// Constants
// ============================================================================

/** A `ws.data` property-n tárolt per-socket state típusa. */
interface WsData {
  /** Az aktív SUBSCRIBE-ok (a reconnect-resync-hez). */
  readonly subscriptions: Set<string>;
  /** A socket zárt-e (a `close` callback hamarabb hívódhat, mint
   *  a `message` callback utolsó üzenete). */
  closed: boolean;
}

/** A subscribe kulcs formátuma: `<symbol>::<tf>`. */
function subscribeKey(symbol: string, timeframe: string): string {
  return `${symbol}::${timeframe}`;
}

// ============================================================================
// Types
// ============================================================================

/** A `WsRelay` opciói. */
export interface WsRelayOptions {
  /** A state-feed kliens (a send / onMessage API). */
  readonly stateFeed: StateFeedClientHandle;
  /** A snapshot cache beállítása, amikor a state-feed SNAPSHOT-ot küld
   *  (az http-server számára). */
  readonly onSnapshot: (
    snapshot: StateFeedSnapshot,
    ohlcBootstrap: Readonly<Record<string, Readonly<Record<string, readonly StateFeedOHLC[]>>>>,
  ) => void;
  /** A reconnect állapotváltozásaira hívódó callback (a HTTP health
   *  endpoint számára). */
  readonly onReconnectScheduled?: (nextDelayMs: number, attempt: number) => void;
}

/** A `WsRelay` visszatérési típusa — a `Bun.serve` `websocket` handler. */
export interface WsRelayHandle {
  /** A `Bun.serve` `websocket` handler. */
  readonly handlers: WebSocketHandler<WsData>;
  /** Az aktuálisan csatlakoztatott böngészők száma. */
  browserCount(): number;
  /** A relay leállítása (a websocket-ek lezárása). */
  closeAll(): void;
  /** A state-feed üzeneteit a böngészők felé továbbító függvény
   *  (a `StateFeedClient.onMessage` callback-jéhez). */
  relayFromStateFeed(message: StateFeedServerMessage): void;
  /** A böngésző SUBSCRIBE cache-ek újraküldése a state-feed felé
   *  (reconnect-resync). */
  resyncAllSubscriptions(): void;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * `createWsRelay` — a WebSocket relay factory. A factory visszaadja
 * a `Bun.serve` `websocket` handler-ét + a `relayFromStateFeed` API-t,
 * amit a `StateFeedClient.onMessage` callback-jébe kell kötni.
 */
export function createWsRelay(options: WsRelayOptions): WsRelayHandle {
  // A böngésző-socketek map-je: a `bun` WebSocket handler a `ws.data`
  // property-n tárolja a per-socket state-et. A `Set<ServerWebSocket<WsData>>`
  // a lezáráskor való iterate-hoz kell.
  const browsers = new Set<ServerWebSocket<WsData>>();

  const handlers: WebSocketHandler<WsData> = {
    open(ws: ServerWebSocket<WsData>) {
      ws.data = { subscriptions: new Set<string>(), closed: false };
      browsers.add(ws);
    },
    message(ws: ServerWebSocket<WsData>, raw: string | Uint8Array) {
      // A böngésző a state-feed protokoll egy részhalmazát küldi:
      // SUBSCRIBE, UNSUBSCRIBE, CONTROL. A PONG-ot a state-feed-en
      // belül kezeljük, a böngésző nem küld PONG-ot.
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      handleBrowserMessage(ws, text, options.stateFeed);
    },
    close(ws: ServerWebSocket<WsData>) {
      ws.data.closed = true;
      browsers.delete(ws);
    },
  };

  const handle: WsRelayHandle = {
    handlers,
    browserCount: () => browsers.size,
    closeAll: () => {
      for (const ws of browsers) {
        try {
          ws.close(1000, "server shutdown");
        } catch {
          // best-effort
        }
      }
      browsers.clear();
    },
    relayFromStateFeed: (message) => {
      // A PING üzenetek CSAK a state-feed-en belüli életciklus részei;
      // a böngésző NEM kap PING-et. A StateFeedClient a PING-re a
      // PONG-ot automatikusan küldi.
      if (message.type === "ping") return;
      // A SNAPSHOT-ot a http-server cache-eli.
      if (message.type === "snapshot") {
        options.onSnapshot(message.snapshot, message.ohlcBootstrap);
      }
      // A relay minden böngészőnek elküldi az üzenetet (a Set iteráció
      // közben a `close` callback-ben törölhet, ezért a `try` + `delete`
      // kombináció biztonságos).
      const payload = JSON.stringify(message);
      for (const ws of browsers) {
        if (ws.data.closed) continue;
        try {
          ws.send(payload);
        } catch {
          // A send elbukott (a socket zárva van) — a `close` callback
          // hamarosan hívódik, és a böngésző törlődik a set-ből.
        }
      }
    },
    resyncAllSubscriptions: () => {
      // Reconnect-resync: minden böngésző SUBSCRIBE cache-ét újraküldi
      // a state-feed felé. A StateFeedClient `onConnect` callback-jéből
      // hívódik (a HELLO + SNAPSHOT üzenetek feldolgozása után).
      for (const ws of browsers) {
        if (ws.data.closed) continue;
        for (const key of ws.data.subscriptions) {
          const sepIdx = key.indexOf("::");
          if (sepIdx === -1) continue;
          const symbol = key.slice(0, sepIdx);
          const timeframe = key.slice(sepIdx + 2);
          try {
            options.stateFeed.send({ type: "subscribe", symbol, timeframe });
          } catch {
            // best-effort
          }
        }
      }
    },
  };

  return handle;
}

// ============================================================================
// Browser message handler
// ============================================================================

/**
 * `handleBrowserMessage` — egy böngésző által küldött szöveges üzenetet
 * feldolgoz. A state-feed protokoll egy részhalmazát fogadja:
 * SUBSCRIBE, UNSUBSCRIBE, CONTROL.
 *
 * A PING-re a böngésző soha nem küld, de ha mégis megtenné (a védelmi
 * vonal a state-feed oldalán van), a PONG-ot a state-feed-en belül
 * kezeljük — a böngésző felé NEM küldünk PONG-ot.
 */
function handleBrowserMessage(
  ws: ServerWebSocket<WsData>,
  rawText: string,
  stateFeed: StateFeedClientHandle,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // Hibás JSON — a böngésző felé egy `error` üzenetet küldünk.
    sendErrorToBrowser(ws, "invalid JSON");
    return;
  }
  if (typeof parsed !== "object" || parsed === null) {
    sendErrorToBrowser(ws, "message must be a JSON object");
    return;
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj["type"] !== "string") {
    sendErrorToBrowser(ws, "missing 'type' field");
    return;
  }
  if (!isClientMessage(parsed)) {
    const typeStr = obj["type"];
    sendErrorToBrowser(ws, `unsupported message type: ${typeStr}`);
    return;
  }
  // A SUBSCRIBE cache frissítése.
  if (parsed.type === "subscribe") {
    ws.data.subscriptions.add(subscribeKey(parsed.symbol, parsed.timeframe));
  } else if (parsed.type === "unsubscribe") {
    ws.data.subscriptions.delete(subscribeKey(parsed.symbol, parsed.timeframe));
  }
  // A state-feed felé küldés — ha nincs aktív kapcsolat, a `send`
  // hamisat ad vissza, és a böngésző egy `error` üzenetet kap.
  const sent = stateFeed.send(parsed);
  if (!sent) {
    sendErrorToBrowser(ws, "state-feed not connected; message dropped");
  }
}

/**
 * `sendErrorToBrowser` — egy `error` típusú üzenetet küld a böngészőnek.
 * A böngésző a `message` mezőben olvassa a hibát. A `recoverable`
 * mező `false` — a böngészőnek NEM kell reconnect-elnie.
 */
function sendErrorToBrowser(ws: ServerWebSocket<WsData>, message: string): void {
  if (ws.data.closed) return;
  try {
    const errorMessage = { type: "error", ts: Date.now(), message, recoverable: false };
    ws.send(JSON.stringify(errorMessage));
  } catch {
    // best-effort
  }
}

// ============================================================================
// Reconnect helper (used in tests for direct per-socket resync)
// ============================================================================

/**
 * `resyncSubscriptions` — reconnect esetén a böngésző SUBSCRIBE
 * cache-ének újraküldése a state-feed felé. A `StateFeedClient`
 * `onConnect` callback-jéből hívódik (a reconnect sikeres csatlakozás
 * UTÁN, a HELLO + SNAPSHOT üzenetek feldolgozása után).
 *
 * A `resyncAllSubscriptions` (a `WsRelayHandle` része) a belső
 * iterációt végzi; ez a helper a per-WS-connection resync-hez ad
 * explicit API-t (a tesztek használják).
 */
export function resyncSubscriptions(
  ws: ServerWebSocket<WsData>,
  stateFeed: StateFeedClientHandle,
): void {
  for (const key of ws.data.subscriptions) {
    const sepIdx = key.indexOf("::");
    if (sepIdx === -1) continue;
    const symbol = key.slice(0, sepIdx);
    const timeframe = key.slice(sepIdx + 2);
    stateFeed.send({ type: "subscribe", symbol, timeframe });
  }
}

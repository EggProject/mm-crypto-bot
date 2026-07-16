/**
 * apps/bot/src/state-feed/protocol.ts
 *
 * ============================================================================
 * PHASE 45 — STATE-FEED WIRE PROTOCOL
 * ============================================================================
 *
 * A state-feed protokoll a bot (szerver, 127.0.0.1:7914) és a web
 * kliens (kliens) közötti, NEWLINE-DELIMITED JSON-on alapuló TCP
 * üzenetváltás forrása.
 *
 * Az üzeneteket a `bun:net`-en (Bun TCP socket) küldi a szerver,
 * soronként egy JSON objektum + `\n` karakter. A parser az üzenet
 * `type` mezője alapján diszkriminálja az üzenet típusát.
 *
 * ============================================================================
 * ÜZENETEK
 * ============================================================================
 *
 *   Szerver → kliens (broadcast, kivéve HELLO + SNAPSHOT):
 *     - hello       — szerver verzió + protokoll verzió, egyszer a connect után
 *     - snapshot    — induló teljes state, egyszer a HELLO után
 *     - tick        — ár tick (4 Hz throttle per symbol per kliens)
 *     - bar         — lezárt OHLC bar
 *     - indicator   — indikátor frissítés (Donchian, pivot, stb.)
 *     - marker      — stratégia jelzés (entry/exit)
 *     - state       — pozíciók / statisztikák / kill-switch / paused
 *     - error       — engine hiba
 *     - ping        — heartbeat (10s)
 *
 *   Kliens → szerver:
 *     - subscribe   — feliratkozás (symbol, tf) szűrőre
 *     - unsubscribe — leiratkozás
 *     - control     — start / stop / pause / kill_switch
 *     - pong        — heartbeat válasz
 *
 * ============================================================================
 * WHY NEWLINE-DELIMITED JSON
 * ============================================================================
 *   - Nincs szükség WebSocket-re / framed binary protocol-ra — a TCP
 *     loopbackon 80 bájt / üresjárat kliens overhead-del kiszolgálható.
 *   - A `\n`-delimitter az emberi olvashatóságot is megőrzi (nc 127.0.0.1 7914
 *     esetén is használható debug célokra).
 *   - A JSON validáció a parser oldalán (a 3.1 §-ban specifikált message
 *     shape) early failure-t ad, ha a séma elromlik.
 *
 * ============================================================================
 * PROTOCOL VERSION
 * ============================================================================
 *   A `PROTOCOL_VERSION` a szerver és kliens közötti kompatibilitás
 *   kulcsa. Ha a jövőben új mezők jönnek, a verzió nő, és a kliens
 *   a HELLO message-ben kapja meg.
 */

import type { StateFeedSnapshot } from "./publisher.js";

// ============================================================================
// Protocol version
// ============================================================================

/** A state-feed protokoll verziója. */
export const PROTOCOL_VERSION = 1 as const;

/** A bot verziója (a `package.json`-ból). */
export const SERVER_VERSION = "0.45.0" as const;

// ============================================================================
// Shared sub-types
// ============================================================================

/** A `MARKER.side` értékei. */
export type StateFeedMarkerSide = "long" | "short" | "buy" | "sell";

/** A `STATE.killSwitch` értékei (a snapshot-ból örökölve). */
export type StateFeedKillSwitchState = "armed" | "confirm" | "triggered";

/** A `CONTROL.command` értékei. */
export type StateFeedControlCommand =
  | "start"
  | "stop"
  | "pause"
  | "resume"
  | "kill_switch";

/** A `SUBSCRIBE` / `UNSUBSCRIBE` per-(symbol, tf) szűrője. */
export interface StateFeedSubscriptionFilter {
  readonly symbol: string;
  readonly timeframe: string;
}

/** OHLC bar. */
export interface StateFeedOHLC {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** Indicator series — a kliens interpretálja (Donchian: upper/lower/middle, stb.). */
export type StateFeedIndicatorSeries = Record<string, readonly (number | null)[]>;

// ============================================================================
// Server → Client messages (discriminated by `type`)
// ============================================================================

/** HELLO — szerver azonosítás. Egyszer a TCP connect után. */
export interface StateFeedHelloMessage {
  readonly type: "hello";
  readonly ts: number;
  readonly serverVersion: string;
  readonly protocolVersion: number;
}

/** SNAPSHOT — induló teljes state. Egyszer a HELLO után. */
export interface StateFeedSnapshotMessage {
  readonly type: "snapshot";
  readonly ts: number;
  readonly snapshot: StateFeedSnapshot;
  readonly ohlcBootstrap: Readonly<Record<string, Readonly<Record<string, readonly StateFeedOHLC[]>>>>;
}

/** TICK — ár tick, 4 Hz-re throttelve per symbol per kliens. */
export interface StateFeedTickMessage {
  readonly type: "tick";
  readonly ts: number;
  readonly symbol: string;
  readonly price: number;
}

/** BAR — lezárt OHLC bar. */
export interface StateFeedBarMessage {
  readonly type: "bar";
  readonly ts: number;
  readonly symbol: string;
  readonly timeframe: string;
  readonly ohlc: StateFeedOHLC;
}

/** INDICATOR — indikátor frissítés. */
export interface StateFeedIndicatorMessage {
  readonly type: "indicator";
  readonly ts: number;
  readonly symbol: string;
  readonly strategy: string;
  readonly timeframe: string;
  readonly indicator: string;
  readonly series: StateFeedIndicatorSeries;
}

/** MARKER — stratégia jelzés. */
export interface StateFeedMarkerMessage {
  readonly type: "marker";
  readonly ts: number;
  readonly symbol: string;
  readonly strategy: string;
  readonly timeframe: string;
  readonly side: StateFeedMarkerSide;
  readonly price: number;
  readonly label: string;
}

/** STATE — pozíciók, statisztikák, kill-switch, paused. */
export interface StateFeedStateMessage {
  readonly type: "state";
  readonly ts: number;
  readonly snapshot: StateFeedSnapshot;
}

/** ERROR — engine hiba (mirrors the deleted TUI EngineErrorBanner). */
export interface StateFeedErrorMessage {
  readonly type: "error";
  readonly ts: number;
  readonly message: string;
  readonly recoverable: boolean;
}

/** PING — heartbeat (szerver küldi 10s-ként). */
export interface StateFeedPingMessage {
  readonly type: "ping";
  readonly ts: number;
}

/** Az összes szerver → kliens üzenet típus. */
export type StateFeedServerMessage =
  | StateFeedHelloMessage
  | StateFeedSnapshotMessage
  | StateFeedTickMessage
  | StateFeedBarMessage
  | StateFeedIndicatorMessage
  | StateFeedMarkerMessage
  | StateFeedStateMessage
  | StateFeedErrorMessage
  | StateFeedPingMessage;

// ============================================================================
// Client → Server messages
// ============================================================================

/** SUBSCRIBE — feliratkozás (symbol, tf) szűrőre. */
export interface StateFeedSubscribeMessage {
  readonly type: "subscribe";
  readonly symbol: string;
  readonly timeframe: string;
}

/** UNSUBSCRIBE — leiratkozás. */
export interface StateFeedUnsubscribeMessage {
  readonly type: "unsubscribe";
  readonly symbol: string;
  readonly timeframe: string;
}

/** CONTROL — start / stop / pause / kill_switch. */
export interface StateFeedControlMessage {
  readonly type: "control";
  readonly command: StateFeedControlCommand;
  readonly confirm?: boolean;
  readonly paused?: boolean;
}

/** PONG — heartbeat válasz. */
export interface StateFeedPongMessage {
  readonly type: "pong";
  readonly ts: number;
}

/** Az összes kliens → szerver üzenet típus. */
export type StateFeedClientMessage =
  | StateFeedSubscribeMessage
  | StateFeedUnsubscribeMessage
  | StateFeedControlMessage
  | StateFeedPongMessage;

// ============================================================================
// JSON serialization helpers
// ============================================================================

/**
 * `serializeMessage` — egy szerver vagy kliens üzenetet JSON string-gé
 * alakít, a sor végére `\n` karaktert fűz. A JSON.stringify `replacer`
 * paramétere nélkül hívódik (a `StateFeedSnapshot` már tisztán
 * serializálható).
 */
export function serializeMessage(message: StateFeedServerMessage | StateFeedClientMessage): string {
  return JSON.stringify(message) + "\n";
}

/**
 * `parseMessage` — egy sort (a `\n` levágva) JSON-né parse-olja, és
 * a `type` mező alapján visszaadja a megfelelő típusú üzenetet.
 *
 * A függvény CSAK a `type` mezőt ellenőrzi; a mezők további validációját
 * a feed-server a `routeClientMessage` metódusban végzi.
 *
 * A függvény `null`-t ad vissza, ha a sor nem valid JSON vagy nincs
 * `type` mezője — a feed-server ilyenkor hibát küld a kliensnek,
 * és zárja a socketet.
 */
export function parseMessage(line: string): StateFeedClientMessage | StateFeedServerMessage | null {
  if (line.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj["type"] !== "string") return null;
  return parsed as StateFeedClientMessage | StateFeedServerMessage;
}

// ============================================================================
// Message-type guards (defense in depth)
// ============================================================================

/** Ellenőrzi, hogy az üzenet kliens → szerver típusú-e. */
export function isClientMessage(
  m: unknown,
): m is StateFeedClientMessage {
  if (typeof m !== "object" || m === null) return false;
  const type = (m as Record<string, unknown>)["type"];
  return (
    type === "subscribe" ||
    type === "unsubscribe" ||
    type === "control" ||
    type === "pong"
  );
}

/** Ellenőrzi, hogy az üzenet szerver → kliens típusú-e. */
export function isServerMessage(
  m: unknown,
): m is StateFeedServerMessage {
  if (typeof m !== "object" || m === null) return false;
  const type = (m as Record<string, unknown>)["type"];
  return (
    type === "hello" ||
    type === "snapshot" ||
    type === "tick" ||
    type === "bar" ||
    type === "indicator" ||
    type === "marker" ||
    type === "state" ||
    type === "error" ||
    type === "ping"
  );
}

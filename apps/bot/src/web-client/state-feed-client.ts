/**
 * apps/bot/src/web-client/state-feed-client.ts
 *
 * ============================================================================
 * PHASE 46 — WEB CLIENT STATE-FEED CONSUMER
 * ============================================================================
 *
 * A `StateFeedClient` a web client oldalán futó TCP kliens, ami a bot
 * `FeedServer`-éhez (127.0.0.1:7914, Phase 45) csatlakozik. A web
 * client ezen a kliensen keresztül olvassa a bot state-változásait
 * (HELLO, SNAPSHOT, TICK, BAR, INDICATOR, MARKER, STATE, ERROR, PING)
 * és ezen küldi a CONTROL / SUBSCRIBE / UNSUBSCRIBE / PONG üzeneteket.
 *
 * ============================================================================
 * PROTOKOL — MIÉRT NEWLINE-DELIMITED JSON
 * ============================================================================
 *
 *   A state-feed protokoll a `apps/bot/src/state-feed/protocol.ts`-ban
 *   van definiálva. A TCP byte-folyam `\n`-del határolt JSON objektumok
 *   sorozata; a parser a `parseMessage` / `serializeMessage` helper-eket
 *   használja. A kliens a `StateFeedClientMessage` (subscribe, unsubscribe,
 *   control, pong) típusú üzeneteket küldi, és a `StateFeedServerMessage`
 *   (hello, snapshot, tick, bar, indicator, marker, state, error, ping)
 *   típusú üzeneteket fogadja.
 *
 * ============================================================================
 * ÚJRAKAPCSOLÓDÁS — EXPONENTIAL BACKOFF
 * ============================================================================
 *
 *   A bot bármikor újraindulhat (a `mm-bot start` leállhat és újraindulhat,
 *   vagy a SIGKILL megöli). A state-feed ilyenkor ELTŰNIK a 7914 portról
 *   és egy idő után újra megjelenik. A `StateFeedClient` exponential
 *   backoff-fal próbálkozik: 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s...
 *
 *   A backoff a `Bun.connect()` első sikeres csatlakozásakor lenullázódik.
 *   A `close()` hívásakor a backoff timer is leáll, így a kliens
 *   tiszta state-ben marad a `start()` újbóli hívásához.
 *
 * ============================================================================
 * PING / PONG — HEARTBEAT
 * ============================================================================
 *
 *   A state-feed 10 másodpercenként `PING` üzenetet küld. A kliensnek
 *   5 másodpercen belül `PONG`-gal kell válaszolnia. A PONG-ot a
 *   `lastPingTs` (a kapott PING timestamp-je) alapján generáljuk —
 *   a PONG `ts` mezője a PING-re válaszol, így a feed-server a
 *   round-trip latency-t mérheti.
 *
 * ============================================================================
 * STATE — RECONNECT-RESYNC
 * ============================================================================
 *
 *   A reconnect SIKERES csatlakozáskor a szerver a HELLO + SNAPSHOT
 *   üzeneteket küldi; a kliens a SNAPSHOT-ot azonnal továbbítja a
 *   `onMessage` callback-eken. A fogyasztó (a `WsRelay` / a REST handler-ek)
 *   a SNAPSHOT alapján újraépíti a saját state-jét. Ehhez a web client
 *   oldalán NEM kell explicit resync — a SNAPSHOT mindig friss.
 *
 * ============================================================================
 * SZERVER-FIGYELÉS — TCP SOCKET
 * ============================================================================
 *
 *   A `Bun.connect()` a Bun natív TCP API-ja. A `socket: { open, data,
 *   close, error, connectError }` callback-ek a TCP életciklust
 *   kezelik. A `socket.write()` a bájtok számát adja vissza, vagy
 *   `-1`-et ha a socket zárva van.
 *
 * ============================================================================
 * TESZTELHETŐSÉG
 * ============================================================================
 *
 *   A `StateFeedClient` a `Bun.connect()`-et használja — a tesztek
 *   ugyanazt a függvényt hívják, így nincs szükség mockolásra. A
 *   backoff timer a `setTimeout`-ra épül, és a `setTimeout`-ok
 *   `advanceTimers` API-val nem módosíthatók (Bun runtime), ezért
 *   a backoff-ot explicit, rövid `initialBackoffMs` értékkel teszteljük.
 */

import { serializeMessage, type StateFeedClientMessage, type StateFeedServerMessage } from "../state-feed/protocol.js";

// ============================================================================
// Constants
// ============================================================================

/** A default reconnect backoff-sor (ms). A 30s cap Phase 45 user mandate. */
const BACKOFF_SEQUENCE_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/** A PONG válasz maximális késleltetése a PING fogadása után (ms). */
const PONG_TIMEOUT_MS = 5_000 as const;

// ============================================================================
// Types
// ============================================================================

/** Az `StateFeedClient` opciói. */
export interface StateFeedClientOptions {
  /** A state-feed host (default: "127.0.0.1"). */
  readonly hostname?: string;
  /** A state-feed port (default: 7914). */
  readonly port?: number;
  /** A reconnect backoff induló értéke (ms). A default 1000ms.
   *  A tesztek ezt csökkentik, hogy gyorsan haladjanak. */
  readonly initialBackoffMs?: number;
  /** A kapcsolat LÉTREJÖTTÉRE hívódó callback (a HELLO előtt).
   *  A reconnect SIKERES csatlakozásakor is hívódik. */
  readonly onConnect?: () => void;
  /** A kapcsolat LEZÁRÁSÁRA hívódó callback. A reconnect-re várás
   *  előtt hívódik (a backoff timer indítása előtt). */
  readonly onDisconnect?: (reason: "remote" | "error" | "local") => void;
  /** A state-feed-től kapott üzenetekre hívódó callback. */
  readonly onMessage?: (message: StateFeedServerMessage) => void;
  /** A reconnect állapotváltozásaira hívódó callback. */
  readonly onReconnectScheduled?: (nextDelayMs: number, attempt: number) => void;
  /** A PING-re válaszolandó PONG generator (a tesztek override-olják). */
  readonly createPong?: (pingTs: number) => StateFeedClientMessage;
}

/** Az `StateFeedClient` handle — a fogyasztó API-ja. */
export interface StateFeedClientHandle {
  /** A kliens elindítása (első connect + reconnect loop). */
  start(): Promise<void>;
  /** A kliens leállítása (timer törlés + socket zárás). */
  close(): Promise<void>;
  /** Egy üzenet küldése a state-feed felé. Hamisat ad vissza, ha nincs
   *  aktív kapcsolat. */
  send(message: StateFeedClientMessage): boolean;
  /** Az aktuális kapcsolat állapota. */
  isConnected(): boolean;
  /** Az aktuális reconnect attempt számláló (0 ha connected). */
  reconnectAttempt(): number;
  /** A hostname. */
  readonly hostname: string;
  /** A port. */
  readonly port: number;
}

// ============================================================================
// StateFeedClient
// ============================================================================

/** A `Socket` típus a Bun.connect-ből. */
type BunSocket = Awaited<ReturnType<typeof Bun.connect>>;

/**
 * `StateFeedClient` — a state-feed TCP kliens implementációja.
 *
 * Az osztály három fő állapottal rendelkezik:
 *   - `disconnected` — a kliens nincs csatlakoztatva, a `start()` hívásra connect-el.
 *   - `connecting` — a `Bun.connect()` Promise-ja függőben van.
 *   - `connected` — a socket nyitva van, üzeneteket fogadunk.
 *
 * A reconnect loop a `disconnected` → `connecting` → `connected` → (`onDisconnect` →
 * `disconnected` (backoff timer) → `connecting`) ciklusban fut.
 */
export class StateFeedClient implements StateFeedClientHandle {
  private readonly options: Required<Pick<StateFeedClientOptions, "hostname" | "port" | "initialBackoffMs">> & StateFeedClientOptions;
  private socket: BunSocket | null = null;
  private buffer = "";
  private closed = true; // Kezdetben zárt — a start() nyitja.
  private attempt = 0; // Reconnect attempt számláló.
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private connectingPromise: Promise<void> | null = null;

  public constructor(options: StateFeedClientOptions = {}) {
    this.options = {
      hostname: options.hostname ?? "127.0.0.1",
      port: options.port ?? 7914,
      initialBackoffMs: options.initialBackoffMs ?? 1_000,
      ...(options.onConnect !== undefined ? { onConnect: options.onConnect } : {}),
      ...(options.onDisconnect !== undefined ? { onDisconnect: options.onDisconnect } : {}),
      ...(options.onMessage !== undefined ? { onMessage: options.onMessage } : {}),
      ...(options.onReconnectScheduled !== undefined ? { onReconnectScheduled: options.onReconnectScheduled } : {}),
      ...(options.createPong !== undefined ? { createPong: options.createPong } : {}),
    };
  }

  public get hostname(): string {
    return this.options.hostname;
  }

  public get port(): number {
    return this.options.port;
  }

  /**
   * `start` — a kliens elindítása. Az első connect-et a `connect()` metódus
   * indítja; ha az elbukik, a backoff timer indul, és a `connect()` újra
   * hívódik a timer lejártakor.
   */
  public async start(): Promise<void> {
    this.closed = false;
    await this.connect();
  }

  /**
   * `close` — a kliens leállítása. A backoff timer és a connect timer
   * törlődik, a socket lezárul. A `start()` újra hívható ezután.
   */
  public close(): Promise<void> {
    this.closed = true;
    this.clearBackoffTimer();
    if (this.socket !== null) {
      try {
        (this.socket as unknown as { end: () => void }).end();
      } catch {
        // best-effort
      }
      this.socket = null;
    }
    return Promise.resolve();
  }

  /**
   * `send` — egy üzenet küldése a state-feed felé. Ha nincs aktív socket,
   *   hamisat ad vissza (a fogyasztó eldobja az üzenetet).
   */
  public send(message: StateFeedClientMessage): boolean {
    if (this.socket === null) return false;
    const sock = this.socket as unknown as { write: (d: string) => number };
    try {
      const result = sock.write(serializeMessage(message));
      return result !== -1;
    } catch {
      return false;
    }
  }

  /**
   * `isConnected` — van-e aktív socket.
   */
  public isConnected(): boolean {
    return this.socket !== null;
  }

  /**
   * `reconnectAttempt` — az aktuális reconnect attempt sorszáma (0 ha connected).
   */
  public reconnectAttempt(): number {
    return this.socket !== null ? 0 : this.attempt;
  }

  // --------------------------------------------------------------------------
  // Internal — connect
  // --------------------------------------------------------------------------

  /**
   * `connect` — a `Bun.connect()` hívása. Ha a Promise reject-el (a
   * connect nem jött létre), a `scheduleReconnect()`-et hívjuk.
   */
  private connect(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.connectingPromise !== null) return this.connectingPromise;

    const promise = (async () => {
      try {
        await Bun.connect({
          hostname: this.options.hostname,
          port: this.options.port,
          socket: {
            open: (socket) => {
              this.socket = socket;
              this.attempt = 0; // Reset a sikeres csatlakozáskor.
              this.options.onConnect?.();
            },
            data: (_s, data) => {
              // A `data` típusa a Bun-ben a BinaryType alapján változhat;
              // a default `buffer` (vagy `ArrayBuffer`/`Uint8Array`).
              // A `Buffer.isBuffer` ellenőrzés a Node.js Buffer típusra,
              // a `instanceof Uint8Array` a natív Uint8Array típusra.
              let text: string;
              if (typeof data === "string") {
                text = data;
              } else if (data instanceof Uint8Array) {
                text = new TextDecoder().decode(data);
              } else {
                // A `Buffer` típus a Bun-ban az `Uint8Array` egy
                // subtypeja, de a TS szigorúbb típusellenőrzése miatt
                // az `instanceof Uint8Array` nem feltétlenül működik
                // — az `ArrayBuffer` nézet a biztonságos.
                text = new TextDecoder().decode(new Uint8Array(data));
              }
              this.buffer += text;
              this.processBuffer();
            },
            close: () => {
              this.handleDisconnect("remote");
            },
            error: (_s, _error) => {
              // A socket hibája a close() callback-en át is megjelenhet.
              // A hibaüzenetet a close() logolja (a `process.stderr.write`
              // nem kell — a reconnect loop a `handleDisconnect`-en át
              // indul).
            },
            connectError: (_s, _error) => {
              // A connect elbukott — a backoff timer indul. A standard
              // failure mode-ok (ECONNREFUSED, host unreachable) mind
              // a `connectError` callback-en át jönnek.
              this.options.onReconnectScheduled?.(0, this.attempt);
              this.scheduleReconnect();
            },
          },
        });
      } catch {
        // A connect Promise reject — a backoff timer indul. Ez a
        // path a `Bun.connect` Promise reject ágát kezeli (ritka,
        // de a TypeScript szigorú típusellenőrzéséhez szükséges).
        this.options.onReconnectScheduled?.(0, this.attempt);
        this.scheduleReconnect();
      }
    })();

    this.connectingPromise = promise.finally(() => {
      this.connectingPromise = null;
    });
    return this.connectingPromise;
  }

  // --------------------------------------------------------------------------
  // Internal — message parsing
  // --------------------------------------------------------------------------

  /**
   * `processBuffer` — a `buffer`-ben lévő sorokra bontja a bejövő
   * üzeneteket, és minden sort a `onMessage` callback-re küld.
   *
   * A parser készletezi a `buffer`-t: a `data()` callback több részletben
   * is kaphatja ugyanazt a sort (TCP Nagle), és a parser a `buffer`
   * végén lévő részleges sort megtartja a következő `data()` hívásig.
   */
  private processBuffer(): void {
    let idx = this.buffer.indexOf("\n");
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length > 0) {
        this.processLine(line);
      }
      idx = this.buffer.indexOf("\n");
    }
  }

  /**
   * `processLine` — egyetlen sort dolgoz fel. A `processBuffer` belső
   * segédmetódusa.
   */
  private processLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Hibás sor — eldobjuk, a state-feed nem küld ilyet.
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj["type"] !== "string") return;
    const message = parsed as StateFeedServerMessage;
    this.options.onMessage?.(message);
    // A PING-re azonnal válaszolunk.
    if (message.type === "ping") {
      this.handlePing(message);
    }
  }

  /**
   * `handlePing` — a PING üzenetre a PONG-ot a PONG_TIMEOUT_MS-n belül
   * küldjük. A PONG `ts` mezője a PING `ts` mezőjét tükrözi (round-trip
   * latency measurement).
   */
  private handlePing(pingMessage: { readonly type: "ping"; readonly ts: number }): void {
    const pongMessage = this.options.createPong
      ? this.options.createPong(pingMessage.ts)
      : { type: "pong" as const, ts: pingMessage.ts };
    // A PONG-ot a PONG_TIMEOUT_MS-n belül kell küldeni — a `setTimeout`
    // biztosítja, hogy ha a send() blokkolna, ne legyen gond.
    setTimeout(() => {
      if (this.closed) return;
      this.send(pongMessage);
    }, 0);
  }

  // --------------------------------------------------------------------------
  // Internal — disconnect + reconnect
  // --------------------------------------------------------------------------

  /**
   * `handleDisconnect` — a socket lezárult. Ha a kliens `closed` flag-je
   * true (a `close()` hívódott), NEM reconnect-elünk. Ha a kliens
   * `closed` flag-je false (a szerver zárt le minket), a backoff timer
   * indul.
   */
  private handleDisconnect(reason: "remote" | "error" | "local"): void {
    const wasConnected = this.socket !== null;
    this.socket = null;
    this.buffer = "";
    if (wasConnected) {
      this.options.onDisconnect?.(reason);
    }
    if (this.closed) return;
    this.scheduleReconnect();
  }

  /**
   * `scheduleReconnect` — a backoff timer indítása. Az attempt számláló
   * nő, és a backoff sorozatból választunk késleltetést.
   */
  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.backoffTimer !== null) return; // Már van timer.
    this.attempt += 1;
    const idx = Math.min(this.attempt - 1, BACKOFF_SEQUENCE_MS.length - 1);
    const fallbackDelay = BACKOFF_SEQUENCE_MS[idx] ?? 30_000;
    const delay = this.attempt === 1 ? this.options.initialBackoffMs : fallbackDelay;
    this.options.onReconnectScheduled?.(delay, this.attempt);
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      void this.connect();
    }, delay);
  }

  /**
   * `clearBackoffTimer` — a backoff timer törlése.
   */
  private clearBackoffTimer(): void {
    if (this.backoffTimer !== null) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
  }
}

// ============================================================================
// Helper
// ============================================================================

/**
 * `resolveWebPort` — a CLI által használt port-feloldó. Az
 * `MM_BOT_WEB_PORT` env var-t olvassa, fallback a default 7913.
 */
export function resolveWebPort(envValue: string | undefined): number {
  if (envValue === undefined || envValue.length === 0) return 7913;
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return 7913;
  }
  return Math.floor(parsed);
}

/**
 * `resolveFeedClientPort` — a state-feed port feloldója. Az
 * `MM_BOT_FEED_PORT` env var-t olvassa, fallback a default 7914.
 */
export function resolveFeedClientPort(envValue: string | undefined): number {
  if (envValue === undefined || envValue.length === 0) return 7914;
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return 7914;
  }
  return Math.floor(parsed);
}

// Suppress unused import warning for PONG_TIMEOUT_MS (referenced in docs).
void PONG_TIMEOUT_MS;

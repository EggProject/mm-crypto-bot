/**
 * apps/bot/src/state-feed/feed-server.ts
 *
 * ============================================================================
 * PHASE 45 — STATE-FEED TCP SERVER
 * ============================================================================
 *
 * A `FeedServer` a state-feed TCP szervere. A Bun TCP API-ját
 * (`Bun.listen`) használja, és a `127.0.0.1:<port>` címen fogad
 * kapcsolatokat. A kliensek newline-delimited JSON üzeneteket
 * küldenek/fogadnak.
 *
 * ============================================================================
 * KAPCSOLAT ÉLETCIKLUS
 * ============================================================================
 *
 *   1) A kliens csatlakozik.
 *   2) A szerver HELLO üzenetet küld.
 *   3) A szerver SNAPSHOT üzenetet küld (a publisher aktuális state-jéből).
 *   4) A kliens a `subscribe` / `unsubscribe` / `control` / `pong` üzenetekkel
 *      kommunikál.
 *   5) A szerver a publisher-től kapott event-eket broadcast-olja.
 *   6) A kapcsolat bármelyik oldalról zárható.
 *
 * ============================================================================
 * LIFECYCLE
 * ============================================================================
 *
 *   - `start()` — megnyitja a TCP socketet, indítja a szervert.
 *   - `stop()`  — lezárja a socketet, minden klienset kiürít.
 *   - `port`    — a megnyitott port (visszaolvasható a `start()` után).
 *
 * ============================================================================
 * BUN TCP API
 * ============================================================================
 *   - `Bun.listen({ port, hostname, socket: { open, data, close, error } })`
 *     — a `socket` callback-ek a TCP socket lifecycle eseményeit kezelik.
 *   - A socket `write(data: string | Buffer)` aszinkron — `Promise<number>`
 *     a visszatérési érték. A Promise resolution-ja a tényleges
 *     byte-ok számát adja.
 *   - A socket `end()` küldi az FIN packet-et, és vár a remote FIN-re.
 *   - A socket `terminate()` azonnal bezárja a socketet (RST).
 *
 * A lassú / túlterhelt kliensek kezelése:
 *   - A Broadcast lassú kliens esetén `false`-t ad vissza a `write()`-ból.
 *   - A lassú klienst a `closeSlowClient` callback-en át zárjuk.
 */

import type { Socket, TCPSocketListener } from "bun";

import {
  PROTOCOL_VERSION,
  SERVER_VERSION,
  isClientMessage,
  serializeMessage,
  type StateFeedControlMessage,
  type StateFeedServerMessage,
} from "./protocol.js";
import { Broadcast, type BroadcastClient } from "./broadcast.js";
import { Heartbeat, PING_INTERVAL_MS, PONG_TIMEOUT_MS } from "./heartbeat.js";
import type { OhlcStore } from "./ohlc-store.js";
import type { LiveStatePublisher, StateFeedSnapshot } from "./publisher.js";

// ============================================================================
// Types
// ============================================================================

/** A FeedServer opciói. */
export interface FeedServerOptions {
  /** A port, amin a szerver hallgat (default: 7914). */
  readonly port: number;
  /** A hostname (default: "127.0.0.1"). */
  readonly hostname?: string;
  /** A state-feed publisher (a SNAPSHOT és a broadcast forrása). */
  readonly publisher: LiveStatePublisher;
  /**
   * `getOhlcBootstrap` — a SNAPSHOT message `ohlcBootstrap` mezőjének
   * forrása. A PR 45A-ban `undefined` (üres OHLC bootstrap), a
   * PR 45B-ben az OhlcStore-ból tölti.
   */
  readonly getOhlcBootstrap?: () => Readonly<
    Record<string, Readonly<Record<string, readonly { time: number; open: number; high: number; low: number; close: number; volume: number }[]>>>
  >;
  /**
   * `handleControl` — a CONTROL üzenetek feldolgozó callback-je.
   * A feed-server nem ismeri a bot életciklusát — a CLI indítja
   * a botot, és a feed-server ezen a callback-en keresztül küld
   * start / stop / pause / kill_switch parancsokat a botnak.
   */
  readonly handleControl?: (command: StateFeedControlMessage["command"], payload: StateFeedControlMessage) => void | Promise<void>;
  /**
   * `handlePong` — a PONG üzenetek feldolgozó callback-je. A PR 45B
   * heartbeat-jét ez táplálja; a PR 45A-ban `undefined` (nincs heartbeat
   * timeout).
   */
  readonly handlePong?: (clientId: string, ts: number) => void;
  /** A heartbeat ping interval (ms). Default: 10000. */
  readonly pingIntervalMs?: number;
  /** A heartbeat pong timeout (ms). Default: 30000. */
  readonly pongTimeoutMs?: number;
  /** Az OHLC store (PR 45B). A `getOhlcBootstrap` helyett használható. */
  readonly ohlcStore?: OhlcStore;
}

/** A `FeedServer` indítása után elérhető handle. */
export interface FeedServerHandle {
  /** A megnyitott port (visszaolvasható a `start()` után). */
  readonly port: number;
  /** A megnyitott hostname. */
  readonly hostname: string;
  /** A feed-server leállítása + minden kliens lezárása. */
  stop(): Promise<void>;
  /** Az aktuális kliens-szám. */
  clientCount(): number;
}

// ============================================================================
// Internal — per-socket state
// ============================================================================

interface SocketState {
  /** A Broadcast által kiosztott kliens-azonosító. */
  readonly clientId: string;
  /** A parancsolt várakozó sor — az adott socketre küldendő sorok. */
  readonly writeQueue: string[];
  /** Az aktuális write folyamatban van-e. */
  writing: boolean;
  /** A socket zárt-e. */
  closed: boolean;
}

/** A bun socket type alias. A Bun TCPSocket extends `Socket<Data>`, ahol
 *  a Data a TCPSocketListener generic paramétere. A listener default
 *  generic paramétere `unknown` — a handler callback-ok `Socket<unknown>`
 *  típust kapnak. A `BunSocket` alias ezt a tényleges típust tükrözi. */
type BunSocket = Socket<unknown>;

// ============================================================================
// FeedServer
// ============================================================================

/**
 * `FeedServer` — a state-feed TCP szervere.
 *
 * A `start()` metódus hívásával indul, a `stop()` metódussal áll le.
 * A `Bun.TCPSocketListener`-t használja, és minden klienshez
 * egyedi `SocketState`-et rendel.
 */
export class FeedServer {
  private readonly options: FeedServerOptions;
  private readonly broadcast: Broadcast;
  private server: TCPSocketListener | null = null;
  private readonly socketStates = new Map<BunSocket, SocketState>();
  private running = false;
  /** A Heartbeat instance (PR 45B). */
  private heartbeat: Heartbeat | null = null;

  public constructor(options: FeedServerOptions) {
    this.options = options;
    this.broadcast = new Broadcast();
  }

  /**
   * `start` — megnyitja a TCP socketet, és elindítja a broadcast
   * szálat. A `Bun.listen` a port 0 esetén ephemeral portot ad —
   * a `port` mező a tényleges portot olvassa vissza.
   */
  public start(): Promise<FeedServerHandle> {
    if (this.running) {
      return Promise.reject(new Error("FeedServer: already running"));
    }
    const hostname = this.options.hostname ?? "127.0.0.1";
    this.server = Bun.listen({
      port: this.options.port,
      hostname,
      socket: {
        open: this.handleOpen.bind(this),
        data: this.handleData.bind(this),
        close: this.handleClose.bind(this),
        error: this.handleError.bind(this),
        connectError: this.handleConnectErrorBound.bind(this),
      },
    });
    this.running = true;
    // A publisher event-emitter-ére feliratkozunk.
    const unsubscribe = this.options.publisher.addEventListener((event) => {
      this.handlePublisherEvent(event);
    });
    // A handle `stop` metódusa az unsubscribe-öt is hívja.
    this.cleanup = unsubscribe;
    // A Heartbeat indítása (PR 45B). A PING üzeneteket a broadcast-on
    // át küldjük; a lassú klienseket a closeSocket-on át zárjuk.
    this.heartbeat = new Heartbeat({
      pingIntervalMs: this.options.pingIntervalMs ?? PING_INTERVAL_MS,
      pongTimeoutMs: this.options.pongTimeoutMs ?? PONG_TIMEOUT_MS,
      callbacks: {
        onPing: (pingMessage) => {
          this.broadcast.publish(pingMessage);
        },
        onSlowClient: (clientId) => {
          this.closeSocketByClientId(clientId);
        },
      },
    });
    this.heartbeat.start();
    return Promise.resolve({
      port: this.server.port,
      hostname: this.server.hostname,
      stop: () => this.stop(),
      clientCount: () => this.broadcast.clientCount(),
    });
  }

  /** A publisher-emit leiratkozás. */
  private cleanup: (() => void) | null = null;

  /**
   * `stop` — lezárja a TCP socketet, és minden klienset kiürít.
   */
  public stop(): Promise<void> {
    if (!this.running) return Promise.resolve();
    this.running = false;
    if (this.cleanup !== null) {
      this.cleanup();
      this.cleanup = null;
    }
    if (this.server !== null) {
      this.server.stop();
      this.server = null;
    }
    if (this.heartbeat !== null) {
      this.heartbeat.stop();
      this.heartbeat = null;
    }
    this.broadcast.closeAll();
    this.socketStates.clear();
    return Promise.resolve();
  }

  /**
   * `handleOpen` — új kliens csatlakozott. A broadcast-ba regisztráljuk,
   * és a sorban álló HELLO + SNAPSHOT üzeneteket küldjük.
   */
  private handleOpen(socket: BunSocket): void {
    const adapter = this.adaptSocket(socket);
    const clientId = this.broadcast.addClient(adapter);
    const state: SocketState = {
      clientId,
      writeQueue: [],
      writing: false,
      closed: false,
    };
    this.socketStates.set(socket, state);
    // A heartbeat regisztrálja az új klienst (30s PONG timeout indul).
    if (this.heartbeat !== null) {
      this.heartbeat.registerClient(clientId);
    }

    // HELLO + SNAPSHOT a sor elejére.
    const helloMessage: StateFeedServerMessage = {
      type: "hello",
      ts: Date.now(),
      serverVersion: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    };
    const snapshotMessage: StateFeedServerMessage = {
      type: "snapshot",
      ts: Date.now(),
      snapshot: this.options.publisher.getSnapshot(),
      ohlcBootstrap: this.resolveOhlcBootstrap(),
    };
    this.enqueueWrite(socket, serializeMessage(helloMessage));
    this.enqueueWrite(socket, serializeMessage(snapshotMessage));
  }

  /**
   * `handleData` — a kliens adatot küldött. A newline-delimited JSON-t
   * sorokra bontjuk, és minden sort parse-olunk. A sor ESETLEG
   * több sort is tartalmaz (a TCP Nagle-algoritmus miatt); a
   * `splitLines` a pontos határokon vág.
   */
  private handleData(socket: BunSocket, data: Buffer): void {
    const state = this.socketStates.get(socket);
    if (state === undefined || state.closed) return;

    // A parser-accumulator a socketen.
    const text = data.toString("utf-8");
    this.parseAndRoute(socket, state, text);
  }

  /**
   * A socket parser-accumulatora. Külön tároljuk per-socket, mert
   * egy `data()` callback több sort is kaphat.
   */
  private readonly socketBuffers = new WeakMap<BunSocket, string>();

  /**
   * `parseAndRoute` — a `text`-ben lévő sorokra bontja a socket
   * üzeneteit, és minden sort a `routeClientMessage` felé továbbít.
   * A TCP split (Nagle) esetén a sor egy része a korábbi
   * callback-ből maradt; az accumulator per-socket.
   */
  private parseAndRoute(socket: BunSocket, state: SocketState, text: string): void {
    let buffer = this.socketBuffers.get(socket) ?? "";
    buffer += text;
    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        this.routeClientMessage(socket, state, line);
      }
      newlineIdx = buffer.indexOf("\n");
    }
    this.socketBuffers.set(socket, buffer);
  }

  /**
   * `routeClientMessage` — egy kliensről jövő sort feldolgoz.
   * Ismeretlen / érvénytelen üzenet esetén a socketet lezárja.
   */
  private routeClientMessage(socket: BunSocket, state: SocketState, line: string): void {
    if (state.closed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.handleProtocolError(socket, "invalid JSON");
      return;
    }
    if (!isClientMessage(parsed)) {
      this.handleProtocolError(socket, "unknown message type");
      return;
    }
    // A Broadcast alkalmazza a SUBSCRIBE / UNSUBSCRIBE / PONG üzeneteket.
    this.broadcast.applyClientMessage(
      state.clientId,
      parsed,
      parsed.type === "pong"
        ? (ts) => {
            // A PONG-ot a heartbeat is feldolgozza (PR 45B).
            if (this.heartbeat !== null) {
              this.heartbeat.recordPong(state.clientId);
            }
            this.options.handlePong?.(state.clientId, ts);
          }
        : undefined,
    );
    // A CONTROL üzeneteket a `handleControl` callback-en át küldjük.
    if (parsed.type === "control" && this.options.handleControl !== undefined) {
      try {
        const result = this.options.handleControl(parsed.command, parsed);
        if (result instanceof Promise) {
          void result.catch(() => {
            // A control handler hibája nem állíthatja le a szervert.
          });
        }
      } catch {
        // best-effort
      }
    }
  }

  /**
   * `handleProtocolError` — a kliens hibás üzenetet küldött.
   * ERROR üzenettel válaszolunk, és zárjuk a socketet.
   */
  private handleProtocolError(socket: BunSocket, message: string): void {
    const errorMsg: StateFeedServerMessage = {
      type: "error",
      ts: Date.now(),
      message: `protocol error: ${message}`,
      recoverable: false,
    };
    this.enqueueWrite(socket, serializeMessage(errorMsg));
    // A sor kiürítése után zárunk.
    setTimeout(() => {
      this.closeSocket(socket);
    }, 50);
  }

  /**
   * `handleClose` — a kliens socketje lezárult.
   */
  private handleClose(socket: BunSocket): void {
    this.closeSocket(socket);
  }

  /**
   * `handleError` — a socketen hiba történt.
   */
  private handleError(socket: BunSocket, error: Error): void {
    // A hibát a stderr-re írjuk, de a feed-server nem áll le.
    process.stderr.write(`[feed-server] socket error: ${error.message}\n`);
    this.closeSocket(socket);
  }

  /**
   * `handleConnectErrorBound` — a `Bun.listen` socket connectError
   * callback signature-jéhez illeszkedő wrapper (a `connectError` a
   * socket paramétert is átadja, de a mi esetünkben nincs rá szükség).
   * A függvény a `handleConnectError`-t hívja.
   */
  private handleConnectErrorBound(_socket: BunSocket, error: Error): void {
    this.handleConnectError(error);
  }

  /**
   * `handleConnectError` — a TCP listen socket connect-acceptance
   * hibája (ritka, de a Bun API megköveteli).
   */
  private handleConnectError(error: Error): void {
    process.stderr.write(`[feed-server] connect error: ${error.message}\n`);
  }

  /**
   * `closeSocket` — a socket lezárása + a broadcast-ból való
   * eltávolítás.
   */
  private closeSocket(socket: BunSocket): void {
    const state = this.socketStates.get(socket);
    if (state === undefined) return;
    if (state.closed) return;
    state.closed = true;
    state.writeQueue.length = 0;
    this.broadcast.removeClient(state.clientId);
    if (this.heartbeat !== null) {
      this.heartbeat.unregisterClient(state.clientId);
    }
    this.socketStates.delete(socket);
    this.socketBuffers.delete(socket);
    try {
      socket.end();
    } catch {
      // best-effort
    }
  }

  /**
   * `closeSocketByClientId` — a heartbeat callback-je által hívott
   * lezáró. A clientId → socket mapping a socketStates map-en át
   * fordított iterációval működik.
   */
  private closeSocketByClientId(clientId: string): void {
    for (const [socket, state] of this.socketStates) {
      if (state.clientId === clientId) {
        this.closeSocket(socket);
        return;
      }
    }
  }

  /**
   * `resolveOhlcBootstrap` — az OHLC bootstrap forrása. A `ohlcStore`
   * opciót használja, ha van; egyébként a `getOhlcBootstrap` callback-re
   * fallbackel; végső esetben üres objektum.
   */
  private resolveOhlcBootstrap(): Readonly<Record<string, Readonly<Record<string, readonly { time: number; open: number; high: number; low: number; close: number; volume: number }[]>>>> {
    if (this.options.ohlcStore !== undefined) {
      return this.options.ohlcStore.getAll();
    }
    if (this.options.getOhlcBootstrap !== undefined) {
      return this.options.getOhlcBootstrap();
    }
    return {};
  }

  /**
   * `enqueueWrite` — egy üzenet a socket writeQueue-jába. Ha
   * a queue üres, a write azonnal elindul.
   */
  private enqueueWrite(socket: BunSocket, data: string): void {
    const state = this.socketStates.get(socket);
    if (state === undefined || state.closed) return;
    state.writeQueue.push(data);
    if (!state.writing) {
      this.flushQueue(socket);
    }
  }

  /**
   * `flushQueue` — a writeQueue-t üríti. Lassú / hibás socket
   * esetén a socket lezárandó.
   */
  private flushQueue(socket: BunSocket): void {
    const state = this.socketStates.get(socket);
    if (state === undefined || state.closed) return;
    if (state.writeQueue.length === 0) {
      state.writing = false;
      return;
    }
    state.writing = true;
    const data = state.writeQueue.shift()!;
    try {
      // A Bun.socket.write() a bájtok számát adja vissza. Ha -1,
      // a socket zárva van. Az enqueueWrite a sorban álló elemeket
      // egymás után írja (minden hívás egy-egy shift + write).
      const written = socket.write(data);
      if (written === -1) {
        this.closeSocket(socket);
        return;
      }
      // A sor kiürült (a shift előtti hossz = 1 volt). Ha a sor
      // továbbra is tartalmaz elemet, a következő tick-en folytatjuk
      // — az enqueueWrite a sorba helyezett elemeket a flushQueue
      // hívásával dolgozza fel.
      state.writing = false;
    } catch {
      this.closeSocket(socket);
    }
  }

  /**
   * `adaptSocket` — a TCP socketet a BroadcastClient interfészhez
   * adaptálja.
   */
  private adaptSocket(socket: BunSocket): BroadcastClient {
    const remote = socket.remoteAddress;
    const id = remote !== "" ? remote : "unknown";
    return {
      id,
      write: (data: string): boolean => {
        const state = this.socketStates.get(socket);
        if (state === undefined || state.closed) return false;
        this.enqueueWrite(socket, data);
        return true;
      },
      close: (): void => {
        this.closeSocket(socket);
      },
    };
  }

  /**
   * `handlePublisherEvent` — a publisher-től kapott event-et
   * broadcast-olja. A `snapshot` event-ből SNAPSHOT message-t
   * készít, a többi event-ből a megfelelő típusú üzenetet.
   */
  private handlePublisherEvent(event: { type: string }): void {
    if (event.type === "snapshot") {
      const snap = this.options.publisher.getSnapshot();
      const message: StateFeedServerMessage = {
        type: "snapshot",
        ts: Date.now(),
        snapshot: snap,
        ohlcBootstrap: this.resolveOhlcBootstrap(),
      };
      this.broadcast.publish(message);
      return;
    }
    if (event.type === "state") {
      const snap = this.options.publisher.getSnapshot();
      const message: StateFeedServerMessage = {
        type: "state",
        ts: Date.now(),
        snapshot: snap,
      };
      this.broadcast.publish(message);
      return;
    }
    if (event.type === "engine-error") {
      // Az engine-error message-t a snapshot engineError mezőjéből
      // képezzük. Ha a snapshot engineError null, NEM küldünk
      // (a recovery flow-hoz tartozik).
      const snap = this.options.publisher.getSnapshot();
      if (snap.status.engineError !== null) {
        const message: StateFeedServerMessage = {
          type: "error",
          ts: Date.now(),
          message: snap.status.engineError,
          recoverable: true,
        };
        this.broadcast.publish(message);
      }
      return;
    }
    if (event.type === "error") {
      // A publishError() által kiadott közvetlen error event —
      // a broadcast-on át megy a kliensnek.
      const e = event as { type: "error"; message: string; recoverable: boolean };
      const message: StateFeedServerMessage = {
        type: "error",
        ts: Date.now(),
        message: e.message,
        recoverable: e.recoverable,
      };
      this.broadcast.publish(message);
      return;
    }
    if (event.type === "tick") {
      const e = event as { type: "tick"; symbol: string; price: number };
      const message: StateFeedServerMessage = {
        type: "tick",
        ts: Date.now(),
        symbol: e.symbol,
        price: e.price,
      };
      this.broadcast.publish(message);
      return;
    }
    if (event.type === "bar") {
      const e = event as {
        type: "bar";
        symbol: string;
        timeframe: string;
        ohlc: { time: number; open: number; high: number; low: number; close: number; volume: number };
      };
      // Az OHLC store-ba is pusholunk (a SNAPSHOT bootstrap frissítéséhez).
      if (this.options.ohlcStore !== undefined) {
        this.options.ohlcStore.pushBar(e.symbol, e.timeframe, e.ohlc);
      }
      const message: StateFeedServerMessage = {
        type: "bar",
        ts: Date.now(),
        symbol: e.symbol,
        timeframe: e.timeframe,
        ohlc: e.ohlc,
      };
      this.broadcast.publish(message);
      return;
    }
    if (event.type === "indicator") {
      const e = event as {
        type: "indicator";
        symbol: string;
        strategy: string;
        timeframe: string;
        indicator: string;
        series: Readonly<Record<string, readonly (number | null)[]>>;
      };
      const message: StateFeedServerMessage = {
        type: "indicator",
        ts: Date.now(),
        symbol: e.symbol,
        strategy: e.strategy,
        timeframe: e.timeframe,
        indicator: e.indicator,
        series: e.series,
      };
      this.broadcast.publish(message);
      return;
    }
    if (event.type === "marker") {
      const e = event as {
        type: "marker";
        symbol: string;
        strategy: string;
        timeframe: string;
        side: "long" | "short" | "buy" | "sell";
        price: number;
        label: string;
      };
      const message: StateFeedServerMessage = {
        type: "marker",
        ts: Date.now(),
        symbol: e.symbol,
        strategy: e.strategy,
        timeframe: e.timeframe,
        side: e.side,
        price: e.price,
        label: e.label,
      };
      this.broadcast.publish(message);
      return;
    }
    // További event típusok (started, stopped, kill-switch, paused)
    // jelenleg a snapshot/state event-ekben jelennek meg; a jövőbeli
    // Phase 46+ refaktorálás külön state-update event-ekké alakíthatja.
  }

  /**
   * `getBroadcast` — a broadcast manager (tesztelési célokra).
   */
  public getBroadcast(): Broadcast {
    return this.broadcast;
  }

  /**
   * `snapshot` — a publisher-ből olvasott snapshot (a handlePublish
   * teszteléséhez).
   */
  public currentSnapshot(): StateFeedSnapshot {
    return this.options.publisher.getSnapshot();
  }
}

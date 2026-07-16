/**
 * apps/bot/src/state-feed/broadcast.ts
 *
 * ============================================================================
 * PHASE 45 — STATE-FEED MULTI-CLIENT BROADCAST
 * ============================================================================
 *
 * A `Broadcast` osztály a state-feed szerver központi eleme: ő kezeli
 * a csatlakozott klienseket, a per-kliens subscription-táblát, és a
 * 4 Hz-es tick throttlingot.
 *
 * ============================================================================
 * DESIGN
 * ============================================================================
 *
 *   - Minden klienshez saját `ClientState` tartozik: subscription
 *     set, last-tick-ts per symbol, write-buffer (socket referenciával
 *     együtt), és egy `sendQueue` a lassú kliensek pufferezésére.
 *
 *   - A TICK üzenetek throttlingja per-(kliens, symbol) történik:
 *     ha az utolsó tick < 250ms (4 Hz), a tick eldobódik. Más
 *     üzenetek (BAR, INDICATOR, MARKER, STATE, ERROR, PING) azonnal
 *     mennek minden kliensnek, akinek a subscription szűrője
 *     engedi.
 *
 *   - A HELLO és SNAPSHOT üzenetek minden kliensnek mennek (nincs
 *     szűrés — ezek a csatlakozás utáni kötelező üzenetek).
 *
 *   - A SUBSCRIBE / UNSUBSCRIBE üzenetek CSAK az adott kliens
 *     subscription-tábláját módosítják. Ha a kliens megszűnik,
 *     a tábla is törlődik.
 *
 * ============================================================================
 * THREAD SAFETY
 * ============================================================================
 * A Broadcast osztály a Bun egy-szálú event-loop-jában fut —
 * nincs szükség mutex-re. A `socket.write()` aszinkron, de a
 * sorrend megmarad (Bun ígéri).
 */

import type {
  StateFeedClientMessage,
  StateFeedServerMessage,
} from "./protocol.js";
// StateFeedServerMessage is used as the type parameter in publish() below.


// ============================================================================
// Configuration
// ============================================================================

/** A TICK üzenetek throttling-rátája (Hz). 4 Hz → 250ms. */
export const TICK_THROTTLE_HZ = 4 as const;

/** A throttling ablak mérete ms-ban. */
export const TICK_THROTTLE_MS = Math.floor(1000 / TICK_THROTTLE_HZ);

// ============================================================================
// Client interface (what the Broadcast needs from a TCP socket)
// ============================================================================

/**
 * Az absztrakt kliens — a Broadcast nem ismeri a `bun:net`-et, csak
 * az `write` + `close` API-t. A feed-server adaptálja a TCP socketet
 * ehhez az interfészhez.
 */
export interface BroadcastClient {
  /** A kliens egyedi azonosítója (debug célokra). */
  readonly id: string;
  /** Üzenet küldése a kliensnek. Best-effort — ha a buffer tele van,
   * a függvény hamisat ad vissza (a kliens lezárandó). */
  write(data: string): boolean;
  /** A kliens kapcsolatának lezárása. */
  close(): void;
}

// ============================================================================
// Client state
// ============================================================================

/**
 * Egy kliens subscription-táblája. A `Set<string>` a `(symbol|tf)` párokat
 * tárolja — csak a match-ölő üzenetek mennek a kliensnek.
 *
 * Ha a kliens NEM küldött SUBSCRIBE-ot, az üres Set-et használjuk —
 * ez az alapértelmezés: CSAK a TICK / STATE / BAR / INDICATOR /
 * MARKER / ERROR / PING üzenetek mennek, és a tick-throttling is
 * érvényes. A HELLO / SNAPSHOT mindig megy.
 */
interface ClientState {
  readonly client: BroadcastClient;
  /** `(symbol)|(timeframe)` kulcsok halmaza. */
  readonly subscriptions: Set<string>;
  /** Per-symbol last-tick-ts (ms). */
  readonly lastTickMs: Map<string, number>;
  /** A kliens zárt-e (cleanup flag). */
  closed: boolean;
}

function subscriptionKey(symbol: string, timeframe: string): string {
  return `${symbol}|${timeframe}`;
}

// ============================================================================
// Broadcast
// ============================================================================

/**
 * `Broadcast` — a state-feed multi-client broadcast manager.
 *
 * A feed-server hozza létre, és minden publish-nál (a publisher-től
 * kapott event-re) meghívja a `publish(message)` metódust. A
 * `Broadcast` felel a subscription-szűrésért és a 4 Hz throttling-ért.
 */
export class Broadcast {
  private readonly clients = new Map<string, ClientState>();
  private nextClientId = 1;

  /**
   * `addClient` — új kliens regisztrálása a broadcast táblába.
   *
   * A kliens subscription táblája üres — amíg a kliens SUBSCRIBE-ot
   * nem küld, a tick / bar / indicator / marker üzenetek NEM mennek
   * a kliensnek (a HELLO, SNAPSHOT, STATE, ERROR, PING viszont igen).
   */
  public addClient(client: BroadcastClient): string {
    const id = `${client.id}-${String(this.nextClientId++)}`;
    this.clients.set(id, {
      client,
      subscriptions: new Set<string>(),
      lastTickMs: new Map<string, number>(),
      closed: false,
    });
    return id;
  }

  /**
   * `removeClient` — kliens eltávolítása a broadcast táblából
   * (a socket lezárásakor hívódik).
   */
  public removeClient(clientId: string): void {
    const state = this.clients.get(clientId);
    if (state === undefined) return;
    state.closed = true;
    this.clients.delete(clientId);
  }

  /**
   * `subscribe` — kliens feliratkoztatása egy (symbol, timeframe) szűrőre.
   *
   * A SUBSCRIBE üzenet idempotens: a duplikált hívás nem okoz változást.
   * A hívás TÖBBSZÖR ismételhető ugyanazzal a kulccsal.
   */
  public subscribe(clientId: string, symbol: string, timeframe: string): void {
    const state = this.clients.get(clientId);
    if (state === undefined || state.closed) return;
    state.subscriptions.add(subscriptionKey(symbol, timeframe));
    // Új szűrő → a throttle ablakot is töröljük, hogy a kliens
    // azonnal kapjon friss tick-et (ne a throttling-ablakba ragadjon).
    state.lastTickMs.delete(symbol);
  }

  /**
   * `unsubscribe` — kliens leiratkoztatása. Idempotens.
   */
  public unsubscribe(clientId: string, symbol: string, timeframe: string): void {
    const state = this.clients.get(clientId);
    if (state === undefined || state.closed) return;
    state.subscriptions.delete(subscriptionKey(symbol, timeframe));
  }

  /**
   * `applyClientMessage` — egy kliensről jövő üzenet feldolgozása
   * (SUBSCRIBE / UNSUBSCRIBE / CONTROL / PONG).
   *
   * A CONTROL üzenetek NEM a Broadcast-hoz tartoznak — a feed-server
   * a `handleControl` callback-en keresztül dolgozza fel. Ez a
   * metódus CSAK a subscription-táblát módosítja, és a PONG-ot
   * a heartbeat handler felé jelzi (callback-en át).
   */
  public applyClientMessage(
    clientId: string,
    message: StateFeedClientMessage,
    onPong?: (ts: number) => void,
  ): void {
    if (message.type === "subscribe") {
      this.subscribe(clientId, message.symbol, message.timeframe);
    } else if (message.type === "unsubscribe") {
      this.unsubscribe(clientId, message.symbol, message.timeframe);
    } else if (message.type === "pong") {
      if (onPong !== undefined) onPong(message.ts);
    }
    // A `control` üzeneteket a feed-server kezeli — itt nincs teendő.
  }

  /**
   * `publish` — egy szerver-üzenet kiküldése minden megfelelő kliensnek.
   *
   * Szűrési logika:
   *   - HELLO, SNAPSHOT, STATE, ERROR, PING: MINDEN kliensnek megy.
   *   - TICK: throttling per (kliens, symbol) + subscription check.
   *     A throttling CSAK a TICK-re érvényes.
   *   - BAR, INDICATOR, MARKER: subscription check (symbol+timeframe).
   *
   * A lassú kliensek `write()` hamisat adhatnak — ilyenkor a kliens
   * lezárandó (a hívó `flushSlowClients` callback-je dolgozza fel).
   */
  public publish(
    message: StateFeedServerMessage,
    onSlowClient?: (clientId: string) => void,
    now: number = Date.now(),
  ): void {
    for (const [clientId, state] of this.clients) {
      if (state.closed) continue;
      if (!this.shouldSendToClient(state, message, now)) continue;
      const ok = state.client.write(JSON.stringify(message) + "\n");
      if (!ok && onSlowClient !== undefined) {
        onSlowClient(clientId);
      }
    }
  }

  /**
   * `shouldSendToClient` — eldönti, hogy az adott üzenet elküldendő-e
   * a kliensnek (szűrés + throttling).
   */
  private shouldSendToClient(
    state: ClientState,
    message: StateFeedServerMessage,
    now: number,
  ): boolean {
    if (
      message.type === "hello" ||
      message.type === "snapshot" ||
      message.type === "state" ||
      message.type === "error" ||
      message.type === "ping"
    ) {
      return true;
    }
    if (message.type === "tick") {
      // Subscription check: ha a kliens NEM subscribed a symbol-ra
      // (bármely tf-en), a tick nem megy. Ha subscribed, de a throttle
      // ablakban van, szintén nem megy.
      const isSubscribed = this.isSubscribedToSymbol(state, message.symbol);
      if (!isSubscribed) return false;
      const last = state.lastTickMs.get(message.symbol);
      if (last === undefined) {
        state.lastTickMs.set(message.symbol, now);
        return true;
      }
      if (now - last < TICK_THROTTLE_MS) return false;
      state.lastTickMs.set(message.symbol, now);
      return true;
    }
    if (message.type === "bar") {
      // BAR subscription filter: (symbol, tf) exact match.
      return state.subscriptions.has(subscriptionKey(message.symbol, message.timeframe));
    }
    // Az INDICATOR / MARKER subscription filter-e egységes: a
    // kliens csak akkor kapja meg, ha a (symbol, tf) kulcsra
    // subscribed. A többi típust az előző if-ágak kizárták.
    // A típus-narrowing miatt a `message` itt `indicator` VAGY
    // `marker`; mindkettő subscription-szűrése azonos.
    return state.subscriptions.has(subscriptionKey(message.symbol, message.timeframe));
  }

  /**
   * `isSubscribedToSymbol` — a kliens subscribed-e a symbol-ra
   * BÁRMELY timeframe-en.
   *
   * A TICK subscription nem kötődik timeframe-höz (a tick minden
   //  tf-re hatással van, mert az ár symbol-szintű).
   * Ha a subscriptions Set tartalmaz `SYMBOL|*` kulcsot, vagy
   * bármely `SYMBOL|tf` kulcsot, a kliens megkapja a tick-et.
   *
   * Ha a subscriptions Set ÜRES, a kliens a "minden tf" alapértelmezést
   * kapja (a bot minden enabled symbol-ját megkapja tick-en).
   */
  private isSubscribedToSymbol(state: ClientState, symbol: string): boolean {
    if (state.subscriptions.size === 0) return true;
    const prefix = `${symbol}|`;
    for (const key of state.subscriptions) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  /**
   * `clientCount` — a jelenleg csatlakozott (nem zárt) kliensek száma.
   * A feed-server a snapshot+metrics riportokhoz használja.
   */
  public clientCount(): number {
    return this.clients.size;
  }

  /**
   * `getSubscriptions` — a kliens subscription listája (debug + teszt).
   */
  public getSubscriptions(clientId: string): readonly string[] {
    const state = this.clients.get(clientId);
    if (state === undefined) return [];
    return [...state.subscriptions];
  }

  /**
   * `closeAll` — minden kliens lezárása (a feed-server shutdown-jakor).
   */
  public closeAll(): void {
    for (const [, state] of this.clients) {
      if (!state.closed) {
        state.closed = true;
        try {
          state.client.close();
        } catch {
          // best-effort
        }
      }
    }
    this.clients.clear();
  }
}



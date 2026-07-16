/**
 * apps/bot/src/state-feed/heartbeat.ts
 *
 * ============================================================================
 * PHASE 45B — STATE-FEED HEARTBEAT
 * ============================================================================
 *
 * A `Heartbeat` a state-feed TCP szerver heartbeat-kezelője. A szerver
 * 10 másodpercenként `PING` üzenetet küld minden kliensnek, és 30
 * másodpercen belül várja a `PONG` választ. Ha egy kliens 30 másodpercig
 * nem válaszol, a socket lezárul.
 *
 * ============================================================================
 * DESIGN
 * ============================================================================
 *
 *   - A PING üzeneteket a feed-server egy `setInterval` tick-en küldi
 *     (nem per-socket). A tick 10 másodpercenként fut; minden kliens
 *     ugyanazt a PING ts-t kapja (a TS a `Date.now()` értéke a tick-ben).
 *
 *   - A PONG nyomon követése per-socket: egy `clientId → lastPongMs` map.
 *     A `recordPong(clientId)` frissíti a `lastPongMs`-t.
 *
 *   - Az ellenőrzés ugyanabban a tick-ben történik: minden kliens
 *     `lastPongMs`-ét összehasonlítjuk a `now - 30_000` küszöbbel.
 *     Ha egy kliens túllépte, a `closeSlowClient(clientId)` callback
 *     hívódik.
 *
 *   - A `stop()` leállítja a tick-et. A `Heartbeat` maga NEM zárja
 *     a socketeket — csak a callback-en át jelzi, hogy mely klienseket
 *     kell zárni.
 *
 * ============================================================================
 * WHY 10s/30s
 * ============================================================================
 *
 *   - 10s PING gyakoriság → a kliensnek elég ideje van a PONG-ra
 *     (3 tűrési ablak).
 *   - 30s PONG timeout → egy lassú hálózatú kliens sem veszik el
 *     azonnal, de a holt klienseket gyorsan kitakarítjuk.
 *   - A 10/30 arány conservative (3x); Phase 50+ csökkentheti, ha
 *     a kliens oldal megbízhatóbb.
 */

import type { StateFeedServerMessage } from "./protocol.js";

// ============================================================================
// Constants
// ============================================================================

/** A PING üzenetek küldésének gyakorisága (ms). */
export const PING_INTERVAL_MS = 10_000 as const;

/** A PONG válasz maximális késleltetése (ms). */
export const PONG_TIMEOUT_MS = 30_000 as const;

// ============================================================================
// Types
// ============================================================================

/** A heartbeat tick callback-jének típusa. */
export interface HeartbeatCallbacks {
  /** A PING üzenet, amit minden kliensnek ki kell küldeni. */
  readonly onPing: (pingMessage: StateFeedServerMessage) => void;
  /**
   * `onSlowClient` — a 30s PONG túllépés miatt lezárandó kliens
   * azonosítója. A feed-server ezt a callback-et a `closeSocket`
   * metódusával köti össze.
   */
  readonly onSlowClient: (clientId: string) => void;
}

/** A `Heartbeat` opciói. */
export interface HeartbeatOptions {
  /** A callback-ek. */
  readonly callbacks: HeartbeatCallbacks;
  /** Opcionális egyedi ping interval (tesztekhez). */
  readonly pingIntervalMs?: number;
  /** Opcionális egyedi pong timeout (tesztekhez). */
  readonly pongTimeoutMs?: number;
}

// ============================================================================
// Heartbeat
// ============================================================================

/**
 * `Heartbeat` — a state-feed heartbeat-kezelője.
 *
 * A `start()` metódus hívásával indul, a `stop()`-pal áll le. A
 * konstruktorban kapott callback-eken át kommunikál a feed-serverrel.
 */
export class Heartbeat {
  private readonly callbacks: HeartbeatCallbacks;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly lastPongMs = new Map<string, number>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  public constructor(options: HeartbeatOptions) {
    this.callbacks = options.callbacks;
    this.pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
    this.pongTimeoutMs = options.pongTimeoutMs ?? PONG_TIMEOUT_MS;
  }

  /**
   * `start` — elindítja a heartbeat tick-et.
   *
   * A metódus NEM ellenőrzi a `running` flag-et — a második hívás
   * kivételt dob, hogy a kettős indítást elkerüljük.
   */
  public start(): void {
    if (this.running) {
      throw new Error("Heartbeat: already running");
    }
    this.running = true;
    this.intervalHandle = setInterval(this.tick.bind(this), this.pingIntervalMs);
  }

  /**
   * `stop` — leállítja a tick-et.
   *
   * A metódus idempotens: a második hívás nem dob kivételt.
   */
  public stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.lastPongMs.clear();
  }

  /**
   * `registerClient` — új kliens regisztrálása. A `lastPongMs` a
   * jelenlegi időre állítódik (az új kliensnek van 30s ideje az
   * első PONG-ra).
   */
  public registerClient(clientId: string, now: number = Date.now()): void {
    this.lastPongMs.set(clientId, now);
  }

  /**
   * `unregisterClient` — kliens eltávolítása (socket lezárásakor).
   */
  public unregisterClient(clientId: string): void {
    this.lastPongMs.delete(clientId);
  }

  /**
   * `recordPong` — a kliens PONG üzenetét regisztrálja. Frissíti a
   * `lastPongMs`-t a jelenlegi időre.
   *
   * A PONG üzenet a feed-server `handlePong` callback-jén át hívódik.
   */
  public recordPong(clientId: string, now: number = Date.now()): void {
    this.lastPongMs.set(clientId, now);
  }

  /**
   * `tick` — a PING üzenet kiküldése + a lassú kliensek azonosítása.
   *
   * A metódus belső, a `setInterval` hívja. A `now` paraméter a
   * tesztek számára van (hogy ne kelljen `Date.now()`-ra támaszkodni).
   */
  public tick(now: number = Date.now()): void {
    if (!this.running) return;
    // A PING üzenet kiküldése a callback-en át.
    const pingMessage: StateFeedServerMessage = { type: "ping", ts: now };
    this.callbacks.onPing(pingMessage);
    // A lassú kliensek azonosítása.
    const threshold = now - this.pongTimeoutMs;
    for (const [clientId, lastPong] of this.lastPongMs) {
      if (lastPong < threshold) {
        this.callbacks.onSlowClient(clientId);
      }
    }
  }

  /**
   * `getLastPongMs` — a kliens utolsó PONG timestamp-je (teszteléshez).
   */
  public getLastPongMs(clientId: string): number | undefined {
    return this.lastPongMs.get(clientId);
  }

  /**
   * `isRunning` — true a `start()` és `stop()` között.
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * `getTrackedClientCount` — a nyomon követett kliensek száma.
   */
  public getTrackedClientCount(): number {
    return this.lastPongMs.size;
  }
}

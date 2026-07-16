/**
 * apps/bot/src/state-feed/index.ts
 *
 * ============================================================================
 * PHASE 45 — STATE-FEED ENTRY POINT
 * ============================================================================
 *
 * Az `attachStateFeed(bot, opts)` a state-feed életciklus-kezelője.
 * A `Bot` példányhoz csatlakoztatja a `LiveStatePublisher`-t és a
 * `FeedServer`-t, és visszaadja a `StateFeedHandle`-t, amivel a
 * `mm-bot start` (vagy a teszt) le tudja állítani a szervert.
 *
 * ============================================================================
 * MIÉRT KÜLÖN MODUL?
 * ============================================================================
 *   A `LiveStatePublisher` (Phase 44-ben hoztuk létre) a bot state-jét
 *   `addEventListener` / `emit` API-n keresztül publikálja. A Phase 45
 *   state-feed TCP szervere ezt az API-t használja a broadcast-hoz.
 *
 *   Az `attachStateFeed` a kettőt összeköti:
 *     1) Létrehoz egy `LiveStatePublisher`-t (vagy fogadja a meglévőt).
 *     2) Létrehoz egy `FeedServer`-t a megadott porton.
 *     3) A publisher event-emitter-ére feliratkoztatja a feed-server
 *        broadcast-ját.
 *
 * ============================================================================
 * LIFECYCLE
 * ============================================================================
 *   1) `attachStateFeed(bot, { port })` — megnyitja a TCP socketet
 *      + elindítja a publisher-t.
 *   2) A bot engine `bot.subscribe` notification-jei a publisher-en
 *      át a feed-server broadcast-ba jutnak.
 *   3) A SIGINT / SIGTERM signal-okra a `close()` hívódik, ami
 *      lezárja a TCP socketet + dispose-olja a publisher-t.
 *
 * ============================================================================
 * DESIGN — WHY PURE EVENT FORWARDING
 * ============================================================================
 *   A feed-server NEM tartja a bot state-jét — a publisher a single
 *   source of truth. A feed-server a publisher event-emitter-ére
 *   feliratkozik, és minden event-ből a megfelelő típusú state-feed
 *   üzenetet készít. Ez a tiszta separation:
 *
 *     Publisher (source of truth, in-memory snapshot)
 *        │ addEventListener(...)
 *        ▼
 *     FeedServer (TCP broadcast)
 *        │ write(JSON.stringify(message) + "\n")
 *        ▼
 *     Web client
 *
 *   A Phase 45A-ban a HELLO + SNAPSHOT + STATE + ERROR + PING event-ek
 *   mennek; a Phase 45B-ben a TICK + BAR + INDICATOR + MARKER.
 */

import type { Bot } from "../bot/bot.js";
import { FeedServer, type FeedServerHandle } from "./feed-server.js";
import { LiveStatePublisher } from "./publisher.js";

// ============================================================================
// Options
// ============================================================================

/** Az `attachStateFeed` opciói. */
export interface AttachStateFeedOptions {
  /** A port, amin a state-feed hallgat (default: 7914). */
  readonly port?: number;
  /** A hostname (default: "127.0.0.1"). */
  readonly hostname?: string;
  /** A bot enabled symbols (a SNAPSHOT bootstrap-hoz). */
  readonly enabledSymbols?: readonly string[];
  /** A bot induló equity (a SNAPSHOT bootstrap-hoz). */
  readonly initialEquityUsdt?: number;
  /** A CONTROL üzenetek feldolgozó callback-je. */
  readonly handleControl?: (
    command: "start" | "stop" | "pause" | "resume" | "kill_switch",
    payload: { readonly type: "control"; readonly command: "start" | "stop" | "pause" | "resume" | "kill_switch"; readonly confirm?: boolean; readonly paused?: boolean },
  ) => void | Promise<void>;
  /** A PONG üzenetek feldolgozó callback-je (heartbeat, PR 45B). */
  readonly handlePong?: (clientId: string, ts: number) => void;
  /** Az OHLC bootstrap forrása (PR 45B). */
  readonly getOhlcBootstrap?: () => Readonly<
    Record<string, Readonly<Record<string, readonly { time: number; open: number; high: number; low: number; close: number; volume: number }[]>>>
  >;
  /** A publisher override (alapértelmezetten a függvény hozza létre). */
  readonly publisher?: LiveStatePublisher;
}

// ============================================================================
// Handle
// ============================================================================

/** Az `attachStateFeed` visszatérési értéke — a state-feed életciklus-kezelője. */
export interface StateFeedHandle {
  /** A feed-server leállítása + a publisher dispose-olása. */
  close(): Promise<void>;
  /** A feed-server port olvasása (a `start()` után). */
  readonly port: number;
  /** Az aktuális kliens-szám. */
  readonly clientCount: number;
  /** A publisher — a state-feed kliensek a snapshot-ját olvassák. */
  readonly publisher: LiveStatePublisher;
}

// ============================================================================
// attachStateFeed
// ============================================================================

/**
 * `attachStateFeed` — a state-feed csatlakoztatása a bot-hoz.
 *
 * Létrehoz egy `LiveStatePublisher`-t (ha a `opts.publisher` nincs
 * megadva), és a feed-server-t a megadott porton. A publisher-t a
 * bot-hoz csatlakoztatja (`bot.subscribe`).
 *
 * A függvény a bot engine indítása ELŐTT hívandó — így a publisher
 * a `bot.start()`-ban a már feliratkozott állapotban van, és a
 * bot engine notify-jait azonnal megkapja.
 */
export async function attachStateFeed(
  bot: Bot,
  options: AttachStateFeedOptions = {},
): Promise<StateFeedHandle> {
  const port = options.port ?? 7914;
  const hostname = options.hostname ?? "127.0.0.1";

  // 1) Publisher — a bot-hoz csatlakoztatjuk.
  const publisher =
    options.publisher ??
    new LiveStatePublisher({
      bot,
      ...(options.enabledSymbols !== undefined ? { enabledSymbols: options.enabledSymbols } : {}),
      ...(options.initialEquityUsdt !== undefined ? { initialEquityUsdt: options.initialEquityUsdt } : {}),
    });
  await publisher.start();

  // 2) FeedServer — a publisher event-emitter-ére hallgat.
  const feedServer = new FeedServer({
    port,
    hostname,
    publisher,
    ...(options.getOhlcBootstrap !== undefined ? { getOhlcBootstrap: options.getOhlcBootstrap } : {}),
    ...(options.handleControl !== undefined ? { handleControl: options.handleControl } : {}),
    ...(options.handlePong !== undefined ? { handlePong: options.handlePong } : {}),
  });
  const handle: FeedServerHandle = await feedServer.start();

  // 3) A leállítás egységesítése.
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    try {
      await feedServer.stop();
    } catch {
      // best-effort
    }
    try {
      await publisher.dispose();
    } catch {
      // best-effort
    }
  };

  return {
    close,
    get port(): number {
      return handle.port;
    },
    get clientCount(): number {
      return handle.clientCount();
    },
    publisher,
  };
}

// ============================================================================
// Default port resolution
// ============================================================================

/**
 * `resolveFeedPort` — a CLI által használt port-feloldó. Az
 * `MM_BOT_FEED_PORT` env var-t olvassa, ha van; fallback a default
 * 7914. A CLI ezt hívja a `startCommand` végén.
 */
export function resolveFeedPort(envValue: string | undefined): number {
  if (envValue === undefined || envValue.length === 0) return 7914;
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return 7914;
  }
  return Math.floor(parsed);
}

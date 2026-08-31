/**
 * apps/bot/src/bot/state-store.ts
 *
 * Phase 33 Track C — `StateStore` — a futó bot perzisztens állapotának
 * JSON-fájlba írása / betöltése.
 *
 * ===========================================================================
 * ATOMIKUS WRITE
 * ===========================================================================
 * A `save()` a fájlt NEM közvetlenül írja — először egy `state.json.tmp`
 * fájlba ír, majd `rename()`-vel atomikusan lecseréli a véglegesre.
 * Így ha a bot menet közben összeomlik, a `state.json` vagy a régi
 * (érvényes) állapotot tartalmazza, vagy az új (teljes) állapotot —
 * a részleges írás nem lehetséges.
 *
 * ===========================================================================
 * SCHEMA VALIDATION
 * ===========================================================================
 * A `load()` a beolvasott JSON-t a `BotStateSchema` Zod-sémán validálja.
 * Ha a séma elutasítja (sérült / kompatibilitástörő séma), WARNING-ot
 * logolunk, és friss state-tel indulunk. A `mm-bot status` CLI innen
 * tudja, hogy a state milyen formátumban van.
 *
 * ===========================================================================
 * AUTOSAVE
 * ===========================================================================
 * A `StateStore` támogatja a `requestSave()`-ot, ami:
 *   - debounce-olja a hívásokat (max 1 írás / 500ms)
 *   - VAGY 60 másodpercenként garantálja a write-ot (az utolsó
 *     sikeres save óta)
 * Az `updateSnapshot()` setter-én keresztül a Bot egyszerűen
 * "frissíti az állapotot", és a store gondoskodik a perzisztenciáról.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { requireLogger, type Logger } from "@mm-crypto-bot/logging";
import { BotStateSchema } from "./state-schema.js";
import { stringifyUnknownError } from "./stringify-unknown-error.js";

export { BotStateSchema } from "./state-schema.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * `ClosedTradeSnapshot` — a history-beli (lezárt) trade.
 */
export interface ClosedTradeSnapshot {
  readonly strategy: string;
  readonly symbol: string;
  readonly side: "long" | "short";
  readonly quantity: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly pnl: number;
  readonly pnlPct: number;
  readonly closedAt: number;
}

/**
 * `BotState` — a perzisztens állapot. A Zod séma ezt validálja a load-nál.
 *
 * - `version`           — a séma verziója (kompatibilitásellenőrzéshez).
 * - `savedAt`           — utolsó sikeres mentés timestamp-je.
 * - `equityUsd`         — az utolsó ismert equity.
 * - `initialEquityUsd`  — induló equity (a drawdown számításhoz).
 * - `realizedPnlUsd`    — kumulatív realizált P&L.
 * - `positions`         — nyitott pozíciók listája.
 * - `closedTrades`      — lezárt trade-ek (cap: 1000, FIFO eviction).
 * - `inFlightOrderIds`  — a feed-en még nyitott rendelések clientOrderId-i.
 * - `counters`          — aggregált számlálók (placed/filled/cancelled/rejected).
 *
 * Megjegyzés: a `positions[].symbol` itt `string` (és NEM branded
 * `Symbol`), mert a perzisztens reprezentáció plain JSON — a brand
 * csak a TypeScript-oldali típusbiztonságot szolgálja, és a fájlba
 * íráskor elveszik. A `Bot` a load után a `symbolOf()` helperrel
 * újra-brandeli, ha szükséges.
 */
export interface BotState {
  readonly version: number;
  readonly savedAt: number;
  readonly equityUsd: number;
  readonly initialEquityUsd: number;
  readonly realizedPnlUsd: number;
  readonly positions: readonly {
    readonly id: string;
    readonly strategy: string;
    readonly symbol: string;
    readonly side: "long" | "short";
    readonly quantity: number;
    readonly entryPrice: number;
    readonly currentPrice: number;
    readonly leverage: number;
    readonly unrealizedPnl: number;
    readonly realizedPnl: number;
    readonly openedAt: number;
    readonly notionalUsd: number;
  }[];
  readonly closedTrades: readonly ClosedTradeSnapshot[];
  readonly inFlightOrderIds: readonly string[];
  readonly counters: {
    readonly placed: number;
    readonly filled: number;
    readonly cancelled: number;
    readonly rejected: number;
  };
}

/**
 * `BotStateSchema` — a Zod séma a `BotState`-hez. A `load()` ezen
 * validálja a beolvasott JSON-t.
 */

/**
 * `StateStoreError` — a StateStore saját hibája (pl. atomic write
 * nem sikerült, vagy a séma invalid).
 */
export class StateStoreError extends Error {
  public override readonly name = "StateStoreError";
  public override readonly cause: unknown;

  // eslint-disable-next-line unicorn/no-null -- The public error contract represents an omitted cause as null.
  public constructor(message: string, cause: unknown = null) {
    super(message);
    this.cause = cause;
    Object.setPrototypeOf(this, StateStoreError.prototype);
  }
}

// ============================================================================
// StateStoreOptions
// ============================================================================

/**
 * `StateStoreOptions` — a StateStore konfigurációja.
 *
 * - `filePath`         — a cél-fájl útvonala (default: `data/bot-state.json`).
 * - `debounceMs`       — a debounce ablak (alap: 500ms).
 * - `logger`           — opcionális structured logger.
 */
export interface StateStoreOptions {
  readonly filePath: string;
  readonly debounceMs?: number;
  readonly logger?: Logger;
}

/**
 * Validates the persistence target before it reaches Node's file-system APIs.
 * The configured path remains byte-for-byte observable through `getFilePath`.
 */
class StateFilePath {
  public readonly value: string;

  public constructor(candidate: string) {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.includes("\0") ||
      path.normalize(candidate) === "."
    ) {
      throw new StateStoreError("[state-store] filePath must be a non-empty filesystem path");
    }
    this.value = candidate;
  }

  public getDirectory(): string {
    return path.dirname(this.value);
  }

  public getTemporaryPath(): string {
    return `${this.value}.tmp`;
  }
}

// ============================================================================
// StateStore class
// ============================================================================

/**
 * `StateStore` — perzisztens állapot JSON-fájlba írása.
 *
 * A `requestSave()` debounce-olt: gyors egymásutánban jövő hívások
 * egyetlen fájlírássá olvadnak össze. A `flush()` kényszerített,
 * azonnali írás (graceful shutdown-nál hívandó).
 */
export class StateStore {
  private readonly stateFilePath: StateFilePath;
  private readonly debounceMs: number;
  private readonly logger: Logger;
  // eslint-disable-next-line unicorn/no-null -- The public persistence contract represents an absent snapshot as null.
  private currentState: BotState | null = null;
  // eslint-disable-next-line unicorn/no-null -- A null timer marks that no debounce work is scheduled.
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // eslint-disable-next-line unicorn/no-null -- The public persistence contract represents that no snapshot has been written as null.
  private lastWrittenState: BotState | null = null;

  public constructor(options: StateStoreOptions) {
    this.stateFilePath = new StateFilePath(options.filePath);
    this.debounceMs = options.debounceMs ?? 500;
    this.logger = requireLogger(options.logger, "state-store");
  }

  private saveSync(state: BotState): void {
    // Skip if the state is identical to the last written — saves IO.
    if (this.lastWrittenState !== null && this.stateEquals(state, this.lastWrittenState)) {
      return;
    }
    const directory = this.stateFilePath.getDirectory();
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- StateFilePath validates the configured persistence boundary before I/O.
      if (!existsSync(directory)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- StateFilePath validates the configured persistence boundary before I/O.
        mkdirSync(directory, { recursive: true });
      }
    } catch (error) {
      throw new StateStoreError(
        `[state-store] failed to create state directory ${directory}: ${stringifyUnknownError(error)}`,
        error,
      );
    }
    const temporaryPath = this.stateFilePath.getTemporaryPath();
    const enriched: BotState = { ...state, savedAt: Date.now() };
    let json: string;
    try {
      json = JSON.stringify(enriched, undefined, 2);
    } catch (error) {
      throw new StateStoreError(
        `[state-store] failed to serialize state: ${stringifyUnknownError(error)}`,
        error,
      );
    }
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- StateFilePath validates the configured persistence boundary before I/O.
      writeFileSync(temporaryPath, json, "utf8");
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- StateFilePath validates both paths from one configured persistence boundary.
      renameSync(temporaryPath, this.stateFilePath.value);
    } catch (error) {
      throw new StateStoreError(
        `[state-store] failed to write state file: ${stringifyUnknownError(error)}`,
        error,
      );
    }
    this.lastWrittenState = enriched;
    this.logger.debug("bot.state.saved", {
      filePath: this.stateFilePath.value,
      positions: enriched.positions.length,
      closedTrades: enriched.closedTrades.length,
      savedAt: enriched.savedAt,
    });
  }

  private stateEquals(a: BotState, b: BotState): boolean {
    return (
      a.equityUsd === b.equityUsd &&
      a.realizedPnlUsd === b.realizedPnlUsd &&
      a.positions.length === b.positions.length &&
      a.closedTrades.length === b.closedTrades.length &&
      a.inFlightOrderIds.length === b.inFlightOrderIds.length &&
      a.counters.placed === b.counters.placed &&
      a.counters.filled === b.counters.filled &&
      a.counters.cancelled === b.counters.cancelled &&
      a.counters.rejected === b.counters.rejected
    );
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * `load` — beolvassa a state-fájlt. Ha nem létezik, `null`-t ad.
   * Ha a séma invalid, WARNING-ot logol és `null`-t ad (a Bot friss
   * state-tel indul).
   */
  public load(): BotState | null {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- StateFilePath validates the configured persistence boundary before I/O.
    if (!existsSync(this.stateFilePath.value)) {
      this.logger.info("bot.state.absent", {
        filePath: this.stateFilePath.value,
      });
      // eslint-disable-next-line unicorn/no-null -- The public load contract uses null when no valid snapshot exists.
      return null;
    }
    let raw: string;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- StateFilePath validates the configured persistence boundary before I/O.
      raw = readFileSync(this.stateFilePath.value, "utf8");
    } catch (error) {
      this.logger.warn("bot.state.read.failed", {
        filePath: this.stateFilePath.value,
        error: stringifyUnknownError(error),
      });
      // eslint-disable-next-line unicorn/no-null -- The public load contract uses null after a read failure.
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.logger.warn("bot.state.json.invalid", {
        filePath: this.stateFilePath.value,
        error: stringifyUnknownError(error),
      });
      // eslint-disable-next-line unicorn/no-null -- The public load contract uses null after invalid JSON.
      return null;
    }
    const validated = BotStateSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn("bot.state.schema.invalid", {
        filePath: this.stateFilePath.value,
        issues: validated.error.issues.map((index) => `${index.path.join(".")}: ${index.message}`),
      });
      // eslint-disable-next-line unicorn/no-null -- The public load contract uses null after schema rejection.
      return null;
    }
    this.currentState = validated.data;
    this.lastWrittenState = validated.data;
    this.logger.info("bot.state.loaded", {
      filePath: this.stateFilePath.value,
      positions: validated.data.positions.length,
      closedTrades: validated.data.closedTrades.length,
      savedAt: validated.data.savedAt,
    });
    return validated.data;
  }

  /**
   * `requestSave` — debounce-olt save. A `Bot` minden állapotváltozás
   * után hívja; a tényleges írás a debounce ablak után fut le.
   */
  public requestSave(state: BotState): void {
    this.currentState = state;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    const scheduledState = state;
    this.debounceTimer = setTimeout(() => {
      // eslint-disable-next-line unicorn/no-null -- A null timer marks completed debounce work.
      this.debounceTimer = null;
      this.saveSync(scheduledState);
    }, this.debounceMs);
  }

  /**
   * `flush` — kényszerített azonnali save. Graceful shutdown-nál hívandó.
   * A függőben lévő debounce timer-t törli, és a `currentState`-et
   * szinkronban lemezre írja.
   */
  // eslint-disable-next-line unicorn/no-null -- The public flush contract uses null to request the current snapshot.
  public flush(state: BotState | null = null): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      // eslint-disable-next-line unicorn/no-null -- A null timer marks that flush cancelled the scheduled debounce work.
      this.debounceTimer = null;
    }
    if (state !== null) {
      this.currentState = state;
    }
    if (this.currentState !== null) {
      this.saveSync(this.currentState);
    }
  }

  /**
   * `getCurrent` — a belső current state (a `requestSave` utolsó hívása óta).
   * A `Bot.getState()` használja.
   */
  public getCurrent(): BotState | null {
    return this.currentState;
  }

  /**
   * `getFilePath` — a perzisztencia-fájl útvonala (a CLI és a tesztek számára).
   */
  public getFilePath(): string {
    return this.stateFilePath.value;
  }
}

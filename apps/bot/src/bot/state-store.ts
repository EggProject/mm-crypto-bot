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
import { dirname } from "node:path";

import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";
import { z } from "zod";

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
export const BotStateSchema = z.object({
  version: z.literal(1),
  savedAt: z.number(),
  equityUsd: z.number(),
  initialEquityUsd: z.number().positive(),
  realizedPnlUsd: z.number(),
  positions: z.array(
    z.object({
      id: z.string(),
      strategy: z.string(),
      symbol: z.string(),
      side: z.enum(["long", "short"]),
      quantity: z.number().positive(),
      entryPrice: z.number().positive(),
      currentPrice: z.number().positive(),
      leverage: z.number().int().min(1).max(10),
      unrealizedPnl: z.number(),
      realizedPnl: z.number(),
      openedAt: z.number(),
      notionalUsd: z.number().positive(),
    }),
  ),
  closedTrades: z.array(
    z.object({
      strategy: z.string(),
      symbol: z.string(),
      side: z.enum(["long", "short"]),
      quantity: z.number().positive(),
      entryPrice: z.number().positive(),
      exitPrice: z.number().positive(),
      pnl: z.number(),
      pnlPct: z.number(),
      closedAt: z.number(),
    }),
  ),
  inFlightOrderIds: z.array(z.string()),
  counters: z.object({
    placed: z.number().int().min(0),
    filled: z.number().int().min(0),
    cancelled: z.number().int().min(0),
    rejected: z.number().int().min(0),
  }),
});

/**
 * `StateStoreError` — a StateStore saját hibája (pl. atomic write
 * nem sikerült, vagy a séma invalid).
 */
export class StateStoreError extends Error {
  public override readonly name = "StateStoreError";
  public override readonly cause: unknown;

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
  private readonly filePath: string;
  private readonly debounceMs: number;
  private readonly logger: Logger;
  private currentState: BotState | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingWrite = false;
  private lastWrittenState: BotState | null = null;

  public constructor(opts: StateStoreOptions) {
    this.filePath = opts.filePath;
    this.debounceMs = opts.debounceMs ?? 500;
    this.logger = opts.logger ?? createLogger("info");
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
    if (!existsSync(this.filePath)) {
      this.logger.info("[state-store] no state file — starting fresh", {
        filePath: this.filePath,
      });
      return null;
    }
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      this.logger.warn("[state-store] failed to read state file — starting fresh", {
        filePath: this.filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.logger.warn("[state-store] invalid JSON in state file — starting fresh", {
        filePath: this.filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    const validated = BotStateSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn("[state-store] state file schema invalid — starting fresh", {
        filePath: this.filePath,
        issues: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return null;
    }
    this.currentState = validated.data;
    this.lastWrittenState = validated.data;
    this.logger.info("[state-store] state loaded", {
      filePath: this.filePath,
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
    this.pendingWrite = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.pendingWrite) {
        this.pendingWrite = false;
        this.saveSync(this.currentState);
      }
    }, this.debounceMs);
  }

  /**
   * `flush` — kényszerített azonnali save. Graceful shutdown-nál hívandó.
   * A függőben lévő debounce timer-t törli, és a `currentState`-et
   * szinkronban lemezre írja.
   */
  public flush(state: BotState | null = null): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingWrite = false;
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
    return this.filePath;
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * `saveSync` — atomikusan írja a state-et a lemezre.
   *   1) `state.json.tmp` fájlba ír.
   *   2) `rename()`-szel atomikusan lecseréli a `state.json`-t.
   * Ha bármelyik lépés hibát dob, `StateStoreError`-t dobunk.
   */
  private saveSync(state: BotState | null): void {
    if (state === null) return;
    // Skip if the state is identical to the last written — saves IO.
    if (this.lastWrittenState !== null && this.stateEquals(state, this.lastWrittenState)) {
      return;
    }
    const dir = dirname(this.filePath);
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      throw new StateStoreError(
        `[state-store] failed to create state directory ${dir}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    const tmpPath = `${this.filePath}.tmp`;
    const enriched: BotState = { ...state, savedAt: Date.now() };
    let json: string;
    try {
      json = JSON.stringify(enriched, null, 2);
    } catch (err) {
      throw new StateStoreError(
        `[state-store] failed to serialize state: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    try {
      writeFileSync(tmpPath, json, "utf8");
      renameSync(tmpPath, this.filePath);
    } catch (err) {
      throw new StateStoreError(
        `[state-store] failed to write state file: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    this.lastWrittenState = enriched;
    this.logger.debug("[state-store] state saved", {
      filePath: this.filePath,
      positions: enriched.positions.length,
      closedTrades: enriched.closedTrades.length,
      savedAt: enriched.savedAt,
    });
  }

  /**
   * `stateEquals` — sekély összehasonlítás a skip-write optimalizáláshoz.
   */
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
}

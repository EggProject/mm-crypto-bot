/**
 * apps/web/src/lib/bot-status.ts
 *
 * Phase 69: pure helpers for the dashboard's status banner +
 * ControlBar button enable/disable logic. Extracted from App.tsx
 * + ControlBar.tsx for direct unit-testability.
 *
 * The 4 helpers here are all PURE — no React, no DOM, no I/O:
 *
 *   1. `extractBotStatus(snapshot)` — defensively walk the WS
 *      `state` / `snapshot` message's `snapshot.botStatus` field
 *      and produce a `BotStatus` object. Returns `null` if the
 *      message is missing the field (the dashboard falls back to
 *      `STOPPED` in that case).
 *
 *   2. `formatUptime(startedAt, now)` — convert the bot's
 *      `startedAt` timestamp into a human-readable uptime string
 *      (e.g. "2h 13m", "47s", "0m 12s"). Returns "—" if the bot
 *      has never started (startedAt === 0).
 *
 *   3. `formatLastUpdate(lastUpdate, now)` — convert the
 *      `lastUpdate` timestamp into a human-readable "X seconds
 *      ago" string. Returns "—" if lastUpdate === 0.
 *
 *   4. `computeControlBarAvailability(botState)` — return the
 *      4-button enable/disable map. The state machine mirrors
 *      the real bot's state machine:
 *
 *        botState: "stopped" → Start enabled, all others disabled
 *        botState: "running" → Stop, Pause, Kill Switch enabled;
 *                              Start, Resume disabled
 *        botState: "paused"  → Resume enabled; Start, Stop, Pause
 *                              disabled; Kill Switch enabled
 *
 *      The `botState` argument is nullable (the helper accepts
 *      `null` for the "no status yet" case) and returns a sensible
 *      default ("stopped") in that case.
 *
 * **No behavior change** for the production code: these helpers
 * are pure refactors of inline code in App.tsx + ControlBar.tsx,
 * with the same control flow. The new e2e tests in
 * `apps/web/e2e/69-bot-status.spec.ts` cover the new branches.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * `BotState` — the bot's high-level run state. The 3-value union
 * matches the real bot's `StateFeedBotStatus.state` field (see
 * `apps/bot/src/state-feed/publisher.ts`).
 */
export type BotState = "running" | "paused" | "stopped";

/**
 * `PositionInfo` — a UI-nak szánt position-forma (Phase 71).
 *
 * A `LiveStatePublisher.getBotStatus()` a `lastEngineState.positions`
 * tömböt `mapPosition()` formátumra konvertálja, és a `botStatus.positions`
 * mezőben adja vissza. A UI a státusz banner "X open positions" szövegét
 * ebből a tömbből olvassa.
 *
 * A `PositionInfo` shape a `StateFeedPosition` (publisher oldali) egy
 * RÉSZHALMAZA — a UI csak a dashboard szempontjából lényeges mezőket
 * olvassa (symbol, side, entryPrice, currentPrice, quantity, leverage,
 * unrealizedPnl). Az extra mezőket a `extractBotStatus` eldobja.
 */
export interface PositionInfo {
  readonly id: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly quantity: number;
  readonly leverage: number;
  readonly unrealizedPnl: number;
  readonly unrealizedPnlPct: number;
  readonly openedAt: number;
}

/**
 * `BotStatus` — the full bot status object returned by the
 * `/api/status` HTTP endpoint and the `state` WS message's
 * `snapshot.botStatus` field.
 *
 * The `lastUpdate` is the timestamp of the most recent state-feed
 * tick (ms precision, like the rest of the protocol).
 *
 * Phase 71: a `positions` mező a bot `positionManager.getPositions()`
 * pillanatképe, `mapPosition()` formátumra konvertálva. A `getBotStatus()`
 * a `lastEngineState.positions`-ből olvas (NEM a `currentState.positions`
 * -ből — az utóbbi csak a `refreshFromBot()` hívások között frissül).
 */
export interface BotStatus {
  readonly state: BotState;
  readonly startedAt: number;
  readonly lastUpdate: number;
  readonly activeStrategyCount: number;
  readonly positions: readonly PositionInfo[];
}

/**
 * `ControlBarAvailability` — the enable/disable map for the 5
 * ControlBar buttons (Start / Stop / Pause / Resume / Kill Switch).
 * `true` = enabled, `false` = disabled.
 */
export interface ControlBarAvailability {
  readonly start: boolean;
  readonly stop: boolean;
  readonly pause: boolean;
  readonly resume: boolean;
  readonly killSwitch: boolean;
}

// ============================================================================
// extractBotStatus
// ============================================================================

/**
 * `extractBotStatus(snapshot)` — defensively walk the WS
 * `state` / `snapshot` message and return the embedded
 * `botStatus` object. Returns `null` if the field is missing or
 * malformed.
 *
 * The state-feed protocol types the `snapshot` field loosely
 * (`object`), so the helper validates the shape at runtime.
 * Tests for the helper cover all 3 valid `state` values + the
 * "missing field" / "wrong type" branches.
 *
 * Phase 71: a `positions` mezőt is validáljuk + kibontjuk. Ha a
 * mező hiányzik vagy nem tömb, a default `[]` kerül a válaszba
 * (a backward-compat a Phase 69-el: a Phase 69-es szerverek nem
 * küldtek `positions` mezőt).
 */
export function extractBotStatus(snapshot: unknown): BotStatus | null {
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const snap = snapshot as { botStatus?: unknown };
  const raw = snap.botStatus;
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  // Defensive: the state field must be one of the 3 valid values.
  // The bracket notation is REQUIRED here because the `Record<string,
  // unknown>` type has no known property names (dot-notation would
  // fail with `Property 'state' does not exist on type 'Record<
  // string, unknown>'`).
  // eslint-disable-next-line @typescript-eslint/dot-notation
  const stateRaw = obj["state"];
  if (stateRaw !== "running" && stateRaw !== "paused" && stateRaw !== "stopped") {
    return null;
  }
  const startedAtRaw = obj.startedAt;
  const lastUpdateRaw = obj.lastUpdate;
  const activeStrategyCountRaw = obj.activeStrategyCount;
  if (typeof startedAtRaw !== "number") return null;
  if (typeof lastUpdateRaw !== "number") return null;
  if (typeof activeStrategyCountRaw !== "number") return null;
  // Phase 71: a `positions` mező validáció + parse. A mező
  // OPCIÓNS a backward-compat miatt (a Phase 69 szerverek nem
  // küldték). Ha hiányzik vagy nem tömb, üres tömböt adunk vissza
  // (a UI a "no open positions" fallback-et így is jól kezeli).
  // A validáció kiszerveztük a `parsePosition` helper-be, hogy a
  // fő függvény kevesebb branch-et tartalmazzon (e2e coverage gate).
  const positionsRaw = obj.positions;
  const positions: readonly PositionInfo[] = Array.isArray(positionsRaw)
    ? positionsRaw.flatMap((p): readonly PositionInfo[] => {
        const parsed = parsePosition(p);
        return parsed === null ? [] : [parsed];
      })
    : [];
  return {
    state: stateRaw,
    startedAt: startedAtRaw,
    lastUpdate: lastUpdateRaw,
    activeStrategyCount: activeStrategyCountRaw,
    positions,
  };
}

/**
 * `parsePosition` — Phase 71: a `botStatus.positions` tömb egy elemének
 * validációja + parse-olása. A helper kiszervezi a `flatMap` callback-jét,
 * hogy a fő `extractBotStatus` függvény branch-száma alacsony maradjon
 * (az e2e coverage gate 75%-os threshold-ot ír elő).
 *
 * A helper `null`-t ad vissza, ha a pozíció object nem valid (a `flatMap`
 * a `null`-t kihagyja a tömbből). A `null` check-ek:
 *   - `typeof p !== "object" || p === null` — a `p` nem object
 *   - `typeof pos.id !== "string"` — az `id` mező hiányzik
 *   - `typeof pos.symbol !== "string"` — a `symbol` mező hiányzik
 *   - `pos.side !== "buy" && pos.side !== "sell"` — a `side` nem "buy" vagy "sell"
 *   - `typeof pos.entryPrice !== "number"` — az `entryPrice` nem szám
 *   - (stb. — minden kötelező mező)
 *
 * Pure: no I/O. A helper-t a unit-tesztek (`bot-status.test.ts`) és
 * a `extractBotStatus` is hívja.
 */
function parsePosition(p: unknown): PositionInfo | null {
  if (typeof p !== "object" || p === null) return null;
  const pos = p as Record<string, unknown>;
  if (typeof pos.id !== "string") return null;
  if (typeof pos.symbol !== "string") return null;
  if (pos.side !== "buy" && pos.side !== "sell") return null;
  if (typeof pos.entryPrice !== "number") return null;
  if (typeof pos.currentPrice !== "number") return null;
  if (typeof pos.quantity !== "number") return null;
  if (typeof pos.leverage !== "number") return null;
  if (typeof pos.unrealizedPnl !== "number") return null;
  if (typeof pos.unrealizedPnlPct !== "number") return null;
  if (typeof pos.openedAt !== "number") return null;
  return {
    id: pos.id,
    symbol: pos.symbol,
    side: pos.side,
    entryPrice: pos.entryPrice,
    currentPrice: pos.currentPrice,
    quantity: pos.quantity,
    leverage: pos.leverage,
    unrealizedPnl: pos.unrealizedPnl,
    unrealizedPnlPct: pos.unrealizedPnlPct,
    openedAt: pos.openedAt,
  };
}

// ============================================================================
// formatUptime
// ============================================================================

/**
 * `formatUptime(startedAt, now)` — convert the bot's `startedAt`
 * timestamp into a human-readable uptime string.
 *
 *   - "0m 0s" (or "—") if `startedAt === 0` (the bot has never started)
 *   - "47s" if uptime < 60s
 *   - "13m 47s" if uptime < 1h
 *   - "2h 13m" if uptime < 24h
 *   - "3d 4h" if uptime >= 24h
 *
 * Pure: no I/O. The caller passes `Date.now()` as `now` (kept
 * pure for testability — the test injects a fixed `now` value).
 */
export function formatUptime(startedAt: number, now: number): string {
  if (startedAt <= 0) return "—";
  const deltaMs = Math.max(0, now - startedAt);
  const totalSec = Math.floor(deltaMs / 1000);
  if (totalSec < 60) {
    return `${String(totalSec)}s`;
  }
  const totalMin = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (totalMin < 60) {
    return `${String(totalMin)}m ${String(sec)}s`;
  }
  const totalHour = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (totalHour < 24) {
    return `${String(totalHour)}h ${String(min)}m`;
  }
  const day = Math.floor(totalHour / 24);
  const hour = totalHour % 24;
  return `${String(day)}d ${String(hour)}h`;
}

// ============================================================================
// formatLastUpdate
// ============================================================================

/**
 * `formatLastUpdate(lastUpdate, now)` — convert the `lastUpdate`
 * timestamp into a human-readable "X seconds ago" string.
 *
 *   - "—" if `lastUpdate === 0` (no update yet)
 *   - "just now" if delta < 2s
 *   - "X seconds ago" if delta < 60s
 *   - "X minutes ago" if delta < 60m
 *   - "X hours ago" if delta < 24h
 *   - "X days ago" otherwise
 *
 * Pure: no I/O. The caller passes `Date.now()` as `now`.
 */
export function formatLastUpdate(lastUpdate: number, now: number): string {
  if (lastUpdate <= 0) return "—";
  const deltaMs = Math.max(0, now - lastUpdate);
  const totalSec = Math.floor(deltaMs / 1000);
  if (totalSec < 2) return "just now";
  if (totalSec < 60) {
    return `${String(totalSec)} seconds ago`;
  }
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) {
    return totalMin === 1 ? "1 minute ago" : `${String(totalMin)} minutes ago`;
  }
  const totalHour = Math.floor(totalMin / 60);
  if (totalHour < 24) {
    return totalHour === 1 ? "1 hour ago" : `${String(totalHour)} hours ago`;
  }
  const day = Math.floor(totalHour / 24);
  return day === 1 ? "1 day ago" : `${String(day)} days ago`;
}

// ============================================================================
// computeControlBarAvailability
// ============================================================================

/**
 * `computeControlBarAvailability(botState)` — the enable/disable
 * map for the 5 ControlBar buttons. The state machine mirrors
 * the real bot's state machine.
 *
 *   - botState === "stopped" → Start enabled (the user can boot
 *                              the bot); Stop / Pause / Resume /
 *                              Kill Switch disabled.
 *   - botState === "running" → Stop, Pause, Kill Switch enabled
 *                              (the user can halt / pause / kill
 *                              the bot); Start, Resume disabled.
 *   - botState === "paused"  → Resume + Kill Switch enabled
 *                              (the user can resume or kill the
 *                              bot); Start, Stop, Pause disabled.
 *
 * The `null` input (no status yet) maps to the "stopped" state —
 * the dashboard's first-paint default.
 */
export function computeControlBarAvailability(
  botState: BotState | null,
): ControlBarAvailability {
  switch (botState ?? "stopped") {
    case "stopped":
      return {
        start: true,
        stop: false,
        pause: false,
        resume: false,
        killSwitch: false,
      };
    case "running":
      return {
        start: false,
        stop: true,
        pause: true,
        resume: false,
        killSwitch: true,
      };
    case "paused":
      return {
        start: false,
        stop: false,
        pause: false,
        resume: true,
        killSwitch: true,
      };
  }
}

// ============================================================================
// buildStatusBannerText
// ============================================================================

/**
 * `buildStatusBannerText(botStatus, now)` — the human-readable
 * text for the dashboard's status banner. Combines the bot
 * state, uptime, last-update time, active strategy count, AND
 * open position count into a single line. Returns a short
 * fallback "Bot: stopped" if `botStatus` is `null`.
 *
 * Phase 71: a `positions.length` is megjelenik a bannerben
 * ("X open positions"). Ha 0, a szöveg kimarad (a UI
 * "No open positions" fallback-et a PositionsTable jeleníti
 * meg külön).
 *
 * Pure: no I/O. The caller passes `Date.now()` as `now`.
 */
export function buildStatusBannerText(
  botStatus: BotStatus | null,
  now: number,
): string {
  if (botStatus === null) {
    return "Bot: stopped — no status yet";
  }
  const stateLabel = botStatus.state.toUpperCase();
  const uptime = formatUptime(botStatus.startedAt, now);
  const lastUpdate = formatLastUpdate(botStatus.lastUpdate, now);
  const active = botStatus.activeStrategyCount;
  const openPositions = botStatus.positions.length;
  // Phase 71: a pozíció-számot a "X active strategies" után
  // fűzzük, ha > 0. A nulla pozíciót nem írjuk ki (a banner
  // tiszta marad, ha a bot csak fut, de még nincs nyitott trade).
  const positionsSuffix =
    openPositions > 0
      ? ` · ${String(openPositions)} open ${openPositions === 1 ? "position" : "positions"}`
      : "";
  return `Bot: ${stateLabel} · uptime ${uptime} · last update ${lastUpdate} · ${String(active)} active strategies${positionsSuffix}`;
}

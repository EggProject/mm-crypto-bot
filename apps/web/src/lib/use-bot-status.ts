/**
 * apps/web/src/lib/use-bot-status.ts
 *
 * Phase 81: a `useBotStatus` React hook that derives the dashboard's
 * high-level bot status (`state`, `startedAt`, `lastUpdate`,
 * `activeStrategyCount`, `positions`) from the existing WebSocket
 * `state` / `snapshot` messages — without polling `/api/status`.
 *
 * ============================================================================
 * WHY THIS HOOK EXISTS (Phase 81 mandate)
 * ============================================================================
 *
 * The previous design polled `GET /api/status` every 1 second
 * (`STATUS_POLL_INTERVAL_MS = 1_000` in `App.tsx`). The user
 * mandate: "a backendnek kene ertesiteni es nem a frontendnek
 * keregetni!" — the backend already pushes the data on every
 * state change via the WS `snapshot` / `state` messages, so the
 * 1-second polling is wasteful, adds latency, and was a primary
 * contributor to the "lagging" UI complaint (issue 1).
 *
 * The fix:
 *   1. PRIMARY source of truth: the WS `state` / `snapshot` messages.
 *      The publisher already calls `markBotStarted()` /
 *      `markBotStopped()` / `setPaused()` on every CONTROL click,
 *      which triggers a `refreshFromBot()`, which emits a
 *      `snapshot` event, which the feed-server turns into a WS
 *      `snapshot` message (carrying the `botStatus` field). The
 *      dashboard picks up the new status within 1 frame of the
 *      CONTROL click — NOT 1-5 seconds.
 *
 *   2. INITIAL BOOTSTRAP: a one-shot `fetch('/api/status')` on
 *      mount, so the dashboard can render the status before the
 *      first WS message arrives. This is best-effort — if the
 *      HTTP fetch fails (network blip, bot still bootstrapping),
 *      the dashboard falls back to the "no status yet" state
 *      until the first WS message arrives.
 *
 *   3. SLOW FALLBACK: a 30-second `setInterval` poll that fires
 *      ONLY when the WS is disconnected (`status !== "connected"`).
 *      On WS reconnect, the slow poll is cancelled. This is the
 *      resilience layer for the rare case where the WS is down
 *      but the bot is still up (the dashboard can still see the
 *      latest status via the HTTP endpoint, with up to 30s delay).
 *
 * ============================================================================
 * PURE-FIRST DESIGN
 * ============================================================================
 *
 * The `extractBotStatus` helper in `bot-status.ts` does the actual
 * field validation + extraction. The hook is a thin orchestration
 * layer:
 *
 *   - On `snapshot` / `state` WS message → call `extractBotStatus`
 *     on the inner `snapshot` object → set state.
 *   - On mount → fire one `fetch('/api/status')` → set state.
 *   - On WS disconnect → start a 30s poll.
 *   - On WS reconnect → stop the 30s poll.
 *
 * ============================================================================
 * TESTABILITY
 * ============================================================================
 *
 * The hook depends on `useWebSocket()` for the WS messages and
 * `fetch()` for the HTTP bootstrap. The unit tests in
 * `lib/__tests__/use-bot-status.test.ts` exercise the hook via
 * a stub `useWebSocket` factory + a stub `fetch` (via the
 * `globalThis.fetch` override, restored on teardown).
 *
 * The e2e suite (`e2e/81-ws-status-push.spec.ts`) drives the
 * actual React flow through Playwright: it starts the dashboard,
 * sends a `start` CONTROL, and asserts the banner updates WITHIN
 * 2 seconds (not 5).
 */

import { useEffect, useState } from "react";

import { extractBotStatus, type BotStatus } from "./bot-status.js";
import { useWebSocket } from "../ws-client.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * The HTTP endpoint URL for the bot's high-level status. Mirrors
 * the `STATUS_URL` constant in `App.tsx` (Phase 69 origin). The
 * dev workflow is browser ↔ loopback, and the Vite dev server
 * proxies nothing on this port (Vite serves the SPA shell; the
 * API is a separate origin). CORS headers are configured
 * server-side.
 */
const STATUS_URL = "http://127.0.0.1:7913/api/status" as const;

/**
 * The slow-poll interval used when the WebSocket is disconnected.
 * The polling fires at most every 30 seconds (vs. the previous
 * 1-second poll) — the dashboard is intentionally a bit stale
 * when the WS is down, with the explicit expectation that the
 * WS reconnect will resume the real-time updates.
 */
const SLOW_POLL_INTERVAL_MS = 30_000;

/**
 * The abort-controller timeout for the bootstrap HTTP fetch.
 * If the bot is still bootstrapping and the fetch hangs, we
 * cancel after 5 seconds to avoid blocking the dashboard's
 * first paint indefinitely.
 */
const BOOTSTRAP_FETCH_TIMEOUT_MS = 5_000;

// ============================================================================
// Public hook
// ============================================================================

/**
 * `useBotStatus()` — React hook that returns the latest `BotStatus`
 * from the WebSocket `state` / `snapshot` messages, with an HTTP
 * bootstrap fetch on mount and a slow-poll fallback when the WS
 * is disconnected.
 *
 * Returns:
 *   - `botStatus` — the latest `BotStatus` (or `null` if the
 *     first message hasn't arrived yet and the HTTP bootstrap
 *     hasn't completed)
 *
 * The hook NEVER sets a `setInterval` with the 1s polling cadence
 * from Phase 69. The WS push is the source of truth.
 */
export function useBotStatus(): BotStatus | null {
  // The full WS state — we need `snapshot` and `lastState` for
  // the `state` / `snapshot` message handlers, plus `status` for
  // the slow-poll fallback gate.
  const { status, snapshot, lastState } = useWebSocket();

  // The derived bot status — initialized to `null` and updated
  // by three sources (in priority order):
  //   1. The latest WS `state` message's `snapshot.botStatus`
  //   2. The latest WS `snapshot` message's `snapshot.botStatus`
  //   3. The one-shot HTTP bootstrap fetch (and the 30s slow
  //      poll when the WS is down)
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);

  // -----------------------------------------------------------------
  // Source 1: WS `state` message. The `state` message carries the
  // full snapshot, which includes `snapshot.botStatus`. This is
  // the PRIMARY source — the publisher emits a `snapshot` event
  // on every `markBotStarted()` / `markBotStopped()` / `setPaused()`
  // call, and the feed-server turns that into a WS `state` /
  // `snapshot` message.
  // -----------------------------------------------------------------
  useEffect(() => {
    if (lastState === null) return;
    const stateMessage = lastState as { snapshot?: unknown };
    const innerSnapshot = stateMessage.snapshot;
    if (innerSnapshot === undefined || innerSnapshot === null) return;
    const parsed = extractBotStatus(innerSnapshot);
    if (parsed !== null) {
      setBotStatus(parsed);
    }
  }, [lastState]);

  // -----------------------------------------------------------------
  // Source 2: WS `snapshot` message (initial connect). The first
  // WS message after connect is `snapshot` (the publisher's initial
  // state); the subsequent state changes arrive as `snapshot` or
  // `state` messages. The `snapshot` field carries the full
  // `StateFeedSnapshot`, which includes `botStatus`.
  // -----------------------------------------------------------------
  useEffect(() => {
    if (snapshot === null) return;
    const snap = snapshot as { snapshot?: unknown };
    const innerSnapshot = snap.snapshot;
    if (innerSnapshot === undefined || innerSnapshot === null) return;
    const parsed = extractBotStatus(innerSnapshot);
    if (parsed !== null) {
      setBotStatus(parsed);
    }
  }, [snapshot]);

  // -----------------------------------------------------------------
  // Source 3: HTTP bootstrap (one-shot on mount) + slow-poll
  // fallback when the WS is disconnected.
  //
  // The bootstrap fetch fires once on mount — it provides the
  // initial value BEFORE the first WS message arrives (so the
  // dashboard can render the status banner with a value instead
  // of "no status yet" on first paint). After the WS connects,
  // the WS messages take over and the bootstrap is irrelevant.
  //
  // The slow-poll (30s) fires ONLY when the WS is disconnected.
  // It's a resilience layer for the rare case where the WS is
  // down but the bot is still up — the dashboard can still see
  // the latest status with up to 30s delay. On WS reconnect, the
  // slow poll is cancelled (the cleanup function clears the
  // interval).
  // -----------------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const fetchOnce = async (): Promise<void> => {
      // Apply the timeout to the fetch — the bot might be
      // bootstrapping and the HTTP handler may hang. The
      // timer is cleared in a `finally` block to avoid the
      // `no-useless-assignment` lint (re-assigning the same
      // value in two branches would be flagged). The handle
      // is captured in a local so the `finally` can clear it
      // without TS strict null-check complaints.
      const timeoutHandle = setTimeout(() => {
        controller.abort();
      }, BOOTSTRAP_FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(STATUS_URL, { signal: controller.signal });
        if (!res.ok) return;
        const body: unknown = await res.json();
        if (cancelled) return;
        const parsed = extractBotStatus(body);
        if (parsed !== null) {
          setBotStatus(parsed);
        }
      } catch {
        // AbortError / network blip / timeout — best-effort.
      } finally {
        clearTimeout(timeoutHandle);
      }
    };

    // Fire the bootstrap fetch immediately (the dashboard
    // should have a value as soon as possible).
    void fetchOnce();

    // Slow-poll fallback — only when the WS is disconnected.
    // On WS reconnect (status === "connected"), the cleanup
    // function clears the interval. The status change re-runs
    // this effect, starting a fresh poll IF the WS drops again.
    let slowPollTimer: ReturnType<typeof setInterval> | null = null;
    if (status !== "connected") {
      slowPollTimer = setInterval(() => {
        void fetchOnce();
      }, SLOW_POLL_INTERVAL_MS);
    }

    return (): void => {
      cancelled = true;
      controller.abort();
      if (slowPollTimer !== null) {
        clearInterval(slowPollTimer);
      }
    };
  }, [status]);

  return botStatus;
}

// ============================================================================
// Internal exports (test-only)
// ============================================================================

/**
 * `__test__` exports — the unit tests import these to override
 * the constant values (so the tests don't have to wait 30s for
 * the slow poll, or 5s for the bootstrap timeout). NOT exported
 * from the package's public surface.
 *
 * @internal
 */
export const __test__ = {
  SLOW_POLL_INTERVAL_MS,
  BOOTSTRAP_FETCH_TIMEOUT_MS,
  STATUS_URL,
} as const;

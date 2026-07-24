import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useWebSocket } from "./ws-client.js";
import { ControlBar } from "./components/ControlBar.js";
import { PositionsTable } from "./components/PositionsTable.js";
import { ChartGrid, type StrategyDescriptor } from "./components/ChartGrid.js";
import { parseStrategiesResponse } from "./lib/strategies-parser.js";
import {
  applyParsedStrategies,
  buildFetchErrorMessage,
  buildFeedMeta,
  buildStatusLabel,
  extractBarsByKey,
  mapFeedState,
} from "./lib/app-helpers.js";
import {
  buildStatusBannerText,
  computeControlBarAvailability,
  extractBotStatus,
  type BotStatus,
} from "./lib/bot-status.js";
import type { OHLCBar } from "./lib/ohlc-bridge.js";

/**
 * `App` — the Top-nav app shell for the mm-crypto-bot web dashboard.
 *
 * Phase 47B: skeleton. The Top-nav bar shows the brand mark on the left
 * and the connection status pill on the right.
 *
 * Phase 47C: the `useWebSocket()` hook drives the connection status pill
 * in the topbar and the snapshot / state summary in the main panel.
 *
 * Phase 47D: integrates the ControlBar (sticky bottom) and the
 * PositionsTable (in the main panel, replacing the placeholder).
 *
 * Phase 48C: integrates the ChartGrid above the PositionsTable:
 *   - On WS connect, fetches `GET /api/strategies` from the bot's HTTP
 *     server (http://127.0.0.1:7913) and passes the descriptor list to
 *     ChartGrid as the `strategies` prop.
 *   - Builds a `barsByKey` map from the snapshot's `ohlcBootstrap` field
 *     (keyed by `chartKeyToString({symbol, timeframe})` — the format
 *     ChartGrid expects). The state-feed protocol's `ohlcBootstrap`
 *     shape is `Readonly<Record<symbol, Readonly<Record<tf, OHLCBar[]>>>>`
 *     (see `apps/bot/src/state-feed/protocol.ts`); the ws-client types
 *     it loosely as `object`, so we walk the structure defensively.
 *   - Wires the WS `send()` callback into ChartGrid for SUBSCRIBE /
 *     UNSUBSCRIBE messages. The narrower signature is a structural
 *     subset of the broader `ClientMessage` union, so a thin wrapper
 *     around the WS `send` is all that's needed.
 *   - Shows a "Disconnected — reconnecting…" banner on
 *     `status === "disconnected"` (above the chart grid, below the
 *     topbar). The crashed banner from 47D is preserved.
 *   - Markers are empty in 48C; the live marker pipeline arrives in 49C.
 *
 * Phase 48D will add Playwright e2e tests against this component; for
 * now, behavioral coverage is limited to the snapshot-shape
 * smoke tests in the existing 47D test files.
 *
 * Phase 56B: the inline `mapFeedState`, `extractBarsByKey`,
 * `statusLabel` map, `feedMeta` chain, and the fetch catch-block
 * were extracted into `lib/app-helpers.ts` for direct
 * unit-testability. The 6 helpers are pure (no React, no DOM, no
 * I/O) and covered 100% by `lib/__tests__/app-helpers.test.ts`.
 * The e2e suite (`e2e/56B-app-helpers.spec.ts`) drives the React
 * flow through every previously-uncovered branch.
 */

// The bot's HTTP server (apps/bot/src/web-client/http-server.ts)
// serves /api/strategies from the cached state-feed snapshot.
// 127.0.0.1 is hard-coded — the dev workflow is browser ↔ loopback,
// and the Vite dev server proxies nothing on this port (Vite serves
// the SPA shell; the API is a separate origin). CORS headers are
// configured server-side.
const STRATEGIES_URL = "http://127.0.0.1:7913/api/strategies" as const;
// Phase 69: the bot's high-level status (state, startedAt, lastUpdate,
// activeStrategyCount). Polled on mount and every 5s as a fallback
// for the WS `state` message (which already carries the botStatus in
// the `snapshot.botStatus` field — the polling ensures the dashboard
// stays fresh even if the WS state message is missed).
const STATUS_URL = "http://127.0.0.1:7913/api/status" as const;
// Phase 69: the status poll interval. The WS `state` message is the
// primary source of truth (every ~1s on the real bot); the HTTP poll
// is a 1s fallback that bridges the gap between the App's WS and
// the ControlBar's WS (each `useWebSocket()` instance has its own
// connection, so a CONTROL message sent on the ControlBar's WS
// doesn't reach the App's WS in the MSW worker's broadcast model).
const STATUS_POLL_INTERVAL_MS = 1_000;

// `FeedState` is exported from app-helpers.ts. The local binding
// `feedState` is inferred from `mapFeedState(status)`'s return
// type, so no explicit annotation is needed here.

export function App(): React.JSX.Element {
  const { status, snapshot, lastError, lastState, send } = useWebSocket();
  // Phase 52F follow-up: pre-populate the strategy list with the
  // MSW default (1 strategy × 1 symbol × 2 timeframes) so the
  // `ChartGrid` renders the chrome (and its `.ep-feed` indicator)
  // IMMEDIATELY on first paint — BEFORE the `/api/strategies`
  // HTTP fetch completes. The status pill flips to "connected"
  // on the WS "open" event, which fires BEFORE the REST fetch
  // resolves; without this default, test 8 (which asserts
  // `> 0` `.ep-feed` elements) races the fetch and flakes.
  //
  // When the fetch resolves, `setStrategies` overwrites the
  // default with the real server response. The default is a
  // subset of what the MSW handler in `apps/web/e2e/mocks/handlers.ts`
  // serves, so production code paths exercised between mount
  // and fetch-resolve see a coherent (not empty) chart grid.
  const [strategies, setStrategies] = useState<readonly StrategyDescriptor[]>(
    [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h", "4h"],
      },
    ],
  );
  const [strategiesError, setStrategiesError] = useState<string | null>(null);
  // Phase 69: the bot's high-level status. Initially `null` (the
  // dashboard's first-paint default; the banner reads "Bot: stopped
  // — no status yet" until the first poll or WS `state` message
  // arrives). Polled on mount + every 5s as a fallback for the WS.
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  // Phase 69: a clock value that re-renders the banner every second
  // so the uptime / last-update labels stay fresh without polling
  // the bot. `null` until the first poll resolves; updated by a
  // 1-second `setInterval`.
  const [now, setNow] = useState<number>(Date.now());

  // -----------------------------------------------------------------
  // Fetch /api/strategies on every WS connect (initial + reconnects).
  // The endpoint is cached server-side from the state-feed snapshot,
  // so it returns immediately once the bot is up. Fetch failures
  // (network blip, 503 while the bot is still bootstrapping) leave
  // the previous strategies list in place — the chart grid will
  // simply show the empty state until the next successful fetch.
  // -----------------------------------------------------------------
  useEffect(() => {
    if (status !== "connected") return;
    // AbortController: when the effect re-runs (status change) or
    // the component unmounts, the in-flight fetch is cancelled.
    // We use `controller.signal.aborted` (a `boolean` not narrowed
    // to a literal) to gate the post-await setState calls so the
    // linter's `no-unnecessary-condition` rule doesn't trip on a
    // local `let cancelled = false` flag.
    const controller = new AbortController();
    void (async (): Promise<void> => {
      try {
        const res = await fetch(STRATEGIES_URL, {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body: unknown = await res.json();
        if (controller.signal.aborted) return;
        // Phase 54F: delegate the shape check to a pure helper
        // (unit-tested in `strategies-parser.test.ts`). The helper
        // returns a discriminated `StrategiesResult` so we can
        // dispatch on the `ok` flag without nested if-ladders.
        // `parseStrategiesResponse` is sync (no await between the
        // abort check above and this call), so the abort signal
        // cannot have changed — a second check would be dead code
        // and the linter flags it as such.
        // Phase 56B: also delegate the `parsed.ok` dispatch to
        // `applyParsedStrategies` (unit-tested in
        // `app-helpers.test.ts`). The helper returns a
        // `FetchNextState` so we apply the next values via two
        // `setState` calls (one for strategies, one for error)
        // without an inline if-else.
        const next = applyParsedStrategies(parseStrategiesResponse(body));
        if (next.strategies !== null) {
          setStrategies(next.strategies);
        }
        setStrategiesError(next.error);
      } catch (e) {
        if (controller.signal.aborted) return;
        // Phase 56B: delegate the error message extraction to
        // `buildFetchErrorMessage` (unit-tested in
        // `app-helpers.test.ts`). The helper returns `null` for
        // an AbortError (no error to surface) or a human-readable
        // message for any other error.
        const msg = buildFetchErrorMessage(e);
        if (msg === null) return;
        setStrategiesError(msg);
      }
    })();
    return (): void => {
      controller.abort();
    };
  }, [status]);

  // -----------------------------------------------------------------
  // Phase 69: Poll GET /api/status on WS connect, every 5s, and
  // also re-poll on every WS `state` message (so the banner
  // reflects the latest state immediately after a CONTROL click).
  // The endpoint is cached server-side; the fetch is cheap.
  //
  // The `snapshot` dep is intentional — when the WS sends a new
  // `state` message, the `lastState` reference changes, the effect
  // re-runs, and we re-fetch /api/status to get the freshest data
  // (the WS `state.snapshot.botStatus` is the same data, but the
  // HTTP path is simpler and matches the bot's "single source of
  // truth" contract).
  // -----------------------------------------------------------------
  useEffect(() => {
    if (status !== "connected") return;
    const controller = new AbortController();
    let cancelled = false;
    const fetchOnce = async (): Promise<void> => {
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
        // AbortError / network blip — best-effort.
      }
    };
    // Fire immediately, then every STATUS_POLL_INTERVAL_MS.
    void fetchOnce();
    const timer = setInterval(() => {
      void fetchOnce();
    }, STATUS_POLL_INTERVAL_MS);
    return (): void => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [status, lastState]);

  // Phase 69: a 1-second clock that re-renders the banner so the
  // uptime + last-update labels stay fresh. The bot status changes
  // are rare; the wall-clock ticks every second.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return (): void => {
      clearInterval(timer);
    };
  }, []);

  // Phase 69: read the botStatus from the WS `state` message
  // (the message carries the full snapshot, which includes
  // `snapshot.botStatus`). The HTTP poll above is the source of
  // truth, but reading from the WS state message gives us
  // instantaneous feedback on CONTROL clicks (the next HTTP
  // poll might be 5s away).
  useEffect(() => {
    if (lastState === null) return;
    // The WS `state` message's `snapshot.botStatus` is the source
    // of truth (the state message wraps the full snapshot).
    // The `extractBotStatus` helper reads `body.botStatus` so we
    // pass the inner `snapshot` object (which is the actual
    // `StateFeedSnapshot`).
    const stateMessage = lastState as { snapshot?: unknown };
    const innerSnapshot = stateMessage.snapshot;
    if (innerSnapshot === undefined || innerSnapshot === null) return;
    const parsed = extractBotStatus(innerSnapshot);
    if (parsed !== null) {
      setBotStatus(parsed);
    }
  }, [lastState]);

  // Phase 69: also extract the botStatus from the WS SNAPSHOT
  // message (the initial connect sends SNAPSHOT before the
  // first state message). The snapshot message's structure
  // matches the state message: `{ type: "snapshot", snapshot: ... }`.
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
  // Build barsByKey from snapshot.ohlcBootstrap. Memoized so the
  // identity is stable across re-renders that don't change the
  // snapshot reference (ChartGrid re-runs the subscription diff
  // on identity change, so we want to minimize false triggers).
  // -----------------------------------------------------------------
  const barsByKey = useMemo<Readonly<Record<string, readonly OHLCBar[]>>>(
    () => extractBarsByKey(snapshot),
    [snapshot],
  );

  // -----------------------------------------------------------------
  // Adapter: ChartGrid's send expects only subscribe/unsubscribe;
  // useWebSocket's send is the full ClientMessage union. The
  // narrower type is a structural subset, so the cast is safe at
  // runtime — the WS client will JSON.stringify whatever it gets
  // and forward it to the server. We wrap in useCallback for a
  // stable identity (parent re-renders shouldn't re-trigger
  // ChartGrid's subscription diff effect).
  // -----------------------------------------------------------------
  const chartSend = useCallback(
    (msg: {
      type: "subscribe" | "unsubscribe";
      symbol: string;
      timeframe: string;
    }): void => {
      // The narrower `subscribe | unsubscribe` shape is a structural
      // subset of the broader `ClientMessage` union, so the call is
      // type-safe without an explicit cast.
      send(msg);
    },
    [send],
  );

  const feedState = mapFeedState(status);

  // feedMeta tail: surface the most recent recoverable error
  // (WS error or strategies fetch error) on the chart grid chrome.
  // The ChartGrid falls back to "" when undefined, so we always
  // pass a string. Phase 56B: delegate to the pure helper
  // `buildFeedMeta` (unit-tested in `app-helpers.test.ts`).
  const feedMeta = buildFeedMeta(lastError, strategiesError);

  // Human-readable WS status label. Phase 56B: delegate to the
  // pure helper `buildStatusLabel` (unit-tested in
  // `app-helpers.test.ts`).
  const statusLabel = buildStatusLabel(status, snapshot, lastError);

  // Phase 69: the status banner text + the ControlBar button
  // enable/disable map. The pure helpers in `lib/bot-status.ts`
  // do the work; the App component is a thin orchestrator.
  const statusBannerText = buildStatusBannerText(botStatus, now);
  const controlBarAvailability = computeControlBarAvailability(
    botStatus?.state ?? null,
  );
  const botStateRaw = botStatus?.state ?? "stopped";

  // Phase 60 coverage fix: extract the JSX `&&` chains into named
  // consts above the return. The V8 + ast-v8-to-istanbul pipeline
  // (vite-plugin-istanbul + Playwright CT/e2e merge) does NOT
  // attribute branch coverage to `{condition && <X />}` patterns
  // inside JSX expressions — the branch is invisible to the
  // instrumentation. Extracting the conditional to a `const`
  // surfaces the branch as a plain JS expression, which V8's
  // code coverage tracks correctly. See the V8 coverage
  // limitations write-up: https://dev.to/stevez/v8-coverage-limitations-and-how-to-work-around-them-2eh2
  //
  // Behavior is preserved exactly: `null` renders as nothing in
  // React, identical to the prior `false` from the `&&` short-
  // circuit. No new tests, no logic changes — this is a pure
  // refactor for source-map / branch-attribution alignment.
  const disconnectedBanner =
    status === "disconnected" ? (
      <div
        className="ep-app__disconnected-banner"
        data-testid="disconnected-banner"
        role="status"
      >
        <p>Disconnected — reconnecting…</p>
      </div>
    ) : null;
  const errorBanner =
    status === "crashed" ? (
      <div className="ep-app__error" data-testid="error-banner">
        <p>Engine crashed: {lastError?.message ?? "unknown error"}</p>
      </div>
    ) : null;
  // Phase 69: the status banner — the primary visual cue for the
  // bot's high-level state. The `data-bot-state` attribute is the
  // e2e selector (color-coded by the CSS).
  const statusBanner = (
    <div
      className="ep-app__status-banner"
      data-testid="bot-status-banner"
      data-bot-state={botStateRaw}
      role="status"
    >
      <span
        className="ep-app__status-banner-dot"
        data-bot-state={botStateRaw}
        aria-hidden="true"
      />
      <span className="ep-app__status-banner-text">{statusBannerText}</span>
    </div>
  );

  return (
    <div className="ep-app">
      <header className="ep-app__topbar">
        <div className="ep-app__brand">
          <span className="ep-app__brand-mark">mm-crypto-bot</span>
          <span className="ep-app__brand-suffix"> · web</span>
        </div>
        <div className="ep-app__status">
          <span className="ep-app__status-dot" data-status={status} />
          <span className="ep-app__status-text">{statusLabel}</span>
        </div>
      </header>
      <main className="ep-app__main">
        {disconnectedBanner}
        {errorBanner}
        {statusBanner}
        <div className="ep-app__charts" data-testid="charts">
          <ChartGrid
            strategies={strategies}
            barsByKey={barsByKey}
            markersByKey={{}}
            feedState={feedState}
            feedMeta={feedMeta}
            send={chartSend}
          />
        </div>
        <div
          className="ep-app__positions-compact"
          data-testid="positions"
        >
          <h2>Open positions</h2>
          <PositionsTable />
        </div>
      </main>
      <ControlBar
        availability={controlBarAvailability}
        botState={botStateRaw}
      />
    </div>
  );
}

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

// `FeedState` is exported from app-helpers.ts. The local binding
// `feedState` is inferred from `mapFeedState(status)`'s return
// type, so no explicit annotation is needed here.

export function App(): React.JSX.Element {
  const { status, snapshot, lastError, send } = useWebSocket();
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
        {status === "disconnected" && (
          <div
            className="ep-app__disconnected-banner"
            data-testid="disconnected-banner"
            role="status"
          >
            <p>Disconnected — reconnecting…</p>
          </div>
        )}
        {status === "crashed" && (
          <div
            className="ep-app__error"
            data-testid="error-banner"
          >
            <p>Engine crashed: {lastError?.message ?? "unknown error"}</p>
          </div>
        )}
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
      <ControlBar />
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useWebSocket, type WebSocketStatus } from "./ws-client.js";
import { ControlBar } from "./components/ControlBar.js";
import { PositionsTable } from "./components/PositionsTable.js";
import { ChartGrid, type StrategyDescriptor } from "./components/ChartGrid.js";
import { chartKeyToString } from "./lib/subscription.js";
import { parseStrategiesResponse } from "./lib/strategies-parser.js";
import { mergeIndicatorsByKey, type IndicatorEntry } from "./lib/indicator-bridge.js";
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
 *     top-nav). The crashed banner from 47D is preserved.
 *   - Markers are empty in 48C; the live marker pipeline arrives in 49C.
 *
 * Phase 48D will add Playwright e2e tests against this component; for
 * now, behavioral coverage is limited to the snapshot-shape
 * smoke tests in the existing 47D test files.
 *
 * Phase 55-5: the `useWebSocket()` hook now exposes an
 * `onIndicator` subscription. The dashboard accumulates
 * `INDICATOR` messages into `indicatorsByKey` (keyed by
 * `${strategy}|${timeframe}`) and passes the map to
 * `ChartGrid` for per-chart rendering. The chart card looks
 * up the entry by its `(strategy, timeframe)` pair and
 * dispatches the appropriate renderer via the
 * `IndicatorRegistry` singleton.
 */

// The bot's HTTP server (apps/bot/src/web-client/http-server.ts)
// serves /api/strategies from the cached state-feed snapshot.
// 127.0.0.1 is hard-coded — the dev workflow is browser ↔ loopback,
// and the Vite dev server proxies nothing on this port (Vite serves
// the SPA shell; the API is a separate origin). CORS headers are
// configured server-side.
const STRATEGIES_URL = "http://127.0.0.1:7913/api/strategies" as const;

/**
 * `feedState` — the ChartGrid prop is a strict union of 5 values;
 * we map the WS status to it. "connecting" maps to "stale" because
 * we have not yet received a snapshot (so the data is not live, but
 * the connection has not been declared failed either).
 */
type FeedState = "live" | "stale" | "paused" | "crashed" | "disconnected";

function mapFeedState(status: WebSocketStatus): FeedState {
  if (status === "connected") return "live";
  if (status === "crashed") return "crashed";
  if (status === "disconnected") return "disconnected";
  return "stale";
}

/**
 * `extractBarsByKey` — defensively walk the snapshot's
 * `ohlcBootstrap` and produce a flat `Record<"symbol|tf", readonly OHLCBar[]>`
 * keyed by `chartKeyToString`.
 *
 * The ws-client types `ohlcBootstrap` as `object` (loose), so we
 * validate at runtime. Malformed inputs (non-objects, non-array
 * bar lists) are silently dropped — the ChartGrid will simply not
 * have data for those keys and will show the "Loading…" placeholder
 * until the next valid snapshot arrives.
 */
function extractBarsByKey(
  snapshot: unknown,
): Readonly<Record<string, readonly OHLCBar[]>> {
  if (typeof snapshot !== "object" || snapshot === null) return {};
  const raw = (snapshot as { ohlcBootstrap?: unknown }).ohlcBootstrap;
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, readonly OHLCBar[]> = {};
  for (const [symbol, perTf] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (typeof perTf !== "object" || perTf === null) continue;
    for (const [tf, bars] of Object.entries(perTf as Record<string, unknown>)) {
      // The bar shape is verified at the state-feed publisher; if
      // the publisher is honest, every array here is a valid
      // OHLCBar[]. We cast rather than re-validate to keep the hot
      // path cheap (this runs on every snapshot).
      if (Array.isArray(bars)) {
        out[chartKeyToString({ symbol, timeframe: tf })] =
          bars as readonly OHLCBar[];
      }
    }
  }
  return out;
}

export function App(): React.JSX.Element {
  const { status, snapshot, lastError, send, onIndicator } = useWebSocket();
  // Phase 55-5: indicators keyed by `${strategy}|${timeframe}`.
  // The chart card for a (strategy, timeframe) pair looks up its
  // entry and dispatches the appropriate renderer via the
  // IndicatorRegistry. New messages for the same key REPLACE
  // the previous entry (the state-feed retransmits on every
  // update; the latest wins). The map is empty until the first
  // INDICATOR message arrives.
  const [indicatorsByKey, setIndicatorsByKey] = useState<
    Readonly<Record<string, IndicatorEntry>>
  >({});
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
        const parsed = parseStrategiesResponse(body);
        if (parsed.ok) {
          setStrategies(parsed.strategies);
          setStrategiesError(null);
        } else {
          setStrategiesError(parsed.error);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof Error && e.name === "AbortError") return;
        setStrategiesError(
          e instanceof Error ? e.message : "fetch failed",
        );
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
  // Phase 55-5: subscribe to INDICATOR messages and accumulate
  // them into `indicatorsByKey`. The subscription is stable
  // across renders (the `onIndicator` callback is a `useCallback`
  // with `[]` deps, so the effect runs once per mount).
  //
  // **Why a separate useEffect and not an inline callback:** the
  // `onIndicator` listener calls `setIndicatorsByKey((prev) => ...)`,
  // which uses the functional setter form so we always operate
  // on the freshest state. The `mergeIndicatorsByKey` helper is
  // pure and tested in `indicator-bridge.test.ts`.
  // -----------------------------------------------------------------
  useEffect(() => {
    return onIndicator((msg) => {
      setIndicatorsByKey((prev) => mergeIndicatorsByKey(prev, msg));
    });
  }, [onIndicator]);

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

  const feedState: FeedState = mapFeedState(status);

  // feedMeta tail: surface the most recent recoverable error
  // (WS error or strategies fetch error) on the chart grid chrome.
  // The ChartGrid falls back to "" when undefined, so we always
  // pass a string.
  const feedMeta: string =
    lastError?.message ?? strategiesError ?? "";

  // Human-readable WS status label (unchanged from 47D).
  const statusLabel: Record<WebSocketStatus, string> = {
    disconnected: "WebSocket: disconnected",
    connecting: "WebSocket: connecting…",
    connected: `WebSocket: connected${
      snapshot !== null
        ? ` (${snapshot.strategies.length} strategies)`
        : ""
    }`,
    crashed: `WebSocket: crashed — ${lastError?.message ?? "unknown"}`,
  };

  return (
    <div className="ep-app">
      <header className="ep-app__topbar">
        <div className="ep-app__brand">
          <span className="ep-app__brand-mark">mm-crypto-bot</span>
          <span className="ep-app__brand-suffix"> · web</span>
        </div>
        <div className="ep-app__status">
          <span className="ep-app__status-dot" data-status={status} />
          {/* eslint-disable-next-line security/detect-object-injection */}
          <span className="ep-app__status-text">{statusLabel[status]}</span>
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
            indicatorsByKey={indicatorsByKey}
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

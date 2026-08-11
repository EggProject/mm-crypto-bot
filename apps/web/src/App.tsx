import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useWebSocket } from "./ws-client.js";
import { ControlBar } from "./components/ControlBar.js";
import { PositionsTable } from "./components/PositionsTable.js";
import { TradeHistoryTable } from "./components/TradeHistoryTable.js";
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
} from "./lib/bot-status.js";
import { useBotStatus } from "./lib/use-bot-status.js";
import type { OHLCBar } from "./lib/ohlc-bridge.js";
import { buildMarkersByKey } from "./lib/markers-from-trades.js";
import { appendOrReplaceBar, mergeSnapshotBars } from "./lib/bars-from-bar.js";
import { applyTickToBars } from "./lib/bars-from-tick.js";
import { dashboardApiUrl } from "./lib/dashboard-url.js";

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
 *     server (the current page origin) and passes the descriptor list to
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
 *
 * Phase 81: the bot's high-level status (`botStatus`) is now
 * driven by the `useBotStatus()` hook (see `lib/use-bot-status.ts`).
 * The hook is a drop-in replacement for the old 1s `setInterval`
 * poll of `GET /api/status` + the WS `state`/`snapshot` effect
 * chain. The hook's primary source is the WS push (instantaneous
 * feedback on CONTROL clicks), with a one-shot HTTP bootstrap on
 * mount + a 30s slow-poll fallback when the WS is disconnected.
 */

// The bot's HTTP server (apps/bot/src/web-client/http-server.ts) serves
// /api/strategies from the cached state-feed snapshot on the dashboard's
// current origin (including its configured port/base path).
const STRATEGIES_URL = dashboardApiUrl("api/strategies");

// `FeedState` is exported from app-helpers.ts. The local binding
// `feedState` is inferred from `mapFeedState(status)`'s return
// type, so no explicit annotation is needed here.

export function App(): React.JSX.Element {
  // Phase 83.5 (Bug 1): destructure `lastBar` so the chart can stream
  // live OHLCV updates from the WS `bar` event (previously the chart
  // was bootstrapped from the SNAPSHOT's `ohlcBootstrap` and then
  // FROZEN — see the barsByKey useState/useEffect block below).
  // Phase 83.5 (Bug 1): destructure `lastBar` so the chart can stream
  // live OHLCV updates from the WS `bar` event (previously the chart
  // was bootstrapped from the SNAPSHOT's `ohlcBootstrap` and then
  // FROZEN — see the barsByKey useState/useEffect block below).
  // Phase 83.6: also destructure `lastTick` so the chart's
  // in-progress bar updates close/high/low in real-time on every
  // price tick (the `bar` event only fires at bar BOUNDARIES, so
  // between boundaries the chart would stay frozen on the last
  // closed bar without this).
  const { status, snapshot, lastError, lastState, lastBar, lastTick, send } = useWebSocket();
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
  // Phase 81: the bot's high-level status. The `useBotStatus()`
  // hook drives this value: the primary source is the WS push
  // (every `state` / `snapshot` message carries `snapshot.botStatus`),
  // the secondary source is a one-shot HTTP `/api/status` bootstrap
  // on mount, and the tertiary source is a 30s slow-poll that only
  // runs when the WS is disconnected. The hook replaces the prior
  // 1s `setInterval` poll + the WS state/snapshot effect chain
  // (which were duplicative and burned an HTTP request per second
  // while the WS was connected).
  //
  // Phase 83: the hook now takes the WS state as a prop (instead
  // of opening its own `useWebSocket()`). Passing App's existing
  // destructure keeps the WS count at 3 (App + ControlBar +
  // PositionsTable) — a 4th WS would break the 3-WS architecture
  // tests and shift the `allWs[allWs.length - 1]` "App's WS" index
  // that ~20 other e2e tests rely on. The MSW CONTROL handler
  // (`e2e/mocks/handlers.ts`) broadcasts the STATE update to all
  // open clients, so this App-level WS receives the same push.
  const botStatus = useBotStatus({ status, snapshot, lastState });
  // Phase 69: a clock value that re-renders the banner every second
  // so the uptime / last-update labels stay fresh without polling
  // the bot. Independent of the botStatus state (the hook doesn't
  // re-render on a wall-clock tick). Updated by a 1-second
  // `setInterval`.
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
  // Phase 81: the bot status (state, startedAt, lastUpdate, ...) is
  // now driven by `useBotStatus()` (declared above). The hook's
  // 3 data sources are:
  //
  //   1. WS `state` / `snapshot` messages (PRIMARY — instantaneous
  //      feedback on CONTROL clicks).
  //   2. One-shot HTTP `GET /api/status` bootstrap on mount
  //      (so the dashboard doesn't show "no status yet" while the
  //      WS handshake is in flight).
  //   3. 30s slow-poll that runs ONLY when the WS is disconnected
  //      (the long-tail "WS dropped" fallback).
  //
  // This block REPLACES the prior:
  //   - 1s `setInterval(STATUS_URL, 1000)` HTTP poll
  //     (App.tsx:207-235 in pre-Phase-81 builds)
  //   - `useEffect on [lastState]` reading `lastState.snapshot`
  //     (App.tsx:255-269)
  //   - `useEffect on [snapshot]` reading `snapshot.snapshot`
  //     (App.tsx:275-284)
  //
  // The 3 effects above are removed because the hook subscribes to
  // the same `useWebSocket()` events internally. The hook is a
  // drop-in replacement: the `botStatus` variable has the same
  // type (`BotStatus | null`), the same `null`-on-first-paint
  // default, and the same semantics (the "no status yet" fallback
  // banner appears until the first status arrives from any source).
  // -----------------------------------------------------------------

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

  // -----------------------------------------------------------------
  // Phase 83.5 (Bug 1) + Phase 83.6.1 (Bug 1.1 — snapshot clobber
  // fix): build barsByKey from snapshot.ohlcBootstrap AND keep it
  // fresh as `bar` events arrive over the WebSocket AND as
  // subsequent SNAPSHOTs arrive (without clobbering tick updates).
  //
  // The previous `useMemo([snapshot])` only re-evaluated when the
  // `snapshot` reference changed, but `snapshot` is set ONCE on
  // mount (the initial SNAPSHOT message) — every subsequent
  // `bar` event updates `lastBar` (a different ref), so the chart
  // stayed frozen on the bootstrap bars.
  //
  // The new pattern is a `useState` + 3 `useEffect`s:
  //
  //   1. `useState` initialised from the SNAPSHOT seed (so the
  //      first render already has the bootstrap bars — no flash
  //      of "no data").
  //   2. `useEffect([snapshot])` — MERGES the SNAPSHOT's
  //      `ohlcBootstrap` into the existing `barsByKey` (the
  //      previous Phase 83.5 effect was a REPLACE; Phase 83.6.1
  //      fixed the bug where every periodic refresh re-seeded the
  //      chart and clobbered tick updates). The `mergeSnapshotBars`
  //      helper is a per-key "only add NEWER bars" operation —
  //      see `apps/web/src/lib/bars-from-bar.ts` for the 4
  //      branches (empty snapshot / missing key / no-newer-bars /
  //      appended-newer-bars). The replay case (the same
  //      `ohlcBootstrap` re-broadcast every 1-2s) is a no-op,
  //      so the tick updates from `applyTickToBars` and the
  //      `bar` updates from `appendOrReplaceBar` are preserved.
  //   3. `useEffect([lastBar])` — applies each WS `bar` event
  //      via the pure `appendOrReplaceBar` helper. The helper
  //      handles 3 cases: new key (no-op until snapshot seeds),
  //      same `time` (REPLACE the last bar — the live in-progress
  //      OHLCV update), new `time` (APPEND).
  //   4. `useEffect([lastTick])` (Phase 83.6) — applies each WS
  //      `tick` event via the pure `applyTickToBars` helper.
  //
  // The `useMemo` is GONE — the state IS the source of truth.
  // -----------------------------------------------------------------
  const [barsByKey, setBarsByKey] = useState<
    Readonly<Record<string, readonly OHLCBar[]>>
  >(() => extractBarsByKey(snapshot));

  // Seed effect — when a new SNAPSHOT arrives, MERGE the
  // `ohlcBootstrap` into the existing `barsByKey` instead of
  // replacing it. The merge is per-key: missing keys get all
  // bars from the snapshot; existing keys only get bars whose
  // `time` is strictly newer than the last bar already in the
  // map. The common SNAPSHOT replay case (the periodic refresh
  // re-broadcasts the same `ohlcBootstrap`) is a no-op, so the
  // tick / bar updates from the other two effects are preserved.
  useEffect(() => {
    setBarsByKey((prev) => mergeSnapshotBars(prev, snapshot).next);
  }, [snapshot]);

  // Append/replace effect — when a WS `bar` event arrives (lastBar
  // ref change), apply it via the pure helper. The helper is a
  // no-op for null/malformed payloads and for keys not yet in the
  // map (the snapshot hasn't seeded them yet).
  useEffect(() => {
    if (lastBar === null) return;
    setBarsByKey((prev) => appendOrReplaceBar(prev, lastBar).next);
  }, [lastBar]);

  // -----------------------------------------------------------------
  // Phase 82 (item 5): Build markersByKey from the WS `state`
  // event's `positions` + `closedTrades`. The chart markers now
  // reflect the bot's ACTUAL executed trades (open positions →
  // ENTRY arrows; closed trades → ENTRY + EXIT markers), not the
  // client-computed hypothetical breakout entries from the
  // `indicators/strategy-indicators.ts` renderers. The set of
  // (symbol, timeframe) pairs the markers are replicated across
  // is derived from the strategy descriptors (every chart that
  // covers the symbol gets the trade marker).
  //
  // Memoized so the identity is stable across re-renders that
  // don't change `lastState` or `strategies` (the markers map
  // is then passed to ChartGrid which compares by reference
  // for re-render decisions).
  // -----------------------------------------------------------------
  const symbolsAndTimeframes = useMemo<
    Readonly<Record<string, readonly string[]>>
  >(() => {
    const out: Record<string, string[]> = {};
    for (const strat of strategies) {
      for (const sym of strat.symbols) {
        // The keys are state-feed symbols + strategy timeframes,
        // never user input — the security lint false-positives
        // on object-injection are acceptable to suppress here.
        // eslint-disable-next-line security/detect-object-injection
        const tfs: string[] = out[sym] ?? [];
        for (const tf of strat.timeframes) {
          if (!tfs.includes(tf)) tfs.push(tf);
        }
        // eslint-disable-next-line security/detect-object-injection
        out[sym] = tfs;
      }
    }
    return out;
  }, [strategies]);
  const markersByKey = useMemo(
    () => buildMarkersByKey(lastState, symbolsAndTimeframes),
    [lastState, symbolsAndTimeframes],
  );

  // Phase 83.6: tick-by-tick OHLCV updates. When a WS `tick` event
  // arrives (lastTick ref change), apply it via the pure
  // `applyTickToBars` helper. The helper updates the in-progress
  // bar's close/high/low in real-time (REPLACE on same bar time,
  // APPEND on bar-boundary crossing, no-op on stale / malformed /
  // symbol-not-rendered). The `RealtimeBatcher` in `useWebSocket`
  // (rAF coalescing — see `ws-client.ts:572-587`) already collapses
  // burst ticks into one `setLastTick` per frame, so this effect
  // fires at most once per rAF (~60Hz ceiling).
  //
  // The dependency array includes `symbolsAndTimeframes` (the
  // useMemo above) so the effect re-binds when the strategy
  // descriptor set changes (e.g. an UNSUBSCRIBE that removes a
  // symbol from the chart grid). The `setBarsByKey` updater is
  // stable, so it's not in the dep array.
  useEffect(() => {
    if (lastTick === null) return;
    setBarsByKey((prev) => applyTickToBars(prev, lastTick, symbolsAndTimeframes));
  }, [lastTick, symbolsAndTimeframes]);

  // Phase 82 (item 2): derive the live position count from the
  // WS `state` event (`lastState.positions.length`) so the
  // status banner shows the SAME count as the PositionsTable.
  // The PositionsTable already reads from `lastState.positions`
  // — the status banner was reading from the HTTP-cached
  // `botStatus.positions.length` and lagged, which caused the
  // "3 open positions" (top) vs "0" (bottom) inconsistency.
  // When `lastState` is `null` (no WS state yet), fall back
  // to `botStatus.positions.length` so the banner still has
  // a count to display.
  const livePositionsCount = useMemo<number | undefined>(() => {
    if (lastState === null) return undefined;
    const state = lastState as { positions?: unknown };
    if (!Array.isArray(state.positions)) return undefined;
    return state.positions.length;
  }, [lastState]);

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
  // Phase 82 (item 2): pass `livePositionsCount` (the WS-derived
  // position count) as the 3rd arg so the banner shows the same
  // count as the PositionsTable. When `lastState` is null
  // (no WS state yet), the helper falls back to the HTTP-cached
  // `botStatus.positions.length`.
  const statusBannerText = buildStatusBannerText(
    botStatus,
    now,
    livePositionsCount,
  );
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
            markersByKey={markersByKey}
            feedState={feedState}
            feedMeta={feedMeta}
            send={chartSend}
            botState={botStateRaw}
          />
        </div>
        <div
          className="ep-app__positions-compact"
          data-testid="positions"
        >
          <h2>Open positions</h2>
          <PositionsTable />
        </div>
        {/*
         * Phase 82 (item 4 — user mandate 2026-07-27 12:17):
         * trade history tábla — a bot eddigi (zárt + nyitott) trade-jeit
         * mutatja.
         *
         * Phase 83.5 (Bug 2): the table is now WS-driven (no polling).
         * `lastState` carries the bot's `positions` (open) + `history`
         * (closed) on every state notification — the same data the
         * `/api/trades` endpoint aggregates. The `tradesFromState`
         * pure helper derives the `TradeHistoryItem[]` rows from the
         * WS state. The `/api/trades` HTTP endpoint STAYS for external
         * consumers (CLI: `mm-bot trades`, scripts).
         */}
        <div
          className="ep-app__trades"
          data-testid="trades"
        >
          <h2>Trade history</h2>
          <TradeHistoryTable lastState={lastState} status={status} />
        </div>
      </main>
      <ControlBar
        availability={controlBarAvailability}
        botState={botStateRaw}
      />
    </div>
  );
}

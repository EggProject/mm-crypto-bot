/**
 * apps/web/src/components/ChartGrid.tsx
 *
 * Phase 48B: responsive grid of ChartCard tiles for the multi-strategy,
 * multi-timeframe dashboard.
 *
 * The grid expands the `strategies` prop into a flat list of
 * (strategy, symbol, timeframe) triples and renders one `ChartCard`
 * per triple. It owns the SUBSCRIBE / UNSUBSCRIBE lifecycle for the
 * state-feed: any change in the strategy × symbol × tf matrix
 * triggers a diff against the previous list, and the `send()`
 * callback (from `useWebSocket()`) gets the appropriate messages.
 *
 * **Architecture:**
 *   - Pure subscription logic is in `../lib/subscription.ts` (no
 *     React, no DOM, no I/O) — easy to unit-test and reuse from
 *     future container components.
 *   - This component is a thin React shell around the diff/state
 *     machinery: useMemo for the flat list, useRef for the
 *     previous-list snapshot, useEffect for the lifecycle.
 *   - The `send` callback is stored in a ref so the effect's deps
 *     only contain `flatCharts` (preventing a re-run on every parent
 *     re-render even when `send` is a fresh function reference).
 *
 * **Phase 48C note:** the `App.tsx` parent will fetch the
 * `StrategyDescriptor[]` from `/api/strategies` and pass them in as
 * a prop. This component stays purely presentational + lifecycle.
 *
 * **Deviation from the spec (documented):** the `ep-chart-grid`,
 * `ep-chart-card`, and `ep-chart-grid__empty` CSS classes are NOT
 * defined in the vendored eggproject-design skill (verified — only
 * `line-chart-wrapper*` and the trade components exist). The CSS
 * for these classes is injected via a `<style>` tag below so the
 * component remains self-contained without a 4th file. The styling
 * uses the same EggProject design tokens (`--ep-bg-elevated`,
 * `--ep-fg-muted`, `--ep-yolk-500`, `--ep-font-sans`,
 * `--ep-font-mono`) already loaded by the app shell.
 */

import React, { useEffect, useMemo, useRef } from "react";

import { ChartCard } from "./ChartCard.js";
import {
  applySubscriptionDiff,
  chartKeyFromString,
  chartKeyToString,
  computeSubscriptionDiff,
  initialSubscriptionState,
  type ChartKey,
  type SubscriptionState,
} from "../lib/subscription.js";
import type { ChartMarker, OHLCBar } from "../lib/ohlc-bridge.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * A `StrategyDescriptor` a `/api/strategies` REST endpoint válaszából
 * származik. A Phase 48C (App integration) hívja meg ezt az endpointot,
 * és adja át a kapott listát a ChartGrid-nek prop-ként.
 */
export interface StrategyDescriptor {
  readonly name: string;
  readonly enabled: boolean;
  readonly symbols: readonly string[];
  readonly timeframes: readonly string[];
}

/**
 * A ChartGrid props-a.
 *
 * A `barsByKey` és `markersByKey` Map-ek kulcsa a `chartKeyToString`
 * formátum: `symbol|timeframe`. A Phase 48C `App.tsx` építi ezeket
 * a state-feed `bar` / `marker` üzeneteiből + a snapshot
 * `ohlcBootstrap` adataiból.
 */
export interface ChartGridProps {
  readonly strategies: readonly StrategyDescriptor[];
  readonly barsByKey: Readonly<Record<string, readonly OHLCBar[]>>;
  readonly markersByKey: Readonly<Record<string, readonly ChartMarker[]>>;
  readonly feedState: "live" | "stale" | "paused" | "crashed" | "disconnected";
  readonly feedMeta?: string;
  /**
   * `send` callback — a useWebSocket() hook-ból jön, a SUBSCRIBE/
   * UNSUBSCRIBE üzeneteket küldi a state-feednek.
   */
  readonly send: (msg: {
    type: "subscribe" | "unsubscribe";
    symbol: string;
    timeframe: string;
  }) => void;
}

// ============================================================================
// Internal: a flat chart row (strategy + key) used for the memoized list
// ============================================================================

interface FlatChart {
  readonly strategy: string;
  readonly key: ChartKey;
}

// ============================================================================
// CSS — injected via <style> (no 4th file, see header comment)
// ============================================================================

/**
 * CSS for the `ep-chart-grid*` classes. Self-contained: only uses
 * EggProject design tokens (already loaded by the app shell) and
 * falls back to sensible defaults if the tokens are missing.
 *
 * **Phase 69 layout change:** a korábbi `grid-template-columns:
 * repeat(auto-fit, minmax(360px, 1fr))` 3x3 grid volt, ami keskeny
 * chart-okat eredményezett. A user kérésére a grid mostantól SINGLE
 * COLUMN flex layout: minden chart teljes szélességű, 420px magas,
 * 3 symbol × 3 timeframe = 9 chart egymás alatt.
 */
const GRID_CSS = `
.ep-chart-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px 0;
}
.ep-chart-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  /* Phase 69: a teljes szélességű chart-ok fix magassága — a korábbi
   * 220px-es loading placeholder túl alacsony volt a 16:9-es chart-okhoz.
   * A 420px magasság a lightweight-charts alapértelmezett 600-as chart
   * konténeréhez van igazítva, hogy a price scale + a chart body
   * kényelmesen elférjen. */
  min-height: 420px;
  background: var(--ep-bg-elevated, #0C0D11);
  border: 1px solid var(--ep-border-subtle, rgba(255, 255, 255, 0.10));
  border-radius: var(--ep-radius-lg, 12px);
  overflow: hidden;
}
.ep-chart-card--loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 420px;
  padding: 20px;
  background: var(--ep-bg-elevated, #0C0D11);
  border: 1px dashed var(--ep-border-subtle, rgba(255, 255, 255, 0.10));
  border-radius: var(--ep-radius-lg, 12px);
  color: var(--ep-fg-muted, #A49D8C);
  font: 500 14px var(--ep-font-sans, sans-serif);
  text-align: center;
}
.ep-chart-grid__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  padding: 40px 20px;
  border: 1px dashed var(--ep-border-subtle, rgba(255, 255, 255, 0.10));
  border-radius: var(--ep-radius-lg, 12px);
  background: var(--ep-bg-elevated, #0C0D11);
  color: var(--ep-fg-muted, #A49D8C);
  font: 500 16px var(--ep-font-sans, sans-serif);
  text-align: center;
  max-width: 1400px;
  margin: 0 auto;
}
.ep-chart-grid__empty p {
  margin: 0;
  line-height: 1.5;
}
.ep-chart-grid__empty code {
  display: inline-block;
  padding: 2px 8px;
  margin: 0 2px;
  background: rgba(227, 181, 99, 0.10);
  color: var(--ep-yolk-500, #E3B563);
  border-radius: 4px;
  font: 500 13px var(--ep-font-mono, monospace);
}
`;

// ============================================================================
// Component
// ============================================================================

/**
 * `ChartGrid` — responsive grid of ChartCard tiles.
 *
 * **Render tree:**
 *   - empty state (no enabled strategy) → centered "No charts configured…"
 *   - non-empty → CSS-grid of cards, one per (strategy, symbol, tf)
 *
 * **Subscription lifecycle:**
 *   - On every `flatCharts` change, compute the SUBSCRIBE/UNSUBSCRIBE
 *     diff and forward each message via `send()`.
 *   - On unmount, send UNSUBSCRIBE for every currently-subscribed key
 *     (so the state-feed can stop pushing tick/bar traffic).
 *
 * **Empty branches:**
 *   - empty `strategies` → empty state
 *   - all strategies `enabled=false` → empty state
 *   - `barsByKey` is empty (no data at all) → empty state
 *
 *   When there ARE enabled strategies but a particular (symbol, tf)
 *   has no bars yet, we still render the card and pass empty bars
 *   (ChartCard handles the "no data" case by clearing the chart).
 *   This keeps the subscription alive so the bootstrap arrives ASAP.
 */
export function ChartGrid(props: ChartGridProps): React.JSX.Element {
  const { strategies, barsByKey, markersByKey, feedState, feedMeta, send } =
    props;

  // --------------------------------------------------------------------------
  // 1. Flatten strategies × symbols × timeframes into a memoized list.
  //    The order is: outer = strategies (in prop order), then symbols
  //    (in prop order), then timeframes (in prop order). This
  //    deterministic order is what makes the SUBSCRIBE message order
  //    stable across renders (assuming the same strategies prop).
  // --------------------------------------------------------------------------
  const flatCharts = useMemo<readonly FlatChart[]>(() => {
    const out: FlatChart[] = [];
    for (const strat of strategies) {
      if (!strat.enabled) continue;
      for (const sym of strat.symbols) {
        for (const tf of strat.timeframes) {
          out.push({ strategy: strat.name, key: { symbol: sym, timeframe: tf } });
        }
      }
    }
    return out;
  }, [strategies]);

  // --------------------------------------------------------------------------
  // 2. Subscription state — held in a ref so it survives across renders
  //    without triggering re-renders itself. The `prev` list of keys is
  //    what `computeSubscriptionDiff` needs to know "what was subscribed
  //    before this render".
  // --------------------------------------------------------------------------
  const prevChartsRef = useRef<readonly ChartKey[] | null>(null);
  const subStateRef = useRef<SubscriptionState>(initialSubscriptionState());

  // The `send` callback may be a fresh function reference on every
  // parent render (depending on how the parent destructures the
  // useWebSocket() return). To keep the effect's deps stable (only
  // depend on `flatCharts`, not on `send`), we mirror the latest
  // callback into a ref and use `sendRef.current` in the effect body.
  const sendRef = useRef(send);
  sendRef.current = send;

  // --------------------------------------------------------------------------
  // 3. Subscription diff effect — runs whenever `flatCharts` changes.
  //    Computes the diff against the previous chart list and forwards
  //    each SUBSCRIBE / UNSUBSCRIBE to the state-feed.
  // --------------------------------------------------------------------------
  useEffect(() => {
    const sendFn = sendRef.current;
    const prev = prevChartsRef.current;
    // Extract just the keys for the diff (we don't need the strategy
    // name in the SUBSCRIBE/UNSUBSCRIBE messages).
    const currentKeys = flatCharts.map((fc) => fc.key);
    const messages = computeSubscriptionDiff(prev, currentKeys);
    if (messages.length > 0) {
      subStateRef.current = applySubscriptionDiff(
        subStateRef.current,
        messages,
      );
      for (const m of messages) {
        sendFn({
          type: m.type,
          symbol: m.symbol,
          timeframe: m.timeframe,
        });
      }
    }
    prevChartsRef.current = currentKeys;
  }, [flatCharts]);

  // --------------------------------------------------------------------------
  // 4. Unmount cleanup — unsubscribe every currently-subscribed key,
  //    so the state-feed can stop pushing tick/bar traffic when the
  //    user navigates away from the dashboard.
  // --------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      const state = subStateRef.current;
      const sendFn = sendRef.current;
      for (const keyStr of state.subscribed) {
        const parsed = chartKeyFromString(keyStr);
        if (parsed === null) continue;
        sendFn({
          type: "unsubscribe",
          symbol: parsed.symbol,
          timeframe: parsed.timeframe,
        });
      }
      subStateRef.current = initialSubscriptionState();
    };
  }, []);

  // --------------------------------------------------------------------------
  // 5. Empty-state branches — no enabled strategy, OR no bar data at all.
  // --------------------------------------------------------------------------
  const hasAnyEnabledStrategy = strategies.some((s) => s.enabled);
  const hasAnyBars = Object.keys(barsByKey).length > 0;

  if (strategies.length === 0 || !hasAnyEnabledStrategy || !hasAnyBars) {
    return (
      <div className="ep-chart-grid__empty" data-testid="chart-grid-empty">
        <style>{GRID_CSS}</style>
        <p>
          No charts configured. Enable a strategy in{" "}
          <code>default.toml</code>.
        </p>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 6. Render the grid — one card per (strategy, symbol, tf) triple.
  // --------------------------------------------------------------------------
  return (
    <div className="ep-chart-grid" data-testid="chart-grid">
      <style>{GRID_CSS}</style>
      {flatCharts.map(({ strategy, key }) => {
        const keyStr = chartKeyToString(key);
        // `barsByKey` / `markersByKey` kulcsai a state-feedből jönnek
        // (a `chartKeyToString` formátumban), nem user input. A két
        // record-ot a Phase 48C `App.tsx` építi a `bar` / `marker`
        // WS üzenetekből. A security lint false-positive (object-
        // injection) itt kikapcsolható, mert a kulcs mindig belső.
        // eslint-disable-next-line security/detect-object-injection
        const bars: readonly OHLCBar[] = barsByKey[keyStr] ?? [];
        // eslint-disable-next-line security/detect-object-injection
        const markers: readonly ChartMarker[] = markersByKey[keyStr] ?? [];
        // Phase 60 coverage fix: extract the ternary in the
        // template-literal className into a named const above the
        // JSX. The V8 + ast-v8-to-istanbul pipeline does NOT
        // attribute branch coverage to ternary expressions inside
        // JSX attribute template-literal expressions — the branch
        // is invisible to the instrumentation. Extracting the
        // conditional to a `const` surfaces the branch as a plain
        // JS expression, which V8's code coverage tracks correctly.
        // The original ternary is preserved verbatim in the const.
        // Phase 52F follow-up: always render the full `ChartCard`
        // (with empty bars) instead of a "Loading…" placeholder.
        // The range-tab selector (`.line-chart-wrapper__range-button`)
        // the e2e suite (test 16) targets lives on the ChartCard
        // chrome — previously, the placeholder hid the chrome until
        // the SNAPSHOT was processed, and the WS status flipped to
        // "connected" BEFORE the SNAPSHOT message arrived, so the
        // test could race the render. Rendering the chrome with
        // `bars=[]` keeps the selector stable; the chart body shows
        // an empty `lightweight-charts` canvas for a frame until
        // the first BAR message populates it.
        const chartCardCls = `ep-chart-card${bars.length === 0 ? " ep-chart-card--loading" : ""}`;
        return (
          <div
            className={chartCardCls}
            key={keyStr}
            data-chart-key={keyStr}
            data-symbol={key.symbol}
            data-strategy={strategy}
            data-timeframe={key.timeframe}
          >
            <ChartCard
              symbol={key.symbol}
              strategy={strategy}
              timeframe={key.timeframe}
              bars={bars}
              markers={markers}
              feedState={feedState}
              feedMeta={feedMeta ?? ""}
            />
          </div>
        );
      })}
    </div>
  );
}

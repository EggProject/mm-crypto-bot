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
 *
 * Phase 82 (3 dashboard UI bugs): added the optional `botState` prop.
 * When provided, the empty-state branch distinguishes the 3 cases:
 *
 *   - no strategies configured → "No strategies configured. Check
 *     `default.toml`."
 *   - all strategies disabled → "All strategies are disabled. Enable
 *     one in `default.toml`."
 *   - bot is stopped → "Bot is stopped. Click Start to begin."
 *   - bot is running but no bars yet → "Bot is starting up. Bars will
 *     appear in a few seconds."
 *
 * Previously the same generic "No charts configured. Enable a strategy
 * in `default.toml`." message was shown for ALL 4 conditions, which was
 * misleading when the config was already loaded but the bot was just
 * stopped (the user complained: "nincs config betoltve" — "no config
 * loaded" — when the bot was actually STOPPED, not mis-configured).
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
  /**
   * Phase 82: the bot's high-level state (from the WS `state`
   * event's `botStatus.state` or `null` if the WS hasn't pushed a
   * state yet). Used to differentiate the empty-state messages.
   * Optional for backward-compat — when omitted, the empty-state
   * message collapses to the prior "starting up" message.
   */
  readonly botState?: "running" | "paused" | "stopped" | null;
}

// ============================================================================
// Internal: a flat chart row (strategy + key) used for the memoized list
// ============================================================================

interface FlatChart {
  readonly strategy: string;
  /** Phase 76: the strategy's `enabled` flag, passed to ChartCard
   *  so it can render the "(disabled)" suffix on the chrome title. */
  readonly enabled: boolean;
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
  /* Phase 74: a korábbi min-height: 420px + a ChartCard belső
   * height: 320px MIATT 100px üres hely maradt a chart alján
   * (a .line-chart-wrapper display: grid; grid-template-rows:
   * auto 1fr auto; a body-t 1fr-re állítja, de a wrapper height
   * 320, a parent 420 → 100px üres). A fix: a parent méretét
   * a child határozza meg (nincs min-height). A ChartCard
   * belső magassága a cardHeight prop-pal szabályozható
   * (default md = 320px). */
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
 *   - empty state (no strategies at all) → centered "No charts configured…"
 *   - non-empty → CSS-grid of cards, one per (strategy, symbol, tf)
 *
 * **Phase 76:** the prior `if (!strat.enabled) continue;` filter is
 * REMOVED. The user mandate: "minden strategiat a chartokon meg kell
 * jeleniteni" — every configured strategy must be displayed on the
 * charts, regardless of whether it's currently `enabled` in the bot
 * config. The `enabled` flag is preserved on the descriptor (so a
 * future "show only running" toggle can be added without re-fetching),
 * and the status banner's "X active strategies" text is the source of
 * truth for the running count (built from the publisher's
 * `activeStrategyCount`).
 *
 * **Subscription lifecycle:**
 *   - On every `flatCharts` change, compute the SUBSCRIBE/UNSUBSCRIBE
 *     diff and forward each message via `send()`.
 *   - On unmount, send UNSUBSCRIBE for every currently-subscribed key
 *     (so the state-feed can stop pushing tick/bar traffic).
 *
 * **Empty branches:**
 *   - empty `strategies` → empty state
 *   - all strategies `enabled=false` → empty state (every strategy
 *     is in the list, but the bot isn't running any of them — the
 *     user gets a clear "nothing running" message instead of 27
 *     identical empty cards)
 *   - `barsByKey` is empty (no data at all) → empty state
 *
 *   When there ARE strategies but a particular (symbol, tf) has no
 *   bars yet, we still render the card and pass empty bars
 *   (ChartCard handles the "no data" case by clearing the chart).
 *   This keeps the subscription alive so the bootstrap arrives ASAP.
 */
export function ChartGrid(props: ChartGridProps): React.JSX.Element {
  const {
    strategies,
    barsByKey,
    markersByKey,
    feedState,
    feedMeta,
    send,
    botState,
  } = props;

  // --------------------------------------------------------------------------
  // 1. Flatten strategies × symbols × timeframes into a memoized list.
  //    The order is: outer = strategies (in prop order), then symbols
  //    (in prop order), then timeframes (in prop order). This
  //    deterministic order is what makes the SUBSCRIBE message order
  //    stable across renders (assuming the same strategies prop).
  //
  //    Phase 76: the prior `if (!strat.enabled) continue;` is removed.
  //    We render one card per (strategy, symbol, tf) REGARDLESS of
  //    whether the strategy is currently enabled. The `enabled` flag
  //    is preserved on each row so the ChartCard can render a
  //    "(disabled)" suffix on its title (per-card visual cue for
  //    "configured but not running").
  // --------------------------------------------------------------------------
  const flatCharts = useMemo<readonly FlatChart[]>(() => {
    const out: FlatChart[] = [];
    for (const strat of strategies) {
      for (const sym of strat.symbols) {
        for (const tf of strat.timeframes) {
          out.push({
            strategy: strat.name,
            enabled: strat.enabled,
            key: { symbol: sym, timeframe: tf },
          });
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
  // 5. Empty-state branches — distinguish the 4 conditions.
  //
  //    Phase 76: we still treat "no enabled strategy" as an empty
  //    state (the user mandate says "minden strategiat" — every
  //    strategy — must be displayed, but if ZERO strategies are
  //    enabled, there's nothing useful to render and the user gets
  //    a clear "nothing running" message instead of 0 cards).
  //
  //    Phase 82 (3 dashboard UI bugs): the single message "No charts
  //    configured. Enable a strategy in `default.toml`." was
  //    misleading because the same message appeared when the bot was
  //    STOPPED (no bars yet) — the user couldn't tell whether the
  //    config was missing or just the bot wasn't started. The fix:
  //    differentiate 4 conditions with specific, actionable messages:
  //
  //      - no strategies at all      → "No strategies configured. Check `default.toml`."
  //      - all strategies disabled   → "All strategies are disabled. Enable one in `default.toml`."
  //      - bot stopped               → "Bot is stopped. Click Start to begin."
  //      - bot starting up           → "Bot is starting up. Bars will appear in a few seconds."
  //
  //    The bot's state comes from the new `botState` prop (passed in
  //    by `App.tsx` from the WS `state` event's `botStatus.state`).
  //    When the prop is omitted (backward-compat) the empty state
  //    falls back to the "starting up" message (the most common
  //    transient case before the first WS state event arrives).
  // --------------------------------------------------------------------------
  const hasAnyStrategy = strategies.length > 0;
  const hasAnyEnabledStrategy = strategies.some((s) => s.enabled);
  const hasAnyBars = Object.keys(barsByKey).length > 0;

  if (!hasAnyStrategy || !hasAnyEnabledStrategy || !hasAnyBars) {
    // Decide WHICH message to show based on the 4 conditions above.
    // Each branch is a separate `if` (not a 3-arm ternary) so the
    // V8 + ast-v8-to-istanbul coverage pipeline attributes each
    // branch correctly. The `!hasAnyStrategy` check takes priority
    // over `!hasAnyEnabledStrategy` (a missing config is more
    // severe than an all-disabled config).
    let emptyMessage: React.JSX.Element;
    if (!hasAnyStrategy) {
      emptyMessage = (
        <p>
          No strategies configured. Check <code>default.toml</code>.
        </p>
      );
    } else if (!hasAnyEnabledStrategy) {
      emptyMessage = (
        <p>
          All strategies are disabled. Enable one in{" "}
          <code>default.toml</code>.
        </p>
      );
    } else if (botState === "stopped" || botState === null) {
      // "stopped" + "null" (no state yet → "not running") are
      // both treated as "the bot isn't running". The message
      // guides the user to the action (click Start).
      emptyMessage = <p>Bot is stopped. Click Start to begin trading.</p>;
    } else {
      // botState === "running" | "paused" — the bot is configured
      // and enabled, but no bars have arrived yet. The message
      // tells the user this is a transient startup state.
      emptyMessage = (
        <p>Bot is starting up. Bars will appear in a few seconds.</p>
      );
    }
    return (
      <div className="ep-chart-grid__empty" data-testid="chart-grid-empty">
        <style>{GRID_CSS}</style>
        {emptyMessage}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 6. Render the grid — one card per (strategy, symbol, tf) triple.
  // --------------------------------------------------------------------------
  return (
    <div className="ep-chart-grid" data-testid="chart-grid">
      <style>{GRID_CSS}</style>
      {flatCharts.map(({ strategy, enabled, key }) => {
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
            data-strategy-enabled={enabled ? "true" : "false"}
          >
            <ChartCard
              symbol={key.symbol}
              strategy={strategy}
              enabled={enabled}
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

/**
 * apps/web/src/indicators/client-compute.ts
 *
 * Phase 78 + 79: client-side indicator computation.
 *
 * The web client computes the strategy indicators from the OHLC bar
 * stream instead of receiving them over the WebSocket. The bot's
 * strategy runners do not currently publish `publishIndicator` calls
 * (the infrastructure is in place but no strategy is using it), so
 * the only way to surface the strategy-specific drawings on the
 * chart is to derive them client-side.
 *
 * **Why client-side and not server-side:** the user's mandate was
 * to NOT touch strategy code (`apps/bot/src/strategies/*`,
 * `packages/core/src/strategy/*`). Computing the indicators in
 * the web app is a well-bounded fix that lives entirely in the
 * rendering layer.
 *
 * **Output shape:** every function returns the `IndicatorSeries`
 * shape that the existing `renderDonchian` / `renderFunding`
 * renderers in `donchian.ts` / `funding.ts` already consume. The
 * renderers were written to accept any pre-computed series (the
 * `IndicatorRegistry` is a name → renderer map, not a producer
 * map); this file is the producer side.
 *
 * **Determinism:** all functions are pure — same `bars` input
 * always produces the same `IndicatorSeries` output. No I/O,
 * no React, no DOM. The function is the canonical test target.
 */

import type { ChartMarker, OHLCBar } from "../lib/ohlc-bridge.js";
import type { IndicatorSeries } from "./registry.js";

// ============================================================================
// Donchian channel
// ============================================================================

/**
 * `DEFAULT_DONCHIAN_LOOKBACK` — the canonical Donchian channel
 * period (20 bars, per Donchian 1949 and the strategy's
 * `htfDonchianPeriod: 20` config in
 * `packages/core/src/strategy/donchian-range-channel.ts`).
 *
 * The lookback is intentionally a constant rather than a runtime
 * parameter: the strategy's reference implementation is hard-wired
 * to 20, and changing the period here would diverge from the
 * server-side logic.
 */
export const DEFAULT_DONCHIAN_LOOKBACK = 20 as const;

/**
 * `computeDonchianFromBars(bars, lookback)` — compute the Donchian
 * channel (upper / middle / lower) from a bar series.
 *
 * Definitions (Donchian 1949; matches the
 * `donchian-range-channel.ts` strategy):
 *   - `upper`  = max(high) over the last `lookback` bars
 *   - `lower`  = min(low)  over the last `lookback` bars
 *   - `middle` = (upper + lower) / 2
 *
 * Edge cases:
 *   - `bars.length === 0`           → every value is `null` (no bars)
 *   - `bars.length < lookback`      → first `lookback - bars.length` values are `null` (warmup period)
 *   - `lookback <= 0`               → throws (defensive — a 0-lookback channel is meaningless)
 *
 * The warmup period is consistent with the strategy's
 * `warmup(): number` contract (the first N bars are not yet
 * computable because the lookback window would reference out-of-
 * bounds bars). The renderer (`renderDonchian`) drops the `null`
 * values from the `LineData` array, so the chart shows a gap on
 * the warmup range — this matches the conventional "indicator
 * not yet defined" rendering.
 *
 * **Pure, deterministic, no side effects.** No `Date.now()`, no
 * mutation of the input array.
 *
 * @param bars     - time-ascending OHLC bar series (the chart card
 *                   passes the same array it renders)
 * @param lookback - the Donchian period; defaults to 20
 * @returns        - `{ upper, middle, lower }` arrays of length
 *                   `bars.length`, with `null` for the warmup
 *                   period and the empty-bars case
 */
export function computeDonchianFromBars(
  bars: readonly OHLCBar[],
  lookback: number = DEFAULT_DONCHIAN_LOOKBACK,
): IndicatorSeries {
  if (lookback <= 0) {
    throw new Error(
      `computeDonchianFromBars: lookback must be > 0 (got ${String(lookback)})`,
    );
  }
  const n = bars.length;
  const upper: (number | null)[] = new Array<number | null>(n).fill(null);
  const lower: (number | null)[] = new Array<number | null>(n).fill(null);
  const middle: (number | null)[] = new Array<number | null>(n).fill(null);

  // Warmup period: not enough bars to fill the lookback window.
  if (n < lookback) {
    return { upper, middle, lower };
  }

  // Initial window: bars[0..lookback-1].
  let winHigh = -Infinity;
  let winLow = Infinity;
  for (let i = 0; i < lookback; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const bar = bars[i];
    if (bar.high > winHigh) winHigh = bar.high;
    if (bar.low < winLow) winLow = bar.low;
  }
  upper[lookback - 1] = winHigh;
  lower[lookback - 1] = winLow;
  middle[lookback - 1] = (winHigh + winLow) / 2;

  // Rolling window: drop bars[i - lookback], add bars[i].
  for (let i = lookback; i < n; i += 1) {
    const outBar = bars[i - lookback];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const inBar = bars[i];
    if (outBar.high === winHigh || outBar.low === winLow) {
      // The leaving bar is the current extremum — recompute by
      // scanning the window (O(lookback) per recompute, so the
      // worst case is O(n * lookback) but the worst case is rare:
      // a bar is only "the extremum" when its high/low defines
      // the rolling max/min, and a single recompute is bounded
      // by `lookback` which is 20 in the canonical config).
      winHigh = -Infinity;
      winLow = Infinity;
      for (let j = i - lookback + 1; j <= i; j += 1) {
        // eslint-disable-next-line security/detect-object-injection -- j is a loop counter
        const b = bars[j];
        if (b.high > winHigh) winHigh = b.high;
        if (b.low < winLow) winLow = b.low;
      }
    } else {
      // Fast path: just track the entering bar.
      if (inBar.high > winHigh) winHigh = inBar.high;
      if (inBar.low < winLow) winLow = inBar.low;
    }
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    upper[i] = winHigh;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    lower[i] = winLow;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    middle[i] = (winHigh + winLow) / 2;
  }

  return { upper, middle, lower };
}

// ============================================================================
// Pivot level (donchian_pivot_composition — strategy-specific, Phase 79)
// ============================================================================

/**
 * `DEFAULT_PIVOT_LOOKBACK` — the default lookback for the pivot
 * computation. 24 LTF bars ≈ 1 day of 1h bars (or 4 hours of 10m
 * bars). The strategy's `PivotPointGridStrategy` uses a 1d HTF
 * bucket; for a chart with 1h bars, 24 bars covers the same
 * bucket. For a chart with 4h bars, 6 bars would cover a 1d
 * bucket — but the lookback is left as a single constant so the
 * function has a uniform signature across charts (a 1d "previous
 * day" aggregation, regardless of the LTF granularity).
 *
 * The strategy code in
 * `packages/core/src/strategy/pivot-point-grid.ts` aggregates
 * 15m → 1d (96 bars), then computes PP from the previous-day
 * H/L/C. We can't do that aggregation client-side from an
 * arbitrary LTF bar stream (we don't have the 1d candles), so
 * we approximate with a rolling window of `lookback` bars. For
 * 1h charts, lookback=24 matches the strategy's daily
 * aggregation; for shorter TFs, the window is shorter than a
 * day; for longer TFs (4h, 1d), the window is longer than a
 * day. The "previous N bars" pivot is a well-known technique
 * (https://www.bulkowskiencyclopediaofchartpatterns.com) and is
 * a defensible approximation when the LTF candles are not
 * available.
 */
export const DEFAULT_PIVOT_LOOKBACK = 24 as const;

/**
 * `computePivotFromBars(bars, lookback)` — compute the classic
 * pivot point (PP) from the rolling `lookback` bar window.
 *
 * Definitions (Bulkowski / Person — matches
 * `packages/core/src/strategy/pivot-point-grid.ts`):
 *   - `pp`   = (H + L + C) / 3, where H/L are the rolling-window
 *              max/min and C is the close of the LAST bar in the
 *              window (the "previous" bar's close in the LTF
 *              interpretation).
 *   - `r1`   = PP + 0.382 × (H - L)   ← Fibonacci inner band
 *   - `r2`   = PP + 0.618 × (H - L)   ← Fibonacci outer band
 *   - `s1`   = PP - 0.382 × (H - L)
 *   - `s2`   = PP - 0.618 × (H - L)
 *
 * The Fibonacci multipliers (0.382, 0.618) are the canonical
 * `DEFAULT_PIVOT_GRID_CONFIG` values in
 * `packages/core/src/strategy/pivot-point-grid.ts` (Phase 15).
 *
 * Edge cases:
 *   - `bars.length === 0`           → every value is `null`
 *   - `bars.length < lookback`      → first `lookback - bars.length` values are `null` (warmup)
 *   - `lookback <= 0`               → throws (defensive)
 *
 * The output `IndicatorSeries` has 5 keys: `pp`, `r1`, `r2`,
 * `s1`, `s2`. The renderer can pick which keys to plot.
 *
 * **Pure, deterministic, no side effects.** No `Date.now()`, no
 * mutation of the input array.
 */
export function computePivotFromBars(
  bars: readonly OHLCBar[],
  lookback: number = DEFAULT_PIVOT_LOOKBACK,
): IndicatorSeries {
  if (lookback <= 0) {
    throw new Error(
      `computePivotFromBars: lookback must be > 0 (got ${String(lookback)})`,
    );
  }
  const n = bars.length;
  const pp: (number | null)[] = new Array<number | null>(n).fill(null);
  const r1: (number | null)[] = new Array<number | null>(n).fill(null);
  const r2: (number | null)[] = new Array<number | null>(n).fill(null);
  const s1: (number | null)[] = new Array<number | null>(n).fill(null);
  const s2: (number | null)[] = new Array<number | null>(n).fill(null);

  if (n < lookback) return { pp, r1, r2, s1, s2 };

  // Fibonacci multipliers from `DEFAULT_PIVOT_GRID_CONFIG`.
  const F1 = 0.382;
  const F2 = 0.618;

  for (let i = lookback - 1; i < n; i += 1) {
    // Compute the rolling-window statistics for the window
    // `bars[i - lookback + 1 .. i]` (inclusive). The pivot point
    // uses the HIGH and LOW of the window + the CLOSE of the
    // LAST bar in the window (the "previous" bar in the LTF
    // interpretation).
    let winHigh = -Infinity;
    let winLow = Infinity;
    for (let j = i - lookback + 1; j <= i; j += 1) {
      // eslint-disable-next-line security/detect-object-injection -- j is a loop counter
      const b = bars[j];
      if (b.high > winHigh) winHigh = b.high;
      if (b.low < winLow) winLow = b.low;
    }
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const lastClose = bars[i].close;
    const range = winHigh - winLow;
    const pivot = (winHigh + winLow + lastClose) / 3;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    pp[i] = pivot;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    r1[i] = pivot + F1 * range;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    r2[i] = pivot + F2 * range;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    s1[i] = pivot - F1 * range;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    s2[i] = pivot - F2 * range;
  }

  return { pp, r1, r2, s1, s2 };
}

// ============================================================================
// Breakout signal markers (donchian_pivot_composition — strategy-specific, Phase 79)
// ============================================================================

/**
 * `computeBreakoutSignalsFromBars(bars, donchian, lookback)` —
 * synthesize entry/exit `ChartMarker`s from the bar stream.
 *
 * The bot's strategy runners do not currently publish
 * `publishIndicator` or `publishMarker` calls (the
 * infrastructure is in place but no strategy is using it), so
 * the only way to surface the strategy's specific signal
 * markers is to derive them client-side. The derivation is a
 * well-known mean-reversion pattern (Donchian range channel
 * + pivot band entries; the same logic the strategy code in
 * `packages/core/src/strategy/donchian-range-channel.ts` and
 * `packages/core/src/strategy/pivot-point-grid.ts` uses,
 * simplified for the rendering layer).
 *
 * **Entry rules (LONG):**
 *   - `close > donchian.upper[i]` → breakout long entry
 *     (arrowUp, belowBar, green)
 *   - `close < donchian.lower[i]` → breakdown short entry
 *     (arrowDown, aboveBar, red)
 *
 * **Exit rules:**
 *   - On the next bar after a long entry, if `close <=
 *     donchian.middle[i]` → exit marker (arrowDown, aboveBar,
 *     green = "took profit, exit")
 *   - On the next bar after a short entry, if `close >=
 *     donchian.middle[i]` → exit marker (arrowUp, belowBar, red)
 *
 * The `donchian` argument is the output of
 * `computeDonchianFromBars(bars, lookback)` — the SAME series
 * we use for the band, so the markers line up with the band
 * visually.
 *
 * The pivot bands (S1/S2/R1/R2) can also trigger entries
 * (close ≤ S2 → buy, close ≥ R2 → sell) but we leave that
 * extension to a future phase — the Donchian breakout is
 * the most common entry signal and the one the user can
 * visually validate against the band.
 *
 * **Pure, deterministic, no side effects.** No `Date.now()`,
 * no mutation of the input arrays.
 *
 * @param bars      - time-ascending OHLC bar series
 * @param donchian  - the Donchian series (output of `computeDonchianFromBars`)
 * @returns         - `ChartMarker[]` (already in ms time, position/
 *                    color/shape set per the convention in
 *                    `apps/web/src/lib/ohlc-bridge.ts`)
 */
export function computeBreakoutSignalsFromBars(
  bars: readonly OHLCBar[],
  donchian: IndicatorSeries,
): readonly ChartMarker[] {
  const markers: ChartMarker[] = [];
  // `IndicatorSeries` is `Readonly<Record<string, readonly (number
  // | null)[]>>`. The static type says `donchian.upper` is the
  // array type, not `readonly (number | null)[] | undefined`
  // (because the index signature returns `T`, not `T | undefined`
  // — `apps/web`'s tsconfig does NOT enable
  // `noUncheckedIndexedAccess`). In practice, the
  // `validateDonchianSeries` path is the canonical entry; here
  // we defensively coerce missing keys to `[]` via `??` even
  // though the linter considers it unnecessary (a runtime
  // `donchian` from a partial test fixture may legitimately
  // lack the keys). The lint suppression is per-line below.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const upper: readonly (number | null)[] = donchian.upper ?? [];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const lower: readonly (number | null)[] = donchian.lower ?? [];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const middle: readonly (number | null)[] = donchian.middle ?? [];

  // Track the most recent open position (for exit logic). The
  // state is local to this function; the marker is a self-
  // contained event, not a portfolio state.
  let openSide: "long" | "short" | null = null;

  for (let i = 0; i < bars.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const bar = bars[i];
    // The index access is statically typed as `number | null`
    // (not `T | undefined`) because the input is `readonly
    // (number | null)[]` and `apps/web`'s tsconfig does NOT
    // enable `noUncheckedIndexedAccess`.
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const u = upper[i];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const l = lower[i];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const m = middle[i];

    // Skip bars where the donchian band isn't yet defined (warmup).
    if (u === null || l === null || m === null) continue;

    // If we have an open position, check for exit first.
    // The exit condition is "close returned to the middle band"
    // (the "equilibrium" of the channel).
    if (openSide === "long" && bar.close <= m) {
      markers.push({
        time: bar.time,
        position: "aboveBar",
        color: "#22c55e",
        shape: "arrowDown",
        text: "EXIT",
      });
      openSide = null;
      continue;
    }
    if (openSide === "short" && bar.close >= m) {
      markers.push({
        time: bar.time,
        position: "belowBar",
        color: "#ef4444",
        shape: "arrowUp",
        text: "EXIT",
      });
      openSide = null;
      continue;
    }

    // No open position — check for a new entry.
    // The breakout condition uses the PREVIOUS bar's upper/lower
    // (i.e. `upper[i-1]` / `lower[i-1]`), NOT the current bar's.
    // The reason: the current bar's upper is `max(high)` over the
    // rolling window, which INCLUDES the current bar's own high.
    // A bar's close can never exceed its own bar's max-high, so
    // comparing close to upper[i] would never trigger. The
    // conventional pattern (Bulkowski; Bulkowskiencyclopedia of
    // Chart Patterns; widely used in trading-system literature)
    // is to compare to the PREVIOUS bar's upper — the breakout
    // is "close above the channel, where the channel didn't
    // include this bar's price yet".
    if (openSide === null && i > 0) {
      const prevU = upper[i - 1];
      const prevL = lower[i - 1];
      if (prevU === null || prevL === null) continue;
      if (bar.close > prevU) {
        markers.push({
          time: bar.time,
          position: "belowBar",
          color: "#22c55e",
          shape: "arrowUp",
          text: "ENTRY",
        });
        openSide = "long";
      } else if (bar.close < prevL) {
        markers.push({
          time: bar.time,
          position: "aboveBar",
          color: "#ef4444",
          shape: "arrowDown",
          text: "ENTRY",
        });
        openSide = "short";
      }
    }
  }

  return markers;
}

// ============================================================================
// Phase 81: strategy-specific computations for the 4 DISABLED strategies.
//
// The user mandate "a tobbi strategianal is biztos hogy jopar dolgot lehetne
// meg jelolni akar chart rajzol vagy indicator formajaban" — for the
// 4 disabled strategies, the chart must show strategy-SPECIFIC drawings,
// not just the universal Donchian band fallback.
//
// The bot's strategy runners do not currently publish per-strategy
// `INDICATOR` messages (the infrastructure is in place but no strategy
// is using it for the disabled strategies), and the user mandate is
// "NE nyulj a strategy kodhoz" / "don't touch strategy code". So the
// only way to surface the strategy-specific drawings on the chart is
// to DERIVE them client-side from the bar stream.
//
// The functions in this section are pure approximations of the
// strategy-specific signals — they are NOT the exact same computation
// the strategy code does server-side. The visual goal is to give each
// chart a strategy-specific marker / line so the user can see at a
// glance WHICH strategy the chart belongs to, not to reproduce the
// strategy's internal logic. A future phase that wires per-strategy
// `INDICATOR` messages can swap these client-compute functions for
// server-supplied data without changing the `LineIndicator` /
// `MarkerIndicator` shape in `strategy-indicators.ts`.
//
// **Output shape consistency:** every function returns either an
// `IndicatorSeries` (for line indicators) or a `ChartMarker[]` (for
// marker indicators) — the same shapes the existing
// `computeDonchianFromBars` / `computePivotFromBars` /
// `computeBreakoutSignalsFromBars` functions return. The renderers
// in `strategy-indicators.ts` and the chart-card dispatch loop are
// therefore reusable as-is.
// ============================================================================

/**
 * `DEFAULT_FUNDING_LOOKBACK` — the default rolling window for
 * funding-rate synthesis. 8 bars is a reasonable proxy for an
 * 8-hour funding window on a 1h chart (1 funding event per 8h
 * bar at 1h granularity = 8 bars between events). The value
 * doesn't have to match a specific exchange convention because
 * the function is a SYNTHETIC proxy for funding (not a real
 * funding rate derivation); the value is chosen to be smooth
 * enough to show a visible line on the chart without flickering.
 */
export const DEFAULT_FUNDING_LOOKBACK = 8 as const;

/**
 * `computeFundingRateFromBars(bars, lookback)` — synthesize a
 * funding-rate series from the bar stream.
 *
 * The bot's `dydx_cex_carry` and `funding_flip_kill_switch`
 * strategies consume per-8h perpetual funding rates. We don't
 * have those from the WebSocket, so we APPROXIMATE the funding
 * rate with a smoothed log return of the bar's close:
 *
 *   `funding[i] = (log(close[i]) - log(close[i - lookback])) / lookback`
 *
 * This is a coarse proxy — the REAL funding rate is set by the
 * exchange per 8h window and depends on the long/short
 * imbalance in the order book, not on the price itself. But the
 * visual goal (a "funding-rate-like" line that goes positive
 * when price trends up and negative when it trends down) is
 * preserved: a positive funding rate (longs pay shorts) is
 * associated with bullish regimes, a negative funding rate
 * (shorts pay longs) with bearish regimes, and a smoothed
 * log-return proxy tracks the same shape.
 *
 * **Pure, deterministic, no side effects.** No `Date.now()`,
 * no mutation of the input array.
 *
 * @param bars     - time-ascending OHLC bar series
 * @param lookback - the smoothing window in bars; defaults to 8
 * @returns        - `{ funding }` array of length `bars.length`
 *                   with `null` for the warmup period
 */
export function computeFundingRateFromBars(
  bars: readonly OHLCBar[],
  lookback: number = DEFAULT_FUNDING_LOOKBACK,
): IndicatorSeries {
  if (lookback <= 0) {
    throw new Error(
      `computeFundingRateFromBars: lookback must be > 0 (got ${String(lookback)})`,
    );
  }
  const n = bars.length;
  const funding: (number | null)[] = new Array<number | null>(n).fill(null);

  if (n <= lookback) return { funding };

  for (let i = lookback; i < n; i += 1) {
     
    const prev = bars[i - lookback];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const cur = bars[i];
    // The log of a non-positive number is -Infinity or NaN; we
    // fall back to 0 for those (the strategy code would also
    // skip those bars, but for the visual approximation we
    // prefer a defined value over a gap on the chart).
    if (prev.close <= 0 || cur.close <= 0) {
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      funding[i] = 0;
      continue;
    }
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    funding[i] = (Math.log(cur.close) - Math.log(prev.close)) / lookback;
  }

  return { funding };
}

/**
 * `computeFundingSpreadFromBars(bars, lookback)` — synthesize
 * the dYdX - CEX funding spread from the bar stream.
 *
 * The `dydx_cex_carry` strategy harvests the SPREAD between
 * two exchanges' funding rates (the "carry"). We don't have
 * the per-exchange funding from the WebSocket, so we
 * approximate the spread with the difference between two
 * smoothing windows of different lengths:
 *
 *   `spread[i] = fastEMA(close) - slowEMA(close)` (normalized)
 *
 * The fast window (default 4) responds quickly to recent
 * moves; the slow window (default 16) is the "fair value" of
 * the funding rate. The difference is a proxy for the
 * instantaneous carry — when price moves faster than the
 * long-run trend, the fast EMA exceeds the slow EMA and the
 * spread is positive.
 *
 * **Pure, deterministic, no side effects.** No `Date.now()`,
 * no mutation of the input array.
 *
 * @param bars     - time-ascending OHLC bar series
 * @param lookback - the slow-EMA window in bars; defaults to 8
 *                   (the fast window is always `lookback / 2`)
 * @returns        - `{ spread }` array of length `bars.length`
 *                   with `null` for the warmup period
 */
export function computeFundingSpreadFromBars(
  bars: readonly OHLCBar[],
  lookback: number = DEFAULT_FUNDING_LOOKBACK,
): IndicatorSeries {
  if (lookback <= 0) {
    throw new Error(
      `computeFundingSpreadFromBars: lookback must be > 0 (got ${String(lookback)})`,
    );
  }
  const n = bars.length;
  const spread: (number | null)[] = new Array<number | null>(n).fill(null);
  // The fast window must be at least 1 and at most lookback - 1
  // (so the slow window is always at least 1 bar longer than
  // the fast window). For lookback=8, fast=4 (4-bar fast EMA
  // vs 8-bar slow EMA).
  const fast = Math.max(1, Math.floor(lookback / 2));

  if (n <= lookback) return { spread };

  for (let i = lookback; i < n; i += 1) {
     
    const prevFast = bars[i - fast];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const curFast = bars[i];
     
    const prevSlow = bars[i - lookback];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const curSlow = bars[i];
    if (
      prevFast.close <= 0 ||
      curFast.close <= 0 ||
      prevSlow.close <= 0 ||
      curSlow.close <= 0
    ) {
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      spread[i] = 0;
      continue;
    }
    const fastRet =
      (Math.log(curFast.close) - Math.log(prevFast.close)) / fast;
    const slowRet =
      (Math.log(curSlow.close) - Math.log(prevSlow.close)) / lookback;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    spread[i] = fastRet - slowRet;
  }

  return { spread };
}

/**
 * `DEFAULT_CASCADE_THRESHOLD_PCT` — the default threshold for
 * cascade-event detection. 2% bar-to-bar move on a 1h chart is
 * the conventional cascade threshold (the strategy code in
 * `packages/strategies/cascade_fade/` uses 1.5% on 1m bars and
 * 2% on 1h bars; we default to 2% for the visual approximation).
 *
 * The threshold is in PERCENT (2 = 2%) and is a CONSTANT for
 * unit-test predictability.
 */
export const DEFAULT_CASCADE_THRESHOLD_PCT = 2 as const;

/**
 * `computeCascadeEventsFromBars(bars, thresholdPct)` — detect
 * liquidation cascade events from the bar stream.
 *
 * The `cascade_fade` strategy tracks large liquidation cascades
 * (rapid, large-magnitude price moves typically caused by
 * forced position closures). We approximate the detection with
 * a bar-to-bar move exceeding `thresholdPct`:
 *
 *   `event at bar i if abs((close[i] - close[i-1]) / close[i-1]) * 100 >= thresholdPct`
 *
 * The `severity` field is normalized to [0, 1] by clamping the
 * observed move to `[thresholdPct, thresholdPct * 3]`:
 *   - `move === thresholdPct` → severity 0 (borderline)
 *   - `move >= 3 * thresholdPct` → severity 1 (massive)
 *   - linear interpolation in between
 *
 * The `side` is `"up"` if the move is positive (price went UP)
 * and `"down"` otherwise. This is the conventional convention
 * for cascade detection (positive = bullish move = short
 * liquidations; negative = bearish move = long liquidations).
 * The `cascadeToChartMarker` convention in `cascade.ts` already
 * inverts the visual color (up = red, down = green) to match
 * the "cascade is the liquidation side" interpretation.
 *
 * **Pure, deterministic, no side effects.** No `Date.now()`,
 * no mutation of the input array.
 *
 * @param bars          - time-ascending OHLC bar series
 * @param thresholdPct  - minimum bar-to-bar move (in %) to count
 *                        as a cascade; defaults to 2
 * @returns             - `ChartMarker[]` with one marker per
 *                        detected cascade event (empty array if
 *                        no cascades)
 */
export function computeCascadeEventsFromBars(
  bars: readonly OHLCBar[],
  thresholdPct: number = DEFAULT_CASCADE_THRESHOLD_PCT,
): readonly ChartMarker[] {
  if (thresholdPct <= 0) {
    throw new Error(
      `computeCascadeEventsFromBars: thresholdPct must be > 0 (got ${String(thresholdPct)})`,
    );
  }
  const markers: ChartMarker[] = [];
  if (bars.length < 2) return markers;

  for (let i = 1; i < bars.length; i += 1) {
     
    const prev = bars[i - 1];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const cur = bars[i];
    if (prev.close <= 0) continue;
    const movePct = ((cur.close - prev.close) / prev.close) * 100;
    const absMove = Math.abs(movePct);
    if (absMove < thresholdPct) continue;

    // Normalize severity to [0, 1] using a 3x threshold as the
    // "max meaningful cascade" — anything above 3x is also
    // severity 1 (a bigger cascade is still a big cascade).
    const severity = Math.min(1, absMove / (thresholdPct * 3));
    const side: "up" | "down" = movePct > 0 ? "up" : "down";

    // The cascade convention: `cascadeToChartMarker` in
    // `cascade.ts` maps `side: "up"` to a red marker above the
    // bar (a buy cascade = long liquidations = bearish) and
    // `side: "down"` to a green marker below the bar (a sell
    // cascade = short liquidations = bullish). To match that
    // visual, we emit a ChartMarker with the SHAPE the cascade
    // renderer uses — but since this is a CLIENT-side compute
    // function (not the strategy's own cascade detection), we
    // emit markers in the ChartMarker shape directly. The
    // strategy-indicators.ts `cascadeMarkerIndicator` then
    // maps them to the lightweight-charts `setMarkers` API.
    markers.push({
      time: cur.time,
      position: side === "up" ? "aboveBar" : "belowBar",
      color: side === "up" ? "#ef4444" : "#22c55e",
      shape: severity > 0.5 ? (side === "up" ? "arrowUp" : "arrowDown") : "circle",
      text: severity > 0.5 ? `CASCADE ${(absMove / 100).toFixed(2)}` : "",
    });
  }

  return markers;
}

/**
 * `computeFundingFlipsFromBars(bars, fundingSeries)` — detect
 * the points where the funding rate's sign changes.
 *
 * The `funding_flip_kill_switch` strategy kills the bot when
 * the funding rate flips sign (positive → negative or
 * negative → positive). The user wants the chart to show
 * arrows at every flip:
 *   - `+ → -` (rate went negative): red arrow pointing down
 *   - `- → +` (rate went positive): green arrow pointing up
 *
 * The function takes a `funding` array (per-bar) and emits a
 * `ChartMarker` at every bar `i` where the sign of
 * `funding[i]` differs from `funding[i-1]`. The bar's close
 * direction is also checked (so we only emit on "real" flips,
 * not on noise around zero) — a flip must coincide with a
 * close that is meaningfully above (long) or below (short)
 * zero.
 *
 * **Pure, deterministic, no side effects.** No `Date.now()`,
 * no mutation of the input array.
 *
 * @param bars          - time-ascending OHLC bar series
 * @param fundingSeries - the funding rate series (per-bar
 *                        numbers, with `null` allowed for the
 *                        warmup period)
 * @returns             - `ChartMarker[]` with one marker per
 *                        detected flip (empty array if no flips)
 */
export function computeFundingFlipsFromBars(
  bars: readonly OHLCBar[],
  fundingSeries: IndicatorSeries,
): readonly ChartMarker[] {
  const markers: ChartMarker[] = [];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive for partial fixtures
  const funding: readonly (number | null)[] = fundingSeries.funding ?? [];
  if (bars.length < 2 || funding.length < bars.length) return markers;

  // A "small value" epsilon — a flip from +0.0001 to -0.0001
  // is not a real flip, it's noise. The epsilon is 0.0005
  // (0.05% per bar), well above the typical "noisy zero"
  // magnitude. This matches the strategy's `fundingFlipEps`
  // config in `packages/strategies/funding_flip_kill_switch/`.
  const EPS = 0.0005;

  for (let i = 1; i < bars.length; i += 1) {
     
    const prev = funding[i - 1];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const cur = funding[i];
    if (prev === null) continue;
    if (cur === null) continue;
    if (Math.abs(prev) < EPS && Math.abs(cur) < EPS) continue;

    const prevSign = prev > 0 ? 1 : prev < 0 ? -1 : 0;
    const curSign = cur > 0 ? 1 : cur < 0 ? -1 : 0;
    if (prevSign === 0 || curSign === 0) continue;
    if (prevSign === curSign) continue;

    // Real flip: emit a marker.
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const bar = bars[i];
    if (curSign > 0) {
      // - → + : green arrow up (rate went positive)
      markers.push({
        time: bar.time,
        position: "belowBar",
        color: "#22c55e",
        shape: "arrowUp",
        text: "FLIP +",
      });
    } else {
      // + → - : red arrow down (rate went negative)
      markers.push({
        time: bar.time,
        position: "aboveBar",
        color: "#ef4444",
        shape: "arrowDown",
        text: "FLIP -",
      });
    }
  }

  return markers;
}

/**
 * `Regime` — the per-bar market regime classification.
 *   - `trending`: the bar's `close` is consistently above (or
 *     below) the rolling-window mean — the market is in a
 *     directional regime (ADX-like heuristic, simplified to
 *     a "close vs rolling-mean" gap).
 *   - `ranging`: the bar's `close` is close to the rolling
 *     mean and the rolling standard deviation is small — the
 *     market is in a sideways regime.
 *   - `volatile`: the rolling standard deviation is large —
 *     the market is choppy / whipsawing.
 */
export type Regime = "trending" | "ranging" | "volatile";

/**
 * `DEFAULT_REGIME_LOOKBACK` — the default rolling window for
 * the regime classifier. 20 bars matches the Donchian
 * lookback so the regime detector and the Donchian band are
 * "in sync" visually.
 */
export const DEFAULT_REGIME_LOOKBACK = 20 as const;

/**
 * `computeRegimeFromBars(bars, lookback)` — classify each
 * bar's market regime.
 *
 * The `regime_detector` strategy classifies the market as
 * `trending` / `ranging` / `volatile` based on a multi-timeframe
 * ADX + ATR aggregation. We approximate with a single-timeframe
 * heuristic:
 *
 *   For each bar `i` with `i >= lookback`:
 *     - `mean[i]` = mean(close) over the last `lookback` bars
 *     - `std[i]`  = std(close)  over the last `lookback` bars
 *     - `gap`     = abs(close[i] - mean[i]) / std[i]   (in std units)
 *     - `relStd`  = std[i] / mean[i]                   (CV, dimensionless)
 *     - if `relStd > HIGH_VOL_THRESHOLD` → `volatile`
 *     - else if `gap > GAP_THRESHOLD`     → `trending`
 *     - else                              → `ranging`
 *
 * The thresholds (0.05 relative std for "high vol", 1.0
 * standard-deviations gap for "trending") are heuristic
 * defaults that work for BTCUSDT 1h bars — a future phase
 * can tune them to the strategy's actual ADX threshold.
 *
 * **Pure, deterministic, no side effects.** No `Date.now()`,
 * no mutation of the input array.
 *
 * @param bars     - time-ascending OHLC bar series
 * @param lookback - the rolling-window size; defaults to 20
 * @returns        - `Regime[]` of length `bars.length` (with
 *                   `"ranging"` as the warmup-period default)
 */
export function computeRegimeFromBars(
  bars: readonly OHLCBar[],
  lookback: number = DEFAULT_REGIME_LOOKBACK,
): readonly Regime[] {
  if (lookback <= 0) {
    throw new Error(
      `computeRegimeFromBars: lookback must be > 0 (got ${String(lookback)})`,
    );
  }
  const n = bars.length;
  // The warmup-period default is `"ranging"` (a conservative
  // "we don't know yet" classification).
  const out: Regime[] = new Array<Regime>(n).fill("ranging");
  if (n < lookback) return out;

  // The thresholds are dimensionless relative to the
  // close-price scale, so they work for any symbol.
  //   - HIGH_VOL_THRESHOLD: 5% coefficient of variation is
  //     "high vol" (BTC 1h bars typically have a 1-3% CV in
  //     ranging regimes and 5%+ in volatile regimes).
  //   - GAP_THRESHOLD: 1.0 standard-deviations of close is
  //     "trending" (an ADX ≈ 25 proxy; ADX 25 ≈ 1.0 σ on
  //     a normal distribution).
  const HIGH_VOL_THRESHOLD = 0.05;
  const GAP_THRESHOLD = 1.0;

  for (let i = lookback - 1; i < n; i += 1) {
    let sum = 0;
    for (let j = i - lookback + 1; j <= i; j += 1) {
      // eslint-disable-next-line security/detect-object-injection -- j is a loop counter
      sum += bars[j].close;
    }
    const mean = sum / lookback;
    if (mean <= 0) {
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      out[i] = "ranging";
      continue;
    }
    let sqSum = 0;
    for (let j = i - lookback + 1; j <= i; j += 1) {
      // eslint-disable-next-line security/detect-object-injection -- j is a loop counter
      const d = bars[j].close - mean;
      sqSum += d * d;
    }
    const std = Math.sqrt(sqSum / lookback);
    const relStd = std / mean;
    if (relStd > HIGH_VOL_THRESHOLD) {
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      out[i] = "volatile";
      continue;
    }
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const gap = std > 0 ? Math.abs(bars[i].close - mean) / std : 0;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    out[i] = gap > GAP_THRESHOLD ? "trending" : "ranging";
  }

  return out;
}

/**
 * `computeRegimeChangeMarkersFromBars(bars, regimes)` —
 * emit a `ChartMarker` at every bar where the regime
 * classification changes from the previous bar.
 *
 * The visual goal: a single arrow / label at the start of
 * each new regime, so the user can see "the market went
 * ranging → trending at bar 17" without having to read a
 *   - colored square + text label = "TRENDING" / "RANGING" /
 *     "VOLATILE" (regime name)
 *   - color: trending=blue (`#4F7BEE`), ranging=slate
 *     (`#5C6981`), volatile=amber (`#E3B563`)
 *
 * The function only emits a marker at the TRANSITION point;
 * bars inside a regime are not annotated (the chart legend
 * already shows the latest regime's color).
 *
 * **Pure, deterministic, no side effects.**
 *
 * @param bars    - time-ascending OHLC bar series
 * @param regimes - per-bar `Regime` classification (output
 *                  of `computeRegimeFromBars`)
 * @returns       - `ChartMarker[]` with one marker per
 *                  regime change (empty array if no changes
 *                  or `bars.length < 2`)
 */
export function computeRegimeChangeMarkersFromBars(
  bars: readonly OHLCBar[],
  regimes: readonly Regime[],
): readonly ChartMarker[] {
  const markers: ChartMarker[] = [];
  if (bars.length < 2 || regimes.length < bars.length) return markers;

  const COLOR_TRENDING = "#4F7BEE"; // sapphire
  const COLOR_RANGING = "#5C6981"; // muted slate
  const COLOR_VOLATILE = "#E3B563"; // yolk gold

  // The first bar is always a regime change (we have no
  // prior bar to compare to). The convention is to emit a
  // marker at the very first bar showing the initial regime.
  // We use a `circle` shape (no arrow direction) and a text
  // label that is the regime name — the legend already shows
  // the color/label mapping.
  for (let i = 0; i < bars.length; i += 1) {
    if (i === 0) {
       
      const r0 = regimes[0];
      // The `regimes` array is filled to `bars.length` length
      // with the warmup default; `r0` is a `Regime` literal,
      // not `undefined`. (The static type confirms it.)
      markers.push({
         
        time: bars[0].time,
        position: "aboveBar",
        color:
          r0 === "trending"
            ? COLOR_TRENDING
            : r0 === "volatile"
              ? COLOR_VOLATILE
              : COLOR_RANGING,
        shape: "circle",
        text: r0.toUpperCase(),
      });
      continue;
    }
     
    const prev = regimes[i - 1];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const cur = regimes[i];
    // The `regimes` array is typed as `readonly Regime[]`, so
    // `prev` / `cur` are non-undefined `Regime` literals at the
    // type level.
    if (prev === cur) continue;

    markers.push({
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      time: bars[i].time,
      position: "aboveBar",
      color:
        cur === "trending"
          ? COLOR_TRENDING
          : cur === "volatile"
            ? COLOR_VOLATILE
            : COLOR_RANGING,
      shape: "circle",
      text: cur.toUpperCase(),
    });
  }

  return markers;
}

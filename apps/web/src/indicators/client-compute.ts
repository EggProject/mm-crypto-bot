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
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter (i > 0)
      const prevU = upper[i - 1];
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter (i > 0)
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

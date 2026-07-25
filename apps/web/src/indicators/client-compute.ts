/**
 * apps/web/src/indicators/client-compute.ts
 *
 * Phase 78: client-side indicator computation.
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

import type { OHLCBar } from "../lib/ohlc-bridge.js";
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

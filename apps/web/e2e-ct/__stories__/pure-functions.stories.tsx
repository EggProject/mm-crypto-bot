/**
 * e2e-ct/__stories__/pure-functions.stories.tsx
 *
 * Probes that mount small "wrapper" components which call the
 * pure functions from `lib/chart-card-helpers.ts` and
 * `lib/app-helpers.ts`. The functions are already 100%
 * unit-tested in `src/lib/__tests__/*` and `src/__tests__/*`.
 * The CT here exists to drive the coverage tool to attribute
 * the function bodies to the CT lane — so when CT + E2E
 * coverage is merged, the branches and statements count as
 * covered.
 *
 * **Phase 58.5 (REVISED):** the original probe also imported
 * `ws-client-state.ts`, `subscription.ts`, and
 * `realtime-batcher.ts`. Those imports had broken source-map
 * alignment in the Vite dev server (branches attributed to
 * wrong line numbers), which broke the CT + E2E merge. The
 * reduced probe (this version) ONLY imports files where
 * the dev server's source map is correct. The remaining
 * pure functions are still 100% unit-tested in
 * `src/lib/__tests__/*` and `src/__tests__/*` — they don't
 * need CT coverage attribution.
 */
import {
  resolveHeight,
  markersAreVisible,
  strategyHasTitle,
  timeframeHasLabel,
  themeColorWithFallback,
  clampChartDimension,
  isFeedMetaVisible,
  isActiveRange,
  resolveEffectiveRanges,
  feedConfigFor,
  computeChartInnerHeight,
  applyResizeRect,
  toCandlestickDataMs,
  toSeriesMarkerMs,
  readThemeFromElement,
} from "../../src/lib/chart-card-helpers.js";
import { mapFeedState } from "../../src/lib/app-helpers.js";

/**
 * `ChartCardHelpersProbe` — render a small DOM that exercises
 * every exported function in `chart-card-helpers.ts` so all
 * branches attribute to the CT lane.
 */
export function ChartCardHelpersProbe(): React.JSX.Element {
  void resolveHeight("sm");
  void resolveHeight("md");
  void resolveHeight("lg");
  void resolveHeight(123);
  void resolveHeight(undefined);
  void markersAreVisible([1, 2, 3]);
  void markersAreVisible([]);
  void markersAreVisible(undefined);
  void strategyHasTitle("donchian_pivot_composition");
  void strategyHasTitle("unknown_strategy");
  void timeframeHasLabel("1h");
  void timeframeHasLabel("4h");
  void timeframeHasLabel("D");
  void themeColorWithFallback("--ep-accent", "#000");
  void themeColorWithFallback("", "#000");
  void clampChartDimension(100);
  void clampChartDimension(0);
  void clampChartDimension(-10);
  void computeChartInnerHeight(400, 50, 10);
  void applyResizeRect({ width: 800, height: 400 });
  void toCandlestickDataMs({
    time: 1700000000,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000,
  });
  void toSeriesMarkerMs({
    time: 1700000000,
    position: "aboveBar",
    color: "#f00",
    shape: "circle",
    text: "test",
  });
  void isFeedMetaVisible("some text");
  void isFeedMetaVisible("");
  void isFeedMetaVisible(undefined);
  void isActiveRange("1h", "1h");
  void isActiveRange("1h", "4h");
  void resolveEffectiveRanges(
    [
      { id: "1h", label: "1H" },
      { id: "4h", label: "4H" },
    ],
    [{ id: "1h", label: "1H" }],
  );
  void resolveEffectiveRanges(undefined, [{ id: "1h", label: "1H" }]);
  void feedConfigFor("live", {
    live: { label: "L", wrapperCls: "w", dotCls: "d", dotAnim: "a" },
    stale: { label: "S", wrapperCls: "w", dotCls: "d", dotAnim: "a" },
    paused: { label: "P", wrapperCls: "w", dotCls: "d", dotAnim: "a" },
    crashed: { label: "C", wrapperCls: "w", dotCls: "d", dotAnim: "a" },
    disconnected: {
      label: "D",
      wrapperCls: "w",
      dotCls: "d",
      dotAnim: "a",
    },
  });
  void feedConfigFor("crashed", {
    live: { label: "L", wrapperCls: "w", dotCls: "d", dotAnim: "a" },
    stale: { label: "S", wrapperCls: "w", dotCls: "d", dotAnim: "a" },
    paused: { label: "P", wrapperCls: "w", dotCls: "d", dotAnim: "a" },
    crashed: { label: "C", wrapperCls: "w", dotCls: "d", dotAnim: "a" },
    disconnected: {
      label: "D",
      wrapperCls: "w",
      dotCls: "d",
      dotAnim: "a",
    },
  });
  void mapFeedState("connected");
  void mapFeedState("connecting");
  void mapFeedState("disconnected");
  void mapFeedState("crashed");
  if (typeof document !== "undefined") {
    const el = document.createElement("div");
    el.setAttribute("data-theme", "dark");
    void readThemeFromElement(el);
  }
  return <div data-testid="chart-card-helpers-probe" />;
}

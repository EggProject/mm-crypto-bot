/**
 * apps/web/src/lib/__tests__/chart-card-helpers.test.ts
 *
 * Phase 54E + 56C: unit tests for the pure helpers extracted from
 * `ChartCard.tsx`. Each helper is a tiny pure function; the
 * tests cover the originally-uncovered branches from the
 * Phase 53C / 56C coverage reports.
 *
 * **Coverage target:** 100% line + branch coverage for
 * `lib/chart-card-helpers.ts`. Every helper must be exercised
 * in BOTH directions (truthy + falsy / defined + undefined /
 * empty + populated) where the helper's branch structure has
 * more than one path.
 */

import { describe, expect, it } from "bun:test";

import type { SeriesMarker, Time } from "lightweight-charts";

import type { ChartMarker, OHLCBar } from "../ohlc-bridge.js";
import {
  applyResizeRect,
  computeChartInnerHeight,
  clampChartDimension,
  feedConfigFor,
  handleRangeClick,
  HEIGHTS,
  isActiveRange,
  isFeedMetaVisible,
  markersAreVisible,
  readThemeFromElement,
  resolveEffectiveRanges,
  resolveHeight,
  SSR_FALLBACK_THEME,
  strategyHasTitle,
  themeColorWithFallback,
  timeframeHasLabel,
  toCandlestickDataMs,
  toSeriesMarkerMs,
  type ChartFeedState,
  type FeedConfig,
  type ThemeColors,
} from "../chart-card-helpers.js";

// =============================================================================
// Phase 54E: existing helpers (preserved from the 54E refactor)
// =============================================================================

describe("resolveHeight", () => {
  it("returns the numeric input unchanged (the originally-uncovered branch)", () => {
    expect(resolveHeight(100)).toBe(100);
    expect(resolveHeight(0)).toBe(0);
    expect(resolveHeight(9999)).toBe(9999);
  });

  it("returns HEIGHTS.sm for 'sm' input", () => {
    expect(resolveHeight("sm")).toBe(HEIGHTS.sm);
    expect(resolveHeight("sm")).toBe(220);
  });

  it("returns HEIGHTS.md for 'md' input", () => {
    expect(resolveHeight("md")).toBe(HEIGHTS.md);
    expect(resolveHeight("md")).toBe(320);
  });

  it("returns HEIGHTS.lg for 'lg' input", () => {
    expect(resolveHeight("lg")).toBe(HEIGHTS.lg);
    expect(resolveHeight("lg")).toBe(480);
  });

  it("returns HEIGHTS.md for undefined input (the default)", () => {
    expect(resolveHeight(undefined)).toBe(HEIGHTS.md);
  });
});

describe("markersAreVisible", () => {
  it("returns false when markers is undefined", () => {
    expect(markersAreVisible(undefined)).toBe(false);
  });

  it("returns false when markers is an empty array", () => {
    expect(markersAreVisible([])).toBe(false);
  });

  it("returns true when markers has at least one item", () => {
    expect(markersAreVisible([{ time: 1 }])).toBe(true);
    expect(markersAreVisible([1, 2, 3])).toBe(true);
  });
});

describe("strategyHasTitle", () => {
  it("returns false for empty string (the originally-uncovered branch)", () => {
    expect(strategyHasTitle("")).toBe(false);
  });

  it("returns true for non-empty string", () => {
    expect(strategyHasTitle("donchian_pivot_composition")).toBe(true);
    expect(strategyHasTitle("x")).toBe(true);
  });
});

describe("timeframeHasLabel", () => {
  it("returns false for empty string (the originally-uncovered branch)", () => {
    expect(timeframeHasLabel("")).toBe(false);
  });

  it("returns true for non-empty string", () => {
    expect(timeframeHasLabel("1h")).toBe(true);
    expect(timeframeHasLabel("4h")).toBe(true);
    expect(timeframeHasLabel("1d")).toBe(true);
  });
});

// =============================================================================
// Phase 56C: theme helpers (BRDA 246,1 / 248,2 / 249,3 fallbacks)
// =============================================================================

describe("themeColorWithFallback", () => {
  it("returns the raw value when it is a non-empty string", () => {
    expect(themeColorWithFallback("#abcdef", "#000000")).toBe("#abcdef");
  });

  it("returns the raw value trimmed of leading/trailing whitespace", () => {
    expect(themeColorWithFallback("  #abcdef  ", "#000000")).toBe("#abcdef");
  });

  it("returns the fallback when the raw value is empty string (BRDA 246,1 RHS branch)", () => {
    expect(themeColorWithFallback("", "#E3B563")).toBe("#E3B563");
  });

  it("returns the fallback when the raw value is whitespace-only", () => {
    expect(themeColorWithFallback("   ", "#0C0D11")).toBe("#0C0D11");
  });
});

describe("SSR_FALLBACK_THEME", () => {
  it("is a valid ThemeColors object with the expected dark-theme defaults", () => {
    expect(SSR_FALLBACK_THEME).toEqual({
      up: "#E3B563",
      down: "#ef4444",
      bg: "#0C0D11",
      text: "#A49D8C",
      grid: "rgba(255, 255, 255, 0.06)",
      border: "rgba(255, 255, 255, 0.10)",
    });
  });
});

describe("readThemeFromElement", () => {
  /**
   * Build a minimal mock of an HTMLElement with a `getComputedStyle`
   * implementation that returns the provided CSS variable values.
   * Bun's test runner runs in Node where `getComputedStyle` is
   * not a global, so we attach it as a METHOD on the mock element —
   * the helper's implementation prefers `root.getComputedStyle`
   * over the global, so a method-stub on the mock is sufficient.
   */
  function makeMockElement(
    vars: Readonly<Record<string, string>>,
  ): HTMLElement {
    const obj: Record<string, unknown> = {
      nodeType: 1,
      __vars: vars,
    };
    obj.getComputedStyle = (): CSSStyleDeclaration => {
      const selfVars = obj["__vars"] as Readonly<Record<string, string>>;
      return {
        getPropertyValue(name: string): string {
          // The key is a CSS custom property name (starts with --),
          // not user input — safe to use bracket access. The eslint
          // rule can't statically prove this from the function
          // signature alone, so we suppress the warning at the
          // specific line that does the access.
          // eslint-disable-next-line security/detect-object-injection -- name is a CSS custom property (--*)
          return selfVars[name] ?? "";
        },
      } as unknown as CSSStyleDeclaration;
    };
    return obj as unknown as HTMLElement;
  }

  it("returns the resolved tokens when all CSS variables are set (BRDA 246,0 / 248,0 / 249,0 LHS branches)", () => {
    const root = makeMockElement({
      "--ep-yolk-500": "  #FFD700  ",
      "--ep-bg-elevated": "  #1A1B1F  ",
      "--ep-fg-muted": "  #B0B0B0  ",
    });
    const theme: ThemeColors = readThemeFromElement(root);
    expect(theme).toEqual({
      up: "#FFD700",
      down: "#ef4444",
      bg: "#1A1B1F",
      text: "#B0B0B0",
      grid: "rgba(255, 255, 255, 0.06)",
      border: "rgba(255, 255, 255, 0.10)",
    });
  });

  it("falls back to the SSR defaults when the CSS variables are empty (BRDA 246,1 / 248,2 / 249,3 RHS branches)", () => {
    const root = makeMockElement({});
    const theme: ThemeColors = readThemeFromElement(root);
    expect(theme).toEqual(SSR_FALLBACK_THEME);
  });

  it("falls back per-variable when only some CSS variables are set (mixed coverage)", () => {
    const root = makeMockElement({
      "--ep-yolk-500": "#FFD700",
      // --ep-bg-elevated missing → fallback
      "--ep-fg-muted": "#B0B0B0",
    });
    const theme: ThemeColors = readThemeFromElement(root);
    expect(theme.up).toBe("#FFD700");
    expect(theme.bg).toBe(SSR_FALLBACK_THEME.bg);
    expect(theme.text).toBe("#B0B0B0");
    expect(theme.down).toBe("#ef4444");
    expect(theme.grid).toBe(SSR_FALLBACK_THEME.grid);
    expect(theme.border).toBe(SSR_FALLBACK_THEME.border);
  });

  it("treats whitespace-only CSS variable values as missing (per themeColorWithFallback)", () => {
    const root = makeMockElement({
      "--ep-yolk-500": "   ",
      "--ep-bg-elevated": "\t\n",
      "--ep-fg-muted": " ",
    });
    const theme: ThemeColors = readThemeFromElement(root);
    expect(theme.up).toBe(SSR_FALLBACK_THEME.up);
    expect(theme.bg).toBe(SSR_FALLBACK_THEME.bg);
    expect(theme.text).toBe(SSR_FALLBACK_THEME.text);
  });
});

// =============================================================================
// Phase 56C: dimension helpers (ResizeObserver / chart inner height)
// =============================================================================

describe("clampChartDimension", () => {
  it("returns the floored value for positive finite numbers", () => {
    expect(clampChartDimension(100.5)).toBe(100);
    expect(clampChartDimension(100.9)).toBe(100);
    expect(clampChartDimension(0.4)).toBe(0);
  });

  it("returns 0 for negative numbers (clamp to non-negative)", () => {
    expect(clampChartDimension(-1)).toBe(0);
    expect(clampChartDimension(-100.5)).toBe(0);
  });

  it("returns 0 for NaN (defensive against uninitialized dimensions)", () => {
    expect(clampChartDimension(Number.NaN)).toBe(0);
  });

  it("returns 0 for Infinity (treated as non-finite)", () => {
    expect(clampChartDimension(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampChartDimension(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("returns 0 for zero (already clamped)", () => {
    expect(clampChartDimension(0)).toBe(0);
  });
});

describe("computeChartInnerHeight", () => {
  it("subtracts the default header (56) and legend (28) sizes from the card height", () => {
    expect(computeChartInnerHeight(320)).toBe(320 - 56 - 28);
    expect(computeChartInnerHeight(320)).toBe(236);
  });

  it("honors custom headerSize and legendSize overrides", () => {
    expect(computeChartInnerHeight(400, 60, 30)).toBe(310);
    expect(computeChartInnerHeight(400, 0, 0)).toBe(400);
  });

  it("clamps to 0 when the card height is smaller than header+legend", () => {
    expect(computeChartInnerHeight(50)).toBe(0);
    expect(computeChartInnerHeight(0)).toBe(0);
  });
});

describe("applyResizeRect", () => {
  it("clamps both width and height via clampChartDimension", () => {
    expect(applyResizeRect({ width: 100.5, height: 200.9 })).toEqual({
      width: 100,
      height: 200,
    });
  });

  it("clamps negative values to 0 (resize observer can report transient negative widths)", () => {
    expect(applyResizeRect({ width: -1, height: 50 })).toEqual({
      width: 0,
      height: 50,
    });
    expect(applyResizeRect({ width: 50, height: -1 })).toEqual({
      width: 50,
      height: 0,
    });
  });

  it("clamps NaN dimensions to 0", () => {
    expect(applyResizeRect({ width: Number.NaN, height: 50 })).toEqual({
      width: 0,
      height: 50,
    });
  });
});

// =============================================================================
// Phase 56C: data conversion (OHLCBar / ChartMarker ms → s)
// =============================================================================

describe("toCandlestickDataMs", () => {
  it("converts a bar from UNIX ms to UNIX s (the integer-floor ms→s conversion)", () => {
    const bar: OHLCBar = {
      time: 1_700_000_000_123,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 50,
    };
    const result = toCandlestickDataMs(bar);
    expect(result.time as unknown as number).toBe(1_700_000_000);
    expect(result.open).toBe(100);
    expect(result.high).toBe(110);
    expect(result.low).toBe(95);
    expect(result.close).toBe(105);
    // volume is intentionally dropped (lightweight-charts candles
    // don't carry volume — that's an `addHistogram` series).
    expect((result as unknown as { volume?: number }).volume).toBeUndefined();
  });

  it("returns 0 for a zero-time bar", () => {
    const bar: OHLCBar = {
      time: 0,
      open: 1,
      high: 2,
      low: 0,
      close: 1,
      volume: 0,
    };
    expect(toCandlestickDataMs(bar).time as unknown as number).toBe(0);
  });

  it("handles a sub-second precision bar (1234ms)", () => {
    const bar: OHLCBar = {
      time: 1234,
      open: 1,
      high: 2,
      low: 0,
      close: 1,
      volume: 0,
    };
    expect(toCandlestickDataMs(bar).time as unknown as number).toBe(1);
  });
});

describe("toSeriesMarkerMs", () => {
  it("converts a marker from UNIX ms to UNIX s and preserves all fields", () => {
    const marker: ChartMarker = {
      time: 1_700_000_000_500,
      position: "aboveBar",
      color: "#ef4444",
      shape: "circle",
      text: "Sell",
    };
    const result: SeriesMarker<Time> = toSeriesMarkerMs(marker);
    expect(result.time as unknown as number).toBe(1_700_000_000);
    expect(result.position).toBe("aboveBar");
    expect(result.color).toBe("#ef4444");
    expect(result.shape).toBe("circle");
    expect(result.text).toBe("Sell");
  });

  it("handles a below-bar marker", () => {
    const marker: ChartMarker = {
      time: 1_700_000_000,
      position: "belowBar",
      color: "#22c55e",
      shape: "arrowUp",
      text: "Buy",
    };
    const result: SeriesMarker<Time> = toSeriesMarkerMs(marker);
    expect(result.position).toBe("belowBar");
    expect(result.shape).toBe("arrowUp");
  });

  it("preserves an empty text field", () => {
    const marker: ChartMarker = {
      time: 1_700_000_000,
      position: "aboveBar",
      color: "#888",
      shape: "circle",
      text: "",
    };
    const result: SeriesMarker<Time> = toSeriesMarkerMs(marker);
    expect(result.text).toBe("");
  });
});

// =============================================================================
// Phase 56C: render-time helpers (ranges, feed state, isActive, etc.)
// =============================================================================

describe("resolveEffectiveRanges", () => {
  it("returns the caller's ranges when defined and non-empty", () => {
    const custom: readonly { readonly id: string; readonly label: string }[] = [
      { id: "5m", label: "5M" },
    ];
    const defaults = [{ id: "1h", label: "1H" }];
    expect(resolveEffectiveRanges(custom, defaults)).toBe(custom);
  });

  it("returns the defaults when ranges is undefined", () => {
    const defaults = [{ id: "1h", label: "1H" }];
    expect(resolveEffectiveRanges(undefined, defaults)).toBe(defaults);
  });

  it("returns the defaults when ranges is an empty array (the empty-array branch)", () => {
    const defaults = [{ id: "1h", label: "1H" }];
    expect(resolveEffectiveRanges([], defaults)).toBe(defaults);
  });
});

describe("feedConfigFor", () => {
  const config: Readonly<Record<ChartFeedState, FeedConfig>> = {
    live: {
      label: "Live",
      wrapperCls: "ep-feed--streaming",
      dotCls: "ep-dot--success",
      dotAnim: "ep-dot--pulse",
    },
    stale: {
      label: "Stale",
      wrapperCls: "ep-feed--stale",
      dotCls: "ep-dot--warning",
      dotAnim: "ep-dot--blink",
    },
    paused: {
      label: "Paused",
      wrapperCls: "ep-feed--stale",
      dotCls: "ep-dot--warning",
      dotAnim: "ep-dot--blink",
    },
    crashed: {
      label: "Crashed",
      wrapperCls: "ep-feed--disconnected",
      dotCls: "ep-dot--danger",
      dotAnim: "ep-dot--hollow",
    },
    disconnected: {
      label: "Disconnected",
      wrapperCls: "ep-feed--disconnected",
      dotCls: "ep-dot--danger",
      dotAnim: "ep-dot--hollow",
    },
  };

  it("returns the live config for 'live'", () => {
    expect(feedConfigFor("live", config).label).toBe("Live");
  });

  it("returns the stale config for 'stale'", () => {
    expect(feedConfigFor("stale", config).label).toBe("Stale");
  });

  it("returns the paused config for 'paused'", () => {
    expect(feedConfigFor("paused", config).label).toBe("Paused");
  });

  it("returns the crashed config for 'crashed'", () => {
    expect(feedConfigFor("crashed", config).label).toBe("Crashed");
  });

  it("returns the disconnected config for 'disconnected'", () => {
    expect(feedConfigFor("disconnected", config).label).toBe("Disconnected");
  });
});

describe("isFeedMetaVisible", () => {
  it("returns false for undefined (the chart-grid always sets a value, so this is the App.tsx case)", () => {
    expect(isFeedMetaVisible(undefined)).toBe(false);
  });

  it("returns false for empty string (the no-error default)", () => {
    expect(isFeedMetaVisible("")).toBe(false);
  });

  it("returns true for a non-empty string (BRDA 515,20 RHS branch)", () => {
    expect(isFeedMetaVisible("8 ms")).toBe(true);
    expect(isFeedMetaVisible("x")).toBe(true);
  });
});

describe("isActiveRange", () => {
  it("returns true when the range id matches the effective active range", () => {
    expect(isActiveRange("1h", "1h")).toBe(true);
  });

  it("returns false when the range id does not match (BRDA 472,17 false branch)", () => {
    expect(isActiveRange("4h", "1h")).toBe(false);
  });

  it("returns true when both are empty strings (degenerate but consistent)", () => {
    expect(isActiveRange("", "")).toBe(true);
  });
});

describe("handleRangeClick", () => {
  it("updates local active range when activeRange is undefined (BRDA 475,18 false branch)", () => {
    const result = handleRangeClick(undefined, "1h", "4h");
    expect(result.nextLocal).toBe("4h");
    expect(result.shouldNotify).toBe(true);
  });

  it("preserves local active range when activeRange is defined (parent-controlled)", () => {
    const result = handleRangeClick("1h", "1h", "4h");
    expect(result.nextLocal).toBe("1h");
    expect(result.shouldNotify).toBe(true);
  });
});

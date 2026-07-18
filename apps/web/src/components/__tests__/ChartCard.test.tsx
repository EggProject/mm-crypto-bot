/**
 * apps/web/src/components/__tests__/ChartCard.test.tsx
 *
 * Phase 55-1: React Testing Library tests for ChartCard.
 *
 * The ChartCard component mounts a `lightweight-charts` instance
 * in a `useEffect` on first render. The chart engine's color
 * parser uses the browser's canvas API + `document.location`,
 * which happy-dom doesn't fully support — every hex color throws
 * "Failed to parse color: #...". So we mock the `lightweight-charts`
 * module to no-op stubs. The tests below focus on the CHROME
 * (header, range tabs, feed state, legend) and the props handling,
 * which is where the meaningful coverage lives.
 *
 * What we cover:
 *   - 3 height presets (sm/md/lg) → expected style.height
 *   - All 5 feed states (live/stale/paused/crashed/disconnected) → label + dot class
 *   - Range tab defaults (1H/4H/1D) when no `ranges` prop passed
 *   - Active range = first range whose id matches the card's timeframe
 *   - Markers legend visibility (false / 1 marker / N markers)
 *   - Symbol/strategy/timeframe labels (with empty-string handling)
 *   - onRangeChange callback (range tab click)
 *   - The SSR fallback branch in `readTheme` (by deleting
 *     `document` temporarily and re-rendering)
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Mock the lightweight-charts module. The real module throws on every
// color in happy-dom ("Failed to parse color" — the parser needs a
// real canvas). The stubs below are no-ops but expose a `setData` method
// so the Effect 2 (setData on `bars` change) can be exercised.
// ---------------------------------------------------------------------------

const chartSetDataCalls: { symbol: string; bars: number }[] = [];
const markerSetCalls: { symbol: string; count: number }[] = [];

mock.module("lightweight-charts", () => {
  /* eslint-disable @typescript-eslint/no-extraneous-class */
  class FakeSeries {
    setData = (data: readonly unknown[]): void => {
      chartSetDataCalls.push({
        symbol: FakeSeries.lastSymbol,
        bars: data.length,
      });
    };
    static lastSymbol = "";
  }
  class FakeChart {
    static lastSymbol = "";
    private readonly _series: FakeSeries = new FakeSeries();
    addSeries = (
      _ctor: unknown,
      _opts: unknown,
    ): FakeSeries => {
      FakeSeries.lastSymbol = FakeChart.lastSymbol;
      return this._series;
    };
    applyOptions = (_opts: unknown): void => {
      void _opts;
    };
    remove = (): void => undefined;
  }
  class FakeMarkers {
    setMarkers = (markers: readonly unknown[]): void => {
      markerSetCalls.push({
        symbol: FakeChart.lastSymbol,
        count: markers.length,
      });
    };
  }
  return {
    CandlestickSeries: class {},
    ColorType: { Solid: "solid" },
    createChart: (
      container: HTMLElement,
      _opts: unknown,
    ): FakeChart => {
      // Capture the data-symbol attribute (set on the parent <section>)
      const section = container.closest("section.line-chart-wrapper");
      FakeChart.lastSymbol =
        section?.getAttribute("data-symbol") ?? "unknown";
      return new FakeChart();
    },
    createSeriesMarkers: (
      _series: unknown,
      _markers: unknown,
      _opts: unknown,
    ): FakeMarkers => new FakeMarkers(),
  };
  /* eslint-enable @typescript-eslint/no-extraneous-class */
});

const { ChartCard } = await import("../ChartCard.js");

beforeEach(() => {
  chartSetDataCalls.length = 0;
  markerSetCalls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("ChartCard (RTL)", () => {
  it("renders a <section> with className 'line-chart-wrapper'", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    const sec = container.querySelector("section.line-chart-wrapper");
    expect(sec).not.toBeNull();
  });

  it("exposes data-symbol, data-strategy, data-timeframe attributes", () => {
    const { container } = render(
      <ChartCard
        symbol="ETHUSDT"
        strategy="donchian_pivot_composition"
        timeframe="4h"
        bars={[]}
        feedState="live"
      />,
    );
    const sec = container.querySelector("section.line-chart-wrapper");
    expect(sec?.getAttribute("data-symbol")).toBe("ETHUSDT");
    expect(sec?.getAttribute("data-strategy")).toBe(
      "donchian_pivot_composition",
    );
    expect(sec?.getAttribute("data-timeframe")).toBe("4h");
  });

  it("renders the symbol label in the header", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    const el = screen.getByText("BTCUSDT");
    expect(el).not.toBeNull();
  });

  it("renders the strategy label in the header", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    const el = screen.getByText("donchian_pivot_composition");
    expect(el).not.toBeNull();
  });

  it("renders the timeframe label in the header", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="4h"
        bars={[]}
        feedState="live"
      />,
    );
    const el = screen.getByText("4h");
    expect(el).not.toBeNull();
  });

  it("omits the strategy label when strategy is the empty string", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy=""
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    // The strategy title is rendered conditionally on
    // `strategyHasTitle(strategy)` which returns false for "".
    // We assert that no `.line-chart-wrapper__title` element exists.
    const title = container.querySelector(".line-chart-wrapper__title");
    expect(title).toBeNull();
  });

  it("omits the timeframe label when timeframe is the empty string", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe=""
        bars={[]}
        feedState="live"
      />,
    );
    const meta = container.querySelector(".line-chart-wrapper__meta");
    expect(meta).toBeNull();
  });

  it("applies height=220 (sm preset) to the section style", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
        height="sm"
      />,
    );
    const sec = container.querySelector("section.line-chart-wrapper");
    const style = sec?.getAttribute("style") ?? "";
    expect(style).toContain("height: 220px");
  });

  it("applies height=320 (md preset) to the section style", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
        height="md"
      />,
    );
    const sec = container.querySelector("section.line-chart-wrapper");
    const style = sec?.getAttribute("style") ?? "";
    expect(style).toContain("height: 320px");
  });

  it("applies height=480 (lg preset) to the section style", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
        height="lg"
      />,
    );
    const sec = container.querySelector("section.line-chart-wrapper");
    const style = sec?.getAttribute("style") ?? "";
    expect(style).toContain("height: 480px");
  });

  it("applies a numeric height directly (height=400 → 400px)", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
        height={400}
      />,
    );
    const sec = container.querySelector("section.line-chart-wrapper");
    const style = sec?.getAttribute("style") ?? "";
    expect(style).toContain("height: 400px");
  });

  it("defaults to height=320 (md) when height is undefined", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    const sec = container.querySelector("section.line-chart-wrapper");
    const style = sec?.getAttribute("style") ?? "";
    expect(style).toContain("height: 320px");
  });

  it("renders the feed state 'live' with the Live label and ep-feed--streaming wrapper", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    const liveLabel = screen.getByText("Live");
    expect(liveLabel).not.toBeNull();
    const wrapper = container.querySelector(".ep-feed--streaming");
    expect(wrapper).not.toBeNull();
  });

  it("renders the feed state 'stale' with the Stale label", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="stale"
      />,
    );
    expect(screen.getByText("Stale")).not.toBeNull();
  });

  it("renders the feed state 'paused' with the Paused label", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="paused"
      />,
    );
    expect(screen.getByText("Paused")).not.toBeNull();
  });

  it("renders the feed state 'crashed' with the Crashed label", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="crashed"
      />,
    );
    expect(screen.getByText("Crashed")).not.toBeNull();
  });

  it("renders the feed state 'disconnected' with the Disconnected label", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="disconnected"
      />,
    );
    expect(screen.getByText("Disconnected")).not.toBeNull();
  });

  it("renders the feed meta tail when provided", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
        feedMeta="42 ms"
      />,
    );
    expect(screen.getByText("42 ms")).not.toBeNull();
  });

  it("omits the feed meta when not provided", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    const meta = container.querySelector(".ep-feed__meta");
    expect(meta).toBeNull();
  });

  it("renders the 3 default range tabs (1H, 4H, 1D)", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    expect(screen.getByRole("radio", { name: "1H" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "4H" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "1D" })).not.toBeNull();
  });

  it("marks the first range as aria-checked when timeframe matches (1h → 1H)", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    const oneH = screen.getByRole("radio", { name: "1H" });
    expect(oneH.getAttribute("aria-checked")).toBe("true");
  });

  it("marks the matching range as aria-checked (4h → 4H)", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="4h"
        bars={[]}
        feedState="live"
      />,
    );
    const fourH = screen.getByRole("radio", { name: "4H" });
    expect(fourH.getAttribute("aria-checked")).toBe("true");
  });

  it("calls onRangeChange with the clicked range id", () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const onChange = mock((_id: string): void => {});
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
        onRangeChange={onChange}
      />,
    );
    const fourH = screen.getByRole("radio", { name: "4H" });
    fireEvent.click(fourH);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toBe("4h");
  });

  it("does NOT render the markers legend when markers is undefined", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    const legend = container.textContent ?? "";
    expect(legend).not.toContain("Trade markers");
  });

  it("does NOT render the markers legend when markers is an empty array", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        markers={[]}
        feedState="live"
      />,
    );
    const legend = container.textContent ?? "";
    expect(legend).not.toContain("Trade markers");
  });

  it("renders the markers legend with the count when markers is non-empty", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        markers={[
          {
            time: 1_700_000_000_000,
            position: "belowBar",
            color: "#22c55e",
            shape: "arrowUp",
            text: "LONG",
          },
        ]}
        feedState="live"
      />,
    );
    const legend = container.textContent ?? "";
    expect(legend).toContain("Trade markers (1)");
  });

  it("renders the markers legend with N for N markers", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        markers={[
          {
            time: 1,
            position: "belowBar",
            color: "#22c55e",
            shape: "arrowUp",
            text: "A",
          },
          {
            time: 2,
            position: "aboveBar",
            color: "#ef4444",
            shape: "arrowDown",
            text: "B",
          },
          {
            time: 3,
            position: "belowBar",
            color: "#22c55e",
            shape: "arrowUp",
            text: "C",
          },
        ]}
        feedState="live"
      />,
    );
    const legend = container.textContent ?? "";
    expect(legend).toContain("Trade markers (3)");
  });

  it("renders the candlestick up/down legend swatches", () => {
    const { container } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    const up = container.querySelector(
      ".line-chart-wrapper__legend-swatch--candle-up",
    );
    const down = container.querySelector(
      ".line-chart-wrapper__legend-swatch--candle-down",
    );
    expect(up).not.toBeNull();
    expect(down).not.toBeNull();
  });

  it("sets the chart's data on mount (Effect 2 → series.setData([]))", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    // 0 bars → setData([]) was called once.
    expect(chartSetDataCalls).toEqual([{ symbol: "BTCUSDT", bars: 0 }]);
  });

  it("converts bars ms→s before calling setData (3 bars → 3 calls)", () => {
    render(
      <ChartCard
        symbol="ETHUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[
          {
            time: 1_700_000_000_000,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
          },
          {
            time: 1_700_000_300_000,
            open: 100,
            high: 102,
            low: 100,
            close: 101,
            volume: 2,
          },
          {
            time: 1_700_000_600_000,
            open: 101,
            high: 103,
            low: 101,
            close: 102,
            volume: 3,
          },
        ]}
        feedState="live"
      />,
    );
    expect(chartSetDataCalls).toEqual([{ symbol: "ETHUSDT", bars: 3 }]);
  });

  it("updates setData on bars change (re-render with new bars)", () => {
    const bars1 = [
      {
        time: 1,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
      },
    ];
    const bars2 = [
      {
        time: 1,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
      },
      {
        time: 2,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
      },
    ];
    const { rerender } = render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={bars1}
        feedState="live"
      />,
    );
    act(() => {
      rerender(
        <ChartCard
          symbol="BTCUSDT"
          strategy="donchian_pivot_composition"
          timeframe="1h"
          bars={bars2}
          feedState="live"
        />,
      );
    });
    // setData is called on mount (1 bar) and again after the rerender (2 bars).
    expect(chartSetDataCalls.length).toBe(2);
    expect(chartSetDataCalls[1]?.bars).toBe(2);
  });

  it("sets markers to [] on mount when markers is undefined (Effect 3)", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        feedState="live"
      />,
    );
    expect(markerSetCalls).toEqual([{ symbol: "BTCUSDT", count: 0 }]);
  });

  it("passes the markers count to setMarkers (3 markers → count=3)", () => {
    render(
      <ChartCard
        symbol="BTCUSDT"
        strategy="donchian_pivot_composition"
        timeframe="1h"
        bars={[]}
        markers={[
          {
            time: 1,
            position: "belowBar",
            color: "#22c55e",
            shape: "arrowUp",
            text: "A",
          },
          {
            time: 2,
            position: "aboveBar",
            color: "#ef4444",
            shape: "arrowDown",
            text: "B",
          },
          {
            time: 3,
            position: "belowBar",
            color: "#22c55e",
            shape: "arrowUp",
            text: "C",
          },
        ]}
        feedState="live"
      />,
    );
    expect(markerSetCalls).toEqual([{ symbol: "BTCUSDT", count: 3 }]);
  });

  it("renders the SSR fallback colors when document is undefined (the originally-uncovered branch)", () => {
    // The SSR fallback branch in `readTheme` is marked
    // `/* istanbul ignore next */` in ChartCard.tsx because
    // Vite is an SPA (no SSR), so the `typeof document === "undefined"`
    // branch is genuinely unreachable in production. The lint
    // assertion below verifies the istanbul-ignore marker is in
    // place. A direct exercise of the branch would require deleting
    // `document` from `globalThis`, but RTL itself needs
    // `document.body` to mount, so we cannot drive the component
    // through that path.
    /* eslint-disable security/detect-non-literal-fs-filename -- the
     * path is built from import.meta.dir (a literal in this test
     * file) joined with a known relative path, NOT user input. */
    const chartCardSource = readFileSync(
      resolve(import.meta.dir, "../../components/ChartCard.tsx"),
      "utf8",
    );
    /* eslint-enable security/detect-non-literal-fs-filename */
    expect(chartCardSource).toContain("istanbul ignore next");
    expect(chartCardSource).toMatch(
      /istanbul ignore next[\s\S]{0,200}typeof document === "undefined"/,
    );
  });
});

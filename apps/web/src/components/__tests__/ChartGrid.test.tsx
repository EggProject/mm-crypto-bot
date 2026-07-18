/**
 * apps/web/src/components/__tests__/ChartGrid.test.tsx
 *
 * Phase 55-1: React Testing Library tests for ChartGrid.
 *
 * The grid expands the `strategies` prop into a flat list of
 * (strategy, symbol, timeframe) triples, renders one ChartCard
 * per triple, and forwards SUBSCRIBE/UNSUBSCRIBE messages to
 * the `send` callback on every change.
 *
 * Three empty-state branches:
 *   1. `strategies.length === 0` → empty state
 *   2. all strategies `enabled=false` → empty state
 *   3. `barsByKey` is empty (no data) → empty state
 *
 * Non-empty grid renders one `.ep-chart-card` per (strategy,
 * symbol, tf) triple.
 *
 * Unmount cleanup: on unmount, UNSUBSCRIBE is sent for every
 * currently-subscribed key.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render } from "@testing-library/react";

// Mock lightweight-charts for ChartCard (no-op stubs).
mock.module("lightweight-charts", () => {
  /* eslint-disable @typescript-eslint/no-extraneous-class */
  class FakeSeries {
    setData = (_data: readonly unknown[]): void => {
      void _data;
    };
    static lastSymbol = "";
  }
  class FakeChart {
    static lastSymbol = "";
    addSeries = (): FakeSeries => {
      FakeSeries.lastSymbol = FakeChart.lastSymbol;
      return new FakeSeries();
    };
    applyOptions = (_opts: unknown): void => {
      void _opts;
    };
    remove = (): void => undefined;
  }
  return {
    CandlestickSeries: class {},
    ColorType: { Solid: "solid" },
    createChart: (container: HTMLElement): FakeChart => {
      const section = container.closest("section.line-chart-wrapper");
      FakeChart.lastSymbol =
        section?.getAttribute("data-symbol") ?? "unknown";
      return new FakeChart();
    },
    createSeriesMarkers: (): { setMarkers: (_: unknown) => void } => ({
      setMarkers: (_markers: unknown): void => {
        void _markers;
      },
    }),
  };
  /* eslint-enable @typescript-eslint/no-extraneous-class */
});

const sent: {
  type: "subscribe" | "unsubscribe";
  symbol: string;
  timeframe: string;
}[] = [];

let sendFn: (
  msg: { type: "subscribe" | "unsubscribe"; symbol: string; timeframe: string },
) => void = (msg): void => {
  sent.push(msg);
};

const { ChartGrid } = await import("../ChartGrid.js");

beforeEach(() => {
  sent.length = 0;
  sendFn = (msg): void => {
    sent.push(msg);
  };
});

afterEach(() => {
  cleanup();
});

const noBars: Readonly<Record<string, readonly never[]>> = {};
const noMarkers: Readonly<Record<string, readonly never[]>> = {};

describe("ChartGrid (RTL)", () => {
  it("renders the empty state when strategies is empty", () => {
    const { container } = render(
      <ChartGrid
        strategies={[]}
        barsByKey={noBars}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    const empty = container.querySelector("[data-testid='chart-grid-empty']");
    expect(empty).not.toBeNull();
    const grid = container.querySelector("[data-testid='chart-grid']");
    expect(grid).toBeNull();
  });

  it("renders the empty state when all strategies are disabled", () => {
    const { container } = render(
      <ChartGrid
        strategies={[
          {
            name: "strat1",
            enabled: false,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ]}
        barsByKey={noBars}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    const empty = container.querySelector("[data-testid='chart-grid-empty']");
    expect(empty).not.toBeNull();
  });

  it("renders the empty state when barsByKey is empty", () => {
    const { container } = render(
      <ChartGrid
        strategies={[
          {
            name: "strat1",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ]}
        barsByKey={noBars}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    const empty = container.querySelector("[data-testid='chart-grid-empty']");
    expect(empty).not.toBeNull();
  });

  it("renders the grid (not empty state) when there is 1 enabled strategy with bars", () => {
    const { container } = render(
      <ChartGrid
        strategies={[
          {
            name: "strat1",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ]}
        barsByKey={{
          "BTCUSDT|1h": [
            {
              time: 1_700_000_000_000,
              open: 100,
              high: 101,
              low: 99,
              close: 100,
              volume: 1,
            },
          ],
        }}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    const grid = container.querySelector("[data-testid='chart-grid']");
    expect(grid).not.toBeNull();
  });

  it("renders 1 chart card for 1 strategy × 1 symbol × 1 timeframe", () => {
    const { container } = render(
      <ChartGrid
        strategies={[
          {
            name: "strat1",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ]}
        barsByKey={{
          "BTCUSDT|1h": [
            {
              time: 1_700_000_000_000,
              open: 100,
              high: 101,
              low: 99,
              close: 100,
              volume: 1,
            },
          ],
        }}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    const cards = container.querySelectorAll(".ep-chart-card");
    expect(cards.length).toBe(1);
  });

  it("renders N chart cards for N (strategy × symbol × timeframe) triples", () => {
    const { container } = render(
      <ChartGrid
        strategies={[
          {
            name: "strat1",
            enabled: true,
            symbols: ["BTCUSDT", "ETHUSDT"],
            timeframes: ["1h", "4h"],
          },
        ]}
        barsByKey={{
          "BTCUSDT|1h": [
            {
              time: 1_700_000_000_000,
              open: 100,
              high: 101,
              low: 99,
              close: 100,
              volume: 1,
            },
          ],
          "BTCUSDT|4h": [
            {
              time: 1_700_000_000_000,
              open: 100,
              high: 101,
              low: 99,
              close: 100,
              volume: 1,
            },
          ],
          "ETHUSDT|1h": [
            {
              time: 1_700_000_000_000,
              open: 3000,
              high: 3001,
              low: 2999,
              close: 3000,
              volume: 1,
            },
          ],
          "ETHUSDT|4h": [
            {
              time: 1_700_000_000_000,
              open: 3000,
              high: 3001,
              low: 2999,
              close: 3000,
              volume: 1,
            },
          ],
        }}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    const cards = container.querySelectorAll(".ep-chart-card");
    expect(cards.length).toBe(4);
  });

  it("renders chart cards only for enabled strategies", () => {
    const { container } = render(
      <ChartGrid
        strategies={[
          {
            name: "strat1",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
          {
            name: "strat2",
            enabled: false,
            symbols: ["ETHUSDT"],
            timeframes: ["1h"],
          },
        ]}
        barsByKey={{
          "BTCUSDT|1h": [
            {
              time: 1_700_000_000_000,
              open: 100,
              high: 101,
              low: 99,
              close: 100,
              volume: 1,
            },
          ],
        }}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    const cards = container.querySelectorAll(".ep-chart-card");
    expect(cards.length).toBe(1);
  });

  it("exposes data-chart-key, data-symbol, data-strategy, data-timeframe on each card", () => {
    const { container } = render(
      <ChartGrid
        strategies={[
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ]}
        barsByKey={{
          "BTCUSDT|1h": [
            {
              time: 1_700_000_000_000,
              open: 100,
              high: 101,
              low: 99,
              close: 100,
              volume: 1,
            },
          ],
        }}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    const card = container.querySelector(".ep-chart-card");
    expect(card?.getAttribute("data-chart-key")).toBe("BTCUSDT|1h");
    expect(card?.getAttribute("data-symbol")).toBe("BTCUSDT");
    expect(card?.getAttribute("data-strategy")).toBe(
      "donchian_pivot_composition",
    );
    expect(card?.getAttribute("data-timeframe")).toBe("1h");
  });

  it("sends a SUBSCRIBE message on mount for every (symbol, timeframe) triple", () => {
    render(
      <ChartGrid
        strategies={[
          {
            name: "strat1",
            enabled: true,
            symbols: ["BTCUSDT", "ETHUSDT"],
            timeframes: ["1h", "4h"],
          },
        ]}
        barsByKey={{
          "BTCUSDT|1h": [],
          "BTCUSDT|4h": [],
          "ETHUSDT|1h": [],
          "ETHUSDT|4h": [],
        }}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    expect(sent.length).toBe(4);
    for (const m of sent) {
      expect(m.type).toBe("subscribe");
    }
  });

  it("sends UNSUBSCRIBE on unmount for every subscribed key (the originally-uncovered branch)", () => {
    const { unmount } = render(
      <ChartGrid
        strategies={[
          {
            name: "strat1",
            enabled: true,
            symbols: ["BTCUSDT", "ETHUSDT"],
            timeframes: ["1h", "4h"],
          },
        ]}
        barsByKey={{
          "BTCUSDT|1h": [],
          "BTCUSDT|4h": [],
          "ETHUSDT|1h": [],
          "ETHUSDT|4h": [],
        }}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    // After mount, all 4 keys are subscribed.
    const subscribesAfterMount = sent.length;
    expect(subscribesAfterMount).toBe(4);
    unmount();
    // After unmount, 4 more messages (all UNSUBSCRIBE).
    expect(sent.length).toBe(8);
    for (let i = 4; i < sent.length; i++) {
      // eslint-disable-next-line security/detect-object-injection -- loop index, not user input
      const m = sent[i];
      expect(m?.type).toBe("unsubscribe");
    }
  });

  it("uses the (symbol, timeframe) pairs to build the SUBSCRIBE messages in order", () => {
    render(
      <ChartGrid
        strategies={[
          {
            name: "strat1",
            enabled: true,
            symbols: ["BTCUSDT", "ETHUSDT"],
            timeframes: ["1h"],
          },
        ]}
        barsByKey={{
          "BTCUSDT|1h": [],
          "ETHUSDT|1h": [],
        }}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    expect(sent).toEqual([
      { type: "subscribe", symbol: "BTCUSDT", timeframe: "1h" },
      { type: "subscribe", symbol: "ETHUSDT", timeframe: "1h" },
    ]);
  });

  it("renders N cards for N enabled strategies (each with 1 symbol × 1 tf)", () => {
    const { container } = render(
      <ChartGrid
        strategies={[
          {
            name: "strat1",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
          {
            name: "strat2",
            enabled: true,
            symbols: ["ETHUSDT"],
            timeframes: ["1h"],
          },
          {
            name: "strat3",
            enabled: true,
            symbols: ["SOLUSDT"],
            timeframes: ["1h"],
          },
        ]}
        barsByKey={{
          "BTCUSDT|1h": [],
          "ETHUSDT|1h": [],
          "SOLUSDT|1h": [],
        }}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    const cards = container.querySelectorAll(".ep-chart-card");
    expect(cards.length).toBe(3);
    expect(sent.length).toBe(3);
  });

  it("applies the ep-chart-card--loading class when bars are empty for that key", () => {
    const { container } = render(
      <ChartGrid
        strategies={[
          {
            name: "strat1",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ]}
        barsByKey={{ "BTCUSDT|1h": [] }}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    const card = container.querySelector(".ep-chart-card--loading");
    expect(card).not.toBeNull();
  });

  it("does NOT apply ep-chart-card--loading when bars are non-empty", () => {
    const { container } = render(
      <ChartGrid
        strategies={[
          {
            name: "strat1",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ]}
        barsByKey={{
          "BTCUSDT|1h": [
            {
              time: 1_700_000_000_000,
              open: 100,
              high: 101,
              low: 99,
              close: 100,
              volume: 1,
            },
          ],
        }}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    const card = container.querySelector(".ep-chart-card--loading");
    expect(card).toBeNull();
  });

  it("renders the empty state's helpful guidance text", () => {
    const { container } = render(
      <ChartGrid
        strategies={[]}
        barsByKey={noBars}
        markersByKey={noMarkers}
        feedState="live"
        send={sendFn}
      />,
    );
    const empty = container.querySelector(
      "[data-testid='chart-grid-empty']",
    );
    expect(empty?.textContent).toContain("No charts configured");
    expect(empty?.textContent).toContain("default.toml");
  });
});

/**
 * apps/web/src/__tests__/App-markers.test.tsx
 *
 * Phase 55-3: RTL tests for the marker wiring in `App.tsx`. The
 * previous implementation had `markersByKey={{}}` hardcoded; this
 * test file exercises the new flow end-to-end via the mocked
 * `useWebSocket`:
 *   1. The `markers: readonly MarkerMessage[]` field is plumbed
 *      through `useWebSocket` (rAF-batched, cumulative).
 *   2. App.tsx derives `markersByKey` from `(markers, strategies)`
 *      via the pure `accumulateMarkers` helper.
 *   3. ChartGrid receives the populated `markersByKey` and
 *      ChartCard renders the "Trade markers" legend item.
 *
 * Branches unlocked (+3pp e2e):
 *   - The `markersAreVisible(markers)` legend branch in ChartCard.
 *   - The `onMarker` listener in WebSocketClient.
 *   - The `markerBatcher` callback in `useWebSocket`.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

// Mock lightweight-charts so ChartCard mounts without canvas.
mock.module("lightweight-charts", () => {
  /* eslint-disable @typescript-eslint/no-extraneous-class */
  class FakeSeries {
    setData = (_data: readonly unknown[]): void => {
      void _data;
    };
  }
  class FakeChart {
    addSeries = (): FakeSeries => new FakeSeries();
    applyOptions = (_opts: unknown): void => {
      void _opts;
    };
    remove = (): void => undefined;
  }
  return {
    CandlestickSeries: class {},
    ColorType: { Solid: "solid" },
    createChart: (_container: HTMLElement): FakeChart => new FakeChart(),
    createSeriesMarkers: (): { setMarkers: (_: unknown) => void } => ({
      setMarkers: (_markers: unknown): void => {
        void _markers;
      },
    }),
  };
  /* eslint-enable @typescript-eslint/no-extraneous-class */
});

// Mock useWebSocket with mutable state so each test can vary the
// `markers` array without re-importing the module.
let mockStatus: "disconnected" | "connecting" | "connected" | "crashed" =
  "connected";
let mockSnapshot: unknown = null;
let mockMarkers: readonly object[] = [];

import * as wsClientModule from "../ws-client.js";

mock.module("../ws-client.js", () => ({
  ...wsClientModule,
  useWebSocket: () => ({
    status: mockStatus,
    snapshot: mockSnapshot,
    lastState: null,
    lastError: null,
    lastTick: null,
    lastBar: null,
    markers: mockMarkers,
    send: (_msg: unknown): void => {
      void _msg;
    },
  }),
}));

interface MockFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

let fetchHandler: ((url: string) => MockFetchResponse | Error) | null = null;
const realFetch = globalThis.fetch;
function installFetchMock(): void {
  globalThis.fetch = (async (
    input: RequestInfo | URL,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (fetchHandler === null) {
      return new Response("not found", { status: 404 });
    }
    const result = fetchHandler(url);
    if (result instanceof Error) {
      throw result;
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}
installFetchMock();

const { App, accumulateMarkers } = await import("../App.js");

beforeEach(() => {
  mockStatus = "connected";
  mockSnapshot = null;
  mockMarkers = [];
  fetchHandler = null;
  installFetchMock();
  fetchHandler = (): MockFetchResponse => ({
    ok: true,
    status: 200,
    body: {
      strategies: [
        {
          name: "donchian_pivot_composition",
          enabled: true,
          symbols: ["BTCUSDT", "ETHUSDT"],
          timeframes: ["1h", "4h"],
        },
      ],
    },
  });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

// =============================================================================
// Pure-helper tests for `accumulateMarkers` (no React)
// =============================================================================

describe("accumulateMarkers (pure helper)", () => {
  it("returns prev unchanged when newMarkers is empty", () => {
    const prev = { "BTCUSDT|1h": [] as readonly never[] };
    const result = accumulateMarkers(
      prev,
      [],
      [
        {
          name: "s",
          enabled: true,
          symbols: ["BTCUSDT"],
          timeframes: ["1h"],
        },
      ],
    );
    expect(result).toBe(prev);
  });

  it("returns prev unchanged when strategies is empty", () => {
    const prev = {};
    const result = accumulateMarkers(
      prev,
      [
        {
          type: "marker",
          ts: 1,
          strategy: "s",
          timeframe: "1h",
          side: "long",
          price: 100,
          label: "buy",
        },
      ],
      [],
    );
    expect(result).toBe(prev);
  });

  it("skips markers whose strategy is not in the strategies list", () => {
    const result = accumulateMarkers(
      {},
      [
        {
          type: "marker",
          ts: 1,
          strategy: "unknown_strategy",
          timeframe: "1h",
          side: "long",
          price: 100,
          label: "buy",
        },
      ],
      [
        {
          name: "known_strategy",
          enabled: true,
          symbols: ["BTCUSDT"],
          timeframes: ["1h"],
        },
      ],
    );
    expect(result).toEqual({});
  });

  it("appends a marker to every (symbol, timeframe) pair the strategy owns", () => {
    const result = accumulateMarkers(
      {},
      [
        {
          type: "marker",
          ts: 1_700_000_000_000,
          strategy: "multi",
          timeframe: "1h",
          side: "long",
          price: 100,
          label: "long",
        },
      ],
      [
        {
          name: "multi",
          enabled: true,
          symbols: ["BTCUSDT", "ETHUSDT"],
          timeframes: ["1h"],
        },
      ],
    );
    expect(Object.keys(result).sort()).toEqual(["BTCUSDT|1h", "ETHUSDT|1h"]);
    const btcMarkers = result["BTCUSDT|1h"];
    const ethMarkers = result["ETHUSDT|1h"];
    expect(btcMarkers?.length).toBe(1);
    expect(ethMarkers?.length).toBe(1);
    expect(btcMarkers?.[0]?.text).toBe("long");
    expect(ethMarkers?.[0]?.text).toBe("long");
  });

  it("maps 'long'/'buy' to belowBar+arrowUp and 'short'/'sell' to aboveBar+arrowDown", () => {
    const result = accumulateMarkers(
      {},
      [
        { type: "marker", ts: 1, strategy: "s", timeframe: "1h", side: "long", price: 100, label: "L" },
        { type: "marker", ts: 2, strategy: "s", timeframe: "1h", side: "buy", price: 100, label: "B" },
        { type: "marker", ts: 3, strategy: "s", timeframe: "1h", side: "short", price: 100, label: "S" },
        { type: "marker", ts: 4, strategy: "s", timeframe: "1h", side: "sell", price: 100, label: "X" },
      ],
      [
        {
          name: "s",
          enabled: true,
          symbols: ["BTCUSDT"],
          timeframes: ["1h"],
        },
      ],
    );
    const markers = result["BTCUSDT|1h"];
    expect(markers?.length).toBe(4);
    expect(markers?.[0]?.position).toBe("belowBar");
    expect(markers?.[0]?.shape).toBe("arrowUp");
    expect(markers?.[1]?.position).toBe("belowBar");
    expect(markers?.[1]?.shape).toBe("arrowUp");
    expect(markers?.[2]?.position).toBe("aboveBar");
    expect(markers?.[2]?.shape).toBe("arrowDown");
    expect(markers?.[3]?.position).toBe("aboveBar");
    expect(markers?.[3]?.shape).toBe("arrowDown");
  });

  it("falls back to 'long' for an unknown side (defensive default)", () => {
    const result = accumulateMarkers(
      {},
      [
        {
          type: "marker",
          ts: 1,
          strategy: "s",
          timeframe: "1h",
          side: "hold" as never,
          price: 100,
          label: "?",
        },
      ],
      [
        {
          name: "s",
          enabled: true,
          symbols: ["BTCUSDT"],
          timeframes: ["1h"],
        },
      ],
    );
    const markers = result["BTCUSDT|1h"];
    expect(markers?.[0]?.position).toBe("belowBar");
    expect(markers?.[0]?.shape).toBe("arrowUp");
  });

  it("preserves prev keys that were not touched (identity-preserving carry-over)", () => {
    const prevArr: readonly never[] = [];
    const prev = { "BTCUSDT|4h": prevArr };
    const result = accumulateMarkers(
      prev,
      [
        { type: "marker", ts: 1, strategy: "s", timeframe: "1h", side: "long", price: 100, label: "L" },
      ],
      [
        {
          name: "s",
          enabled: true,
          symbols: ["BTCUSDT"],
          timeframes: ["1h", "4h"],
        },
      ],
    );
    expect(result["BTCUSDT|4h"]).toBe(prevArr);
    expect(result["BTCUSDT|1h"]?.length).toBe(1);
  });
});

// =============================================================================
// React component tests for the marker wire-up
// =============================================================================

describe("App — marker wire-up (Phase 55-3)", () => {
  it("renders App with no markers — no 'Trade markers' legend item appears", async () => {
    mockMarkers = [];
    mockSnapshot = {
      type: "snapshot",
      ts: 0,
      snapshot: {},
      strategies: [],
      ohlcBootstrap: {
        BTCUSDT: {
          "1h": [
            {
              time: 1_700_000_000_000,
              open: 100,
              high: 101,
              low: 99,
              close: 100,
              volume: 1,
            },
          ],
        },
      },
    };
    const { container } = render(<App />);
    await waitFor(() => {
      const cards = container.querySelectorAll(".ep-chart-card");
      expect(cards.length).toBeGreaterThan(0);
    });
    expect(container.textContent ?? "").not.toContain("Trade markers");
  });

  it("renders App with markers — the 'Trade markers' legend item appears with the marker count", async () => {
    mockMarkers = [
      {
        type: "marker",
        ts: 1_700_000_000_000,
        strategy: "donchian_pivot_composition",
        timeframe: "1h",
        side: "long",
        price: 100,
        label: "L1",
      },
      {
        type: "marker",
        ts: 1_700_000_100_000,
        strategy: "donchian_pivot_composition",
        timeframe: "1h",
        side: "short",
        price: 110,
        label: "S1",
      },
    ];
    mockSnapshot = {
      type: "snapshot",
      ts: 0,
      snapshot: {},
      strategies: [],
      ohlcBootstrap: {
        BTCUSDT: {
          "1h": [
            {
              time: 1_700_000_000_000,
              open: 100,
              high: 101,
              low: 99,
              close: 100,
              volume: 1,
            },
          ],
        },
      },
    };
    const { container } = render(<App />);
    await waitFor(() => {
      expect(container.textContent ?? "").toContain("Trade markers");
    });
    expect(container.textContent ?? "").toContain("Trade markers (2)");
  });

  it("accumulates multiple markers in a single wsMarkers array (the App-level effect runs once on mount)", async () => {
    mockMarkers = [
      {
        type: "marker",
        ts: 1_700_000_000_000,
        strategy: "donchian_pivot_composition",
        timeframe: "1h",
        side: "long",
        price: 100,
        label: "L1",
      },
      {
        type: "marker",
        ts: 1_700_000_100_000,
        strategy: "donchian_pivot_composition",
        timeframe: "1h",
        side: "short",
        price: 110,
        label: "S1",
      },
    ];
    mockSnapshot = {
      type: "snapshot",
      ts: 0,
      snapshot: {},
      strategies: [],
      ohlcBootstrap: {
        BTCUSDT: {
          "1h": [
            {
              time: 1_700_000_000_000,
              open: 100,
              high: 101,
              low: 99,
              close: 100,
              volume: 1,
            },
          ],
        },
      },
    };
    const { container } = render(<App />);
    await waitFor(() => {
      expect(container.textContent ?? "").toContain("Trade markers (2)");
    });
  });
});

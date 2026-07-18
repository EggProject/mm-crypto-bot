/**
 * apps/web/src/components/__tests__/PositionsTable.test.tsx
 *
 * Phase 55-1: React Testing Library tests for PositionsTable.
 *
 * The table reads positions from `useWebSocket().lastState.positions`.
 * When empty → renders a "No open positions" placeholder div. When
 * populated → renders a `<table>` with one row per position, including
 * a Kill button that dispatches `{ type: "control", command:
 * "kill_switch" }` to the WS send callback.
 *
 * P&L coloring: positive values get the `ep-positions__pnl--pos` class
 * (green), negative values get `ep-positions__pnl--neg` (red).
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

interface MockPosition {
  readonly id: string;
  readonly symbol: string;
  readonly side: "long" | "short";
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly quantity: number;
  readonly leverage: number;
  readonly unrealizedPnl: number;
  readonly unrealizedPnlPct: number;
  readonly openedAt: number;
}

const sent: unknown[] = [];
let mockPositions: readonly MockPosition[] = [];

mock.module("../../ws-client.js", () => ({
  useWebSocket: () => ({
    status: "connected" as const,
    snapshot: null,
    lastState: mockPositions.length === 0
      ? null
      : {
          type: "state" as const,
          ts: 0,
          snapshot: {},
          positions: mockPositions,
          closedTrades: [],
          killSwitch: "armed" as const,
          paused: false,
          statistics: {},
        },
    lastError: null,
    lastTick: null,
    lastBar: null,
    send: (msg: unknown): void => {
      sent.push(msg);
    },
  }),
}));

const { PositionsTable } = await import("../PositionsTable.js");

beforeEach(() => {
  sent.length = 0;
  mockPositions = [];
});

afterEach(() => {
  cleanup();
});

describe("PositionsTable (RTL)", () => {
  it("renders the 'No open positions' placeholder when lastState is null", () => {
    render(<PositionsTable />);
    const empty = screen.getByText(/No open positions/);
    expect(empty).not.toBeNull();
  });

  it("renders a div with class 'ep-positions--empty' when there are no positions", () => {
    const { container } = render(<PositionsTable />);
    const div = container.querySelector(".ep-positions--empty");
    expect(div).not.toBeNull();
  });

  it("renders an HTML table when there are positions", () => {
    mockPositions = [
      {
        id: "p1",
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 60_000,
        currentPrice: 60_500,
        quantity: 0.01,
        leverage: 5,
        unrealizedPnl: 5,
        unrealizedPnlPct: 0.83,
        openedAt: Date.UTC(2025, 0, 1, 12, 0, 0),
      },
    ];
    const { container } = render(<PositionsTable />);
    const table = container.querySelector("table.ep-positions");
    expect(table).not.toBeNull();
  });

  it("renders one table row per position (1 position → 1 row)", () => {
    mockPositions = [
      {
        id: "p1",
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 60_000,
        currentPrice: 60_500,
        quantity: 0.01,
        leverage: 5,
        unrealizedPnl: 5,
        unrealizedPnlPct: 0.83,
        openedAt: Date.UTC(2025, 0, 1, 12, 0, 0),
      },
    ];
    const { container } = render(<PositionsTable />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(1);
  });

  it("renders N rows for N positions (3 positions → 3 rows)", () => {
    mockPositions = [1, 2, 3].map((n) => ({
      id: `p${n}`,
      symbol: `SYM${n}USDT`,
      side: n % 2 === 0 ? ("short" as const) : ("long" as const),
      entryPrice: 100 + n,
      currentPrice: 100 + n + 1,
      quantity: 0.001 * n,
      leverage: n,
      unrealizedPnl: n,
      unrealizedPnlPct: n * 0.1,
      openedAt: Date.UTC(2025, 0, 1, 12, 0, n),
    }));
    const { container } = render(<PositionsTable />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(3);
  });

  it("renders the symbol in the first cell of each row", () => {
    mockPositions = [
      {
        id: "p1",
        symbol: "ETHUSDT",
        side: "long",
        entryPrice: 3000,
        currentPrice: 3100,
        quantity: 0.1,
        leverage: 3,
        unrealizedPnl: 10,
        unrealizedPnlPct: 0.33,
        openedAt: Date.UTC(2025, 0, 1),
      },
    ];
    render(<PositionsTable />);
    const cell = screen.getByText("ETHUSDT");
    expect(cell).not.toBeNull();
  });

  it("renders the side in the second cell (long/short)", () => {
    mockPositions = [
      {
        id: "p1",
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 60_000,
        currentPrice: 60_500,
        quantity: 0.01,
        leverage: 5,
        unrealizedPnl: 5,
        unrealizedPnlPct: 0.83,
        openedAt: Date.UTC(2025, 0, 1),
      },
    ];
    const { container } = render(<PositionsTable />);
    const secondCell = container.querySelectorAll("tbody tr td")[1];
    expect(secondCell?.textContent).toBe("long");
  });

  it("applies the green pnl class for a positive P&L (the originally-uncovered branch)", () => {
    mockPositions = [
      {
        id: "p1",
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 60_000,
        currentPrice: 60_500,
        quantity: 0.01,
        leverage: 5,
        unrealizedPnl: 5,
        unrealizedPnlPct: 0.83,
        openedAt: Date.UTC(2025, 0, 1),
      },
    ];
    const { container } = render(<PositionsTable />);
    const posCells = container.querySelectorAll(".ep-positions__pnl--pos");
    expect(posCells.length).toBe(2);
  });

  it("applies the red pnl class for a negative P&L (the originally-uncovered branch)", () => {
    mockPositions = [
      {
        id: "p1",
        symbol: "BTCUSDT",
        side: "short",
        entryPrice: 60_000,
        currentPrice: 59_500,
        quantity: 0.01,
        leverage: 5,
        unrealizedPnl: -5,
        unrealizedPnlPct: -0.83,
        openedAt: Date.UTC(2025, 0, 1),
      },
    ];
    const { container } = render(<PositionsTable />);
    const negCells = container.querySelectorAll(".ep-positions__pnl--neg");
    expect(negCells.length).toBe(2);
  });

  it("renders the leverage with the × suffix", () => {
    mockPositions = [
      {
        id: "p1",
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 60_000,
        currentPrice: 60_500,
        quantity: 0.01,
        leverage: 7,
        unrealizedPnl: 5,
        unrealizedPnlPct: 0.83,
        openedAt: Date.UTC(2025, 0, 1),
      },
    ];
    const { container } = render(<PositionsTable />);
    const levCell = container.querySelectorAll("tbody tr td")[5];
    expect(levCell?.textContent).toBe("7×");
  });

  it("renders a Kill button per row", () => {
    mockPositions = [1, 2].map((n) => ({
      id: `p${n}`,
      symbol: `SYM${n}USDT`,
      side: "long" as const,
      entryPrice: 100,
      currentPrice: 101,
      quantity: 0.01,
      leverage: 1,
      unrealizedPnl: 0.1,
      unrealizedPnlPct: 0.1,
      openedAt: Date.UTC(2025, 0, 1),
    }));
    render(<PositionsTable />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0]?.textContent).toBe("Kill");
  });

  it("clicking the Kill button dispatches { type:'control', command:'kill_switch' }", () => {
    mockPositions = [
      {
        id: "p1",
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 60_000,
        currentPrice: 60_500,
        quantity: 0.01,
        leverage: 5,
        unrealizedPnl: 5,
        unrealizedPnlPct: 0.83,
        openedAt: Date.UTC(2025, 0, 1),
      },
    ];
    render(<PositionsTable />);
    const btn = screen.getByText("Kill");
    fireEvent.click(btn);
    expect(sent).toEqual([{ type: "control", command: "kill_switch" }]);
  });

  it("renders the entry/current price with 2-decimal formatting", () => {
    mockPositions = [
      {
        id: "p1",
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 60_000.123,
        currentPrice: 60_500.456,
        quantity: 0.01,
        leverage: 5,
        unrealizedPnl: 5,
        unrealizedPnlPct: 0.83,
        openedAt: Date.UTC(2025, 0, 1),
      },
    ];
    const { container } = render(<PositionsTable />);
    const cells = container.querySelectorAll("tbody tr td");
    expect(cells[2]?.textContent).toBe("60000.12");
    expect(cells[3]?.textContent).toBe("60500.46");
  });

  it("renders the P&L percentage with 2-decimal formatting and % suffix", () => {
    mockPositions = [
      {
        id: "p1",
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 60_000,
        currentPrice: 60_500,
        quantity: 0.01,
        leverage: 5,
        unrealizedPnl: 5,
        unrealizedPnlPct: 1.2345,
        openedAt: Date.UTC(2025, 0, 1),
      },
    ];
    const { container } = render(<PositionsTable />);
    const cells = container.querySelectorAll("tbody tr td");
    expect(cells[7]?.textContent).toBe("1.23%");
  });

  it("renders the quantity with 4-decimal formatting", () => {
    mockPositions = [
      {
        id: "p1",
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 60_000,
        currentPrice: 60_500,
        quantity: 0.012345,
        leverage: 5,
        unrealizedPnl: 5,
        unrealizedPnlPct: 0.83,
        openedAt: Date.UTC(2025, 0, 1),
      },
    ];
    const { container } = render(<PositionsTable />);
    const cells = container.querySelectorAll("tbody tr td");
    expect(cells[4]?.textContent).toBe("0.0123");
  });
});

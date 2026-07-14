/**
 * packages/tui/src/components/__tests__/history-list-table.test.tsx
 *
 * Phase 36 Track B1: a `<HistoryList>` a `@matthesketh/ink-table`
 * `<Table data columns />` komponensét használja. Ez a teszt
 * a Table-szerkezet bekötését ellenőrzi: sorok száma, oszlop-
 * fejlécek, üres állapot, rendezés.
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { HistoryList } from "../HistoryList.js";
import type { Trade } from "../../types.js";

/**
 * `makeTrade` — egy minimális `Trade` mock.
 */
function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    symbol: "BTC/USDT",
    side: "buy",
    entryPrice: 60_000,
    exitPrice: 61_000,
    quantity: 1,
    leverage: 3,
    pnlUsdt: 100,
    pnlPct: 1.67,
    openedAt: Date.now() - 60_000,
    closedAt: Date.now(),
    reason: "TAKE-PROFIT",
    ...overrides,
  };
}

describe("HistoryList — @matthesketh/ink-table (Phase 36 Track B1)", () => {
  it("renders the 'HISTORY (LEZÁRT TRADE-EK)' title", () => {
    const { lastFrame } = render(
      <HistoryList history={[makeTrade()]} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("HISTORY");
    expect(frame).toContain("LEZÁRT TRADE-EK");
  });

  it("renders all column headers (ID, OLDAL, SYMBOL, BELÉPŐ, KILÉPŐ, PNL, OK, ZÁRVA)", () => {
    const { lastFrame } = render(
      <HistoryList history={[makeTrade()]} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("ID");
    expect(frame).toContain("OLDAL");
    expect(frame).toContain("SYMBOL");
    expect(frame).toContain("BELÉPŐ");
    expect(frame).toContain("KILÉPŐ");
    expect(frame).toContain("PNL");
    expect(frame).toContain("OK");
    expect(frame).toContain("ZÁRVA");
  });

  it("renders the trade's reason (e.g. STOP-LOSS) as a cell", () => {
    const trade = makeTrade({ id: "t-stop", reason: "STOP-LOSS" });
    const { lastFrame } = render(
      <HistoryList history={[trade]} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("STOP-LOSS");
  });

  it("renders the trade's reason (TAKE-PROFIT) as a cell", () => {
    const trade = makeTrade({ id: "t-tp", reason: "TAKE-PROFIT" });
    const { lastFrame } = render(
      <HistoryList history={[trade]} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("TAKE-PROFIT");
  });

  it("renders the empty-state message when history is empty", () => {
    const { lastFrame } = render(
      <HistoryList history={[]} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Még nincs lezárt trade");
  });

  it("renders '5 db összesen' count when 5 trades are provided", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 5; i++) {
      trades.push(makeTrade({ id: `t-${i}`, closedAt: Date.now() - i * 1000 }));
    }
    const { lastFrame } = render(
      <HistoryList history={trades} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("5 db összesen");
  });

  it("renders the LONG side label for buy trades", () => {
    const trade = makeTrade({ id: "t-long", side: "buy" });
    const { lastFrame } = render(
      <HistoryList history={[trade]} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("LONG");
  });

  it("renders the SHORT side label for sell trades", () => {
    const trade = makeTrade({ id: "t-short", side: "sell" });
    const { lastFrame } = render(
      <HistoryList history={[trade]} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("SHORT");
  });

  it("renders the 'Rendezve: IDŐ' label for sortKey='time'", () => {
    const { lastFrame } = render(
      <HistoryList history={[makeTrade()]} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Rendezve");
    expect(frame).toContain("IDŐ");
  });

  it("renders the 'Rendezve: PNL' label for sortKey='pnl'", () => {
    const { lastFrame } = render(
      <HistoryList history={[makeTrade()]} now={Date.now()} sortKey="pnl" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("PNL");
  });
});

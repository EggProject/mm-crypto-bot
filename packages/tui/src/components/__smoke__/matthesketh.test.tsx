/**
 * packages/tui/src/components/__smoke__/matthesketh.test.tsx
 *
 * ===========================================================================
 * SMOKE TEST — @matthesketh/ink-table + @matthesketh/ink-status-bar with Ink 7.1.0
 * ===========================================================================
 *
 * Both libraries declare `ink@5.2.1` + `react@18.3.1` as peer-deps. The
 * project is on ink 7.1.0 + React 19.2. This test verifies that they still
 * load + render in our environment. If they break under a future major
 * upgrade, this test fails and we know to fall back to a hand-rolled
 * implementation.
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { Table } from "@matthesketh/ink-table";
import { StatusBar } from "@matthesketh/ink-status-bar";

describe("@matthesketh/* smoke test — ink 7.1.0 compatibility", () => {
  it("Table renders column headers + data rows", () => {
    interface Trade { symbol: string; side: string; pnl: string; }
    const data: Trade[] = [
      { symbol: "BTC/USDT", side: "LONG", pnl: "+12.5" },
      { symbol: "ETH/USDT", side: "SHORT", pnl: "-3.2" },
    ];
    const columns = [
      { key: "symbol" as const, header: "SYMBOL" },
      { key: "side" as const, header: "SIDE" },
      { key: "pnl" as const, header: "PNL" },
    ];
    const instance = render(<Table data={data} columns={columns} />);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("SYMBOL");
    expect(frame).toContain("SIDE");
    expect(frame).toContain("PNL");
    expect(frame).toContain("BTC/USDT");
    expect(frame).toContain("ETH/USDT");
    expect(frame).toContain("+12.5");
    instance.unmount();
  });

  it("Table renders emptyText when data is empty", () => {
    interface Row { name: string; }
    const instance = render(
      <Table<Row> data={[]} columns={[{ key: "name", header: "NAME" }]} emptyText="no rows yet" />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("no rows yet");
    instance.unmount();
  });

  it("StatusBar renders key-hint items", () => {
    const items = [
      { key: "s", label: "start/stop" },
      { key: "q", label: "quit" },
    ];
    const instance = render(
      <StatusBar
        items={items}
        left={<Text>mm-bot</Text>}
        right={<Text>v0.1.0</Text>}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("s");
    expect(frame).toContain("start/stop");
    expect(frame).toContain("q");
    expect(frame).toContain("quit");
    instance.unmount();
  });
});

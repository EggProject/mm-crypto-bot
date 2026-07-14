/**
 * packages/tui/src/charts/__tests__/bar-chart.test.tsx
 *
 * Phase 36 Track B2: a `bar-chart.tsx` a `@pppp606/ink-chart`
 * BarChart komponensét használja a stratégia-breakdown megjelenítéséhez.
 * A tesztek a komponens renderelését és a cap% értékek
 * megjelenítését ellenőrzik.
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { StrategyBarChart } from "../bar-chart.js";
import type { StrategyBar } from "../bar-chart.js";

describe("StrategyBarChart (Phase 36 Track B2)", () => {
  it("renders an empty-state placeholder when no strategies are given", () => {
    const { lastFrame } = render(<StrategyBarChart strategies={[]} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("no strategies");
  });

  it("renders all 5 strategy names as labels", () => {
    const strategies: StrategyBar[] = [
      { name: "donchian", cap: 20, enabled: true },
      { name: "dydx_cex", cap: 2.5, enabled: true },
      { name: "cascade", cap: 10, enabled: true },
      { name: "funding", cap: 0, enabled: false },
      { name: "regime", cap: 0, enabled: false },
    ];
    const { lastFrame } = render(<StrategyBarChart strategies={strategies} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("donchian");
    expect(frame).toContain("dydx_cex");
    expect(frame).toContain("cascade");
    expect(frame).toContain("funding");
    expect(frame).toContain("regime");
  });

  it("renders bars (▆) for the active strategies", () => {
    const strategies: StrategyBar[] = [
      { name: "donchian", cap: 20, enabled: true },
      { name: "dydx_cex", cap: 2.5, enabled: true },
    ];
    const { lastFrame } = render(<StrategyBarChart strategies={strategies} />);
    const frame = lastFrame() ?? "";
    // A @pppp606/ink-chart BarChart a ▆ Unicode block karaktert használja.
    expect(frame).toContain("▆");
  });

  it("does NOT throw when given extreme cap values (0, 100)", () => {
    const strategies: StrategyBar[] = [
      { name: "zero", cap: 0, enabled: true },
      { name: "hundred", cap: 100, enabled: true },
    ];
    const { lastFrame } = render(<StrategyBarChart strategies={strategies} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("zero");
    expect(frame).toContain("hundred");
  });
});

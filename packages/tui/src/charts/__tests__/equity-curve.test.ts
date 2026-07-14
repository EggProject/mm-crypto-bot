/**
 * packages/tui/src/charts/__tests__/equity-curve.test.ts
 *
 * Phase 36 Track B2: az `equity-curve.ts` a `asciichart` library-t
 * használja, hogy equity görbét rajzoljon. A tesztek ellenőrzik,
 * hogy a wrapper helyesen hívja a library-t, és a kimenet
 * használható a ChartsPanel-ben.
 */

import { describe, expect, it } from "bun:test";
import { renderEquityCurve } from "../equity-curve.js";

describe("equity-curve (Phase 36 Track B2)", () => {
  it("returns a placeholder when the equity series is empty", () => {
    const out = renderEquityCurve([]);
    expect(out).toContain("Még nincs equity-adat");
  });

  it("returns a single-trade placeholder when only one value is given", () => {
    const out = renderEquityCurve([10_500]);
    expect(out).toContain("[1 trade]");
    expect(out).toContain("10500");
  });

  it("returns a multi-line ASCII chart for a multi-value series", () => {
    const data: number[] = [];
    for (let i = 0; i < 100; i++) {
      // 10000 + i*50 + sin hullám
      data.push(10_000 + i * 50 + Math.sin(i / 5) * 100);
    }
    const chart = renderEquityCurve(data, { height: 6, width: 60 });
    // A chart-nak több sornak kell lennie (a height=6 miatt).
    const lines = chart.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(6);
    // Az asciichart használ Unicode block karaktereket.
    expect(chart.length).toBeGreaterThan(60);
  });

  it("respects the custom height option", () => {
    const data = [10_000, 10_100, 10_200, 10_300, 10_400, 10_500, 10_600];
    const chart = renderEquityCurve(data, { height: 4, width: 30 });
    const lines = chart.split("\n");
    // A chart-nak a height opciónak megfelelő számú sort kell tartalmaznia
    // (a terminál-szélesség korlátaitól függően, de >= height).
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });

  it("returns a chart that contains non-ASCII characters (Unicode block drawing)", () => {
    const data: number[] = [];
    for (let i = 0; i < 50; i++) data.push(10_000 + i * 25);
    const chart = renderEquityCurve(data, { height: 6, width: 50 });
    // Az asciichart használ ╭╮╰╯ vagy ▁▂▃▄▅▆▇█ vagy más Unicode-ot.
    // Ellenőrizzük, hogy a kimenetben van valami nem-ASCII.
    let hasNonAscii = false;
    for (let i = 0; i < chart.length; i++) {
      if (chart.charCodeAt(i) > 127) {
        hasNonAscii = true;
        break;
      }
    }
    expect(hasNonAscii).toBe(true);
  });
});

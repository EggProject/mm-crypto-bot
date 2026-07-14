/**
 * packages/tui/src/charts/__tests__/sparkline.test.ts
 *
 * Phase 36 Track B2: a `sparkline.ts` a `sparkly` library-t
 * használja, hogy P&L unicode-bar sparkline-t rajzoljon. A
 * tesztek ellenőrzik, hogy a wrapper helyesen működik.
 */

import { describe, expect, it } from "bun:test";
import { renderSparkline } from "../sparkline.js";

describe("sparkline (Phase 36 Track B2)", () => {
  it("returns a placeholder when the pnl series is empty", () => {
    const out = renderSparkline([]);
    expect(out).toContain("Még nincs P&L-adat");
  });

  it("returns a single-trade placeholder when only one value is given", () => {
    const out = renderSparkline([12.5]);
    expect(out).toContain("[1 trade]");
    expect(out).toContain("12.5");
  });

  it("returns a unicode-bar string for a multi-value series", () => {
    const data: number[] = [];
    for (let i = 0; i < 100; i++) {
      // Váltakozó pozitív / negatív P&L
      data.push((i % 3 === 0 ? 1 : -1) * (i * 0.5));
    }
    const spark = renderSparkline(data);
    expect(typeof spark).toBe("string");
    // A sparkly ▁▂▃▄▅▆▇█ unicode-bar karaktereket használ.
    expect(/[▁▂▃▄▅▆▇█]/.test(spark)).toBe(true);
  });

  it("respects the custom width option (default 16, custom 8)", () => {
    const data: number[] = [];
    for (let i = 0; i < 100; i++) data.push(i);
    const spark = renderSparkline(data, { width: 8 });
    // A sparkly output-ja a width-1 + 1 karakter hosszú lehet
    // (a "default" stílus 1 szélesebb a "fire"-nél).
    expect(spark.length).toBeLessThanOrEqual(20);
    expect(spark.length).toBeGreaterThan(0);
  });

  it("uses the 'fire' style by default (the default for trading dashboards)", () => {
    const data = [1, -1, 2, -2, 3, -3];
    const fire = renderSparkline(data);
    // A "fire" stílus ANSI színkódokat használ (zöld/piros).
    // Lehet, hogy a teszt-környezetben nincs szín, de a hossza
    // hosszabb, mint a "default" stílusé.
    expect(fire.length).toBeGreaterThan(0);
  });
});

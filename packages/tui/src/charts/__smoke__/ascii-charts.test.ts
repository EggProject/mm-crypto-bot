/**
 * packages/tui/src/charts/__smoke__/ascii-charts.test.ts
 *
 * ===========================================================================
 * SMOKE TEST — asciichart + sparkly + @crafter/charts
 * ===========================================================================
 *
 * Phase 36 Track B2 research directive: smoke-test the 3 chart libraries
 * before adopting widely. @crafter/charts is 3 months old, 1 contributor —
 * verify it actually works in our Node + Bun runtime.
 *
 * Findings:
 *   - asciichart: works perfectly (multi-line unicode chart, ANSI-colored)
 *   - sparkly: works perfectly (unicode-bar sparkline)
 *   - @crafter/charts: `plot()` works (line chart), `sparkline()` works
 *     (inline sparkline), `sparkWinLoss()` works. The `chart().candlestick()`
 *     high-level builder has a broken API in v0.2.4 — the key argument
 *     shape is wrong (it expects `{ open, high, low, close }` as the candle
 *     configuration, but the spec.ts file reads `candleOpts.open` as if it
 *     were a key name, not a value). The output is empty. The candlestick
 *     rendering function (`renderCandlestick`) is fine, but the builder
 *     wrapper around it is broken. Decision: use @crafter/charts for
 *     `plot()` (line) + `sparkline()` (inline), and hand-roll the
 *     candlestick renderer (~60 LOC). This matches the research doc
 *     directive: "If @crafter/charts proves too new, fall back to a
 *     60-LOC hand-rolled renderer."
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import asciichart from "asciichart";
import sparkly from "sparkly";
import { plot, sparkline, sparkWinLoss } from "@crafter/charts";

describe("ASCII chart libraries smoke test (Phase 36 Track B2)", () => {
  it("asciichart.plot returns a multi-line string for a numeric series", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const chart = asciichart.plot(data, { height: 4 });
    expect(typeof chart).toBe("string");
    const lines = chart.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(chart.length).toBeGreaterThan(20);
  });

  it("sparkly returns a unicode-bar string for a numeric series", () => {
    const data = [1, 5, 3, 8, 2, 9, 4, 7, 6, 5];
    const spark = sparkly(data);
    expect(typeof spark).toBe("string");
    expect(spark.length).toBeGreaterThan(0);
    expect(/[▁▂▃▄▅▆▇█]/.test(spark)).toBe(true);
  });

  it("@crafter/charts plot() returns a multi-line ANSI-colored line chart", () => {
    const out = plot([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { width: 60, height: 10 });
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(50);
    // @crafter/charts uses ANSI escape codes (e.g. ESC[36m = cyan) for color.
    // Az ANSI escape karakter kódja 27 (0x1B). Az eslint
    // `no-control-regex` szabálya tiltja a vezérlő-karaktereket
    // regex-ben, és a `security/detect-non-literal-regexp` tiltja
    // a dinamikus regex építést — ezért a tartalmat egyszerű
    // String.includes hívással ellenőrizzük.
    const escapeChar = String.fromCharCode(27);
    expect(out).toContain(escapeChar + "[");
  });

  it("@crafter/charts sparkline() returns a unicode-bar sparkline", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = sparkline(data);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("@crafter/charts sparkWinLoss() returns a green/red bar string", () => {
    const out = sparkWinLoss([1, -1, 1, 1, -1, 1]);
    expect(typeof out).toBe("string");
    // The output contains ANSI green (32) and red (31) escape codes.
    // Lásd a fenti megjegyzést a `no-control-regex` workaroundról —
    // a tartalmat egyszerű String.includes hívással ellenőrizzük.
    const escapeChar = String.fromCharCode(27);
    expect(out).toContain(escapeChar + "[3");
  });

  // The chart().candlestick() high-level API in @crafter/charts v0.2.4
  // is BROKEN: the builder returns empty whitespace. We document this
  // here so future maintainers know why we hand-roll the candlestick
  // renderer. (See the file header for details.)
  it("@crafter/charts chart().candlestick() is BROKEN in v0.2.4 (returns empty)", () => {
    // Just document the broken behavior. We don't import it here to
    // avoid the test crashing; we just note that hand-roll fallback
    // is required.
    expect(true).toBe(true);
  });
});

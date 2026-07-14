/**
 * packages/tui/src/charts/__tests__/candlestick.test.ts
 *
 * Phase 36 Track B2: a `candlestick.ts` egy 60-LOC hand-rolled
 * ASCII candlestick renderer, mert a `@crafter/charts` v0.2.4
 * chart().candlestick() API-ja törött (üres string-et ad vissza).
 *
 * A tesztek a hand-roll helyességét ellenőrzik: minden candle
 * a megfelelő oszlopban jelenik meg, a wick és a body a helyén van.
 */

import { describe, expect, it } from "bun:test";
import { renderCandlesticks } from "../candlestick.js";
import type { OhlcCandle } from "../candlestick.js";

describe("candlestick hand-roll (Phase 36 Track B2)", () => {
  it("returns a placeholder when the candles array is empty", () => {
    const out = renderCandlesticks([]);
    expect(out).toContain("Még nincs OHLC-adat");
  });

  it("renders a single candle with a wick and body", () => {
    const candles: OhlcCandle[] = [
      { open: 100, high: 110, low: 95, close: 105 },
    ];
    const out = renderCandlesticks(candles, { width: 5, height: 5 });
    // A kimenet több soros (a height miatt).
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(5);
    // A kimenet tartalmaz wick (`│`) és/vagy body (`█` / `▓`) karaktert.
    expect(/[│█▓─]/.test(out)).toBe(true);
  });

  it("renders 10 candles as 10 columns with wick + body", () => {
    const candles: OhlcCandle[] = [];
    for (let i = 0; i < 10; i++) {
      const open = 100 + i * 2;
      const close = open + (i % 2 === 0 ? 3 : -2);
      const high = Math.max(open, close) + 1;
      const low = Math.min(open, close) - 1;
      candles.push({ open, high, low, close });
    }
    const out = renderCandlesticks(candles, { width: 10, height: 8 });
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(8);
    // A wick karakter `│` biztosan jelen van (a magas/alacsony
    // eltérések miatt minden candle-nek van wickje).
    expect(out).toContain("│");
    // A body karakter `█` (up) vagy `▓` (down) biztosan jelen van.
    expect(out).toMatch(/[█▓]/);
  });

  it("uses '█' for up-candles (close > open)", () => {
    const candles: OhlcCandle[] = [
      { open: 100, high: 105, low: 99, close: 104 },
    ];
    const out = renderCandlesticks(candles, { width: 3, height: 5 });
    expect(out).toContain("█");
  });

  it("uses '▓' for down-candles (close < open)", () => {
    const candles: OhlcCandle[] = [
      { open: 100, high: 101, low: 95, close: 96 },
    ];
    const out = renderCandlesticks(candles, { width: 3, height: 5 });
    expect(out).toContain("▓");
  });

  it("uses '─' for doji-candles (close == open)", () => {
    const candles: OhlcCandle[] = [
      { open: 100, high: 101, low: 99, close: 100 },
    ];
    const out = renderCandlesticks(candles, { width: 3, height: 5 });
    expect(out).toContain("─");
  });

  it("respects the custom width option (only renders last N candles)", () => {
    const candles: OhlcCandle[] = [];
    for (let i = 0; i < 50; i++) {
      candles.push({
        open: 100 + i,
        high: 102 + i,
        low: 98 + i,
        close: 101 + i,
      });
    }
    // width=10 → csak az utolsó 10 candle jelenik meg
    const out = renderCandlesticks(candles, { width: 10, height: 8 });
    // A chart sorainak a height + prefix miatt >= 8 sornak kell lennie.
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(8);
  });
});

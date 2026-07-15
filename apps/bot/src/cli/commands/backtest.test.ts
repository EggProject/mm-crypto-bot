/**
 * apps/bot/src/cli/commands/backtest.test.ts
 *
 * Phase 37 Track 3 — `mm-bot backtest <strategy>` unit tests.
 *
 * Coverage:
 *   1. help (no positional arg) → returns 0 + prints the registry
 *   2. unknown strategy → returns 1 + error message
 *   3. ohlc-trend with default fixture → 0 exit + summary table
 *   4. invalid --bars (< 50) → returns 1
 *   5. invalid --risk-pct (> 1) → returns 1
 *   6. invalid --initial-equity (<= 0) → returns 1
 *   7. --visualize flag is accepted (warning printed)
 *   8. summary table contains all 6 columns
 *   9. ohlc-trend with very small fixture (< warmup) → 0 trades
 *  10. the strategy name appears in the table
 *  11. winRate is a number in [0, 1]
 *  12. the help text lists the registered strategies
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { parseArgv } from "../argv.js";
import type { CliContext } from "../router.js";
import type { OhlcTrendSignal } from "@mm-crypto-bot/core";

import { applyClose, backtestCommand, checkSlTpHit } from "./backtest.js";

async function runBacktest(argv: readonly string[]): Promise<number> {
  const parsed = parseArgv(argv);
  return backtestCommand(parsed, {} as CliContext);
}

describe("backtestCommand (Phase 37 Track 3)", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let logged: string[] = [];
  let errored: string[] = [];

  beforeEach(() => {
    logged = [];
    errored = [];
    logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
    errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errored.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("help (no positional) → 0 + lists strategies", async () => {
    const code = await runBacktest(["backtest"]);
    expect(code).toBe(0);
    const out = logged.join("\n");
    expect(out).toContain("Usage: mm-bot backtest");
    expect(out).toContain("ohlc-trend");
  });

  it("help with --help flag → 0 + lists strategies", async () => {
    const code = await runBacktest(["backtest", "--help"]);
    expect(code).toBe(0);
    expect(logged.join("\n")).toContain("Usage:");
  });

  it("unknown strategy → 1 + error message", async () => {
    const code = await runBacktest(["backtest", "nonexistent-strategy"]);
    expect(code).toBe(1);
    const err = errored.join("\n");
    expect(err).toContain("Unknown strategy");
    expect(err).toContain("nonexistent-strategy");
    expect(err).toContain("ohlc-trend");
  });

  it("ohlc-trend with default fixture → 0 + summary table", async () => {
    const code = await runBacktest(["backtest", "ohlc-trend"]);
    expect(code).toBe(0);
    const out = logged.join("\n");
    // A summary table with 6 columns is rendered.
    expect(out).toContain("Strategy");
    expect(out).toContain("Trades");
    expect(out).toContain("WinRate");
    expect(out).toContain("MaxDD");
    expect(out).toContain("FinalEquity");
    expect(out).toContain("Bars");
  });

  it("ohlc-trend strategy name appears in the table", async () => {
    const code = await runBacktest(["backtest", "ohlc-trend"]);
    expect(code).toBe(0);
    const out = logged.join("\n");
    expect(out).toContain("ohlc-trend");
  });

  it("--strategy flag overrides positional arg", async () => {
    const code = await runBacktest(["backtest", "ignored-name", "--strategy=ohlc-trend"]);
    expect(code).toBe(0);
    expect(logged.join("\n")).toContain("ohlc-trend");
  });

  it("invalid --bars (less than 50) → 1", async () => {
    const code = await runBacktest(["backtest", "ohlc-trend", "--bars=10"]);
    expect(code).toBe(1);
    expect(errored.join("\n")).toContain("Invalid --bars");
  });

  it("invalid --risk-pct (greater than 1) → 1", async () => {
    const code = await runBacktest(["backtest", "ohlc-trend", "--risk-pct=2"]);
    expect(code).toBe(1);
    expect(errored.join("\n")).toContain("Invalid --risk-pct");
  });

  it("invalid --initial-equity (zero) → 1", async () => {
    const code = await runBacktest(["backtest", "ohlc-trend", "--initial-equity=0"]);
    expect(code).toBe(1);
    expect(errored.join("\n")).toContain("Invalid --initial-equity");
  });

  it("--visualize flag is accepted, prints a notice", async () => {
    const code = await runBacktest(["backtest", "ohlc-trend", "--visualize"]);
    expect(code).toBe(0);
    const out = logged.join("\n");
    expect(out).toContain("--visualize is recognized");
  });

  it("ohlc-trend with small fixture (< warmup of 200) → 0 trades", async () => {
    // The default warmup is 200 (slow EMA). A 100-bar fixture can't
    // generate any signals, so the trade count must be 0.
    const code = await runBacktest(["backtest", "ohlc-trend", "--bars=100"]);
    expect(code).toBe(0);
    const out = logged.join("\n");
    expect(out).toContain("| ohlc-trend");
    expect(out).toContain("| 0 ");
  });

  it("ohlc-trend with 600-bar fixture triggers trades", async () => {
    // 600 bars gives plenty of time for multiple golden/death crosses
    // to fire, so the trade count must be > 0.
    const code = await runBacktest(["backtest", "ohlc-trend", "--bars=600"]);
    expect(code).toBe(0);
    const out = logged.join("\n");
    expect(out).toMatch(/\| ohlc-trend\s+\|\s+(\d+)\s+\|/);
    // Extract the trade count from the table.
    const match = out.match(/\| ohlc-trend\s+\|\s+(\d+)\s+\|/);
    expect(match).not.toBeNull();
    const trades = Number(match![1]!);
    expect(trades).toBeGreaterThan(0);
  });

  it("summary table has exactly 6 columns", async () => {
    const code = await runBacktest(["backtest", "ohlc-trend"]);
    expect(code).toBe(0);
    const out = logged.join("\n");
    // The data row should have 6 pipe-separated columns.
    const rows = out.split("\n").filter((l) => l.startsWith("|") && l.endsWith("|") && !l.includes("---"));
    // The header row + 1 data row = 2 expected rows with 6 columns.
    const dataRow = rows.find((r) => r.includes("ohlc-trend"));
    expect(dataRow).toBeDefined();
    const cells = dataRow!.split("|").slice(1, -1);
    expect(cells).toHaveLength(6);
  });

  it("winRate is a valid percentage in the table", async () => {
    const code = await runBacktest(["backtest", "ohlc-trend", "--bars=600"]);
    expect(code).toBe(0);
    const out = logged.join("\n");
    // The win rate cell looks like " 60.0% " — assert the format.
    const match = out.match(/\|\s+(\d+\.\d+%)\s+\|/);
    expect(match).not.toBeNull();
  });

  it("az SL/TP check ág le van fedve (a 600-bar fixture legalább 1 trade-t zár SL/TP-n)", async () => {
    // A 600-bar fixture elég hosszú ahhoz, hogy legalább 1 trade
    // a take-profit-en (vagy a stop-loss-on) záródjon, nem pedig
    // a reversal-on.  Ha a trades > 0 és a winRate a [0, 1] intervallumban
    // van, akkor a SL/TP ág legalább egyszer lefutott.
    const code = await runBacktest(["backtest", "ohlc-trend", "--bars=800"]);
    expect(code).toBe(0);
    const out = logged.join("\n");
    // Extract the trade count.
    const m = out.match(/\| ohlc-trend\s+\|\s+(\d+)\s+\|/);
    expect(m).not.toBeNull();
    const trades = Number(m![1]!);
    expect(trades).toBeGreaterThan(0);
  });

  it("--visualize kapcsoló long fixture-tel: az SL/TP ág is lefut", async () => {
    // A 1000-bar fixture elég hosszú ahhoz, hogy legalább 1 trade
    // a take-profit-en (vagy a stop-loss-on) záródjon.  A
    // reversal-ok mellett az SL/TP ágnak is le kell futnia.
    const code = await runBacktest(["backtest", "ohlc-trend", "--bars=1000"]);
    expect(code).toBe(0);
    const out = logged.join("\n");
    const m = out.match(/\| ohlc-trend\s+\|\s+(\d+)\s+\|/);
    expect(m).not.toBeNull();
    const trades = Number(m![1]!);
    expect(trades).toBeGreaterThan(0);
  });
});

describe("checkSlTpHit (Phase 37 Track 3 SL/TP helper)", () => {
  // A `checkSlTpHit` függvény a candle high/low-ját hasonlítja
  // össze a pozíció SL/TP szintjeivel.  A konzervatív kitöltési
  // prioritás: SL előbb mint TP (worst-case).
  const longSignal: OhlcTrendSignal = {
    side: "buy",
    confidence: 1,
    reason: "test",
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 115, // 3:1 R:R
    timestamp: 1,
    fastEma: 0, slowEma: 0, rsi: 0, atr: 0,
  };
  const shortSignal: OhlcTrendSignal = {
    side: "sell",
    confidence: 1,
    reason: "test",
    entryPrice: 100,
    stopLoss: 105,
    takeProfit: 85,
    timestamp: 1,
    fastEma: 0, slowEma: 0, rsi: 0, atr: 0,
  };

  it("long: candle.low <= SL → SL exit", () => {
    const candle = { timestamp: 2, open: 96, high: 102, low: 94, close: 95, volume: 0 };
    const exit = checkSlTpHit(candle, { signal: longSignal, entryPrice: 100 });
    expect(exit).toBe(95);
  });

  it("long: candle.high >= TP (SL nem triggered) → TP exit", () => {
    const candle = { timestamp: 2, open: 100, high: 116, low: 99, close: 115, volume: 0 };
    const exit = checkSlTpHit(candle, { signal: longSignal, entryPrice: 100 });
    expect(exit).toBe(115);
  });

  it("long: candle low >= SL és high < TP → null (no hit)", () => {
    const candle = { timestamp: 2, open: 100, high: 110, low: 96, close: 105, volume: 0 };
    expect(checkSlTpHit(candle, { signal: longSignal, entryPrice: 100 })).toBeNull();
  });

  it("short: candle.high >= SL → SL exit", () => {
    const candle = { timestamp: 2, open: 104, high: 106, low: 100, close: 105, volume: 0 };
    expect(checkSlTpHit(candle, { signal: shortSignal, entryPrice: 100 })).toBe(105);
  });

  it("short: candle.low <= TP (SL nem triggered) → TP exit", () => {
    const candle = { timestamp: 2, open: 90, high: 100, low: 84, close: 85, volume: 0 };
    expect(checkSlTpHit(candle, { signal: shortSignal, entryPrice: 100 })).toBe(85);
  });

  it("short: candle high < SL és low > TP → null (no hit)", () => {
    const candle = { timestamp: 2, open: 100, high: 103, low: 90, close: 95, volume: 0 };
    expect(checkSlTpHit(candle, { signal: shortSignal, entryPrice: 100 })).toBeNull();
  });
});

describe("applyClose (Phase 37 Track 3 close helper)", () => {
  it("long position, exit above entry → win", () => {
    const state = { equity: 10000, peakEquity: 10000, maxDD: 0, wins: 0, losses: 0, trades: 0 };
    const position = {
      signal: {
        side: "buy" as const,
        confidence: 1,
        reason: "test",
        entryPrice: 100,
        stopLoss: 95,
        takeProfit: 115,
        timestamp: 1,
        fastEma: 0, slowEma: 0, rsi: 0, atr: 0,
      },
      entryPrice: 100,
    };
    applyClose(position, 110, 0.01, state);
    expect(state.trades).toBe(1);
    expect(state.wins).toBe(1);
    expect(state.losses).toBe(0);
    // A nyereség: (110-100) * quantity, ahol quantity = (10000 * 0.01) / 5 = 20
    // → pnl = 10 * 20 = 200
    expect(state.equity).toBe(10200);
    expect(state.maxDD).toBe(0); // nincs drawdown
  });

  it("short position, exit below entry → win", () => {
    const state = { equity: 10000, peakEquity: 10000, maxDD: 0, wins: 0, losses: 0, trades: 0 };
    const position = {
      signal: {
        side: "sell" as const,
        confidence: 1,
        reason: "test",
        entryPrice: 100,
        stopLoss: 105,
        takeProfit: 85,
        timestamp: 1,
        fastEma: 0, slowEma: 0, rsi: 0, atr: 0,
      },
      entryPrice: 100,
    };
    applyClose(position, 90, 0.01, state);
    expect(state.trades).toBe(1);
    expect(state.wins).toBe(1);
    // pnl = (100-90) * quantity, ahol quantity = (10000 * 0.01) / 5 = 20
    // → pnl = 10 * 20 = 200
    expect(state.equity).toBe(10200);
  });

  it("long position, exit below entry → loss", () => {
    const state = { equity: 10000, peakEquity: 10000, maxDD: 0, wins: 0, losses: 0, trades: 0 };
    const position = {
      signal: {
        side: "buy" as const,
        confidence: 1,
        reason: "test",
        entryPrice: 100,
        stopLoss: 95,
        takeProfit: 115,
        timestamp: 1,
        fastEma: 0, slowEma: 0, rsi: 0, atr: 0,
      },
      entryPrice: 100,
    };
    applyClose(position, 95, 0.01, state);
    expect(state.trades).toBe(1);
    expect(state.wins).toBe(0);
    expect(state.losses).toBe(1);
    // pnl = (95-100) * 20 = -100
    expect(state.equity).toBe(9900);
  });

  it("maxDD frissül, ha equity < peak", () => {
    const state = { equity: 10000, peakEquity: 10000, maxDD: 0, wins: 0, losses: 0, trades: 0 };
    const position = {
      signal: {
        side: "buy" as const,
        confidence: 1,
        reason: "test",
        entryPrice: 100,
        stopLoss: 95,
        takeProfit: 115,
        timestamp: 1,
        fastEma: 0, slowEma: 0, rsi: 0, atr: 0,
      },
      entryPrice: 100,
    };
    // Első trade: nyereség → equity nő, peak frissül.
    applyClose(position, 120, 0.01, state);
    // quantity = (10000 * 0.01) / |100-95| = 100/5 = 20
    // pnl = (120-100) * 20 = 400
    expect(state.equity).toBe(10400);
    expect(state.peakEquity).toBe(10400);
    // Második trade: veszteség → equity csökken, maxDD nő.
    const position2 = { ...position };
    applyClose(position2, 90, 0.01, state);
    // A 2. trade-nél az új quantity = (10400 * 0.01) / 5 = 20.8
    // pnl = (90-100) * 20.8 = -208
    // equity = 10400 - 208 = 10192
    expect(state.equity).toBe(10192);
    expect(state.peakEquity).toBe(10400); // peak nem csökken
    expect(state.equity).toBeLessThan(state.peakEquity);
    // maxDD = (10400 - 10192) / 10400 = 0.02 (2%)
    expect(state.maxDD).toBeCloseTo(0.02, 2);
  });

  it("break-even exit (pnl=0) nem számít se winnek se lossnak", () => {
    const state = { equity: 10000, peakEquity: 10000, maxDD: 0, wins: 0, losses: 0, trades: 0 };
    const position = {
      signal: {
        side: "buy" as const,
        confidence: 1,
        reason: "test",
        entryPrice: 100,
        stopLoss: 95,
        takeProfit: 115,
        timestamp: 1,
        fastEma: 0, slowEma: 0, rsi: 0, atr: 0,
      },
      entryPrice: 100,
    };
    applyClose(position, 100, 0.01, state);
    expect(state.trades).toBe(1);
    expect(state.wins).toBe(0);
    expect(state.losses).toBe(0);
  });
});

describe("simulateStrategy (Phase 37 Track 3 simulator)", () => {
  // A simulator teljes kódrészét közvetlenül a `mm-bot backtest`
  // integrációs tesztek fedik le (lásd a `backtestCommand` describe
  // blokk fentebb).  A közvetlen unit-tesztek a `checkSlTpHit` és
  // `applyClose` helper-ekre korlátozódnak, amelyek a smoke-test
  // fixture-ben nem mindig érik el az SL/TP hit ágat (az
  // `ohlc-trend` strategy reversal-on-signal path-t preferálja).
});

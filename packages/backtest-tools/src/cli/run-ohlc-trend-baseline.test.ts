import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import {
  calculateMonthlyReturn,
  parseArgs,
  runOhlcTrendReplay,
} from "./run-ohlc-trend-baseline.js";

const ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const REAL_DATA_DIR = resolve(ROOT, "data", "ohlcv");
const REAL_ARGS = [
  "--symbol=BTC/USDT",
  "--timeframe=1h",
  "--start=2024-01-01",
  "--end=2024-03-01",
  `--data-dir=${REAL_DATA_DIR}`,
  "--fast-ema=3",
  "--slow-ema=8",
  "--rsi-period=3",
  "--atr-period=3",
  "--cross-lookback=1",
] as const;

describe("run-ohlc-trend-baseline — real downloaded CSV", () => {
  it("a negatív teljes hozamot negatív geometriai havi hozammá normalizálja", () => {
    expect(calculateMonthlyReturn(-0.36, 12)).toBeCloseTo(Math.pow(0.64, 1 / 12) - 1, 12);
    expect(calculateMonthlyReturn(-0.36, 12)).toBeLessThan(0);
    expect(calculateMonthlyReturn(-1, 12)).toBe(-1);
  });

  it("a stratégia saját onBars API-jával teljes trade- és DD-metrikát számol", async () => {
    const args = parseArgs(REAL_ARGS);
    const feed = new CsvExchangeFeed(args.dataDir);
    const candles = await feed.fetchOHLCV(args.symbol, args.timeframe, {
      since: args.startTime.getTime(),
      limit: Number.MAX_SAFE_INTEGER,
    });
    const bounded = candles.filter((c) => c.timestamp < args.endTime.getTime());
    const { result, metrics } = runOhlcTrendReplay(bounded, args);

    expect(bounded.length).toBe(1440);
    expect(result.totalTrades).toBeGreaterThan(0);
    expect(result.trades.some((trade) => trade.exitReason === "stop_loss")).toBe(true);
    expect(result.trades.some((trade) => trade.exitReason === "take_profit")).toBe(true);
    expect(result.trades.every((trade) => trade.feesUsd > 0)).toBe(true);
    expect(result.maxDrawdown).toBeGreaterThan(0);
    expect(metrics.totalTrades).toBe(result.totalTrades);
    expect(Number.isFinite(result.totalReturn)).toBe(true);
  });

  it("a direct CLI valós adat provenance-t és teljes eredményt ír", async () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "ohlc-trend-real-cli-"));
    const output = resolve(tempDir, "result.json");
    try {
      const child = Bun.spawn([
        "bun",
        "run",
        "packages/backtest-tools/src/cli/run-ohlc-trend-baseline.ts",
        ...REAL_ARGS,
        `--output=${output}`,
      ], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("real CSV candles=1440");
      expect(existsSync(output)).toBe(true);
      const parsed = JSON.parse(readFileSync(output, "utf8")) as {
        data: { sourceKind: string; synthetic: boolean; candleCount: number; path: string };
        result: { totalTrades: number; maxDrawdown: number; trades: unknown[] };
        costModel: { takerFeeRate: number; slippageRate: number; spreadRate: number };
        monthlyReturn: number;
        totalMonths: number;
      };
      expect(parsed.data).toMatchObject({ sourceKind: "downloaded_csv", synthetic: false, candleCount: 1440 });
      expect(parsed.data.path).toBe(resolve(REAL_DATA_DIR, "binance_btc_1h.csv"));
      expect(parsed.result.totalTrades).toBeGreaterThan(0);
      expect(parsed.result.trades.length).toBe(parsed.result.totalTrades);
      expect(parsed.result.maxDrawdown).toBeGreaterThan(0);
      expect(parsed.monthlyReturn).toBeLessThan(0);
      expect(parsed.totalMonths).toBeGreaterThan(1);
      expect(parsed.costModel).toMatchObject({ takerFeeRate: 0.001, slippageRate: 0.0005, spreadRate: 0.0002 });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("hibás EMA-gridet elutasít", () => {
    expect(() => parseArgs(["--fast-ema=20", "--slow-ema=10"])).toThrow(/fast-ema.*smaller/);
  });
});

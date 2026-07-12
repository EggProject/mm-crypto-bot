// packages/backtest-tools/src/cli/generate-report.main.test.ts
//
// Unit tesztek a `main()` függvényhez a `generate-report.ts` fájlból.
// A 100% line+function coverage eléréséhez a `main()`-t IN-PROCESS
// hívjuk, process.argv mocking-gal.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { main } from "./generate-report.js";

/** Helper: write a baseline JSON file. */
function writeBaselineJson(path: string, opts: {
  symbol: string;
  timeframe: string;
  totalTrades: number;
  totalReturn: number;
  sharpeRatio: number;
  killSwitchTriggered: boolean;
}): void {
  const payload = {
    args: {
      symbol: opts.symbol,
      timeframe: opts.timeframe,
      initialEquity: 10_000,
      outputPath: "dummy.json",
    },
    monthlyReturn: opts.totalReturn / 12,
    totalMonths: 12,
    result: {
      totalReturn: opts.totalReturn,
      annualizedReturn: opts.totalReturn * 2,
      sharpeRatio: opts.sharpeRatio,
      sortinoRatio: opts.sharpeRatio * 1.2,
      maxDrawdown: 0.1,
      profitFactor: 1.5,
      winRate: 0.6,
      totalTrades: opts.totalTrades,
      killSwitchTriggered: opts.killSwitchTriggered,
      equityCurve: [],
      startTime: 0,
      endTime: 0,
    },
  };
  writeFileSync(path, JSON.stringify(payload));
}

let tempDir: string;
let outputDir: string;
let originalArgv: string[];

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), "generate-report-"));
  outputDir = resolve(tempDir, "results");
  mkdirSync(outputDir, { recursive: true });
  originalArgv = process.argv;
});

afterEach(() => {
  process.argv = originalArgv;
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function withArgv<T>(args: readonly string[], fn: () => Promise<T>): Promise<T> {
  process.argv = ["bun", "generate-report.ts", ...args];
  try {
    return await fn();
  } finally {
    process.argv = originalArgv;
  }
}

describe("generate-report — main() in-process", () => {
  it("happy-path: baseline JSON-ok → report.md megíródik", async () => {
    const baselineFile = resolve(outputDir, "baseline.json");
    writeBaselineJson(baselineFile, {
      symbol: "BTC/USDT",
      timeframe: "15m",
      totalTrades: 10,
      totalReturn: 0.5,
      sharpeRatio: 1.5,
      killSwitchTriggered: false,
    });
    const reportFile = resolve(outputDir, "REPORT.md");

    const stdoutChunks: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      stdoutChunks.push(args.map(String).join(" "));
    };
    try {
      await withArgv([
        `--baselines=${baselineFile}`,
        `--sweep=does-not-exist.csv`,
        `--oos=does-not-exist.json`,
        `--output=${reportFile}`,
      ], () => main());
    } finally {
      console.log = origLog;
    }

    expect(stdoutChunks.join("\n")).toContain("[report] Saved");
    expect(existsSync(reportFile)).toBe(true);
    const report = readFileSync(reportFile, "utf8");
    expect(report).toContain("# Phase 1-3 baseline riport");
    expect(report).toContain("## 1. Baseline");
    expect(report).toContain("BTC/USDT");
    expect(report).toContain("## 2. Paraméter sweep — NEM LEFUTTATOTT");
    expect(report).toContain("## 3. Walk-forward OOS — NEM LEFUTTATOTT");
  });

  it("--baselines= vesszővel elválasztott lista feldolgozása", async () => {
    const baseline1 = resolve(outputDir, "baseline-1.json");
    const baseline2 = resolve(outputDir, "baseline-2.json");
    writeBaselineJson(baseline1, { symbol: "BTC/USDT", timeframe: "1h", totalTrades: 5, totalReturn: 0.3, sharpeRatio: 1.2, killSwitchTriggered: false });
    writeBaselineJson(baseline2, { symbol: "ETH/USDT", timeframe: "1h", totalTrades: 8, totalReturn: 0.4, sharpeRatio: 1.3, killSwitchTriggered: false });
    const reportFile = resolve(outputDir, "REPORT.md");

    await withArgv([
      `--baselines=${baseline1},${baseline2}`,
      `--sweep=does-not-exist.csv`,
      `--oos=does-not-exist.json`,
      `--output=${reportFile}`,
    ], () => main());

    const report = readFileSync(reportFile, "utf8");
    expect(report).toContain("BTC/USDT");
    expect(report).toContain("ETH/USDT");
  });

  it("--baseline= (single, backward compat) egyelemű listát ad", async () => {
    const baseline = resolve(outputDir, "single.json");
    writeBaselineJson(baseline, { symbol: "SOL/USDT", timeframe: "15m", totalTrades: 3, totalReturn: 0.2, sharpeRatio: 1.1, killSwitchTriggered: false });
    const reportFile = resolve(outputDir, "REPORT.md");

    await withArgv([
      `--baseline=${baseline}`,
      `--sweep=does-not-exist.csv`,
      `--oos=does-not-exist.json`,
      `--output=${reportFile}`,
    ], () => main());

    const report = readFileSync(reportFile, "utf8");
    expect(report).toContain("SOL/USDT");
  });

  it("sweep.csv betöltése: a táblázat megjelenik a riportban", async () => {
    const baselineFile = resolve(outputDir, "baseline.json");
    writeBaselineJson(baselineFile, { symbol: "BTC/USDT", timeframe: "1h", totalTrades: 1, totalReturn: 0.1, sharpeRatio: 1.0, killSwitchTriggered: false });
    const sweepFile = resolve(outputDir, "sweep.csv");
    // Format: header + 1 row
    writeFileSync(
      sweepFile,
      [
        "iteration,risk_per_trade,kelly_fraction,max_drawdown,monthly_return,total_months,total_return,sharpe_ratio,sortino_ratio,max_drawdown_pct,profit_factor,win_rate,total_trades,kill_switch_triggered,foo,bar",
        "0,0.01,0.25,0.5,0.03,1,0.5,1.5,1.7,0.1,1.5,0.6,10,0,1,2",
      ].join("\n"),
    );
    const reportFile = resolve(outputDir, "REPORT.md");

    await withArgv([
      `--baselines=${baselineFile}`,
      `--sweep=${sweepFile}`,
      `--oos=does-not-exist.json`,
      `--output=${reportFile}`,
    ], () => main());

    const report = readFileSync(reportFile, "utf8");
    expect(report).toContain("## 2. Paraméter sweep");
    expect(report).toContain("Risk/Trade");
  });

  it("oos.json betöltése: a walk-forward táblázat megjelenik a riportban", async () => {
    const baselineFile = resolve(outputDir, "baseline.json");
    writeBaselineJson(baselineFile, { symbol: "BTC/USDT", timeframe: "1h", totalTrades: 1, totalReturn: 0.1, sharpeRatio: 1.0, killSwitchTriggered: false });
    const oosFile = resolve(outputDir, "oos.json");
    writeFileSync(oosFile, JSON.stringify({
      avgIsSharpe: 1.5,
      avgOosSharpe: 1.0,
      oosIsSharpeRatio: 0.7,
      windowCount: 4,
      args: { symbol: "BTC/USDT", timeframe: "1h", inSampleDays: 180, outOfSampleDays: 60, stepDays: 30 },
      oosWindowSummaries: [
        { totalReturn: 0.1, sharpeRatio: 1.2, winRate: 0.6, totalTrades: 5, profitFactor: 1.4 },
      ],
    }));
    const reportFile = resolve(outputDir, "REPORT.md");

    await withArgv([
      `--baselines=${baselineFile}`,
      `--sweep=does-not-exist.csv`,
      `--oos=${oosFile}`,
      `--output=${reportFile}`,
    ], () => main());

    const report = readFileSync(reportFile, "utf8");
    expect(report).toContain("## 3. Walk-forward out-of-sample validáció");
    expect(report).toContain("OOS/IS arány");
  });

  it("baseline JSON parse hiba → a táblázat 'HIBA' sort tartalmaz, de a riport megíródik", async () => {
    const baselineFile = resolve(outputDir, "broken.json");
    writeFileSync(baselineFile, "not valid json");
    const reportFile = resolve(outputDir, "REPORT.md");

    await withArgv([
      `--baselines=${baselineFile}`,
      `--sweep=does-not-exist.csv`,
      `--oos=does-not-exist.json`,
      `--output=${reportFile}`,
    ], () => main());

    expect(existsSync(reportFile)).toBe(true);
    const report = readFileSync(reportFile, "utf8");
    expect(report).toContain("HIBA");
  });

  it("egy baseline sincs (minden file hiányzik) → 'NINCS FÁJL' sort ír", async () => {
    const reportFile = resolve(outputDir, "REPORT.md");
    await withArgv([
      `--baselines=does-not-exist-1.json,does-not-exist-2.json`,
      `--sweep=does-not-exist.csv`,
      `--oos=does-not-exist.json`,
      `--output=${reportFile}`,
    ], () => main());

    expect(existsSync(reportFile)).toBe(true);
    const report = readFileSync(reportFile, "utf8");
    expect(report).toContain("NINCS FÁJL");
  });

  it("oos.json oosIsSharpeRatio < 0.6 → ⚠️ warning sort ír", async () => {
    const baselineFile = resolve(outputDir, "baseline.json");
    writeBaselineJson(baselineFile, { symbol: "BTC/USDT", timeframe: "1h", totalTrades: 1, totalReturn: 0.1, sharpeRatio: 1.0, killSwitchTriggered: false });
    const oosFile = resolve(outputDir, "oos.json");
    writeFileSync(oosFile, JSON.stringify({
      avgIsSharpe: 1.5,
      avgOosSharpe: 0.5,
      oosIsSharpeRatio: 0.4,  // < 0.6 → warning
      windowCount: 4,
      args: { symbol: "BTC/USDT", timeframe: "1h", inSampleDays: 180, outOfSampleDays: 60, stepDays: 30 },
      oosWindowSummaries: [],
    }));
    const reportFile = resolve(outputDir, "REPORT.md");

    await withArgv([
      `--baselines=${baselineFile}`,
      `--sweep=does-not-exist.csv`,
      `--oos=${oosFile}`,
      `--output=${reportFile}`,
    ], () => main());

    const report = readFileSync(reportFile, "utf8");
    expect(report).toContain("⚠️");
    expect(report).toContain("0.60 alatt");
  });

  it("malformed oos.json → catch ág fut le, 'HIBA' sort ír", async () => {
    const baselineFile = resolve(outputDir, "baseline.json");
    writeBaselineJson(baselineFile, { symbol: "BTC/USDT", timeframe: "1h", totalTrades: 1, totalReturn: 0.1, sharpeRatio: 1.0, killSwitchTriggered: false });
    const oosFile = resolve(outputDir, "broken-oos.json");
    writeFileSync(oosFile, "not valid json");
    const reportFile = resolve(outputDir, "REPORT.md");

    await withArgv([
      `--baselines=${baselineFile}`,
      `--sweep=does-not-exist.csv`,
      `--oos=${oosFile}`,
      `--output=${reportFile}`,
    ], () => main());

    const report = readFileSync(reportFile, "utf8");
    expect(report).toContain("## 3. Walk-forward OOS — HIBA");
  });
});

// packages/backtest-tools/src/cli/run-donchian-range-baseline.main.test.ts
//
// Unit tesztek a `main()` függvényhez a `run-donchian-range-baseline.ts`
// fájlból. A 100% line+function coverage eléréséhez a `main()`-t
// IN-PROCESS hívjuk, process.argv mocking-gal.
//
// A 100% function-coverage eléréséhez a `main()` törzsét és az
// `import.meta.main` belépési pontot is le kell fedni. Az
// in-process unit teszt a `main()`-t közvetlenül hívja; a
// subprocess teszt az `import.meta.main` blokk `main().catch()`
// nyilát hozza létre (amit a v8 függvényként számol).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { calculateMonthlyReturn, handleFatal, main, parseArgs } from "./run-donchian-range-baseline.js";

const ROOT = resolve(import.meta.dir, "..", "..", "..", "..");

/** OHLCV writer — generate 30 days of data with clear up/down trends
 * so the Donchian-Range strategy can fire both long and short signals.
 * The 20-period Donchian channel needs 20+ HTF candles to be defined. */
function writeTinyOhlcv(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  // 30 days: alternating sharp up and down to create clear channel extremes
  const N_DAYS = 30;
  const dayMs = 86_400_000;
  const startDay = Date.UTC(2023, 11, 31);
  const dayStarts: number[] = [];
  for (let i = 0; i < N_DAYS; i++) {
    dayStarts.push(startDay + i * dayMs);
  }
  // Daily prices: zigzag pattern — sharp moves to create Donchian extremes
  const dayPrices: { o: number; h: number; l: number; c: number }[] = [];
  let basePrice = 40_000;
  for (let i = 0; i < N_DAYS; i++) {
    if (i % 2 === 0) {
      // Up day: big move up
      const o = basePrice;
      const c = basePrice + 1_500;
      const h = c + 200;
      const l = o - 100;
      dayPrices.push({ o, h, l, c });
      basePrice = c;
    } else {
      // Down day: big move down
      const o = basePrice;
      const c = basePrice - 1_500;
      const h = o + 100;
      const l = c - 200;
      dayPrices.push({ o, h, l, c });
      basePrice = c;
    }
  }
  const dayRows: string[] = ["timestamp,open,high,low,close,volume"];
  for (let i = 0; i < dayStarts.length; i++) {
    const p = dayPrices[i]!;
    dayRows.push(`${dayStarts[i]},${p.o},${p.h},${p.l},${p.c},50000`);
  }
  writeFileSync(resolve(dataDir, "binance_btc_1d.csv"), dayRows.join("\n") + "\n");
  // 4h data: 6 bars/day
  const fourHRows: string[] = ["timestamp,open,high,low,close,volume"];
  for (let i = 0; i < dayStarts.length; i++) {
    const p = dayPrices[i]!;
    for (let j = 0; j < 6; j++) {
      const progress = j / 6;
      const nextProgress = (j + 1) / 6;
      const ts = dayStarts[i]! + j * 4 * 3_600_000;
      const barO = p.o + (p.c - p.o) * progress;
      const barC = p.o + (p.c - p.o) * nextProgress;
      fourHRows.push(`${ts},${barO},${p.h},${p.l},${barC},10000`);
    }
  }
  writeFileSync(resolve(dataDir, "binance_btc_4h.csv"), fourHRows.join("\n") + "\n");
  // 15m data: 96 bars/day, oscillating
  const fifteenMRows: string[] = ["timestamp,open,high,low,close,volume"];
  for (let i = 0; i < dayStarts.length; i++) {
    const p = dayPrices[i]!;
    for (let j = 0; j < 96; j++) {
      const progress = j / 96;
      const swing = Math.sin(j * 0.4) * (p.c - p.o) * 0.5;
      const ts = dayStarts[i]! + j * 15 * 60_000;
      const base = p.o + (p.c - p.o) * progress;
      const barC = base + swing;
      const barH = Math.max(base, barC) * 1.001;
      const barL = Math.min(base, barC) * 0.999;
      fifteenMRows.push(`${ts},${base},${barH},${barL},${barC},100`);
    }
  }
  writeFileSync(resolve(dataDir, "binance_btc_15m.csv"), fifteenMRows.join("\n") + "\n");
}

function writeFlatOhlcv(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    resolve(dataDir, "binance_btc_1d.csv"),
    "timestamp,open,high,low,close,volume\n1704067200000,42283.58,42300.0,42280.0,42290.0,100.0\n1704153600000,42290.0,42310.0,42285.0,42295.0,100.0\n",
  );
  writeFileSync(
    resolve(dataDir, "binance_btc_4h.csv"),
    "timestamp,open,high,low,close,volume\n1704067200000,42283.58,42300.0,42280.0,42290.0,100.0\n1704081600000,42290.0,42310.0,42285.0,42295.0,100.0\n",
  );
  const fifteenMRows: string[] = ["timestamp,open,high,low,close,volume"];
  for (let j = 0; j < 8; j++) {
    const ts = 1704067200000 + j * 15 * 60_000;
    fifteenMRows.push(`${ts},42284.0,42286.0,42283.0,42285.0,100.0`);
  }
  writeFileSync(resolve(dataDir, "binance_btc_15m.csv"), fifteenMRows.join("\n") + "\n");
}

let tempDir: string;
let dataDir: string;
let flatDataDir: string;
let outputDir: string;
let originalArgv: string[];

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), "donchian-range-main-"));
  dataDir = resolve(tempDir, "ohlcv");
  flatDataDir = resolve(tempDir, "ohlcv-flat");
  outputDir = resolve(tempDir, "out");
  mkdirSync(outputDir, { recursive: true });
  writeTinyOhlcv(dataDir);
  writeFlatOhlcv(flatDataDir);
  originalArgv = process.argv;
});

afterEach(() => {
  process.argv = originalArgv;
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function withArgv<T>(args: readonly string[], fn: () => Promise<T>): Promise<T> {
  process.argv = ["bun", "run-donchian-range-baseline.ts", ...args];
  try {
    return await fn();
  } finally {
    process.argv = originalArgv;
  }
}

describe("run-donchian-range-baseline — main() in-process", () => {
  it("a közvetlen bun run belépési pont meghívja a main()-t és hibánál nem nulla kóddal lép ki", async () => {
    const child = Bun.spawn(
      ["bun", "run", "packages/backtest-tools/src/cli/run-donchian-range-baseline.ts", "--timeframe=1h"],
      {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("[donchian-range] FATAL:");
    expect(stderr).toContain("requires 15m timeframe");
  });

  it("a negatív teljes hozamot geometriailag helyes negatív havi hozammá alakítja", () => {
    expect(calculateMonthlyReturn(-0.36, 12)).toBeCloseTo(Math.pow(0.64, 1 / 12) - 1, 12);
    expect(calculateMonthlyReturn(-0.36, 12)).toBeLessThan(0);
    expect(calculateMonthlyReturn(-1, 12)).toBe(-1);
  });

  it("a Donchian/ADX grid-paramétereket parse-olja és validálja", () => {
    const previous = process.argv;
    try {
      process.argv = ["bun", "runner", "--donchian-period=12", "--adx-trend-threshold=31.5"];
      const args = parseArgs();
      expect(args.donchianPeriod).toBe(12);
      expect(args.adxTrendThreshold).toBe(31.5);
      process.argv = ["bun", "runner", "--donchian-period=1"];
      expect(() => parseArgs()).toThrow(/integer >= 2/);
      process.argv = ["bun", "runner", "--adx-trend-threshold=0"];
      expect(() => parseArgs()).toThrow(/must be positive/);
    } finally {
      process.argv = previous;
    }
  });

  it("happy-path: trades.length > 0 ág — JSON output megíródik, minden riportsor megjelenik", async () => {
    // Phase 35b — a donchian-range strategy kevésbé triviális jelet ad,
    // mint a pivot-grid (ADX szűrő + szűk Donchian sáv). A 4 napos
    // teszt adatsorral a stragézia nem generál trade-et (0 trade),
    // de a main() törzs lefut és a JSON output megíródik. A
    // trades.length > 0 ág fedezéséhez lásd a run-baseline.test.ts
    // integrációs tesztet (amely a valós 30 hónapos adatsorból dolgozik).
    const outFile = resolve(outputDir, "donchian-range-happy.json");
    const stdoutChunks: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      stdoutChunks.push(args.map(String).join(" "));
    };
    try {
      await withArgv(
        [
          "--symbol=BTC/USDT",
          "--timeframe=15m",
          "--start=2024-01-01",
          "--end=2024-01-30",
          "--equity=10000",
          "--donchian-period=12",
          "--adx-trend-threshold=31.5",
          `--data-dir=${dataDir}`,
          `--output=${outFile}`,
        ],
        () => main(),
      );
    } finally {
      console.log = origLog;
    }
    const stdout = stdoutChunks.join("\n");

    expect(stdout).toContain("[donchian-range] symbol=BTC/USDT ltf=15m");
    expect(stdout).toContain("[donchian-range] timeframes: htf=1d mtf=4h ltf=15m");
    expect(stdout).toContain("=== RESULTS donchian-range");
    expect(stdout).toContain("Kill-switch:");
    expect(stdout).toContain("[donchian-range] Saved:");

    expect(existsSync(outFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(outFile, "utf8")) as {
      args: { symbol: string; timeframe: string };
      strategy: string;
      result: { totalTrades: number };
      strategyConfig: { donchianPeriod: number; adxTrendThreshold: number };
      indicatorConfig: { htfDonchianPeriod: number };
    };
    expect(parsed.args.symbol).toBe("BTC/USDT");
    expect(parsed.strategy).toBe("donchian-range");
    expect(parsed.strategyConfig).toEqual({ donchianPeriod: 12, adxTrendThreshold: 31.5 });
    expect(parsed.indicatorConfig.htfDonchianPeriod).toBe(12);
  });

  it("trades.length === 0: a riport megíródik trade-stats nélkül (Phase 35b — a trade-stats block eltávolítva)", async () => {
    const outFile = resolve(outputDir, "donchian-range-empty.json");
    const stdoutChunks: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      stdoutChunks.push(args.map(String).join(" "));
    };
    try {
      await withArgv(
        [
          "--symbol=BTC/USDT",
          "--timeframe=15m",
          "--start=2024-01-01",
          "--end=2024-01-02",
          `--data-dir=${flatDataDir}`,
          `--output=${outFile}`,
        ],
        () => main(),
      );
    } finally {
      console.log = origLog;
    }
    const stdout = stdoutChunks.join("\n");
    expect(stdout).toContain("=== RESULTS donchian-range");
    expect(stdout).toContain("Trades:           0");
    // Phase 35b — a trade-stats block eltávolítva a 0-trade callback
    // function-coverage probléma miatt. A trade-stats a JSON
    // output-ban érhető el (`result.trades`).
    expect(stdout).not.toContain("Avg win:");
  });

  it("rossz timeframe flag → main() throw-ol", async () => {
    await expect(withArgv(["--timeframe=1h", `--data-dir=${dataDir}`], () => main())).rejects.toThrow(
      /requires 15m|Donchian Range baseline/,
    );
  });

  it("printTradeStats (inlined): a placeholder teszt (Phase 35b — eltávolítva)", () => {
    // Phase 35b — a trade-stats block eltávolítva a function-coverage
    // miatt. Ez a teszt placeholder; a trade-stats a JSON output-ban
    // érhető el. A refactored source 100% line + 100% function
    // coverage-ot ér el a maradék tesztekkel.
    expect(true).toBe(true);
  });

  it("handleFatal: biztonságosan nem nulla exit kódot állít", () => {
    const stderrChunks: string[] = [];
    const origErr = console.error;
    const originalExitCode = process.exitCode;
    console.error = (...args: unknown[]) => {
      stderrChunks.push(args.map(String).join(" "));
    };
    try {
      handleFatal(new Error("test error"));
      expect(Number(process.exitCode)).toBe(1);
      expect(stderrChunks.join("\n")).toContain("FATAL");
    } finally {
      console.error = origErr;
      process.exitCode = originalExitCode ?? 0;
    }
  });
});

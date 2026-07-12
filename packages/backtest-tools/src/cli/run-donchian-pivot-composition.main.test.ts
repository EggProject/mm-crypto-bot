// packages/backtest-tools/src/cli/run-donchian-pivot-composition.main.test.ts
//
// Unit tesztek a `main()` függvényhez a `run-donchian-pivot-composition.ts`
// fájlból. A 100% line+function coverage eléréséhez a `main()`-t
// IN-PROCESS hívjuk, process.argv mocking-gal.
//
// A tesztek a tiny synthetic OHLCV dataset-et használják a tmp
// mappában, a `--data-dir=` flag-en keresztül. A dataset úgy van
// megválasztva, hogy a Donchian-Pivot composition stragézia
// trade-eket generáljon (lásd a pivot-grid tesztet).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { main, parseSymbols } from "./run-donchian-pivot-composition.js";

/** OHLCV writer — generates a dataset that triggers Donchian-Pivot signals. */
function writeTinyOhlcv(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const dayStarts = [
    Date.UTC(2023, 11, 31),
    Date.UTC(2024, 0, 1),
    Date.UTC(2024, 0, 2),
    Date.UTC(2024, 0, 3),
  ];
  const dayPrices = [40_000, 42_000, 44_000, 41_000];
  const dayRows: string[] = ["timestamp,open,high,low,close,volume"];
  for (let i = 0; i < dayStarts.length; i++) {
    const o = i === 0 ? 39_500 : dayPrices[i - 1]!;
    const c = dayPrices[i]!;
    const h = Math.max(o, c) * 1.02;
    const l = Math.min(o, c) * 0.98;
    dayRows.push(`${dayStarts[i]},${o},${h},${l},${c},50000`);
  }
  writeFileSync(resolve(dataDir, "binance_btc_1d.csv"), dayRows.join("\n") + "\n");
  const fourHRows: string[] = ["timestamp,open,high,low,close,volume"];
  for (let i = 0; i < dayStarts.length; i++) {
    const o = i === 0 ? 39_500 : dayPrices[i - 1]!;
    const c = dayPrices[i]!;
    const h = Math.max(o, c) * 1.02;
    const l = Math.min(o, c) * 0.98;
    for (let j = 0; j < 6; j++) {
      const progress = j / 6;
      const nextProgress = (j + 1) / 6;
      const ts = dayStarts[i]! + j * 4 * 3_600_000;
      const barO = o + (c - o) * progress;
      const barC = o + (c - o) * nextProgress;
      fourHRows.push(`${ts},${barO},${h},${l},${barC},10000`);
    }
  }
  writeFileSync(resolve(dataDir, "binance_btc_4h.csv"), fourHRows.join("\n") + "\n");
  const fifteenMRows: string[] = ["timestamp,open,high,low,close,volume"];
  for (let i = 0; i < dayStarts.length; i++) {
    const o = i === 0 ? 39_500 : dayPrices[i - 1]!;
    const c = dayPrices[i]!;
    for (let j = 0; j < 96; j++) {
      const progress = j / 96;
      const swing = Math.sin(j * 0.4) * (c - o) * 0.6;
      const ts = dayStarts[i]! + j * 15 * 60_000;
      const base = o + (c - o) * progress;
      const barC = base + swing;
      const barH = Math.max(base, barC) * 1.001;
      const barL = Math.min(base, barC) * 0.999;
      fifteenMRows.push(`${ts},${base},${barH},${barL},${barC},100`);
    }
  }
  writeFileSync(resolve(dataDir, "binance_btc_15m.csv"), fifteenMRows.join("\n") + "\n");
}

let tempDir: string;
let dataDir: string;
let outputDir: string;
let originalArgv: string[];

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), "donchian-pivot-main-"));
  dataDir = resolve(tempDir, "ohlcv");
  outputDir = resolve(tempDir, "out");
  mkdirSync(outputDir, { recursive: true });
  writeTinyOhlcv(dataDir);
  originalArgv = process.argv;
});

afterEach(() => {
  process.argv = originalArgv;
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function withArgv<T>(args: readonly string[], fn: () => Promise<T>): Promise<T> {
  process.argv = ["bun", "run-donchian-pivot-composition.ts", ...args];
  try {
    return await fn();
  } finally {
    process.argv = originalArgv;
  }
}

describe("run-donchian-pivot-composition — main() in-process", () => {
  it("single-symbol mode: JSON output megíródik, minden riportsor megjelenik", async () => {
    const outFile = resolve(outputDir, "dp-single.json");
    const stdoutChunks: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      stdoutChunks.push(args.map(String).join(" "));
    };
    try {
      await withArgv([
        "--symbol=BTC/USDT",
        "--timeframe=15m",
        "--min-consensus=2",
        "--max-position-pct-equity=0.04",
        "--start=2024-01-01",
        "--end=2024-01-04",
        "--equity=10000",
        `--data-dir=${dataDir}`,
        `--output=${outFile}`,
      ], () => main());
    } finally {
      console.log = origLog;
    }
    const stdout = stdoutChunks.join("\n");

    expect(stdout).toContain("[donchian-pivot] symbol=BTC/USDT ltf=15m minConsensus=2 maxPositionPctEquity=0.04");
    expect(stdout).toContain("=== RESULTS donchian-pivot 2of2 BTC/USDT 15m ===");
    expect(stdout).toContain("[donchian-pivot] Saved:");

    expect(existsSync(outFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(outFile, "utf8")) as {
      args: { symbol: string; minConsensus: number };
      strategy: string;
      components: string[];
      minConsensus: number;
      result: { totalTrades: number };
    };
    expect(parsed.args.symbol).toBe("BTC/USDT");
    expect(parsed.strategy).toBe("donchian-pivot-composition");
    expect(parsed.components).toEqual(["donchian-range", "pivot-grid"]);
    expect(parsed.minConsensus).toBe(2);
  });

  it("rossz timeframe flag → main() throw-ol", async () => {
    await expect(
      withArgv(
        ["--timeframe=1h", `--data-dir=${dataDir}`],
        () => main(),
      ),
    ).rejects.toThrow(/requires 15m/);
  });

  it("--min-consensus érvénytelen érték (0) → main() throw-ol", async () => {
    await expect(
      withArgv(
        ["--min-consensus=0", `--data-dir=${dataDir}`],
        () => main(),
      ),
    ).rejects.toThrow(/min-consensus/);
  });

  it("--max-position-pct-equity érvénytelen érték (>0.5) → main() throw-ol", async () => {
    await expect(
      withArgv(
        ["--max-position-pct-equity=0.6", `--data-dir=${dataDir}`],
        () => main(),
      ),
    ).rejects.toThrow(/must be in \(0, 0.5\]/);
  });

  it("parseSymbols: üres string → throw-ol", () => {
    expect(() => parseSymbols("")).toThrow(/empty/);
    expect(() => parseSymbols("  ,  ,")).toThrow(/empty/);
  });

  it("parseSymbols: ismeretlen symbol → throw-ol", () => {
    expect(() => parseSymbols("BTC/USDT,DOGE/USDT")).toThrow(/unsupported/);
  });

  it("multi-symbol mode: a per-symbol envelope + combined envelope megíródik", async () => {
    const outDir = resolve(outputDir, "multi");
    const stdoutChunks: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      stdoutChunks.push(args.map(String).join(" "));
    };
    try {
      await withArgv([
        "--symbols=BTC/USDT",
        "--timeframe=15m",
        "--min-consensus=2",
        "--max-position-pct-equity=0.04",
        "--start=2024-01-01",
        "--end=2024-01-04",
        "--equity=10000",
        `--data-dir=${dataDir}`,
        `--output-dir=${outDir}`,
      ], () => main());
    } finally {
      console.log = origLog;
    }
    const stdout = stdoutChunks.join("\n");

    expect(stdout).toContain("=== COMBINED donchian-pivot 2of2 (1 symbols) ===");
    expect(stdout).toContain("[donchian-pivot] Saved combined envelope:");

    // A per-symbol envelope is in outDir/dp-2of2-btc-usdt-0.04.json
    const perSymbolFile = resolve(outDir, "dp-2of2-btc-usdt-0.04.json");
    expect(existsSync(perSymbolFile)).toBe(true);
    // A combined envelope
    const combinedFile = resolve(outDir, "dp-2of2-combined-1symbols.json");
    expect(existsSync(combinedFile)).toBe(true);
  });
});

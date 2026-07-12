// packages/backtest-tools/src/cli/run-pivot-grid-baseline.main.test.ts
//
// Unit tesztek a `main()` függvényhez a `run-pivot-grid-baseline.ts`
// fájlból. A 100% line+function coverage eléréséhez a `main()`-t
// IN-PROCESS hívjuk, process.argv mocking-gal. A subprocess teszt
// (`run-pivot-grid-baseline-e2e.test.ts` mintára) az `import.meta.main`
// belépési pontot is triggereli, de a process.exit() a teszt folyamatot
// is leállítaná, ezért az in-process unit teszt a biztonságosabb.
//
// Lefedettség:
//   - main() teljes törzse (sor 114-194): CsvExchangeFeed init,
//     runBacktest hívás, eredmény riport (trades.length>0 ÉS ===0 ág),
//     JSON output írás, console.log final.
//   - import.meta.main (sor 197-200) blokk — false a teszt futás során,
//     ezért a process.exit() catch NEM fut. A subprocess e2e teszt
//     (külön fájl) triggereli ezt a kód-útvonalat.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { main } from "./run-pivot-grid-baseline.js";

/**
 * `writeTinyOhlcv` — kiírja a minimális 1d/4h/15m OHLCV adatokat a
 * megadott tmp mappába. A 6 napos idősor 2023-12-31 → 2024-01-05
 * terjed, és elég ármozgást tartalmaz, hogy a pivot-grid stragézia
 * trade-eket generáljon.
 */
function writeTinyOhlcv(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const dayStarts = [
    Date.UTC(2023, 11, 31),
    Date.UTC(2024, 0, 1),
    Date.UTC(2024, 0, 2),
    Date.UTC(2024, 0, 3),
    Date.UTC(2024, 0, 4),
    Date.UTC(2024, 0, 5),
  ];
  const dayPrices = [40_000, 42_000, 44_000, 41_000, 45_000, 43_000];
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

/** Lapos (stagnáló) OHLCV — 0 trade. */
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

// === Temp dir lifecycle ===

let tempDir: string;
let dataDir: string;
let flatDataDir: string;
let outputDir: string;
let originalArgv: string[];

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), "pivot-grid-main-"));
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

/**
 * `withArgv` — beállítja a process.argv-ot a main() hívás idejére,
 * majd visszaállítja. A teszt így tiszta process.argv mocking-ot
 * használ a CLI args-ok átadásához.
 */
async function withArgv<T>(args: readonly string[], fn: () => Promise<T>): Promise<T> {
  process.argv = ["bun", "run-pivot-grid-baseline.ts", ...args];
  try {
    return await fn();
  } finally {
    process.argv = originalArgv;
  }
}

// === main() tesztek ===

describe("run-pivot-grid-baseline — main() in-process", () => {
  it("happy-path: trades.length > 0 ág — JSON output megíródik, minden riportsor megjelenik", async () => {
    const outFile = resolve(outputDir, "pivot-grid-happy.json");
    const stdoutChunks: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      stdoutChunks.push(args.map(String).join(" "));
    };
    try {
      await withArgv([
        "--symbol=BTC/USDT",
        "--timeframe=15m",
        "--start=2024-01-01",
        "--end=2024-01-06",
        "--equity=10000",
        "--max-position-pct-equity=0.04",
        `--data-dir=${dataDir}`,
        `--output=${outFile}`,
      ], () => main());
    } finally {
      console.log = origLog;
    }
    const stdout = stdoutChunks.join("\n");

    expect(stdout).toContain("[pivot-grid] symbol=BTC/USDT ltf=15m");
    expect(stdout).toContain("[pivot-grid] timeframes: htf=1d mtf=4h ltf=15m");
    expect(stdout).toContain("[pivot-grid] period: 2024-01-01T00:00:00.000Z");
    expect(stdout).toContain("[pivot-grid] initial equity: $10000");
    expect(stdout).toContain("[pivot-grid] max-position-pct-equity (strategy-side cap, default 0.04): 0.04");
    expect(stdout).toContain("=== RESULTS pivot-grid BTC/USDT 15m (cap=0.04) ===");
    // A trades.length > 0 ág: Avg win / Avg loss / Best / Worst trade riportsorok.
    expect(stdout).toContain("Avg win:");
    expect(stdout).toContain("Avg loss:");
    expect(stdout).toContain("Best trade:");
    expect(stdout).toContain("Worst trade:");
    expect(stdout).toContain("[pivot-grid] Saved:");

    // A JSON output megíródott a lemezre.
    expect(existsSync(outFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(outFile, "utf8")) as {
      args: { symbol: string; timeframe: string };
      strategy: string;
      monthlyReturn: number;
      totalMonths: number;
      result: { totalTrades: number; killSwitchTriggered: boolean };
      strategyConfig: { maxPositionPctEquity: number };
    };
    expect(parsed.args.symbol).toBe("BTC/USDT");
    expect(parsed.args.timeframe).toBe("15m");
    expect(parsed.strategy).toBe("pivot-grid");
    expect(parsed.result.totalTrades).toBeGreaterThan(0);
    expect(parsed.result.killSwitchTriggered).toBe(false);
    expect(parsed.strategyConfig.maxPositionPctEquity).toBe(0.04);
  });

  it("trades.length === 0: az 'if (result.trades.length > 0)' else ága fut le", async () => {
    const outFile = resolve(outputDir, "pivot-grid-empty.json");
    const stdoutChunks: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      stdoutChunks.push(args.map(String).join(" "));
    };
    try {
      await withArgv([
        "--symbol=BTC/USDT",
        "--timeframe=15m",
        "--start=2024-01-01",
        "--end=2024-01-02",
        `--data-dir=${flatDataDir}`,
        `--output=${outFile}`,
      ], () => main());
    } finally {
      console.log = origLog;
    }
    const stdout = stdoutChunks.join("\n");

    expect(stdout).toContain("=== RESULTS pivot-grid");
    // Az else ág: NEM jelenik meg a Best trade / Worst trade / Avg win sor.
    expect(stdout).not.toContain("Avg win:");
    expect(stdout).not.toContain("Best trade:");
    expect(stdout).toContain("Trades:           0");
    expect(stdout).toContain("[pivot-grid] Saved:");
  });

  it("a parseArgs() által dobott hiba (rossz timeframe) propagálódik a main()-ból", async () => {
    // A 15m-en kívül minden mást a parseArgs() elutasít. A hiba
    // a main() catch-ágja nélkül propagálódik — az in-process unit
    // teszt ezt a throw-t várja.
    await expect(
      withArgv(
        [
          "--timeframe=1h",
          `--data-dir=${dataDir}`,
        ],
        () => main(),
      ),
    ).rejects.toThrow(/requires 15m|Pivot Grid baseline/);
  });

  it("--max-position-pct-equity érvénytelen érték → main() throw-ol", async () => {
    await expect(
      withArgv(
        [
          "--max-position-pct-equity=0",
          `--data-dir=${dataDir}`,
        ],
        () => main(),
      ),
    ).rejects.toThrow(/must be in \(0, 1\]/);
  });
});

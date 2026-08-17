// packages/backtest-tools/src/cli/run-baseline-cli.test.ts —
// `parseArgs` + `timeframesFor*` egységtesztek a három baseline runner-re.
//
// A három baseline CLI (run-pivot-grid-baseline, run-donchian-range-baseline,
// run-donchian-pivot-composition) a `main()` belsejében futtatja a
// backtest engine-t, amihez a `data/ohlcv/` mappában lévő CSV-kre van
// szükség. A 100% line-coverage eléréséhez a `parseArgs` és
// `timeframesFor*` helper-eket exportáltuk, és itt unit tesztekkel
// fedjük le a flag-validációt + timeframe mapping-et.
//
// A `main()` maga subprocess tesztekkel van lefedve (lásd a
// `cli-e2e` mintát az apps/bot-ban) — az M3 baseline futtatás
// `bun run` CLI-vel indítható, és a JSON output a `data/` mappa
// nélkül is ellenőrizhető.

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { parseArgs as pivotGridParseArgs, timeframesForPivotGrid } from "./run-pivot-grid-baseline.js";
import {
  parseArgs as donchianRangeParseArgs,
  timeframesForDonchianRange,
} from "./run-donchian-range-baseline.js";
import {
  parseArgs as compositionParseArgs,
  parseSymbols,
  timeframesForComposition,
} from "./run-donchian-pivot-composition.js";

// A process.argv a process.argv.slice(2)-ből jön. Minden tesztben
// felülírjuk, és az afterEach visszaállítja.
let originalArgv: string[];
beforeEach(() => {
  originalArgv = process.argv;
});
afterEach(() => {
  process.argv = originalArgv;
});

// === run-pivot-grid-baseline ===

describe("run-pivot-grid-baseline — parseArgs", () => {
  it("alapértelmezett értékeket ad vissza üres arg tömbbel", () => {
    process.argv = ["bun", "run-pivot-grid-baseline.ts"];
    const args = pivotGridParseArgs();
    expect(args.symbol).toBe("BTC/USDT");
    expect(args.timeframe).toBe("15m");
    expect(args.initialEquity).toBe(10_000);
    expect(args.maxPositionPctEquity).toBe(0.04);
  });

  it("parseolja az explicit zászlókat", () => {
    process.argv = [
      "bun",
      "run-pivot-grid-baseline.ts",
      "--symbol=ETH/USDT",
      "--equity=50000",
      "--max-position-pct-equity=0.08",
      "--output=/tmp/foo.json",
    ];
    const args = pivotGridParseArgs();
    expect(args.symbol).toBe("ETH/USDT");
    expect(args.initialEquity).toBe(50_000);
    expect(args.maxPositionPctEquity).toBe(0.08);
    expect(args.outputPath).toBe("/tmp/foo.json");
  });

  it("elutasítja a nem-15m timeframe-öt", () => {
    process.argv = ["bun", "run-pivot-grid-baseline.ts", "--timeframe=1h"];
    expect(() => pivotGridParseArgs()).toThrow(/requires 15m/);
  });

  it("elutasítja a (0, 1] tartományon kívüli --max-position-pct-equity értéket", () => {
    process.argv = ["bun", "run-pivot-grid-baseline.ts", "--max-position-pct-equity=0"];
    expect(() => pivotGridParseArgs()).toThrow(/must be in \(0, 1\]/);

    process.argv = ["bun", "run-pivot-grid-baseline.ts", "--max-position-pct-equity=1.5"];
    expect(() => pivotGridParseArgs()).toThrow(/must be in \(0, 1\]/);

    process.argv = ["bun", "run-pivot-grid-baseline.ts", "--max-position-pct-equity=NaN"];
    expect(() => pivotGridParseArgs()).toThrow(/must be in \(0, 1\]/);
  });
});

describe("run-pivot-grid-baseline — timeframesForPivotGrid", () => {
  it("15m-re a 1d/4h/15m konstellációt adja vissza", () => {
    const tf = timeframesForPivotGrid("15m");
    expect(tf.htf).toBe("1d");
    expect(tf.mtf).toBe("4h");
    expect(tf.ltf).toBe("15m");
  });

  it("bármely más timeframe-re hibát dob", () => {
    expect(() => timeframesForPivotGrid("1h")).toThrow(/supports 15m only/);
    expect(() => timeframesForPivotGrid("5m")).toThrow(/supports 15m only/);
  });
});

// === run-donchian-range-baseline ===

describe("run-donchian-range-baseline — parseArgs", () => {
  it("alapértelmezett értékeket ad vissza üres arg tömbbel", () => {
    process.argv = ["bun", "run-donchian-range-baseline.ts"];
    const args = donchianRangeParseArgs();
    expect(args.symbol).toBe("BTC/USDT");
    expect(args.timeframe).toBe("15m");
    expect(args.initialEquity).toBe(10_000);
  });

  it("parseolja az explicit zászlókat", () => {
    process.argv = [
      "bun",
      "run-donchian-range-baseline.ts",
      "--symbol=ETH/USDT",
      "--equity=20000",
      "--output=/tmp/dr.json",
    ];
    const args = donchianRangeParseArgs();
    expect(args.symbol).toBe("ETH/USDT");
    expect(args.initialEquity).toBe(20_000);
    expect(args.outputPath).toBe("/tmp/dr.json");
  });

  it("elutasítja a nem-15m timeframe-öt", () => {
    process.argv = ["bun", "run-donchian-range-baseline.ts", "--timeframe=1d"];
    expect(() => donchianRangeParseArgs()).toThrow(/requires 15m/);
  });
});

describe("run-donchian-range-baseline — timeframesForDonchianRange", () => {
  it("15m-re a 1d/4h/15m konstellációt adja vissza", () => {
    const tf = timeframesForDonchianRange("15m");
    expect(tf.htf).toBe("1d");
    expect(tf.mtf).toBe("4h");
    expect(tf.ltf).toBe("15m");
  });

  it("bármely más timeframe-re hibát dob", () => {
    expect(() => timeframesForDonchianRange("1h")).toThrow(/supports 15m only/);
  });
});

// === run-donchian-pivot-composition ===

describe("run-donchian-pivot-composition — parseSymbols", () => {
  it("a megadott vesszővel elválasztott listát adja vissza", () => {
    const result = parseSymbols("BTC/USDT,ETH/USDT,SOL/USDT");
    expect(result).toEqual(["BTC/USDT", "ETH/USDT", "SOL/USDT"]);
  });

  it("a whitespace-eket levágja", () => {
    const result = parseSymbols(" BTC/USDT , ETH/USDT ");
    expect(result).toEqual(["BTC/USDT", "ETH/USDT"]);
  });

  it("hibát dob, ha a lista üres", () => {
    expect(() => parseSymbols("")).toThrow(/empty/);
    expect(() => parseSymbols("  ,  ,")).toThrow(/empty/);
  });

  it("hibát dob, ha a lista nem támogatott symbol-t tartalmaz", () => {
    expect(() => parseSymbols("BTC/USDT,DOGE/USDT")).toThrow(/unsupported/);
  });
});

describe("run-donchian-pivot-composition — parseArgs", () => {
  it("alapértelmezett értékeket ad vissza üres arg tömbbel", () => {
    process.argv = ["bun", "run-donchian-pivot-composition.ts"];
    const args = compositionParseArgs();
    expect(args.symbol).toBe("BTC/USDT");
    expect(args.symbols).toEqual([]);
    expect(args.timeframe).toBe("15m");
    expect(args.initialEquity).toBe(10_000);
    expect(args.minConsensus).toBe(2);
    expect(args.maxPositionPctEquity).toBe(0.2);
    expect(args.multiSymbolMode).toBe(false);
  });

  it("multi-symbol mód bekapcsol, ha --symbols= át van adva", () => {
    process.argv = ["bun", "run-donchian-pivot-composition.ts", "--symbols=BTC/USDT,ETH/USDT"];
    const args = compositionParseArgs();
    expect(args.symbols).toEqual(["BTC/USDT", "ETH/USDT"]);
    expect(args.multiSymbolMode).toBe(true);
  });

  it("parseolja a min-consensus és max-position-pct-equity flag-eket", () => {
    process.argv = [
      "bun",
      "run-donchian-pivot-composition.ts",
      "--min-consensus=1",
      "--max-position-pct-equity=0.10",
      "--start=2024-01-01",
      "--end=2025-12-31",
    ];
    const args = compositionParseArgs();
    expect(args.minConsensus).toBe(1);
    expect(args.maxPositionPctEquity).toBe(0.1);
    expect(args.startTime.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(args.endTime.toISOString()).toBe("2025-12-31T00:00:00.000Z");
  });

  it("elutasítja a nem-15m timeframe-öt", () => {
    process.argv = ["bun", "run-donchian-pivot-composition.ts", "--timeframe=4h"];
    expect(() => compositionParseArgs()).toThrow(/requires 15m/);
  });

  it("elutasítja a nem 1 vagy 2 --min-consensus értéket", () => {
    process.argv = ["bun", "run-donchian-pivot-composition.ts", "--min-consensus=0"];
    expect(() => compositionParseArgs()).toThrow(/min-consensus/);
    process.argv = ["bun", "run-donchian-pivot-composition.ts", "--min-consensus=3"];
    expect(() => compositionParseArgs()).toThrow(/min-consensus/);
  });

  it("elutasítja a (0, 0.5] tartományon kívüli --max-position-pct-equity értéket", () => {
    process.argv = ["bun", "run-donchian-pivot-composition.ts", "--max-position-pct-equity=0"];
    expect(() => compositionParseArgs()).toThrow(/must be in \(0, 0.5\]/);
    process.argv = ["bun", "run-donchian-pivot-composition.ts", "--max-position-pct-equity=0.6"];
    expect(() => compositionParseArgs()).toThrow(/must be in \(0, 0.5\]/);
  });

  it("parseolja a --output és --output-dir zászlókat", () => {
    process.argv = [
      "bun",
      "run-donchian-pivot-composition.ts",
      "--output=/tmp/foo.json",
      "--output-dir=/tmp/results",
    ];
    const args = compositionParseArgs();
    expect(args.outputPath).toBe("/tmp/foo.json");
    expect(args.outputDir).toBe("/tmp/results");
  });
});

describe("run-donchian-pivot-composition — timeframesForComposition", () => {
  it("15m-re a 1d/4h/15m konstellációt adja vissza", () => {
    const tf = timeframesForComposition("15m");
    expect(tf.htf).toBe("1d");
    expect(tf.mtf).toBe("4h");
    expect(tf.ltf).toBe("15m");
  });

  it("bármely más timeframe-re hibát dob", () => {
    expect(() => timeframesForComposition("1h")).toThrow(/supports 15m only/);
  });
});

// === generate-report ===

import {
  formatPct,
  loadFile,
  parseArgs as generateReportParseArgs,
  parseSweepRows,
} from "./generate-report.js";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

describe("generate-report — parseArgs", () => {
  it("alapértelmezett értékeket ad vissza üres arg tömbbel", () => {
    process.argv = ["bun", "generate-report.ts"];
    const args = generateReportParseArgs();
    expect(args.baselines.length).toBe(5);
    expect(args.baselines[0]).toBe("backtest-results/baseline-btc-1h.json");
    expect(args.sweep).toBe("backtest-results/sweep.json");
    expect(args.oos).toBe("backtest-results/oos.json");
    expect(args.output).toBe("backtest-results/REPORT.md");
  });

  it("parseolja a --baselines= vesszővel elválasztott listát", () => {
    process.argv = ["bun", "generate-report.ts", "--baselines=a.json,b.json,c.json"];
    const args = generateReportParseArgs();
    expect(args.baselines).toEqual(["a.json", "b.json", "c.json"]);
  });

  it("a --baseline= (single, backward compat) egyelemű listát ad", () => {
    process.argv = ["bun", "generate-report.ts", "--baseline=only.json"];
    const args = generateReportParseArgs();
    expect(args.baselines).toEqual(["only.json"]);
  });

  it("parseolja a --sweep, --oos, --output zászlókat", () => {
    process.argv = [
      "bun",
      "generate-report.ts",
      "--sweep=custom-sweep.csv",
      "--oos=custom-oos.json",
      "--output=/tmp/REPORT.md",
    ];
    const args = generateReportParseArgs();
    expect(args.sweep).toBe("custom-sweep.csv");
    expect(args.oos).toBe("custom-oos.json");
    expect(args.output).toBe("/tmp/REPORT.md");
  });
});

describe("generate-report — formatPct", () => {
  it("0.05-ot 5.00%-ként formázza (alapértelmezett 2 tizedesjegy)", () => {
    expect(formatPct(0.05)).toBe("5.00%");
  });

  it("egyedi tizedesjegyszámot is elfogad", () => {
    expect(formatPct(0.05, 4)).toBe("5.0000%");
    expect(formatPct(0.12345, 1)).toBe("12.3%");
    expect(formatPct(-0.5, 0)).toBe("-50%");
  });
});

describe("generate-report — sweep input compatibility", () => {
  it("a jelenlegi sweep JSON envelope eredményeit parse-olja", () => {
    const rows = parseSweepRows(
      JSON.stringify({
        workflow: "sweep",
        results: [
          {
            maxPositionPctEquity: 0.08,
            result: {
              totalReturn: 0.25,
              sharpeRatio: 1.5,
              maxDrawdown: 0.1,
              profitFactor: 1.8,
              winRate: 0.6,
              totalTrades: 12,
              killSwitchTriggered: false,
            },
          },
        ],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.maxPositionPctEquity).toBe(0.08);
    expect(rows[0]?.totalReturn).toBe(0.25);
    expect(rows[0]?.totalTrades).toBe(12);
  });

  it("a legacy sweep CSV-t fejlécnév alapján továbbra is parse-olja", () => {
    const rows = parseSweepRows(
      [
        "iteration,risk_per_trade,kelly_fraction,max_drawdown,monthly_return,total_months,total_return,sharpe_ratio,sortino_ratio,max_drawdown_pct,profit_factor,win_rate,total_trades,kill_switch_triggered",
        "0,0.01,0.25,0.5,-0.02,12,-0.22,1.5,1.7,0.1,1.6,0.6,10,1",
      ].join("\n"),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.riskPerTrade).toBe(0.01);
    expect(rows[0]?.monthlyReturn).toBe(-0.02);
    expect(rows[0]?.sharpeRatio).toBe(1.5);
    expect(rows[0]?.killSwitchTriggered).toBe(true);
  });
});

describe("generate-report — loadFile", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = mkdtempSync(resolve(tmpdir(), "generate-report-"));
  });
  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("sikeresen beolvassa a fájlt, ha létezik", async () => {
    const file = resolve(tempDir, "test.txt");
    writeFileSync(file, "hello world");
    const result = await loadFile(file);
    expect(result).toBe("hello world");
  });

  it("null-t ad vissza, ha a fájl nem létezik (catch ág)", async () => {
    const result = await loadFile(resolve(tempDir, "does-not-exist.txt"));
    expect(result).toBeNull();
  });
});

// A spyOn csak azért van importálva, hogy a linter ne jelezzen
// unused-import warningot (más tesztek is használhatják a későbbiekben).
void spyOn;

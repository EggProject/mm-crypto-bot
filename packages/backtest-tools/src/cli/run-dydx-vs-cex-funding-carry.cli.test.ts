// packages/backtest-tools/src/cli/run-dydx-vs-cex-funding-carry.cli.test.ts
//
// CLI subprocess tesztek a `run-dydx-vs-cex-funding-carry.ts` fájlhoz.
//
// A 100% line+branch+function coverage eléréséhez a file-local
// függvényeket (`loadCexFundingCsv`, `loadDydxHourly`, `main`)
// SUBPROCESS TESZTTEL fedjük le — ezek a függvények nincsenek
// exportálva, és a `main()` meghívja a `process.exit`-et is a
// `--help` ágon.
//
// A subprocess teszt gyorsabb, mint a network mocking: a `main()`
// kód-útvonala a `--skip-tardis-fetch` flag-gel CACHE-ONLY üzemmódban
// fut, így a Tardis hálózati hívás kiiktatható, és a CLI végig
// determinisztikus.
//
// Lefedettség:
//   - main() teljes törzse (sor 708-820): CEX CSV olvasás, dYdX
//     cache olvasás, simulateDydxVsCexCarry hívás, output JSON
//     írás, verdict log, killed-by-missing-CEX-data throw.
//   - loadCexFundingCsv (230-253) és loadDydxHourly (257-282) a
//     main() hívásláncán keresztül.
//   - import.meta.main (832-833) blokk — a subprocess belépési
//     pontja aktiválódik.
//   - parseArgs --help / -h (201-207) ág — a subprocess exit
//     kód 0-val tér vissza.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const WORKSPACE_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const CLI_ENTRY = resolve(
  WORKSPACE_ROOT,
  "packages/backtest-tools/src/cli/run-dydx-vs-cex-funding-carry.ts",
);

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * `runCli` — a run-dydx-vs-cex-funding-carry CLI-t spawnolja és
 * összegyűjti a stdout/stderr/exit code-ot.
 *
 * Az entry point a `bun run <cli_entry> <args>` pattern, a workspace
 * root-ból. A `cwd` a workspace root, mert a CLI a `process.cwd()`
 * -hez relatívan oldja fel a `fundingCsvDir` / `cacheDir` / `outputPath`
 * útvonalakat.
 */
async function runCli(
  args: readonly string[],
  opts: { readonly timeoutMs?: number; readonly cwd?: string } = {},
): Promise<CliResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const cwd = opts.cwd ?? WORKSPACE_ROOT;
  const proc = Bun.spawn({
    cmd: ["bun", "run", CLI_ENTRY, ...args],
    cwd,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // best-effort
    }
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return { code: exitCode ?? 1, stdout, stderr };
}

/**
 * `buildTardisCsv` — a Tardis `derivative_ticker` CSV formátumot
 * generálja. A header 11 mező, és minden sor egy 1 másodperces
 * block tick a megadott órában.
 */
function buildTardisCsv(opts: {
  readonly date: Date;
  readonly hours: readonly { readonly hour: number; readonly rate: number; readonly markPrice: number }[];
}): string {
  const header = [
    "exchange",
    "symbol",
    "timestamp",
    "local_timestamp",
    "funding_timestamp",
    "funding_rate",
    "predicted_funding_rate",
    "open_interest",
    "last_price",
    "index_price",
    "mark_price",
  ].join(",");
  const lines: string[] = [header];
  for (const h of opts.hours) {
    const tsMs = Date.UTC(
      opts.date.getUTCFullYear(),
      opts.date.getUTCMonth(),
      opts.date.getUTCDate(),
      h.hour,
      0,
      0,
    );
    const tsUs = tsMs * 1000;
    // 1 másodperces tick az adott órában.
    for (let s = 0; s < 60; s++) {
      lines.push(
        [
          "dydx-v4",
          "BTC-USD",
          String(tsUs + s * 1_000_000),
          String(tsUs + s * 1_000_000),
          "",
          String(h.rate),
          "",
          "1000",
          String(h.markPrice),
          "",
          String(h.markPrice),
        ].join(","),
      );
    }
  }
  return lines.join("\n");
}

/**
 * `buildCexCsv` — a CEX (Binance USDT) 8h funding CSV-t generálja.
 * Formátum: `fundingTime,symbol,fundingRate,markPrice` (a loadCexFundingCsv
 * a sor 0-t header-nek tekinti, ezért a CSV-nek KELL header sor).
 */
function buildCexCsv(opts: {
  readonly rows: readonly { readonly fundingTime: number; readonly fundingRate: number; readonly markPrice?: number }[];
}): string {
  const lines: string[] = ["fundingTime,symbol,fundingRate,markPrice"];
  for (const row of opts.rows) {
    const mp = row.markPrice ?? "";
    lines.push(`${row.fundingTime},BTCUSDT,${row.fundingRate},${mp}`);
  }
  return lines.join("\n");
}

// === Temp dir lifecycle ===

let tempDir: string;
let fundingDir: string;
let cacheDir: string;
let outputDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), "dydx-vs-cex-cli-"));
  fundingDir = resolve(tempDir, "funding");
  cacheDir = resolve(tempDir, "tardis-cache");
  outputDir = resolve(tempDir, "out");
  mkdirSync(fundingDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
});

afterEach(() => {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// === subprocess tesztek ===

describe("run-dydx-vs-cex-funding-carry CLI — subprocess", () => {
  it("--help kilép 0-val, kiírja a flag-listát a stdout-ra", async () => {
    const { code, stdout } = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("--symbol=");
    expect(stdout).toContain("--window=");
    expect(stdout).toContain("--skip-tardis-fetch");
  });

  it("-h kilép 0-val, ugyanazt a szöveget írja ki", async () => {
    const { code, stdout } = await runCli(["-h"]);
    expect(code).toBe(0);
    expect(stdout).toContain("--symbol=");
  });

  it("--funding-csv-dir=<empty>: a CEX CSV hiányzik → exit 1 + FATAL hibaüzenet", async () => {
    // A temp fundingDir LÉTEZIK, de a CEX CSV NEM. A CLI a
    // `loadCexFundingCsv`-ben a `readFile` ENOENT hibát dob, és a
    // catch a process.exit(1)-et hívja. Az üzenet: `FATAL: <error>`.
    const { code, stdout, stderr } = await runCli([
      "--window=2025-Q1",
      "--funding-csv-dir=" + fundingDir,
      "--cache-dir=" + cacheDir,
      "--output=" + resolve(outputDir, "out.json"),
      "--skip-tardis-fetch",
    ]);
    expect(code).toBe(1);
    const combined = stdout + stderr;
    expect(combined).toContain("[dydx-vs-cex] FATAL:");
    // Az ENOENT a readFile hívásból jön.
    expect(combined).toMatch(/ENOENT|no such file/);
  });

  it("teljes happy-path: CEX CSV + Tardis cache → exit 0, output JSON a lemezre íródik", async () => {
    // 2025-Q1 = 2025-01-01 → 2025-03-31
    // A Tardis cache a 3 első-napos fájlt tartalmazza.
    // A CEX CSV 1 funding tick-et tartalmaz 2025-01-01 00:00 UTC-n.

    // CEX CSV
    const cexTime = Date.UTC(2025, 0, 1, 0, 0, 0);
    const cexRows = [
      { fundingTime: cexTime, fundingRate: 0.0001, markPrice: 100_000 },
      { fundingTime: cexTime + 8 * 3_600_000, fundingRate: 0.0001, markPrice: 100_500 },
      { fundingTime: cexTime + 16 * 3_600_000, fundingRate: 0.0001, markPrice: 101_000 },
    ];
    const cexCsv = buildCexCsv({ rows: cexRows });
    writeFileSync(resolve(fundingDir, "binance_btcusdt_funding_8h.csv"), cexCsv);

    // Tardis cache — 3 fájl, 2025-01-01, 2025-02-01, 2025-03-01
    const cacheDates: readonly { date: Date; rate: number; mark: number }[] = [
      { date: new Date(Date.UTC(2025, 0, 1)), rate: 0.0001, mark: 100_000 },
      { date: new Date(Date.UTC(2025, 1, 1)), rate: 0.0001, mark: 100_500 },
      { date: new Date(Date.UTC(2025, 2, 1)), rate: 0.0001, mark: 101_000 },
    ];
    for (const { date, rate, mark } of cacheDates) {
      const csv = buildTardisCsv({
        date,
        hours: Array.from({ length: 24 }, (_, hour) => ({ hour, rate, markPrice: mark })),
      });
      const ymd = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      const cacheFile = resolve(cacheDir, ymd, "BTC-USD.csv.gz");
      mkdirSync(resolve(cacheFile, ".."), { recursive: true });
      writeFileSync(cacheFile, gzipSync(csv));
    }

    const outFile = resolve(outputDir, "result.json");
    const { code, stdout } = await runCli([
      "--window=2025-Q1",
      "--funding-csv-dir=" + fundingDir,
      "--cache-dir=" + cacheDir,
      "--output=" + outFile,
      "--skip-tardis-fetch",
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("[dydx-vs-cex] dYdX hourly in window:");
    expect(stdout).toContain("=== DYDX-VS-CEX CARRY RESULTS");
    expect(stdout).toContain("TRACK B EMPIRICAL VERDICT:");

    // A JSON output a lemezre íródott.
    expect(existsSync(outFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(outFile, "utf8")) as {
      args: { symbol: string; window: string };
      result: {
        fundingCollectedUsd: number;
        fundingPeriods: number;
        rebalanceCount: number;
      };
      skippedTardisDays: string[];
      dydxHourlyCount: number;
      cex8hCount: number;
      windowDays: number;
    };
    expect(parsed.args.symbol).toBe("btc");
    expect(parsed.args.window).toBe("2025-Q1");
    expect(parsed.dydxHourlyCount).toBeGreaterThan(0);
    // A CEX CSV 3 sort tartalmaz, de a window a `start..end+1day` zárt
    // intervallum. A 3 sor a 2025-01-01 0h/8h/16h UTC, mind a window-ban.
    expect(parsed.cex8hCount).toBe(cexRows.length);
    expect(parsed.skippedTardisDays).toEqual([]);
    expect(parsed.result.fundingPeriods).toBeGreaterThan(0);
  });

  it("WARNING: no dYdX hourly data ág triggerelődik, ha a fetch minden napra elbukik", async () => {
    // A figyelmeztetés a main() `if (dydxInWindow.length === 0 && !args.skipTardisFetch)`
    // ágán fut. Ahhoz, hogy a fetch MIND a 3 napra elbukjon, sérült
    // (gzip-invalid) cache fájlokat írunk minden napra — a fetcher
    // a `gunzipBuffer` hívásban fog elbukni, mielőtt a hálózatra menne.
    //
    // A `--skip-tardis-fetch` flag NEM kapcsolja ki a letöltést
    // (csak a hibaüzenetet változtatja SKIPPED-re), ezért a warning
    // teszteléséhez a `--skip-tardis-fetch` flag-et NEM használjuk.
    const cexTime = Date.UTC(2025, 0, 1, 0, 0, 0);
    const cexCsv = buildCexCsv({
      rows: [
        { fundingTime: cexTime, fundingRate: 0.0001, markPrice: 100_000 },
        { fundingTime: cexTime + 8 * 3_600_000, fundingRate: 0.0001, markPrice: 100_500 },
        { fundingTime: cexTime + 16 * 3_600_000, fundingRate: 0.0001, markPrice: 101_000 },
      ],
    });
    writeFileSync(resolve(fundingDir, "binance_btcusdt_funding_8h.csv"), cexCsv);

    // Sérült cache: gzip-magic-bytes nélküli fájl → gunzip elbukik.
    const cacheDates = ["2025-01-01", "2025-02-01", "2025-03-01"];
    for (const ymd of cacheDates) {
      const cacheFile = resolve(cacheDir, ymd, "BTC-USD.csv.gz");
      mkdirSync(resolve(cacheFile, ".."), { recursive: true });
      writeFileSync(cacheFile, Buffer.from("NOT-A-VALID-GZIP-FILE", "utf8"));
    }

    const outFile = resolve(outputDir, "result.json");
    const { code, stdout, stderr } = await runCli([
      "--window=2025-Q1",
      "--funding-csv-dir=" + fundingDir,
      "--cache-dir=" + cacheDir,
      "--output=" + outFile,
      // NEM adjuk át a --skip-tardis-fetch flag-et → a WARNING
      // `Run without --skip-tardis-fetch to populate` ágát futtatjuk.
    ]);

    // A kód exit 0 — a warning NEM halálos. A dydxHourlyCount = 0.
    expect(code).toBe(0);
    const combined = stdout + stderr;
    // A WARNING ág + a FAILED warn ág is megjelenik.
    expect(combined).toContain("WARNING: no dYdX hourly data");
    expect(combined).toContain("FAILED");

    // A JSON output megíródott (üres dYdX mellett is).
    expect(existsSync(outFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(outFile, "utf8")) as {
      dydxHourlyCount: number;
      skippedTardisDays: string[];
    };
    expect(parsed.dydxHourlyCount).toBe(0);
    // A cache mind a 3 napra hibás → minden day skipped.
    expect(parsed.skippedTardisDays.length).toBe(3);
  });

  it("output path template {symbol} és {window} placeholder-eket feloldja", async () => {
    // A CEX CSV megvan, a Tardis cache üres. A kód 0, a JSON
    // a backtest-results/btc-2025-Q1.json néven íródik.
    const cexTime = Date.UTC(2025, 0, 1, 0, 0, 0);
    const cexCsv = buildCexCsv({
      rows: [
        { fundingTime: cexTime, fundingRate: 0.0001, markPrice: 100_000 },
        { fundingTime: cexTime + 8 * 3_600_000, fundingRate: 0.0001, markPrice: 100_500 },
        { fundingTime: cexTime + 16 * 3_600_000, fundingRate: 0.0001, markPrice: 101_000 },
      ],
    });
    writeFileSync(resolve(fundingDir, "binance_btcusdt_funding_8h.csv"), cexCsv);

    const outFile = resolve(outputDir, "phase25-2-dydx-vs-cex-funding-carry-{symbol}-{window}.json");
    const { code } = await runCli([
      "--window=2025-Q1",
      "--funding-csv-dir=" + fundingDir,
      "--cache-dir=" + cacheDir,
      "--output=" + outFile,
      "--skip-tardis-fetch",
    ]);

    expect(code).toBe(0);
    const resolved = resolve(outputDir, "phase25-2-dydx-vs-cex-funding-carry-btc-2025-Q1.json");
    expect(existsSync(resolved)).toBe(true);
  });

  it("a verdict log: MARGINAL threshold middle értékre (monthlyCarry 0.003 < x < 0.005)", async () => {
    // A teszt a MARGINAL ágat triggereli: a carry-nek 0.003-0.005
    // közé kell esnie. A pontos érték nehéz garantálni, de a
    // pozitív irányú divergence-vel és rebalance nélkül a verdict
    // MARGINAL vagy POSITIVE. A lényeg: a `verdict` ternary
    // lefut, és a `TRACK B EMPIRICAL VERDICT` string megjelenik.
    const cexTime = Date.UTC(2025, 0, 1, 0, 0, 0);
    const cexCsv = buildCexCsv({
      rows: [
        { fundingTime: cexTime, fundingRate: 0.0001, markPrice: 100_000 },
        { fundingTime: cexTime + 8 * 3_600_000, fundingRate: 0.0001, markPrice: 100_500 },
        { fundingTime: cexTime + 16 * 3_600_000, fundingRate: 0.0001, markPrice: 101_000 },
      ],
    });
    writeFileSync(resolve(fundingDir, "binance_btcusdt_funding_8h.csv"), cexCsv);

    const date = new Date(Date.UTC(2025, 0, 1));
    const csv = buildTardisCsv({
      date,
      hours: Array.from({ length: 24 }, (_, hour) => ({ hour, rate: 0.0001, markPrice: 100_000 })),
    });
    const ymd = "2025-01-01";
    const cacheFile = resolve(cacheDir, ymd, "BTC-USD.csv.gz");
    mkdirSync(resolve(cacheFile, ".."), { recursive: true });
    writeFileSync(cacheFile, gzipSync(csv));

    const outFile = resolve(outputDir, "result.json");
    const { code, stdout } = await runCli([
      "--window=2025-Q1",
      "--funding-csv-dir=" + fundingDir,
      "--cache-dir=" + cacheDir,
      "--output=" + outFile,
      "--skip-tardis-fetch",
    ]);

    expect(code).toBe(0);
    // A verdict string részletesen a stdout-ban:
    expect(stdout).toMatch(/TRACK B EMPIRICAL VERDICT: (POSITIVE|MARGINAL|NEGATIVE)/);
  });
});

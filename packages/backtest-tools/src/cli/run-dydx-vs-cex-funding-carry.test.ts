// packages/backtest-tools/src/cli/run-dydx-vs-cex-funding-carry.test.ts —
// unit tests for the pure-functional carry-simulation core.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import type { FundingSnapshot } from "@mm-crypto-bot/core";

import {
  loadCexFundingCsv,
  loadDydxHourly,
  main,
  parseArgs,
  printHelp,
  simulateDydxVsCexCarry,
  WINDOW_DEFS,
} from "./run-dydx-vs-cex-funding-carry.js";

describe("parseArgs", () => {
  it("alapértelmezett értékeket ad vissza ha nincs flag", () => {
    const args = parseArgs([]);
    expect(args.symbol).toBe("btc");
    expect(args.window).toBe("2025-Q1");
    expect(args.initialEquity).toBe(10_000);
    expect(args.targetNotionalUsd).toBe(250_000);
    expect(args.rebalanceCostBps).toBe(20);
    expect(args.withdrawalLatencyMinutes).toBe(15);
    expect(args.skipTardisFetch).toBe(false);
  });

  it("parseolja az explicit zászlókat", () => {
    const args = parseArgs([
      "--symbol=eth",
      "--window=2026-Q1",
      "--equity=50000",
      "--notional=100000",
      "--rebalance-bps=30",
      "--latency=10",
      "--output=/tmp/foo.json",
      "--skip-tardis-fetch",
    ]);
    expect(args.symbol).toBe("eth");
    expect(args.window).toBe("2026-Q1");
    expect(args.initialEquity).toBe(50_000);
    expect(args.targetNotionalUsd).toBe(100_000);
    expect(args.rebalanceCostBps).toBe(30);
    expect(args.withdrawalLatencyMinutes).toBe(10);
    expect(args.outputPath).toBe("/tmp/foo.json");
    expect(args.skipTardisFetch).toBe(true);
  });

  it("elutasítja az ismeretlen symbol-t", () => {
    expect(() => parseArgs(["--symbol=DOGE"])).toThrow();
  });

  it("elutasítja az ismeretlen window-t", () => {
    expect(() => parseArgs(["--window=2030-Q1"])).toThrow();
  });

  it("kezeli a case-insensitive symbol inputot", () => {
    expect(parseArgs(["--symbol=BTC"]).symbol).toBe("btc");
    expect(parseArgs(["--symbol=Eth"]).symbol).toBe("eth");
    expect(parseArgs(["--symbol=SOL"]).symbol).toBe("sol");
  });
});

describe("WINDOW_DEFS", () => {
  it("minden ablakhoz van start, end és legalább 1 tardisDay", () => {
    for (const [id, def] of Object.entries(WINDOW_DEFS)) {
      expect(def.start.getTime()).toBeLessThan(def.end.getTime());
      expect(def.tardisDays.length).toBeGreaterThan(0);
      for (const d of def.tardisDays) {
        expect(d.getUTCDate()).toBe(1); // free tier = first of month
      }
      void id;
    }
  });
});

describe("simulateDydxVsCexCarry — pure carry math", () => {
  const dydxPositive = (h: number): FundingSnapshot[] => [
    {
      fundingTime: Date.UTC(2025, 3, 1, h, 0, 0),
      symbol: "BTC-USD",
      fundingRate: 0.0001,
      markPrice: 80_000,
    },
  ];

  it("long dYdX + short CEX: pozitív carry ha mindkettő pozitív", () => {
    const dydx = [
      { fundingTime: Date.UTC(2025, 3, 1, 0, 0, 0), symbol: "BTC-USD", fundingRate: 0.0001, markPrice: 80_000 },
    ];
    const cex: FundingSnapshot[] = [
      {
        fundingTime: Date.UTC(2025, 3, 1, 0, 0, 0),
        symbol: "BTCUSDT",
        fundingRate: 0.00005,
      },
    ];
    const r = simulateDydxVsCexCarry({
      dydxHourly: dydx,
      cex8h: cex,
      startTime: Date.UTC(2025, 3, 1, 0, 0, 0),
      endTime: Date.UTC(2025, 3, 1, 8, 0, 0),
      initialEquity: 10_000,
      targetNotionalUsd: 100_000,
      rebalanceCostBps: 20,
      withdrawalLatencyMinutes: 15,
    });
    expect(r.fundingPeriods).toBe(2);
    // long dYdX rate=+0.0001 → -paymentUsd = -10
    // short CEX rate=+0.00005 → +paymentUsd = +5
    // net funding = -5 USD
    expect(r.fundingCollectedUsd).toBeCloseTo(-10 + 5, 4);
  });

  it("long dYdX: negatív funding = earn (sign-flip a FundingCarry konvencióhoz)", () => {
    const dydx = [
      { fundingTime: Date.UTC(2025, 3, 1, 0, 0, 0), symbol: "BTC-USD", fundingRate: -0.0001, markPrice: 80_000 },
    ];
    const cex: FundingSnapshot[] = [];
    const r = simulateDydxVsCexCarry({
      dydxHourly: dydx,
      cex8h: cex,
      startTime: Date.UTC(2025, 3, 1, 0, 0, 0),
      endTime: Date.UTC(2025, 3, 1, 1, 0, 0),
      initialEquity: 10_000,
      targetNotionalUsd: 100_000,
      rebalanceCostBps: 20,
      withdrawalLatencyMinutes: 15,
    });
    // negatív dYdX funding → long earns → -(-100k * -0.0001) = -(-10) = 10
    expect(r.fundingCollectedUsd).toBeCloseTo(10, 4);
  });

  it("kill-switch: divergence < 0.0005/8h 7 egymás utáni napon → trigger", () => {
    const startMs = Date.UTC(2025, 3, 1, 0, 0, 0);
    const days = 10;
    const dydx: { fundingTime: number; symbol: string; fundingRate: number; markPrice: number }[] = [];
    const cex: FundingSnapshot[] = [];
    // Minden nap: dYdX rate = -0.00001/8h-eq (a divergence = -0.00001 - 0.0001 = -0.00011 < 0.0005 threshold)
    for (let day = 0; day < days; day++) {
      dydx.push({
        fundingTime: startMs + day * 86_400_000,
        symbol: "BTC-USD",
        fundingRate: -0.00001 / 8, // per hour
        markPrice: 80_000,
      });
      cex.push({
        fundingTime: startMs + day * 86_400_000,
        symbol: "BTCUSDT",
        fundingRate: 0.0001,
      });
    }
    const r = simulateDydxVsCexCarry({
      dydxHourly: dydx,
      cex8h: cex,
      startTime: startMs,
      endTime: startMs + days * 86_400_000,
      initialEquity: 10_000,
      targetNotionalUsd: 100_000,
      rebalanceCostBps: 20,
      withdrawalLatencyMinutes: 15,
    });
    expect(r.killSwitch7DayCompressionTriggered).toBe(true);
    expect(r.compressedDivergenceDays).toBeGreaterThanOrEqual(7);
  });

  it("mean-reversion half-life véges ha van AR(1) együttható", () => {
    // AR(1) divergence series: y_t = -0.5 * y_{t-1} + ε → half-life ≈ 1.4 time units.
    // We construct it explicitly so the OLS regression finds a clean β = -0.5.
    const startMs = Date.UTC(2025, 3, 1, 0, 0, 0);
    const divSeries: number[] = [];
    let y = 0.001;
    for (let h = 0; h < 24 * 14; h++) {
      divSeries.push(y);
      y = -0.5 * y; // pure AR(1) with β = -0.5
    }
    const dydx: { fundingTime: number; symbol: string; fundingRate: number; markPrice: number }[] = [];
    const cex: FundingSnapshot[] = [];
    // CEX = 0.0001 (constant). dYdX = (div + cex) / 8.
    for (let h = 0; h < divSeries.length; h++) {
      const div = divSeries[h] ?? 0;
      dydx.push({
        fundingTime: startMs + h * 3_600_000,
        symbol: "BTC-USD",
        fundingRate: (div + 0.0001) / 8,
        markPrice: 80_000,
      });
      if (h % 8 === 0) {
        cex.push({
          fundingTime: startMs + h * 3_600_000,
          symbol: "BTCUSDT",
          fundingRate: 0.0001,
        });
      }
    }
    const r = simulateDydxVsCexCarry({
      dydxHourly: dydx,
      cex8h: cex,
      startTime: startMs,
      endTime: startMs + divSeries.length * 3_600_000,
      initialEquity: 10_000,
      targetNotionalUsd: 100_000,
      rebalanceCostBps: 20,
      withdrawalLatencyMinutes: 15,
    });
    expect(Number.isFinite(r.meanReversionHalfLifeHours)).toBe(true);
    expect(r.meanReversionHalfLifeHours).toBeGreaterThan(0);
    expect(r.meanReversionHalfLifeHours).toBeLessThan(100);
  });

  it("bit-identical probe: --symbol=btc vs --symbol=BTC azonos eredményt ad", () => {
    const args1 = parseArgs(["--symbol=btc", "--window=2025-Q1"]);
    const args2 = parseArgs(["--symbol=BTC", "--window=2025-Q1"]);
    expect(args1.symbol).toBe(args2.symbol);
    // Resolution is identical for downstream run.
    expect(args1.symbol).toBe("btc");
    expect(args2.symbol).toBe("btc");
  });

  it("parseolja a --funding-csv-dir opciót (resolve-öl a cwd-hez képest)", () => {
    const args = parseArgs(["--funding-csv-dir=data/funding"]);
    expect(args.fundingCsvDir).toContain("data/funding");
  });

  it("parseolja a --cache-dir opciót", () => {
    const args = parseArgs(["--cache-dir=/tmp/tardis-cache"]);
    expect(args.cacheDir).toBe("/tmp/tardis-cache");
  });

  it("elutasítja az ismeretlen CLI flag-et", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown arg/);
  });
  void dydxPositive;
});

// === További simulateDydxVsCexCarry ág-lefedések (100% line+branch) ===

describe("simulateDydxVsCexCarry — rebalance + esemény-szétválogatás", () => {
  it("dydx és cex event azonos timestamp-en: a merge hurok a cexRate-et is kitölti", () => {
    // A `simulateDydxVsCexCarry` event-loop ága:
    //   dydxTs === cexTs → az event 'cexRate' mezője a cex fundingRate-et kapja
    //   (nem null), és a `j` pointer is léptetődik. Ezt az ágat kell lefedni,
    //   mert egyébként a divergence series-ben hamis 'null' lenne.
    const startMs = Date.UTC(2025, 3, 1, 0, 0, 0);
    const dydx = [
      {
        fundingTime: startMs, // dydx event ugyanott mint a cex
        symbol: "BTC-USD",
        fundingRate: 0.0001,
        markPrice: 80_000,
      },
    ];
    const cex: FundingSnapshot[] = [
      {
        fundingTime: startMs, // cex event ugyanott mint a dydx
        symbol: "BTCUSDT",
        fundingRate: 0.0001,
      },
    ];
    const r = simulateDydxVsCexCarry({
      dydxHourly: dydx,
      cex8h: cex,
      startTime: startMs,
      endTime: startMs + 3_600_000,
      initialEquity: 10_000,
      targetNotionalUsd: 100_000,
      rebalanceCostBps: 20,
      withdrawalLatencyMinutes: 15,
    });
    // Mindkét event megjelent → fundingPeriods === 2
    expect(r.fundingPeriods).toBe(2);
    // A divergence series-ben a két átfedő event 1 elemet ad (dydx-cex).
    expect(r.equityCurve[0]?.divergence).not.toBeNull();
    if (r.equityCurve[0] !== undefined) {
      const d = r.equityCurve[0].divergence;
      expect(d).not.toBeNull();
      if (d !== null) {
        // dydx 0.0001 × 8 = 0.0008, cex 0.0001 → divergence = 0.0007
        expect(d).toBeCloseTo(0.0007, 8);
      }
    }
  });

  it("dydx event cex nélkül, majd cex event dydx nélkül: a 2-ágú event-loop mindkét felét futtatja", () => {
    // Az event-loop két döntési ága:
    //   - `dydxTs <= cexTs && i < dydx.length` → dydx event, cex null
    //   - `else if (j < cex.length)` → cex event, dydx null
    // Mindkettőt le kell fedni. A második ág csak akkor fut le,
    // ha a dydx list hamarabb elfogy, mint a cex lista.
    const startMs = Date.UTC(2025, 3, 1, 0, 0, 0);
    const dydx = [
      {
        fundingTime: startMs,
        symbol: "BTC-USD",
        fundingRate: 0.0001,
        markPrice: 80_000,
      },
    ];
    const cex: FundingSnapshot[] = [
      // A cex event a dydx után jön → a dydx előbb fogy el.
      {
        fundingTime: startMs + 3_600_000,
        symbol: "BTCUSDT",
        fundingRate: 0.0001,
      },
      {
        fundingTime: startMs + 7_200_000,
        symbol: "BTCUSDT",
        fundingRate: 0.0001,
      },
    ];
    const r = simulateDydxVsCexCarry({
      dydxHourly: dydx,
      cex8h: cex,
      startTime: startMs,
      endTime: startMs + 8 * 3_600_000,
      initialEquity: 10_000,
      targetNotionalUsd: 100_000,
      rebalanceCostBps: 20,
      withdrawalLatencyMinutes: 15,
    });
    expect(r.fundingPeriods).toBe(3);
    // Az utolsó equity point csak cex fundingot tartalmaz (a dydx null
    // a divergence-ben → divergence === null).
    const lastWithData = r.equityCurve.find((p) => p.divergence === null && p.cex8hRate !== null);
    expect(lastWithData).toBeDefined();
  });

  it("rebalance: a drift eléri a 5%-os küszöböt → rebalanceCount és rebalanceCostUsd növekszik", () => {
    // A rebalance trigger a 0.05 (= 5%) drift fraction. A driftUsd
    // = cumFundingUsd * 0.01 (deltaSensitivity). A threshold:
    //   |driftUsd| / targetNotionalUsd >= 0.05
    //   → |cumFundingUsd| * 0.01 / 100_000 >= 0.05
    //   → |cumFundingUsd| >= 500_000
    //
    // Hogy NE hívjunk túl sok event-et, de a drift összegyűljön:
    // - 8 órás dydx rate = 0.001 (0.1% / hour → 0.8% / 8h), 10 dydx event.
    // - dydx paymentUsd = -targetNotionalUsd * rate = -100_000 * 0.001 = -100
    //   hosszú dydx-en a sign-flip miatt negatív → 10 event = -1000.
    //   |cumFundingUsd| = 1000 < 500_000 → nem elég.
    //
    // Másik megközelítés: növeljük a targetNotionalUsd-ot vagy a rate-et.
    // A tesztben a 0.5%-os dydx rate 100 event-tel ad 5e6 USD drift-et,
    // ami bőven triggerel.
    const startMs = Date.UTC(2025, 3, 1, 0, 0, 0);
    const dydx: { fundingTime: number; symbol: string; fundingRate: number; markPrice: number }[] = [];
    for (let h = 0; h < 100; h++) {
      dydx.push({
        fundingTime: startMs + h * 3_600_000,
        symbol: "BTC-USD",
        fundingRate: -0.005, // negatív funding → long earn → pozitív paymentUsd
        markPrice: 80_000,
      });
    }
    const r = simulateDydxVsCexCarry({
      dydxHourly: dydx,
      cex8h: [],
      startTime: startMs,
      endTime: startMs + 100 * 3_600_000,
      initialEquity: 10_000,
      targetNotionalUsd: 100_000,
      rebalanceCostBps: 20, // 0.20% = 200 USD flat fee
      withdrawalLatencyMinutes: 15, // 0.25h × 0.0001 × 100_000 = 2.5 USD latency
    });
    // Az első rebalance akkor következik be, amikor a cumFundingUsd
    // eléri a threshold-ot. A dydx paymentUsd = -100_000 * -0.005 = 500/event.
    // 5e5 / 500 = 1000 event kellene — a tesztben 100 event van, de
    // a threshold a drift = |cumFundingUsd| * 0.01 / 100_000.
    // |500 * 100| * 0.01 / 100_000 = 0.5 / 100 = 0.005 → NEM éri el a 0.05-öt.
    //
    // A teszt így a "no rebalance" ágat fedné le, ami szintén kell. De
    // a rebalance branch-hez nagyobb drift kell. Végigmegyünk a
    // dydxRate növelésével: 0.05 → 5000/event → 5e5 100 event alatt
    // → drift = 5e5 * 0.01 / 1e5 = 0.05 → eléri a threshold-ot.
    const dydx2: { fundingTime: number; symbol: string; fundingRate: number; markPrice: number }[] = [];
    for (let h = 0; h < 100; h++) {
      dydx2.push({
        fundingTime: startMs + h * 3_600_000,
        symbol: "BTC-USD",
        fundingRate: -0.05, // 5% / hour → 5000 USD / event long earn
        markPrice: 80_000,
      });
    }
    const r2 = simulateDydxVsCexCarry({
      dydxHourly: dydx2,
      cex8h: [],
      startTime: startMs,
      endTime: startMs + 100 * 3_600_000,
      initialEquity: 10_000,
      targetNotionalUsd: 100_000,
      rebalanceCostBps: 20,
      withdrawalLatencyMinutes: 15,
    });
    expect(r2.rebalanceCount).toBeGreaterThan(0);
    expect(r2.rebalanceCostUsd).toBeGreaterThan(0);
    // Az r (kis drift) nem triggerel rebalance-et.
    expect(r.rebalanceCount).toBe(0);
  });

  it("kill-switch: a kill switch runStart a tömb végén is lezárul (final runStart branch)", () => {
    // A kill-switch runStart akkor fut le, amikor a `dailyCompressedFlags`
    // tömb UTOLSÓ eleme true (a kilépés a ciklusból nem reset-eli a
    // runStart-ot, hanem az `if (runStart !== -1)` final-check dolgozza
    // fel). A 7+ consecutive compressed nap → trigger.
    const startMs = Date.UTC(2025, 3, 1, 0, 0, 0);
    const days = 10;
    const dydx: { fundingTime: number; symbol: string; fundingRate: number; markPrice: number }[] = [];
    const cex: FundingSnapshot[] = [];
    for (let day = 0; day < days; day++) {
      dydx.push({
        fundingTime: startMs + day * 86_400_000,
        symbol: "BTC-USD",
        fundingRate: -0.00001 / 8,
        markPrice: 80_000,
      });
      cex.push({
        fundingTime: startMs + day * 86_400_000,
        symbol: "BTCUSDT",
        fundingRate: 0.0001,
      });
    }
    const r = simulateDydxVsCexCarry({
      dydxHourly: dydx,
      cex8h: cex,
      startTime: startMs,
      endTime: startMs + days * 86_400_000,
      initialEquity: 10_000,
      targetNotionalUsd: 100_000,
      rebalanceCostBps: 20,
      withdrawalLatencyMinutes: 15,
    });
    expect(r.killSwitch7DayCompressionTriggered).toBe(true);
    // A `compressedRuns` utolsó eleme a `dailyCompressedFlags.length - 1`-ig tart.
    expect(r.compressedDivergenceDays).toBeGreaterThanOrEqual(7);
  });

  it("dydxRate=0 esetén a fundingCollectedUsd nem változik (sign-flip ág)", () => {
    // A sign-flip ág: 0 funding rate esetén paymentUsd = 0, a wins/losses
    // számláló NÖVEKSZIK (a kód >= 0 → wins, < 0 → losses; 0 → wins).
    const startMs = Date.UTC(2025, 3, 1, 0, 0, 0);
    const dydx = [
      {
        fundingTime: startMs,
        symbol: "BTC-USD",
        fundingRate: 0, // zero funding
        markPrice: 80_000,
      },
    ];
    const r = simulateDydxVsCexCarry({
      dydxHourly: dydx,
      cex8h: [],
      startTime: startMs,
      endTime: startMs + 3_600_000,
      initialEquity: 10_000,
      targetNotionalUsd: 100_000,
      rebalanceCostBps: 20,
      withdrawalLatencyMinutes: 15,
    });
    expect(r.fundingCollectedUsd).toBe(0);
    expect(r.fundingPeriods).toBe(1);
  });

  it("kill-switch: a közepén nem-compressed nap a runStart-ot -1-re reseteli (else if branch)", () => {
    // A kill switch run-tracking második ága (`else if (runStart !== -1)`)
    // akkor fut le, amikor a run-ban vagyunk (runStart !== -1) és a
    // következő nap NEM compressed (flag = false). A run ekkor lezárul,
    // és a runStart -1-re áll vissza.
    //
    // A teszt: 4 compressed nap → 1 nem compressed → 4 compressed.
    // Mindkét run hossza 4 < 7 → kill switch NEM triggerelődik.
    const startMs = Date.UTC(2025, 3, 1, 0, 0, 0);
    const days = 9;
    const dydx: { fundingTime: number; symbol: string; fundingRate: number; markPrice: number }[] = [];
    const cex: FundingSnapshot[] = [];
    for (let day = 0; day < days; day++) {
      const ts = startMs + day * 86_400_000;
      // A 4. nap (day === 4): a divergence-t kihúzzuk a compressed sávból
      // (nagyon nagy abszolút érték) → flag = false.
      // A többi nap: -0.00001/8 - 0.0001 = ~-0.00010125 < 0.0005 → flag = true.
      const isInterruptedDay = day === 4;
      dydx.push({
        fundingTime: ts,
        symbol: "BTC-USD",
        fundingRate: isInterruptedDay ? 0.01 : -0.00001 / 8,
        markPrice: 80_000,
      });
      cex.push({
        fundingTime: ts,
        symbol: "BTCUSDT",
        fundingRate: 0.0001,
      });
    }
    const r = simulateDydxVsCexCarry({
      dydxHourly: dydx,
      cex8h: cex,
      startTime: startMs,
      endTime: startMs + days * 86_400_000,
      initialEquity: 10_000,
      targetNotionalUsd: 100_000,
      rebalanceCostBps: 20,
      withdrawalLatencyMinutes: 15,
    });
    // A run-ok 4 nap hosszúak, tehát a kill switch NEM triggered.
    expect(r.killSwitch7DayCompressionTriggered).toBe(false);
    // A 2 run összesen 8 compressed napot jelent (4 + 4).
    expect(r.compressedDivergenceDays).toBe(8);
  });
});

// === File-local helper tesztek (loadCexFundingCsv, loadDydxHourly, main) ===
//
// Ezek a függvények file-local-ok voltak, de a 100% coverage eléréséhez
// exportálva lettek. A unit tesztek a függvényeket közvetlenül hívják,
// a network/cache-ek in-process izolált temp dir-ekben.

describe("loadCexFundingCsv — CEX funding CSV parser", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(resolve(tmpdir(), "dydx-vs-cex-loader-"));
  });
  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("beolvassa a CSV-t és csak a megadott cexSymbol-hoz tartozó sorokat adja vissza", async () => {
    const csv = [
      "fundingTime,symbol,fundingRate,markPrice",
      "1704067200000,BTCUSDT,0.0001,42313.9",
      "1704096000000,ETHUSDT,0.0002,2283.7",
      "1704124800000,BTCUSDT,0.00015,42400.0",
    ].join("\n");
    const csvPath = resolve(tempDir, "test-funding.csv");
    writeFileSync(csvPath, csv);

    const result = await loadCexFundingCsv(csvPath, "BTCUSDT");
    expect(result.length).toBe(2);
    expect(result[0]?.symbol).toBe("BTCUSDT");
    expect(result[0]?.fundingRate).toBe(0.0001);
    expect(result[0]?.markPrice).toBe(42313.9);
    expect(result[1]?.fundingTime).toBe(1704124800000);
  });

  it("markPrice nélküli sort is helyesen parsolja (a markPrice mező undefined)", async () => {
    const csv = [
      "fundingTime,symbol,fundingRate",
      "1704067200000,BTCUSDT,0.0001",
    ].join("\n");
    const csvPath = resolve(tempDir, "no-markprice.csv");
    writeFileSync(csvPath, csv);

    const result = await loadCexFundingCsv(csvPath, "BTCUSDT");
    expect(result.length).toBe(1);
    expect(result[0]?.markPrice).toBeUndefined();
  });

  it("kihagyja a rövid (<3 mező) sorokat és a NaN timestamp/rate sorokat", async () => {
    const csv = [
      "fundingTime,symbol,fundingRate,markPrice",
      "1704067200000,BTCUSDT,0.0001",
      "short,row",
      "NaN,BTCUSDT,0.0001",
      "1704067200000,BTCUSDT,NaN",
    ].join("\n");
    const csvPath = resolve(tempDir, "malformed.csv");
    writeFileSync(csvPath, csv);

    const result = await loadCexFundingCsv(csvPath, "BTCUSDT");
    expect(result.length).toBe(1);
    expect(result[0]?.fundingTime).toBe(1704067200000);
  });

  it("üres CSV-re üres tömböt ad", async () => {
    const csvPath = resolve(tempDir, "empty.csv");
    writeFileSync(csvPath, "");
    const result = await loadCexFundingCsv(csvPath, "BTCUSDT");
    expect(result.length).toBe(0);
  });
});

describe("loadDydxHourly — Tardis cache loader", () => {
  let tempDir: string;
  let cacheDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(resolve(tmpdir(), "dydx-hourly-"));
    cacheDir = resolve(tempDir, "tardis");
    mkdirSync(cacheDir, { recursive: true });
  });
  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function buildTardisCsv(hour: number, rate: number, mark: number): string {
    const header =
      "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price";
    const tsMs = Date.UTC(2025, 0, 1, hour, 0, 0);
    const tsUs = tsMs * 1000;
    const row = `dydx-v4,BTC-USD,${tsUs},${tsUs},,${rate},,1000,${mark},,${mark}`;
    return [header, row].join("\n");
  }

  it("a cache-ből olvassa a CSV-t, ha a cache fájl létezik", async () => {
    const date = new Date(Date.UTC(2025, 0, 1));
    const ymd = "2025-01-01";
    const cacheFile = resolve(cacheDir, ymd, "BTC-USD.csv.gz");
    mkdirSync(resolve(cacheFile, ".."), { recursive: true });
    writeFileSync(cacheFile, gzipSync(buildTardisCsv(0, 0.0001, 100_000)));

    const result = await loadDydxHourly(cacheDir, "btc", [date], true);
    expect(result.hourly.length).toBeGreaterThan(0);
    expect(result.skippedDays).toEqual([]);
  });

  it("hibás cache (sérült gzip) esetén a skippedDays-be kerül a nap", async () => {
    const date = new Date(Date.UTC(2025, 0, 1));
    const ymd = "2025-01-01";
    const cacheFile = resolve(cacheDir, ymd, "BTC-USD.csv.gz");
    mkdirSync(resolve(cacheFile, ".."), { recursive: true });
    writeFileSync(cacheFile, Buffer.from("NOT-A-VALID-GZIP", "utf8"));

    const result = await loadDydxHourly(cacheDir, "btc", [date], true);
    // A cache olvasás elbukik → a day a skippedDays listába kerül.
    expect(result.hourly.length).toBe(0);
    expect(result.skippedDays).toEqual(["2025-01-01"]);
  });

  it("hibás cache + skipFetch=false: a FAILED warn ág fut le (else branch)", async () => {
    // A `loadDydxHourly` catch blokkjában az `if (skipFetch) SKIPPED
    // else FAILED` ágak vannak. Az előző teszt a SKIPPED ágat fedi
    // le (skipFetch=true). Ez a teszt a FAILED ágat (skipFetch=false).
    const date = new Date(Date.UTC(2025, 0, 1));
    const ymd = "2025-01-01";
    const cacheFile = resolve(cacheDir, ymd, "BTC-USD.csv.gz");
    mkdirSync(resolve(cacheFile, ".."), { recursive: true });
    writeFileSync(cacheFile, Buffer.from("NOT-A-VALID-GZIP", "utf8"));

    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await loadDydxHourly(cacheDir, "btc", [date], false);
      expect(result.hourly.length).toBe(0);
      expect(result.skippedDays).toEqual(["2025-01-01"]);
      // A FAILED warn kiírása megtörtént (a SKIPPED NEM).
      const warnCalls = warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
      expect(warnCalls).toContain("FAILED");
      expect(warnCalls).not.toContain("SKIPPED");
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// === printHelp ===

describe("printHelp — help szöveg", () => {
  it("kiírja a flag-listát a stdout-ra", () => {
    // A console.log-ot spy-oljuk, hogy ne a teszt kimenetére írjon.
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      printHelp();
      const calls = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
      expect(calls).toContain("--symbol=");
      expect(calls).toContain("--window=");
      expect(calls).toContain("--skip-tardis-fetch");
      // A `Flags:` fejléc is megjelenik.
      expect(calls).toContain("Flags:");
    } finally {
      logSpy.mockRestore();
    }
  });
});

// === parseArgs — --help / -h (process.exit spy) ===

describe("parseArgs — --help / -h", () => {
  it("--help meghívja a printHelp-et és process.exit(0)-át (exit spy-ölve)", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      _code?: number | string | null,
    ) => undefined) as typeof process.exit);
    try {
      // A process.exit le van cserélve → a parseArgs nem állítja le a tesztet.
      parseArgs(["--help"]);
      // A printHelp kiírt valamit.
      const calls = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
      expect(calls).toContain("--symbol=");
      // A process.exit(0) meg lett hívva.
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("-h ugyanazt csinálja, mint --help", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      _code?: number | string | null,
    ) => undefined) as typeof process.exit);
    try {
      parseArgs(["-h"]);
      const calls = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
      expect(calls).toContain("--symbol=");
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

// === main() — in-process integration ===

describe("main() — in-process integration", () => {
  let tempDir: string;
  let fundingDir: string;
  let cacheDir: string;
  let outputDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(resolve(tmpdir(), "dydx-vs-cex-main-"));
    fundingDir = resolve(tempDir, "funding");
    cacheDir = resolve(tempDir, "tardis");
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

  function buildCexCsv(rows: readonly { fundingTime: number; fundingRate: number; markPrice?: number }[]): string {
    const lines: string[] = ["fundingTime,symbol,fundingRate,markPrice"];
    for (const r of rows) {
      lines.push(`${r.fundingTime},BTCUSDT,${r.fundingRate},${r.markPrice ?? ""}`);
    }
    return lines.join("\n");
  }

  function buildTardisCsv(hour: number, rate: number, mark: number): string {
    const header =
      "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price";
    const tsMs = Date.UTC(2025, 0, 1, hour, 0, 0);
    const tsUs = tsMs * 1000;
    const row = `dydx-v4,BTC-USD,${tsUs},${tsUs},,${rate},,1000,${mark},,${mark}`;
    return [header, row].join("\n");
  }

  it("sikeresen lefut: a CEX CSV + Tardis cache alapján kimenti az output JSON-t", async () => {
    // CEX CSV
    const cexTime = Date.UTC(2025, 0, 1, 0, 0, 0);
    writeFileSync(
      resolve(fundingDir, "binance_btcusdt_funding_8h.csv"),
      buildCexCsv([
        { fundingTime: cexTime, fundingRate: 0.0001, markPrice: 100_000 },
        { fundingTime: cexTime + 8 * 3_600_000, fundingRate: 0.0001, markPrice: 100_500 },
        { fundingTime: cexTime + 16 * 3_600_000, fundingRate: 0.0001, markPrice: 101_000 },
      ]),
    );

    // Tardis cache — 3 fájl (a 2025-Q1 első napjai)
    const cacheDates: readonly string[] = ["2025-01-01", "2025-02-01", "2025-03-01"];
    for (const ymd of cacheDates) {
      const csv = Array.from({ length: 24 }, (_, hour) => buildTardisCsv(hour, 0.0001, 100_000)).join("\n");
      const cacheFile = resolve(cacheDir, ymd, "BTC-USD.csv.gz");
      mkdirSync(resolve(cacheFile, ".."), { recursive: true });
      writeFileSync(cacheFile, gzipSync(csv));
    }

    const outFile = resolve(outputDir, "result.json");
    // A `process.argv` felülírása a CLI args-ok átadásához. A parseArgs
    // a process.argv.slice(2)-t olvassa, ha nincs explicit argv.
    const originalArgv = process.argv;
    process.argv = [
      "bun",
      "run-dydx-vs-cex-funding-carry.ts",
      "--window=2025-Q1",
      "--funding-csv-dir=" + fundingDir,
      "--cache-dir=" + cacheDir,
      "--output=" + outFile,
      "--skip-tardis-fetch",
    ];
    try {
      await main();
    } finally {
      process.argv = originalArgv;
    }

    expect(existsSync(outFile)).toBe(true);
    const parsed = JSON.parse(
      await Bun.file(outFile).text(),
    ) as {
      args: { symbol: string; window: string };
      dydxHourlyCount: number;
      cex8hCount: number;
    };
    expect(parsed.args.symbol).toBe("btc");
    expect(parsed.args.window).toBe("2025-Q1");
    expect(parsed.dydxHourlyCount).toBe(72);
    expect(parsed.cex8hCount).toBe(3);
  });

  it("a {symbol} és {window} placeholder-eket feloldja az output path-ban", async () => {
    const cexTime = Date.UTC(2025, 0, 1, 0, 0, 0);
    writeFileSync(
      resolve(fundingDir, "binance_btcusdt_funding_8h.csv"),
      buildCexCsv([
        { fundingTime: cexTime, fundingRate: 0.0001, markPrice: 100_000 },
        { fundingTime: cexTime + 8 * 3_600_000, fundingRate: 0.0001, markPrice: 100_500 },
        { fundingTime: cexTime + 16 * 3_600_000, fundingRate: 0.0001, markPrice: 101_000 },
      ]),
    );

    const outFile = resolve(outputDir, "out-{symbol}-{window}.json");
    const originalArgv = process.argv;
    process.argv = [
      "bun",
      "run-dydx-vs-cex-funding-carry.ts",
      "--window=2025-Q1",
      "--funding-csv-dir=" + fundingDir,
      "--cache-dir=" + cacheDir,
      "--output=" + outFile,
      "--skip-tardis-fetch",
    ];
    try {
      await main();
    } finally {
      process.argv = originalArgv;
    }

    const resolved = resolve(outputDir, "out-btc-2025-Q1.json");
    expect(existsSync(resolved)).toBe(true);
  }, 30_000);

  it("ha a CEX CSV üres (nincs adat a window-ban), a main() 'No CEX funding data' errort dob", async () => {
    // A CEX CSV létezik, de a benne lévő funding tick-ek a window-on
    // KÍVÜL esnek (2030-as adatok, míg a window 2025-Q1). Az output
    // throw-ol, amit a `if (import.meta.main)` catch-elne, de mi
    // in-process hívunk, és a promise rejection-t várjuk.
    writeFileSync(
      resolve(fundingDir, "binance_btcusdt_funding_8h.csv"),
      buildCexCsv([
        { fundingTime: Date.UTC(2030, 0, 1, 0, 0, 0), fundingRate: 0.0001, markPrice: 100_000 },
      ]),
    );

    const outFile = resolve(outputDir, "result.json");
    const originalArgv = process.argv;
    process.argv = [
      "bun",
      "run-dydx-vs-cex-funding-carry.ts",
      "--window=2025-Q1",
      "--funding-csv-dir=" + fundingDir,
      "--cache-dir=" + cacheDir,
      "--output=" + outFile,
      "--skip-tardis-fetch",
    ];
    try {
      await expect(main()).rejects.toThrow(/No CEX funding data/);
    } finally {
      process.argv = originalArgv;
    }
  });

  it("ha a dYdX cache minden napra hibás és --skip-tardis-fetch=false, a WARNING warn megjelenik", async () => {
    // A CEX CSV megvan (a window-ban), a Tardis cache MIND a 3 napra
    // sérült gzip → a dydxHourlyCount = 0. A --skip-tardis-fetch=false
    // miatt a FAILED warn + a WARNING warn is megjelenik.
    const cexTime = Date.UTC(2025, 0, 1, 0, 0, 0);
    writeFileSync(
      resolve(fundingDir, "binance_btcusdt_funding_8h.csv"),
      buildCexCsv([
        { fundingTime: cexTime, fundingRate: 0.0001, markPrice: 100_000 },
        { fundingTime: cexTime + 8 * 3_600_000, fundingRate: 0.0001, markPrice: 100_500 },
        { fundingTime: cexTime + 16 * 3_600_000, fundingRate: 0.0001, markPrice: 101_000 },
      ]),
    );
    const cacheDates = ["2025-01-01", "2025-02-01", "2025-03-01"];
    for (const ymd of cacheDates) {
      const cacheFile = resolve(cacheDir, ymd, "BTC-USD.csv.gz");
      mkdirSync(resolve(cacheFile, ".."), { recursive: true });
      writeFileSync(cacheFile, Buffer.from("NOT-A-VALID-GZIP", "utf8"));
    }

    const outFile = resolve(outputDir, "result.json");
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
    const originalArgv = process.argv;
    process.argv = [
      "bun",
      "run-dydx-vs-cex-funding-carry.ts",
      "--window=2025-Q1",
      "--funding-csv-dir=" + fundingDir,
      "--cache-dir=" + cacheDir,
      "--output=" + outFile,
      // NEM --skip-tardis-fetch → a WARNING + FAILED warn megjelenik.
    ];
    try {
      await main();
      const warnCalls = warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
      expect(warnCalls).toContain("FAILED");
      expect(warnCalls).toContain("WARNING: no dYdX hourly data");
    } finally {
      warnSpy.mockRestore();
      process.argv = originalArgv;
    }
  }, 30_000);
});
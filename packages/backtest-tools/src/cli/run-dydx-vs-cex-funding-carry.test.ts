// packages/backtest-tools/src/cli/run-dydx-vs-cex-funding-carry.test.ts —
// unit tests for the pure-functional carry-simulation core.

import { describe, expect, it } from "bun:test";
import type { FundingSnapshot } from "@mm-crypto-bot/core";

import {
  parseArgs,
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
  void dydxPositive;
});
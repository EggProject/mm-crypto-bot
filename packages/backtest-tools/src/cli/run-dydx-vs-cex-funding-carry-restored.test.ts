import { describe, expect, it } from "bun:test";

import type { FundingSnapshot } from "@mm-crypto-bot/core";
import { ExactRational } from "@mm-crypto-bot/numeric";

import type { DydxHourlyFunding } from "../data/tardis-dydx-funding.js";
import { assessDydxCoverage, parseCliArguments, WINDOW_DEFS } from "./dydx-vs-cex-carry-data.js";
import { simulateDydxVsCexCarry } from "./dydx-vs-cex-carry-simulation.js";

const exact = (value: string): ExactRational => ExactRational.from(value);
const start = Date.UTC(2025, 3, 1);

function dydx(fundingTime: number, fundingRate: string): DydxHourlyFunding {
  return { fundingTime, symbol: "BTC-USD", fundingRate: exact(fundingRate), markPrice: exact("80000") };
}

function cex(fundingTime: number, fundingRate: string): FundingSnapshot {
  return { fundingTime, symbol: "BTCUSDT", fundingRate: exact(fundingRate), markPrice: exact("80000") };
}

const exactOptions = {
  startTime: start,
  endTime: start + 3_600_000,
  initialEquity: "1000",
  targetNotionalUsd: "10000",
  rebalanceCostBps: "1",
  withdrawalLatencyMinutes: "1",
};

describe("restored dYdX carry CLI sidecar scenarios", () => {
  it("alapértelmezett értékeket ad vissza ha nincs flag", () => {
    const arguments_ = parseCliArguments([]);
    expect(arguments_.symbol).toBe("btc");
    expect(arguments_.window).toBe("2025-Q1");
    expect(arguments_.initialEquity).toBe("10000");
    expect(arguments_.targetNotionalUsd).toBe("250000");
    expect(arguments_.rebalanceCostBps).toBe("20");
    expect(arguments_.withdrawalLatencyMinutes).toBe("15");
    expect(arguments_.skipTardisFetch).toBe(false);
  });

  it("parseolja az explicit zászlókat", () => {
    const arguments_ = parseCliArguments([
      "--symbol=eth",
      "--window=2026-Q1",
      "--equity=50000",
      "--notional=100000",
      "--rebalance-bps=30",
      "--latency=10",
      "--output=/tmp/foo.json",
      "--skip-tardis-fetch",
    ]);
    expect(arguments_.symbol).toBe("eth");
    expect(arguments_.window).toBe("2026-Q1");
    expect(arguments_.initialEquity).toBe("50000");
    expect(arguments_.targetNotionalUsd).toBe("100000");
    expect(arguments_.rebalanceCostBps).toBe("30");
    expect(arguments_.withdrawalLatencyMinutes).toBe("10");
    expect(arguments_.outputPath).toBe("/tmp/foo.json");
    expect(arguments_.skipTardisFetch).toBe(true);
  });

  it("elutasítja az ismeretlen symbol-t", () => {
    expect(() => parseCliArguments(["--symbol=DOGE"])).toThrow();
  });

  it("elutasítja az ismeretlen window-t", () => {
    expect(() => parseCliArguments(["--window=2030-Q1"])).toThrow();
  });

  it("kezeli a case-insensitive symbol inputot", () => {
    expect(parseCliArguments(["--symbol=BTC"]).symbol).toBe("btc");
    expect(parseCliArguments(["--symbol=Eth"]).symbol).toBe("eth");
    expect(parseCliArguments(["--symbol=SOL"]).symbol).toBe("sol");
  });

  it("a sűrű, küszöb feletti mintát elfogadja", () => {
    const rows = Array.from({ length: 9 }, (_, index) => dydx(start + index * 3_600_000, "0.0001"));
    const coverage = assessDydxCoverage(rows, start, start + 10 * 3_600_000);
    expect(coverage.status).toBe("SUFFICIENT");
    expect(coverage.hourlyCoverageRatio).toBe(0.9);
    expect(coverage.dailyCoverageRatio).toBe(1);
  });

  it("minden ablakhoz van start, end és legalább 1 tardisDay", () => {
    for (const window of Object.values(WINDOW_DEFS)) {
      const expectedDays = Math.round((window.end.getTime() - window.start.getTime()) / 86_400_000) + 1;
      expect(window.tardisDays).toHaveLength(expectedDays);
      expect(window.tardisDays[0]?.getTime()).toBe(window.start.getTime());
      expect(window.tardisDays.at(-1)?.getTime()).toBe(window.end.getTime());
    }
  });

  it("long dYdX + short CEX: pozitív carry ha mindkettő pozitív", () => {
    const result = simulateDydxVsCexCarry({
      ...exactOptions,
      dydxHourly: [dydx(start, "0.001")],
      cex8h: [cex(start, "0.002")],
    });
    expect(result.fundingPeriods).toBe(2);
    expect(result.fundingCollectedUsd.equals(exact("10"))).toBe(true);
  });

  it("long dYdX: negatív funding = earn (sign-flip a FundingCarry konvencióhoz)", () => {
    const result = simulateDydxVsCexCarry({
      ...exactOptions,
      dydxHourly: [dydx(start, "-0.001")],
      cex8h: [],
    });
    expect(result.fundingCollectedUsd.equals(exact("10"))).toBe(true);
  });

  it("dydx és cex event azonos timestamp-en: a merge hurok a cexRate-et is kitölti", () => {
    const result = simulateDydxVsCexCarry({
      ...exactOptions,
      dydxHourly: [dydx(start, "0.001")],
      cex8h: [cex(start, "0.002")],
    });
    expect(result.fundingPeriods).toBe(2);
    expect(result.equityCurve[0]?.cex8hRate?.equals(exact("0.002"))).toBe(true);
    expect(result.equityCurve[0]?.divergence?.equals(exact("0.006"))).toBe(true);
  });

  it("dydxRate=0 esetén a fundingCollectedUsd nem változik (sign-flip ág)", () => {
    const result = simulateDydxVsCexCarry({ ...exactOptions, dydxHourly: [dydx(start, "0")], cex8h: [] });
    expect(result.fundingCollectedUsd.equals(exact("0"))).toBe(true);
    expect(result.fundingPeriods).toBe(1);
  });

  it("rejects noncanonical direct simulation configuration before exact replay", () => {
    expect(() =>
      simulateDydxVsCexCarry({
        ...exactOptions,
        initialEquity: "01000",
        dydxHourly: [],
        cex8h: [],
      }),
    ).toThrow("initialEquity must be a canonical positive decimal");
    expect(() =>
      simulateDydxVsCexCarry({
        ...exactOptions,
        initialEquity: "0",
        dydxHourly: [],
        cex8h: [],
      }),
    ).toThrow("initialEquity must be a canonical positive decimal");
  });
});

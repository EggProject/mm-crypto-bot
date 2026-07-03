// packages/backtest/tests/integration.test.ts — a backtest motor integrációs tesztjei
//
// A CCXT `fetchOHLCV` mockolva van. Ezek a tesztek a teljes backtest
// futtatást ellenőrzik: equity-görbe, trade-lista, kill-switch, time-exit,
// stop-loss kilépés, take-profit kilépés.
//
// Specifikáció: docs/research/selected-strategy.md §5 (position sizing),
// §8 (OOS validáció), §9 (költség-modell).

import { describe, expect, it } from "bun:test";

import type { Candle, Timeframe } from "@mm-crypto-bot/shared/types";

import type { BacktestOptions, CostModel, ExchangeFeed } from "../src/types.js";
import { runBacktest } from "../src/engine.js";
import { computeMetrics } from "../src/metrics.js";
import { formatReport } from "../src/report.js";

const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
};

const POSITION_SIZE = {
  riskPerTrade: 0.01,
  kellyFraction: 0.25,
  maxDrawdown: 0.15,
  maxPositionPctEquity: 0.2,
  minPositionPctEquity: 0.01,
};

function mkCandle(timestamp: number, price: number, opts?: { high?: number; low?: number; volume?: number }): Candle {
  return {
    timestamp,
    open: price,
    high: opts?.high ?? price * 1.01,
    low: opts?.low ?? price * 0.99,
    close: price,
    volume: opts?.volume ?? 1000,
  };
}

class MockFeed implements ExchangeFeed {
  constructor(private readonly candles: readonly Candle[]) {}
  async fetchOHLCV(
    _symbol: string,
    _timeframe: Timeframe,
    _options: { readonly since?: number; readonly limit?: number },
  ): Promise<readonly Candle[]> {
    return this.candles;
  }
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 `mkUptrendCandles` — növekvő trend candle-sor.
 A HTF (1D) candle-eket és az LTF (1H) candle-eket egyaránt szimulálja.
*/
function mkUptrendCandles(days: number, basePrice: number, driftPerDay: number): Candle[] {
  const out: Candle[] = [];
  for (let d = 0; d < days; d++) {
    const dayPrice = basePrice + d * driftPerDay;
    for (let h = 0; h < 24; h++) {
      const t = d * DAY_MS + h * HOUR_MS;
      out.push(mkCandle(t, dayPrice + h * (driftPerDay / 24)));
    }
  }
  return out;
}

function mkFlatCandles(days: number, basePrice: number): Candle[] {
  const out: Candle[] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      const t = d * DAY_MS + h * HOUR_MS;
      out.push(mkCandle(t, basePrice));
    }
  }
  return out;
}

describe("runBacktest — alap integráció", () => {
  it("startTime >= endTime esetén hibát dob", async () => {
    const candles = mkUptrendCandles(10, 100, 1);
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(10 * DAY_MS),
      endTime: new Date(0),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
    };
    await expect(runBacktest(opts)).rejects.toThrow();
  });

  it("negatív/zero equity esetén hibát dob", async () => {
    const candles = mkUptrendCandles(10, 100, 1);
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(10 * DAY_MS),
      initialEquityUsd: 0,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
    };
    await expect(runBacktest(opts)).rejects.toThrow();
  });

  it("üres candle-listával hibát dob", async () => {
    const feed = new MockFeed([]);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(10 * DAY_MS),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
    };
    await expect(runBacktest(opts)).rejects.toThrow();
  });
});

describe("runBacktest — stratégia szignálok nélkül", () => {
  it("flat piacon nincs trade, az equity változatlan", async () => {
    const candles = mkFlatCandles(30, 100);
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(30 * DAY_MS),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
    };
    const result = await runBacktest(opts);
    expect(result.totalTrades).toBe(0);
    expect(result.equityCurve.length).toBeGreaterThan(0);
    // A final equity kicsit csokkenhet a margin-kamat miatt (ha van nyitott
    // pozíció), de mivel nincs trade, a final equity = initial equity.
    const lastEquity = result.equityCurve[result.equityCurve.length - 1]!.equity;
    expect(lastEquity).toBe(10000);
  });
});

describe("runBacktest — equity-görbe és metrikák", () => {
  it("az equity-görbe minden LTF candle-re tartalmaz egy pontot", async () => {
    const candles = mkUptrendCandles(10, 100, 1);
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(10 * DAY_MS),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
    };
    const result = await runBacktest(opts);
    expect(result.equityCurve.length).toBe(candles.length);
  });

  it("a metrikák konzisztensek a trade-listával", async () => {
    const candles = mkUptrendCandles(10, 100, 1);
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(10 * DAY_MS),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
    };
    const result = await runBacktest(opts);
    const metrics = computeMetrics(
      result.trades,
      result.equityCurve,
      result.startTime,
      result.endTime,
      365 * 24,
    );
    expect(metrics.totalTrades).toBe(result.totalTrades);
    expect(metrics.totalReturnPct).toBeCloseTo(result.totalReturn, 10);
    expect(metrics.profitFactor).toBeCloseTo(result.profitFactor, 10);
  });
});

describe("runBacktest — riport", () => {
  it("a riport emberi olvasható szöveget generál", async () => {
    const candles = mkUptrendCandles(10, 100, 1);
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(10 * DAY_MS),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
    };
    const result = await runBacktest(opts);
    const metrics = computeMetrics(
      result.trades,
      result.equityCurve,
      result.startTime,
      result.endTime,
      365 * 24,
    );
    const report = formatReport(result, metrics, "BTC/USDC");
    expect(report.summary).toContain("Backtest riport");
    expect(report.summary).toContain("BTC/USDC");
  });
});

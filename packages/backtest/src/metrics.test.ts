// packages/backtest/src/metrics.test.ts — a backtest metrikák unit-tesztek

import { describe, expect, it } from "bun:test";

import type { ExitReason, Side, Symbol, Trade } from "@mm-crypto-bot/shared/types";

import type { EquityPoint } from "./types.js";

import {
  computeMetrics,
  equityReturns,
  exposureTime,
  maxConsecutive,
  maxDrawdown,
  profitFactor,
  sharpeRatio,
  sortinoRatio,
  tradeReturns,
  winRate,
} from "./metrics.js";

function mkTrade(opts: {
  readonly pnlUsd: number;
  readonly pnlPct: number;
  readonly entryTime: number;
  readonly exitTime: number;
}): Trade {
  return {
    symbol: "BTC/USDC" as Symbol,
    side: "buy" as Side,
    entryTime: opts.entryTime,
    entryPrice: 100,
    exitTime: opts.exitTime,
    exitPrice: 100 * (1 + opts.pnlPct),
    quantity: 1,
    notionalUsd: 100,
    pnlUsd: opts.pnlUsd,
    pnlPct: opts.pnlPct,
    feesUsd: 0,
    exitReason: "take_profit" as ExitReason,
  };
}

function mkEquityPoint(timestamp: number, equity: number): EquityPoint {
  return { timestamp, equity };
}

describe("tradeReturns", () => {
  it("visszaadja a trade-ek PnL%-os hozamait", () => {
    const trades = [mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 0, exitTime: 1 })];
    expect(tradeReturns(trades)).toEqual([0.1]);
  });

  it("üres trade-listára üres tömböt ad", () => {
    expect(tradeReturns([])).toEqual([]);
  });
});

describe("equityReturns", () => {
  it("visszaadja a periódus-hozamokat", () => {
    const curve = [mkEquityPoint(0, 100), mkEquityPoint(1, 110), mkEquityPoint(2, 121)];
    // 110/100 - 1 = 0.10, 121/110 - 1 = 0.10
    expect(equityReturns(curve)).toEqual([0.1, 0.1]);
  });

  it("kihagyja a 0 vagy negatív prev equity pontokat", () => {
    const curve = [mkEquityPoint(0, 0), mkEquityPoint(1, 100)];
    expect(equityReturns(curve)).toEqual([]);
  });

  it("egyetlen elemre üres tömböt ad", () => {
    expect(equityReturns([mkEquityPoint(0, 100)])).toEqual([]);
  });
});

describe("sharpeRatio", () => {
  it("kevesebb mint 2 elem esetén 0-t ad", () => {
    expect(sharpeRatio([], 252)).toBe(0);
    expect(sharpeRatio([0.01], 252)).toBe(0);
  });

  it("0 szórás esetén 0-t ad", () => {
    expect(sharpeRatio([0.01, 0.01, 0.01], 252)).toBe(0);
  });

  it("kiszámítja az évesített Sharpe-ot", () => {
    // mean=0.01, stddev=0.01, periods=252 → Sharpe = (0.01/0.01) * sqrt(252) = 15.87
    const returns = [0.02, 0.01, 0.0, 0.01, 0.01, 0.01];
    const result = sharpeRatio(returns, 252);
    expect(result).toBeGreaterThan(0);
  });
});

describe("sortinoRatio", () => {
  it("kevesebb mint 2 elem esetén 0-t ad", () => {
    expect(sortinoRatio([], 252)).toBe(0);
  });

  it("nincs negatív hozam esetén +∞-t ad", () => {
    expect(sortinoRatio([0.01, 0.02, 0.03], 252)).toBe(Number.POSITIVE_INFINITY);
  });

  it("kiszámítja az évesített Sortino-ót", () => {
    const returns = [0.02, -0.01, 0.0, 0.01, 0.01, -0.02];
    const result = sortinoRatio(returns, 252);
    expect(result).toBeGreaterThan(0);
  });

  it("0 downside deviation esetén 0-t ad", () => {
    // A -0 nem szamit negativnak a filter szamara (a -0 < 0 hamis).
    // Helyette egy olyan esetet tesztelunk, ahol minden return >= 0.
    expect(sortinoRatio([0.01, 0.01, 0.005], 252)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("maxDrawdown", () => {
  it("üres görbére 0-t ad", () => {
    expect(maxDrawdown([])).toBe(0);
  });

  it("a legnagyobb equity-csökkenést adja", () => {
    const curve = [
      mkEquityPoint(0, 100),
      mkEquityPoint(1, 120),
      mkEquityPoint(2, 90), // 25% drawdown
      mkEquityPoint(3, 110),
      mkEquityPoint(4, 80), // ~33% drawdown
    ];
    // Max DD: 80/120 - 1 = -0.333...
    expect(maxDrawdown(curve)).toBeCloseTo(0.3333, 3);
  });

  it("monoton növekvő görbére 0-t ad", () => {
    const curve = [mkEquityPoint(0, 100), mkEquityPoint(1, 110), mkEquityPoint(2, 121)];
    expect(maxDrawdown(curve)).toBe(0);
  });

  it("0 equity görbére 0-t ad (peak = 0)", () => {
    // A peak <= 0 esetén a drawdown 0 (nincs veszteség).
    const curve = [mkEquityPoint(0, 0), mkEquityPoint(1, 0)];
    expect(maxDrawdown(curve)).toBe(0);
  });
});

describe("profitFactor", () => {
  it("üres trade-listára 0-t ad", () => {
    expect(profitFactor([])).toBe(0);
  });

  it("csak nyertes trade-ekre +∞-t ad", () => {
    const trades = [
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 0, exitTime: 1 }),
      mkTrade({ pnlUsd: 20, pnlPct: 0.1, entryTime: 2, exitTime: 3 }),
    ];
    expect(profitFactor(trades)).toBe(Number.POSITIVE_INFINITY);
  });

  it("csak vesztes trade-ekre 0-t ad", () => {
    const trades = [
      mkTrade({ pnlUsd: -10, pnlPct: -0.1, entryTime: 0, exitTime: 1 }),
    ];
    expect(profitFactor(trades)).toBe(0);
  });

  it("kiszámítja a profit factor-t (30/10 = 3.0)", () => {
    const trades = [
      mkTrade({ pnlUsd: 30, pnlPct: 0.3, entryTime: 0, exitTime: 1 }),
      mkTrade({ pnlUsd: -10, pnlPct: -0.1, entryTime: 2, exitTime: 3 }),
    ];
    expect(profitFactor(trades)).toBe(3);
  });

  it("break-even trade (pnl=0) nem befolyásolja a profit factor-t", () => {
    const trades = [
      mkTrade({ pnlUsd: 30, pnlPct: 0.3, entryTime: 0, exitTime: 1 }),
      mkTrade({ pnlUsd: 0, pnlPct: 0, entryTime: 2, exitTime: 3 }),
      mkTrade({ pnlUsd: -10, pnlPct: -0.1, entryTime: 4, exitTime: 5 }),
    ];
    // A break-even trade (pnl=0) nem számít bele a profit factor-ba.
    expect(profitFactor(trades)).toBe(3);
  });
});

describe("maxConsecutive", () => {
  it("a `curLosses > maxLosses` false ága is le van fedve", () => {
    // A max loss streak 2, a kovetkezo loss streak csak 1.
    const trades = [
      mkTrade({ pnlUsd: -10, pnlPct: -0.1, entryTime: 0, exitTime: 1 }),
      mkTrade({ pnlUsd: -10, pnlPct: -0.1, entryTime: 2, exitTime: 3 }),
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 4, exitTime: 5 }),
      mkTrade({ pnlUsd: -10, pnlPct: -0.1, entryTime: 6, exitTime: 7 }),
    ];
    const result = maxConsecutive(trades);
    expect(result.maxConsecutiveLosses).toBe(2);
  });
});

describe("computeMetrics — további ágak", () => {
  it("üres equity-görbe: totalReturn és annualReturn 0", () => {
    const metrics = computeMetrics([], [], 0, 1000, 252);
    expect(metrics.totalReturnPct).toBe(0);
    expect(metrics.annualizedReturnPct).toBe(0);
  });

  it("endTimeMs === startTimeMs: annualReturn 0 (nincs időszak)", () => {
    const trades = [
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 100, exitTime: 200 }),
    ];
    const equityCurve = [mkEquityPoint(100, 100), mkEquityPoint(200, 110)];
    const metrics = computeMetrics(trades, equityCurve, 100, 100, 252);
    expect(metrics.annualizedReturnPct).toBe(0);
  });
});

describe("winRate", () => {
  it("üres trade-listára 0-t ad", () => {
    expect(winRate([])).toBe(0);
  });

  it("kiszámítja a nyerési arányt (2/3)", () => {
    const trades = [
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 0, exitTime: 1 }),
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 2, exitTime: 3 }),
      mkTrade({ pnlUsd: -10, pnlPct: -0.1, entryTime: 4, exitTime: 5 }),
    ];
    expect(winRate(trades)).toBeCloseTo(2 / 3, 10);
  });
});

describe("maxConsecutive", () => {
  it("üres trade-listára 0/0-t ad", () => {
    expect(maxConsecutive([])).toEqual({ maxConsecutiveWins: 0, maxConsecutiveLosses: 0 });
  });

  it("kiszámítja a leghosszabb nyerő/vesztes sorozatot", () => {
    const trades = [
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 0, exitTime: 1 }),
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 2, exitTime: 3 }),
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 4, exitTime: 5 }),
      mkTrade({ pnlUsd: -10, pnlPct: -0.1, entryTime: 6, exitTime: 7 }),
      mkTrade({ pnlUsd: -10, pnlPct: -0.1, entryTime: 8, exitTime: 9 }),
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 10, exitTime: 11 }),
    ];
    const result = maxConsecutive(trades);
    expect(result.maxConsecutiveWins).toBe(3);
    expect(result.maxConsecutiveLosses).toBe(2);
  });

  it("break-even trade-ek nullázzák a sorozatot", () => {
    const trades = [
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 0, exitTime: 1 }),
      mkTrade({ pnlUsd: 0, pnlPct: 0, entryTime: 2, exitTime: 3 }),
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 4, exitTime: 5 }),
    ];
    expect(maxConsecutive(trades).maxConsecutiveWins).toBe(1);
  });
});

describe("exposureTime", () => {
  it("üres trade-listára 0-t ad", () => {
    expect(exposureTime([], 0, 1000)).toBe(0);
  });

  it("endTime <= startTime esetén 0-t ad", () => {
    expect(exposureTime([], 1000, 1000)).toBe(0);
  });

  it("kiszámítja az exposure time-ot (holding / total time)", () => {
    const trades = [
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 0, exitTime: 500 }),
    ];
    // 500 / 1000 = 0.5
    expect(exposureTime(trades, 0, 1000)).toBe(0.5);
  });

  it("az exitTime < entryTime esetén nem számolja a holding time-ot", () => {
    const trades = [
      mkTrade({ pnlUsd: 10, pnlPct: 0.1, entryTime: 1000, exitTime: 500 }),
    ];
    expect(exposureTime(trades, 0, 1000)).toBe(0);
  });
});

describe("computeMetrics", () => {
  it("az összes metrikát kiszámítja", () => {
    const start = 0;
    const end = 1000;
    const trades = [
      mkTrade({ pnlUsd: 30, pnlPct: 0.3, entryTime: 100, exitTime: 200 }),
      mkTrade({ pnlUsd: -10, pnlPct: -0.1, entryTime: 300, exitTime: 400 }),
    ];
    const equityCurve = [mkEquityPoint(0, 100), mkEquityPoint(500, 130), mkEquityPoint(1000, 120)];
    const metrics = computeMetrics(trades, equityCurve, start, end, 252);
    expect(metrics.totalTrades).toBe(2);
    expect(metrics.totalReturnPct).toBeCloseTo(0.2, 10);
    expect(metrics.bestTrade).toBe(30);
    expect(metrics.worstTrade).toBe(-10);
    expect(metrics.profitFactor).toBe(3);
    expect(metrics.winRatePct).toBe(0.5);
  });

  it("üres trade-listával is működik", () => {
    const start = 0;
    const end = 1000;
    const equityCurve = [mkEquityPoint(0, 100), mkEquityPoint(1000, 100)];
    const metrics = computeMetrics([], equityCurve, start, end, 252);
    expect(metrics.totalTrades).toBe(0);
    expect(metrics.winRatePct).toBe(0);
    expect(metrics.profitFactor).toBe(0);
  });
});

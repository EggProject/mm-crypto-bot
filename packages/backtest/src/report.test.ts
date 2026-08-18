// packages/backtest/src/report.test.ts — a riport-generator unit-tesztek

import { describe, expect, it } from "bun:test";

import type { BacktestResult, EquityPoint } from "./types.js";

import { formatJsonReport, formatReport, formatTradeListCsv } from "./report.js";

function mkResult(): BacktestResult {
  const equityCurve: EquityPoint[] = [
    { timestamp: 0, equity: 10_000 },
    { timestamp: 1000, equity: 11_000 },
    { timestamp: 2000, equity: 10_500 },
  ];
  return {
    totalReturn: 0.05,
    annualizedReturn: 0.1,
    sharpeRatio: 1.5,
    sortinoRatio: 2,
    maxDrawdown: 0.1,
    profitFactor: 1.5,
    winRate: 0.6,
    totalTrades: 3,
    trades: [
      {
        symbol: "BTC/USDC" as never,
        side: "buy",
        entryTime: 100,
        entryPrice: 100,
        exitTime: 200,
        exitPrice: 110,
        quantity: 1,
        notionalUsd: 100,
        pnlUsd: 10,
        pnlPct: 0.1,
        feesUsd: 1,
        exitReason: "take_profit",
      },
    ],
    equityCurve,
    killSwitchTriggered: false,
    startTime: 0,
    endTime: 2000,
  };
}

function mkMetrics() {
  return {
    totalReturnPct: 0.05,
    annualizedReturnPct: 0.1,
    sharpeRatio: 1.5,
    sortinoRatio: 2,
    maxDrawdownPct: 0.1,
    profitFactor: 1.5,
    winRatePct: 0.6,
    totalTrades: 3,
    avgWin: 10,
    avgLoss: -5,
    avgWinPct: 0.1,
    avgLossPct: -0.05,
    bestTrade: 10,
    worstTrade: -5,
    maxConsecutiveWins: 2,
    maxConsecutiveLosses: 1,
    exposureTime: 0.5,
  };
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new TypeError(`Expected ${label} to be a JSON object.`);
  }
  return value;
}

function requireSummary(record: Readonly<Record<string, unknown>>): string {
  const value = ownField(record, "summary");
  if (typeof value !== "string") {
    throw new TypeError("Expected report.summary to be a string.");
  }
  return value;
}

function requireResult(record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return requireRecord(ownField(record, "result"), "report.result");
}

function requireTotalReturn(record: Readonly<Record<string, unknown>>): number {
  const value = ownField(record, "totalReturn");
  if (typeof value !== "number") {
    throw new TypeError("Expected result.totalReturn to be a number.");
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownField(record: Readonly<Record<string, unknown>>, field: string): unknown {
  return Object.entries(record).find(([key]) => key === field)?.[1];
}

describe("formatReport", () => {
  it("emberi olvasható riportot general", () => {
    const report = formatReport(mkResult(), mkMetrics(), "BTC/USDC");
    expect(report.summary).toContain("Backtest riport");
    expect(report.summary).toContain("BTC/USDC");
    expect(report.summary).toContain("Sharpe ratio");
    expect(report.summary).toContain("Max drawdown");
    expect(report.summary).toContain("Trade-lista");
  });

  it("a minősítés a minimum-mutatók alapján történik", () => {
    const report = formatReport(mkResult(), mkMetrics(), "BTC/USDC");
    expect(report.summary).toContain("Sharpe ratio >= 1.0");
    expect(report.summary).toContain("Max drawdown <= 30%");
  });

  it("a BacktestReport tartalmazza a result-ot és a metrics-eket", () => {
    const report = formatReport(mkResult(), mkMetrics(), "BTC/USDC");
    expect(report.result).toBeDefined();
    expect(report.metrics).toBeDefined();
  });

  it("üres equity-görbét is kezeli (0 Kezdő/Végső equity)", () => {
    const emptyResult: BacktestResult = {
      totalReturn: 0,
      annualizedReturn: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      profitFactor: 0,
      winRate: 0,
      totalTrades: 0,
      trades: [],
      equityCurve: [],
      killSwitchTriggered: false,
      startTime: 0,
      endTime: 1000,
    };
    const report = formatReport(emptyResult, mkMetrics(), "BTC/USDC");
    expect(report.summary).toContain("Kezdő equity: $0.00");
    expect(report.summary).toContain("Végső equity: $0.00");
  });

  it("a killSwitchTriggered = true ágat is lekezeli ('igen')", () => {
    const triggeredResult: BacktestResult = {
      totalReturn: -0.1,
      annualizedReturn: -0.5,
      sharpeRatio: -1,
      sortinoRatio: -1,
      maxDrawdown: 0.2,
      profitFactor: 0,
      winRate: 0,
      totalTrades: 1,
      trades: [
        {
          symbol: "BTC/USDC" as never,
          side: "buy",
          entryTime: 0,
          entryPrice: 100,
          exitTime: 1000,
          exitPrice: 90,
          quantity: 1,
          notionalUsd: 100,
          pnlUsd: -10,
          pnlPct: -0.1,
          feesUsd: 0,
          exitReason: "kill_switch",
        },
      ],
      equityCurve: [
        { timestamp: 0, equity: 10_000 },
        { timestamp: 1000, equity: 9000 },
      ],
      killSwitchTriggered: true,
      startTime: 0,
      endTime: 1000,
    };
    const report = formatReport(triggeredResult, mkMetrics(), "BTC/USDC");
    expect(report.summary).toContain("Kill-switch triggered: igen");
  });
});

describe("formatJsonReport", () => {
  it("JSON formátumban adja vissza a riportot", () => {
    const json = formatJsonReport(formatReport(mkResult(), mkMetrics(), "BTC/USDC"));
    const parsed: unknown = JSON.parse(json);
    const report = requireRecord(parsed, "report");
    const result = requireResult(report);

    expect(requireSummary(report)).toContain("Backtest riport");
    expect(requireTotalReturn(result)).toBe(0.05);
  });
});

describe("formatTradeListCsv", () => {
  it("CSV formátumban adja vissza a trade-listát", () => {
    const csv = formatTradeListCsv(mkResult());
    const lines = csv.split("\n");
    expect(lines.length).toBe(2); // header + 1 trade
    expect(lines[0]).toContain("entryTime");
    expect(lines[0]).toContain("exitTime");
    expect(lines[0]).toContain("side");
    expect(lines[1]).toContain("buy");
  });
});

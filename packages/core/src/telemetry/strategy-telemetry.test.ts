// packages/core/src/telemetry/strategy-telemetry.test.ts — per-strategy telemetry tests
//
// Phase 10G Track B — ≥10 unit tests covering:
//   - PnL attribution across 2-3 strategies
//   - Per-strategy Sharpe rolling window
//   - Cross-strategy correlation update
//   - State snapshot serializability
//   - Kill-switch: disable mid-flight, verify no further signals
//   - CSV / JSON export formatting
//   - Determinism
//   - Edge cases: 0 strategies, missing data, single bar

import { describe, expect, test } from "bun:test";

import {
  DEFAULT_STRATEGY_TELEMETRY_CONFIG,
  StrategyTelemetry,
  type TradeRecord,
} from "./strategy-telemetry.js";
import type { SizingSignal } from "../risk/portfolio-risk-engine.js";

const DAY_MS = 86_400_000;

function makeTrade(
  source: string,
  pnl: number,
  timestamp: number,
  symbol = "BTC/USDT",
  notional = 10_000,
): TradeRecord {
  return {
    source,
    symbol,
    timestamp,
    notionalUsd: notional,
    pnlUsd: pnl,
    side: pnl >= 0 ? "long" : "short",
  };
}

function makeSizing(source: string, ts: number, symbol = "BTC/USDT"): SizingSignal {
  return {
    kind: "sizing",
    source,
    symbol,
    effectiveNotionalUsd: 50_000,
    leverage: 10,
    timestamp: ts,
  };
}

// ----------------------------------------------------------------------
// Trade attribution across 2-3 strategies
// ----------------------------------------------------------------------

describe("StrategyTelemetry — PnL attribution", () => {
  test("attribution: 3 strategies, distinct PnLs → correct attribution", () => {
    const tele = new StrategyTelemetry();
    for (let i = 0; i < 10; i++) {
      tele.recordTrade(makeTrade("donchian", 100, DAY_MS * (i + 1)));
      tele.recordTrade(makeTrade("mtf", 50, DAY_MS * (i + 1), "ETH/USDT"));
      tele.recordTrade(makeTrade("carry", 25, DAY_MS * (i + 1), "SOL/USDT"));
    }
    const stats = tele.allPerStrategyStats();
    expect(stats.length).toBe(3);
    const bySource = new Map(stats.map((s) => [s.source, s]));
    expect(bySource.get("donchian")!.totalPnlUsd).toBeCloseTo(1000, 4);
    expect(bySource.get("mtf")!.totalPnlUsd).toBeCloseTo(500, 4);
    expect(bySource.get("carry")!.totalPnlUsd).toBeCloseTo(250, 4);
    expect(bySource.get("donchian")!.tradeCount).toBe(10);
    expect(bySource.get("mtf")!.tradeCount).toBe(10);
    expect(bySource.get("carry")!.tradeCount).toBe(10);
  });

  test("win rate calculation: 7 wins, 3 losses → 0.70", () => {
    const tele = new StrategyTelemetry();
    for (let i = 0; i < 7; i++) tele.recordTrade(makeTrade("A", 100, DAY_MS * (i + 1)));
    for (let i = 7; i < 10; i++) tele.recordTrade(makeTrade("A", -50, DAY_MS * (i + 1)));
    const stats = tele.perStrategyStats("A");
    expect(stats).not.toBeNull();
    expect(stats!.winCount).toBe(7);
    expect(stats!.lossCount).toBe(3);
    expect(stats!.winRate).toBeCloseTo(0.7, 4);
  });

  test("per-strategy Sharpe computed from trades", () => {
    const tele = new StrategyTelemetry();
    // Varying returns — some wins, some losses → std > 0 → Sharpe defined.
    const pnls = [100, 200, -50, 150, 80, -30, 120, 90, -20, 110];
    for (let i = 0; i < pnls.length; i++) tele.recordTrade(makeTrade("A", pnls[i]!, DAY_MS * (i + 1)));
    const stats = tele.perStrategyStats("A");
    expect(stats!.sharpe).toBeGreaterThan(0);
  });

  test("per-strategy max drawdown computed correctly", () => {
    const tele = new StrategyTelemetry();
    // Sequence: +200, +200, -500, +100, +200 → peak 400, DD to -100. Need ≥5 trades.
    tele.recordTrade(makeTrade("A", 200, DAY_MS));
    tele.recordTrade(makeTrade("A", 200, DAY_MS * 2));
    tele.recordTrade(makeTrade("A", -500, DAY_MS * 3));
    tele.recordTrade(makeTrade("A", 100, DAY_MS * 4));
    tele.recordTrade(makeTrade("A", 50, DAY_MS * 5));
    const stats = tele.perStrategyStats("A");
    // Cumulative: 200, 400, -100, 0, 50. Peak = 400. Max DD = (400 - (-100)) / 400 = 1.25.
    expect(stats!.maxDrawdownPct).toBeCloseTo(1.25, 4);
  });
});

// ----------------------------------------------------------------------
// Per-strategy Sharpe rolling window
// ----------------------------------------------------------------------

describe("StrategyTelemetry — per-strategy Sharpe rolling window", () => {
  test("returns series truncated to windowDays", () => {
    const tele = new StrategyTelemetry({ ...DEFAULT_STRATEGY_TELEMETRY_CONFIG, sharpeWindowDays: 5 });
    for (let i = 0; i < 20; i++) {
      tele.recordReturn("A", DAY_MS * (i + 1), 0.01 * (i % 2 === 0 ? 1 : -1));
    }
    // The perStrategyStats uses trade-based Sharpe (independent of return series).
    // We verify the return series is truncated via the snapshot correlation
    // (which uses the same series).
    for (let i = 0; i < 20; i++) {
      tele.recordReturn("B", DAY_MS * (i + 1), 0.02 * (i % 2 === 0 ? 1 : -1));
    }
    const corr = tele.correlationMatrix();
    expect(corr).not.toBeNull();
    expect(corr!.observationCount).toBe(5);
  });
});

// ----------------------------------------------------------------------
// Cross-strategy correlation update on each new bar
// ----------------------------------------------------------------------

describe("StrategyTelemetry — cross-strategy correlation update", () => {
  test("correlation matrix updates as new returns arrive", () => {
    const tele = new StrategyTelemetry();
    // First 5 observations: perfectly correlated (varying returns → non-zero std).
    const aReturns = [0.01, 0.02, -0.01, 0.03, -0.02];
    for (let i = 0; i < aReturns.length; i++) {
      tele.recordReturn("A", DAY_MS * (i + 1), aReturns[i]!);
      tele.recordReturn("B", DAY_MS * (i + 1), aReturns[i]!);
    }
    const c1 = tele.correlationMatrix();
    expect(c1!.matrix[0]![1]).toBeCloseTo(1, 4);

    // Now add 5 more observations: anti-correlated.
    for (let i = 5; i < 10; i++) {
      tele.recordReturn("A", DAY_MS * (i + 1), 0.01);
      tele.recordReturn("B", DAY_MS * (i + 1), -0.01);
    }
    const c2 = tele.correlationMatrix();
    // Correlation should now be lower (mix of +1 and -1 periods).
    expect(c2!.matrix[0]![1]).toBeLessThan(1);
    expect(c2!.matrix[0]![1]).toBeGreaterThan(-1);
  });

  test("<2 sources → correlation returns null", () => {
    const tele = new StrategyTelemetry();
    tele.recordReturn("A", DAY_MS, 0.01);
    expect(tele.correlationMatrix()).toBeNull();
  });
});

// ----------------------------------------------------------------------
// State snapshot serializability
// ----------------------------------------------------------------------

describe("StrategyTelemetry — snapshot serializability", () => {
  test("snapshot is JSON-roundtrip safe", () => {
    const tele = new StrategyTelemetry();
    for (let i = 0; i < 10; i++) {
      tele.recordTrade(makeTrade("A", 100, DAY_MS * (i + 1)));
      tele.recordReturn("A", DAY_MS * (i + 1), 0.01);
    }
    const snap = tele.snapshot();
    const json = JSON.stringify(snap);
    const parsed = JSON.parse(json);
    expect(parsed.numStrategies).toBe(1);
    expect(parsed.totalTrades).toBe(10);
    expect(parsed.perStrategy.length).toBe(1);
    expect(parsed.perStrategy[0].source).toBe("A");
  });

  test("snapshot with kill-switch events → history preserved", () => {
    const tele = new StrategyTelemetry();
    tele.disablePlugin("bad-plugin", "over-trading");
    const snap = tele.snapshot();
    expect(snap.numDisabledStrategies).toBe(1);
    expect(snap.killSwitchHistory.length).toBe(1);
    expect(snap.killSwitchHistory[0]!.source).toBe("bad-plugin");
  });
});

// ----------------------------------------------------------------------
// Kill-switch: disable mid-flight
// ----------------------------------------------------------------------

describe("StrategyTelemetry — kill-switch (plugin disable/enable)", () => {
  test("disablePlugin → subsequent submitSignal drops the signal", () => {
    const tele = new StrategyTelemetry();
    expect(tele.submitSignal(makeSizing("good", DAY_MS))).toBe(true);
    tele.disablePlugin("good", "manual pause");
    expect(tele.submitSignal(makeSizing("good", DAY_MS * 2))).toBe(false);
  });

  test("kill-switch latches — disable persists until enablePlugin", () => {
    const tele = new StrategyTelemetry();
    tele.disablePlugin("A", "test");
    expect(tele.isPluginDisabled("A")).toBe(true);
    // Even after time passes, still disabled.
    expect(tele.isPluginDisabled("A")).toBe(true);
    tele.enablePlugin("A");
    expect(tele.isPluginDisabled("A")).toBe(false);
  });

  test("enablePlugin on already-enabled plugin is a no-op", () => {
    const tele = new StrategyTelemetry();
    tele.enablePlugin("never-disabled", "test");
    expect(tele.getKillSwitchHistory().length).toBe(0);
  });

  test("kill-switch history records disable + enable with reasons", () => {
    const tele = new StrategyTelemetry();
    tele.disablePlugin("A", "excessive losses");
    tele.disablePlugin("B", "regime shift");
    tele.enablePlugin("A", "manual reset after review");
    const hist = tele.getKillSwitchHistory();
    expect(hist.length).toBe(3);
    expect(hist[0]!.action).toBe("disable");
    expect(hist[1]!.action).toBe("disable");
    expect(hist[2]!.action).toBe("enable");
    expect(hist[2]!.source).toBe("A");
  });

  test("disablePlugin twice → last disable wins (idempotent update)", () => {
    const tele = new StrategyTelemetry();
    tele.disablePlugin("A", "first reason");
    const firstTime = tele.getKillSwitchHistory()[0]!.timestamp;
    // Wait a tick.
    const t0 = Date.now();
    while (Date.now() === t0) {
      // spin briefly
    }
    tele.disablePlugin("A", "second reason");
    const stats = tele.perStrategyStats("A");
    // disabledAt updated (will be ≥ firstTime)
    expect(stats).toBeNull(); // no trades yet
    expect(tele.getKillSwitchHistory().length).toBe(2);
    // The latest disable is the second event.
    expect(tele.getKillSwitchHistory()[1]!.reason).toBe("second reason");
    // disabledAt timestamp should be ≥ firstTime.
    expect(tele.getKillSwitchHistory()[1]!.timestamp).toBeGreaterThanOrEqual(firstTime);
  });

  test("disabled plugins list reflects current state", () => {
    const tele = new StrategyTelemetry();
    expect(tele.getDisabledPlugins()).toEqual([]);
    tele.disablePlugin("A", "test");
    tele.disablePlugin("B", "test");
    expect([...tele.getDisabledPlugins()].sort()).toEqual(["A", "B"]);
    tele.enablePlugin("A");
    expect(tele.getDisabledPlugins()).toEqual(["B"]);
  });
});

// ----------------------------------------------------------------------
// CSV / JSON export
// ----------------------------------------------------------------------

describe("StrategyTelemetry — export", () => {
  test("exportCsv produces valid CSV with header", () => {
    const tele = new StrategyTelemetry();
    tele.recordTrade(makeTrade("A", 100, DAY_MS));
    tele.recordTrade(makeTrade("B", -50, DAY_MS * 2, "ETH/USDT"));
    const csv = tele.exportCsv();
    const lines = csv.split("\n");
    expect(lines[0]).toBe("source,symbol,timestamp,side,notionalUsd,pnlUsd");
    expect(lines.length).toBe(3); // header + 2 trades
    expect(lines[1]).toContain("A");
    expect(lines[2]).toContain("B");
  });

  test("exportCsv handles delimiter-in-value via escaping", () => {
    const tele = new StrategyTelemetry({ ...DEFAULT_STRATEGY_TELEMETRY_CONFIG, exportDelimiter: "," });
    tele.recordTrade({
      source: "weird,name",
      symbol: "BTC/USDT",
      timestamp: DAY_MS,
      notionalUsd: 1000,
      pnlUsd: 50,
      side: "long",
    });
    const csv = tele.exportCsv();
    expect(csv).toContain('"weird,name"');
  });

  test("exportJson returns valid JSON matching snapshot", () => {
    const tele = new StrategyTelemetry({ ...DEFAULT_STRATEGY_TELEMETRY_CONFIG, minTradeCount: 0 });
    tele.recordTrade(makeTrade("A", 100, DAY_MS));
    const json = tele.exportJson();
    const parsed = JSON.parse(json);
    expect(parsed.numStrategies).toBe(1);
    expect(parsed.perStrategy[0].source).toBe("A");
  });

  test("exportPerStrategyCsv includes winRate, sharpe, maxDD columns", () => {
    const tele = new StrategyTelemetry();
    for (let i = 0; i < 10; i++) tele.recordTrade(makeTrade("A", i % 2 === 0 ? 100 : -50, DAY_MS * (i + 1)));
    const csv = tele.exportPerStrategyCsv();
    const lines = csv.split("\n");
    expect(lines[0]).toContain("source");
    expect(lines[0]).toContain("winRate");
    expect(lines[0]).toContain("sharpe");
    expect(lines[0]).toContain("maxDrawdownPct");
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("A");
  });
});

// ----------------------------------------------------------------------
// Determinism
// ----------------------------------------------------------------------

describe("StrategyTelemetry — determinism", () => {
  test("identical input → identical snapshot across runs", () => {
    const runOnce = () => {
      const tele = new StrategyTelemetry();
      for (let i = 0; i < 10; i++) {
        tele.recordTrade(makeTrade("A", 100, DAY_MS * (i + 1)));
        tele.recordTrade(makeTrade("B", -50, DAY_MS * (i + 1), "ETH/USDT"));
        tele.recordReturn("A", DAY_MS * (i + 1), 0.01);
        tele.recordReturn("B", DAY_MS * (i + 1), 0.02);
      }
      // Disable timestamp-dependent fields for comparison.
      const snap = tele.snapshot();
      // Override timestamp for deterministic comparison (spread to break readonly).
      const normalized = { ...snap, timestamp: 0 };
      return normalized;
    };
    const s1 = runOnce();
    const s2 = runOnce();
    // Compare JSON without the timestamp field.
    const normalize = (snap: typeof s1) => ({ ...snap, timestamp: 0 });
    expect(JSON.stringify(normalize(s1))).toBe(JSON.stringify(normalize(s2)));
  });

  test("CSV export is deterministic for fixed input", () => {
    const runOnce = () => {
      const tele = new StrategyTelemetry();
      for (let i = 0; i < 5; i++) tele.recordTrade(makeTrade("A", 100, DAY_MS * (i + 1)));
      return tele.exportCsv();
    };
    expect(runOnce()).toBe(runOnce());
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe("StrategyTelemetry — edge cases", () => {
  test("0 strategies → snapshot has 0 strategies, 0 trades, null correlation", () => {
    const tele = new StrategyTelemetry();
    const snap = tele.snapshot();
    expect(snap.numStrategies).toBe(0);
    expect(snap.numActiveStrategies).toBe(0);
    expect(snap.totalTrades).toBe(0);
    expect(snap.correlationMatrix).toBeNull();
  });

  test("single trade → per-strategy stats null (below minTradeCount=5)", () => {
    const tele = new StrategyTelemetry();
    tele.recordTrade(makeTrade("A", 100, DAY_MS));
    expect(tele.perStrategyStats("A")).toBeNull();
  });

  test("single bar (1 observation per source) → correlation matrix requires 2", () => {
    const tele = new StrategyTelemetry();
    tele.recordReturn("A", DAY_MS, 0.01);
    tele.recordReturn("B", DAY_MS, 0.02);
    expect(tele.correlationMatrix()).toBeNull(); // need ≥2 common obs
  });

  test("clear() resets all state including kill-switch history", () => {
    const tele = new StrategyTelemetry();
    tele.recordTrade(makeTrade("A", 100, DAY_MS));
    tele.disablePlugin("B", "test");
    tele.clear();
    const snap = tele.snapshot();
    expect(snap.numStrategies).toBe(0);
    expect(snap.killSwitchHistory.length).toBe(0);
    expect(tele.getDisabledPlugins()).toEqual([]);
  });

  test("invalid config: negative sharpeWindowDays → throws", () => {
    expect(
      () => new StrategyTelemetry({ ...DEFAULT_STRATEGY_TELEMETRY_CONFIG, sharpeWindowDays: -1 }),
    ).toThrow(/sharpeWindowDays/);
  });

  test("invalid config: non-integer minTradeCount → throws", () => {
    expect(
      () => new StrategyTelemetry({ ...DEFAULT_STRATEGY_TELEMETRY_CONFIG, minTradeCount: 1.5 }),
    ).toThrow(/minTradeCount/);
  });
});

// ----------------------------------------------------------------------
// minTradeCount=0 allows per-strategy stats with 1 trade (for diagnostic use)
// ----------------------------------------------------------------------

describe("StrategyTelemetry — minTradeCount=0 (diagnostic mode)", () => {
  it("minTradeCount=0 → 1 trade produces stats", () => {
    const tele = new StrategyTelemetry({ ...DEFAULT_STRATEGY_TELEMETRY_CONFIG, minTradeCount: 0 });
    tele.recordTrade(makeTrade("A", 100, DAY_MS));
    const stats = tele.perStrategyStats("A");
    expect(stats).not.toBeNull();
    expect(stats!.tradeCount).toBe(1);
  });
});

describe("StrategyTelemetry — getTradeCount", () => {
  test("returns 0 when no trades recorded", () => {
    const tele = new StrategyTelemetry(DEFAULT_STRATEGY_TELEMETRY_CONFIG);
    expect(tele.getTradeCount()).toBe(0);
  });

  test("sums trade counts across all sources", () => {
    const tele = new StrategyTelemetry(DEFAULT_STRATEGY_TELEMETRY_CONFIG);
    tele.recordTrade(makeTrade("A", 100, DAY_MS));
    tele.recordTrade(makeTrade("A", 50, DAY_MS * 2));
    tele.recordTrade(makeTrade("B", -20, DAY_MS * 3));
    expect(tele.getTradeCount()).toBe(3);
  });

  test("includes trades across all perSourceTrades entries", () => {
    const tele = new StrategyTelemetry(DEFAULT_STRATEGY_TELEMETRY_CONFIG);
    for (const id of ["A", "B", "C", "D", "E"] as const) {
      for (let i = 0; i < 3; i++) {
        tele.recordTrade(makeTrade(id, 10, DAY_MS * (i + 1)));
      }
    }
    expect(tele.getTradeCount()).toBe(15);
  });
});
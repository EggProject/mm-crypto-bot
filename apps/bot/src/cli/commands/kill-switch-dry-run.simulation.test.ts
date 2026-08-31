import { describe, expect, it } from "bun:test";

import {
  buildClosures,
  buildReport,
  formatJsonLogLines,
  formatTelegramAlert,
  shouldTrigger,
} from "./kill-switch-dry-run.js";
import { makePosition, makeState, parseJsonRecord } from "./kill-switch-dry-run.test-support.js";

describe("buildClosures", () => {
  it("returns an empty list when there are no positions", () => {
    const closures = buildClosures(makeState());
    expect(closures).toEqual([]);
  });

  it("maps a single position correctly", () => {
    const position = makePosition({ symbol: "ETH/USDC", side: "short", quantity: 2, leverage: 7 });
    const closures = buildClosures(makeState({ positions: [position] }));
    expect(closures).toHaveLength(1);
    const [closure] = closures;
    expect(closure?.symbol).toBe("ETH/USDC");
    expect(closure?.side).toBe("short");
    expect(closure?.quantity).toBe(2);
    expect(closure?.leverage).toBe(7);
    expect(closure?.notionalUsd).toBe(position.notionalUsd);
    expect(closure?.estLossUsd).toBe(position.unrealizedPnl);
  });

  it("preserves all 3 positions in order", () => {
    const positions = [
      makePosition({ id: "p-1", symbol: "BTC/USDC" }),
      makePosition({ id: "p-2", symbol: "ETH/USDC" }),
      makePosition({ id: "p-3", symbol: "SOL/USDC" }),
    ];
    const closures = buildClosures(makeState({ positions }));
    expect(closures.map((closure) => closure.id)).toEqual(["p-1", "p-2", "p-3"]);
    expect(closures).toHaveLength(3);
  });
});

describe("formatTelegramAlert", () => {
  it("formats the alert for an empty list", () => {
    const text = formatTelegramAlert([], 0, 0, 1_700_000_000_000, "/tmp/state.json");
    expect(text).toContain("KILL-SWITCH TRIGGERED (DRY-RUN)");
    expect(text).toContain("positions=0");
    expect(text).toContain("total notional: $0.00");
    expect(text).toContain("est. P&L: $0.00");
  });

  it("includes the state file path and ISO timestamp", () => {
    const text = formatTelegramAlert([], 0, 0, 1_700_000_000_000, "/data/bot-state.json");
    expect(text).toContain("/data/bot-state.json");
    expect(text).toContain("2023-11-14T22:13:20.000Z");
  });

  it("includes each position in the alert", () => {
    const closures = [makePosition({ id: "p-1", strategy: "donchian" })].map((position) => ({
      id: position.id,
      strategy: position.strategy,
      symbol: position.symbol,
      side: position.side,
      quantity: position.quantity,
      notionalUsd: position.notionalUsd,
      estLossUsd: position.unrealizedPnl,
      leverage: position.leverage,
    }));
    const text = formatTelegramAlert(closures, 15_000, 500, 1_700_000_000_000, "/s.json");
    expect(text).toContain("positions=1");
    expect(text).toContain("BTC/USDC LONG 0.5");
    expect(text).toContain("lev 5x");
    expect(text).toContain("notional $15000.00");
    expect(text).toContain("est. P&L $500.00");
  });
});

describe("formatJsonLogLines", () => {
  it("emits only the summary line when the closures list is empty", () => {
    const lines = formatJsonLogLines([], 0, 0, 1_700_000_000_000, "/s.json");
    expect(lines).toHaveLength(1);
    const parsed = parseJsonRecord(lines[0] ?? "");
    expect(parsed["level"]).toBe("error");
    expect(parsed["tag"]).toBe("kill-switch-dry-run");
    expect(parsed["positions"]).toBe(0);
    expect(parsed["totalNotionalUsd"]).toBe(0);
    expect(parsed["totalEstLossUsd"]).toBe(0);
  });

  it("emits a per-position line for each closure", () => {
    const closures = buildClosures(
      makeState({
        positions: [
          makePosition({ id: "p-1" }),
          makePosition({
            id: "p-2",
            symbol: "ETH/USDC",
            side: "short",
            quantity: 1,
            notionalUsd: 2000,
            unrealizedPnl: -100,
            leverage: 3,
          }),
        ],
      }),
    );
    const lines = formatJsonLogLines(closures, 17_000, 400, 1_700_000_000_000, "/s.json");
    expect(lines).toHaveLength(3);
    const summary = parseJsonRecord(lines[0] ?? "");
    expect(summary["positions"]).toBe(2);
    expect(summary["totalNotionalUsd"]).toBe(17_000);
    const firstPosition = parseJsonRecord(lines[1] ?? "");
    expect(firstPosition["symbol"]).toBe("BTC/USDC");
    expect(firstPosition["positionId"]).toBe("p-1");
    const secondPosition = parseJsonRecord(lines[2] ?? "");
    expect(secondPosition["symbol"]).toBe("ETH/USDC");
    expect(secondPosition["side"]).toBe("short");
  });
});

describe("shouldTrigger", () => {
  it("returns false when there are no positions", () => {
    expect(shouldTrigger(makeState({ equityUsd: 5000 }), 0.15)).toBe(false);
  });

  it("returns true when drawdown >= threshold and positions exist", () => {
    const state = makeState({ equityUsd: 8000, initialEquityUsd: 10_000, positions: [makePosition()] });
    expect(shouldTrigger(state, 0.15)).toBe(true);
  });

  it("returns false when drawdown < threshold and positions exist", () => {
    const state = makeState({ equityUsd: 9000, initialEquityUsd: 10_000, positions: [makePosition()] });
    expect(shouldTrigger(state, 0.15)).toBe(false);
  });

  it("returns true when drawdown exactly equals threshold", () => {
    const state = makeState({ equityUsd: 8500, initialEquityUsd: 10_000, positions: [makePosition()] });
    expect(shouldTrigger(state, 0.15)).toBe(true);
  });

  it("returns false when initialEquityUsd is 0 (defensive — no division by zero)", () => {
    const state = makeState({ equityUsd: 0, initialEquityUsd: 0, positions: [makePosition()] });
    expect(shouldTrigger(state, 0.15)).toBe(false);
  });
});

describe("buildReport", () => {
  it("uses Date.now() when generatedAt is not provided", () => {
    const before = Date.now();
    const report = buildReport({
      state: makeState(),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    const after = Date.now();
    expect(report.generatedAt).toBeGreaterThanOrEqual(before);
    expect(report.generatedAt).toBeLessThanOrEqual(after);
  });

  it("uses the explicit generatedAt when provided", () => {
    const report = buildReport({
      state: makeState(),
      stateFilePath: "/s.json",
      configPath: "/c.toml",
      maxDrawdownPct: 0.15,
      generatedAt: 1_700_000_000_000,
    });
    expect(report.generatedAt).toBe(1_700_000_000_000);
    expect(report.configPath).toBe("/c.toml");
  });

  it("sets wouldTrigger=true and 'breached' description when drawdown > threshold", () => {
    const report = buildReport({
      state: makeState({ equityUsd: 7000, initialEquityUsd: 10_000, positions: [makePosition()] }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    expect(report.wouldTrigger).toBe(true);
    expect(report.killSwitchDescription).toContain("breached");
  });

  it("sets wouldTrigger=false and 'within budget' description when drawdown < threshold", () => {
    const report = buildReport({
      state: makeState({ equityUsd: 9500, initialEquityUsd: 10_000, positions: [makePosition()] }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    expect(report.wouldTrigger).toBe(false);
    expect(report.killSwitchDescription).toContain("within budget");
  });

  it("sums total notional + est P&L across multiple positions", () => {
    const positions = [
      makePosition({ notionalUsd: 1000, unrealizedPnl: 100 }),
      makePosition({ notionalUsd: 2000, unrealizedPnl: -50 }),
      makePosition({ notionalUsd: 500, unrealizedPnl: 25 }),
    ];
    const report = buildReport({
      state: makeState({ positions }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    expect(report.totalNotionalUsd).toBe(3500);
    expect(report.totalEstLossUsd).toBe(75);
  });

  it("builds the telegram alert + JSON log lines", () => {
    const report = buildReport({
      state: makeState({ positions: [makePosition()] }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    expect(report.telegramAlertText).toContain("KILL-SWITCH TRIGGERED (DRY-RUN)");
    expect(report.jsonLogLines).toHaveLength(2);
  });
});

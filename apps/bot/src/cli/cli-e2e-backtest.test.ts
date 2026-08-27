import { describe, expect, it } from "bun:test";

import { runCli } from "./cli-e2e-test-support.test.js";

describe("CLI backtest end-to-end", () => {
  it("mm-bot backtest exposes help and rejects each invalid numeric boundary", async () => {
    const help = await runCli(["backtest"], { caseId: "backtest-help" });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: bun run apps/bot/src/index.ts backtest");

    const bars = await runCli(["backtest", "ohlc-trend", "--bars=49"], {
      caseId: "backtest-invalid-bars",
    });
    expect(bars.code).toBe(1);
    expect(bars.stderr).toContain("Invalid --bars");

    const risk = await runCli(["backtest", "ohlc-trend", "--risk-pct=2"], {
      caseId: "backtest-invalid-risk",
    });
    expect(risk.code).toBe(1);
    expect(risk.stderr).toContain("Invalid --risk-pct");

    const equity = await runCli(["backtest", "ohlc-trend", "--initial-equity=0"], {
      caseId: "backtest-invalid-equity",
    });
    expect(equity.code).toBe(1);
    expect(equity.stderr).toContain("Invalid --initial-equity");
  });
});

it("mm-bot backtest covers unknown, no-trade, and traded fixture results", async () => {
  const unknown = await runCli(["backtest", "missing-strategy"], {
    caseId: "backtest-unknown-strategy",
  });
  expect(unknown.code).toBe(1);
  expect(unknown.stderr).toContain("Unknown strategy");

  const noTrades = await runCli(["backtest", "ohlc-trend", "--bars=100"], {
    caseId: "backtest-no-trades",
  });
  expect(noTrades.code).toBe(0);
  expect(noTrades.stdout).toContain("No trades were triggered");

  const trades = await runCli(
    [
      "backtest",
      "ignored",
      "--strategy=ohlc-trend",
      "--bars=600",
      "--risk-pct=0.02",
      "--initial-equity=12000",
      "--timeframe=4h",
    ],
    { caseId: "backtest-trades" },
  );
  expect(trades.code).toBe(0);
  expect(trades.stdout).toContain("Backtest complete");
  expect(trades.stdout).toContain("Timeframe: 4h");
});

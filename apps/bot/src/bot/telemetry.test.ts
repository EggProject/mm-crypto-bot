/**
 * apps/bot/src/bot/telemetry.test.ts
 *
 * A `Telemetry` unit tesztjei — log structure, metrics emit, formatUptime.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Telemetry, computeDrawdownPct, formatUptime } from "./telemetry.js";

describe("Telemetry", () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-telemetry-"));
    logDir = join(tmpDir, "logs");
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("emits metrics to daily log file", () => {
    const t = new Telemetry({
      logDir,
      metricsIntervalSec: 60,
      snapshotProvider: () => ({
        equityUsd: 11_000,
        initialEquityUsd: 10_000,
        realizedPnlUsd: 1_000,
        unrealizedPnlUsd: 0,
        drawdownPct: 0,
        openPositions: 1,
        maxPositions: 3,
        counters: { placed: 5, filled: 4, cancelled: 1, rejected: 0 },
        killSwitchEngaged: false,
        killSwitchReasons: [],
        uptime: 60_000,
        uptimeHuman: "1m 0s",
        activeStrategies: ["donchian_pivot_composition"],
      }),
    });
    t.emitMetrics();
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(logDir, `bot-${date}.log`);
    expect(existsSync(filePath)).toBe(true);
    const raw = readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0] as string) as { kind: string; equityUsd: number };
    expect(parsed.kind).toBe("metrics");
    expect(parsed.equityUsd).toBe(11_000);
  });

  it("setEngaged() updates kill-switch state in next metrics", () => {
    const t = new Telemetry({
      logDir,
      snapshotProvider: () => ({
        equityUsd: 10_000,
        initialEquityUsd: 10_000,
        realizedPnlUsd: 0,
        unrealizedPnlUsd: 0,
        drawdownPct: 0,
        openPositions: 0,
        maxPositions: 3,
        counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
        killSwitchEngaged: false,
        killSwitchReasons: [],
        uptime: 0,
        uptimeHuman: "0s",
        activeStrategies: [],
      }),
    });
    t.setEngaged(true, ["max-drawdown", "latency-gate"]);
    t.emitMetrics();
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(logDir, `bot-${date}.log`);
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as { killSwitchEngaged: boolean; killSwitchReasons: string[] };
    expect(parsed.killSwitchEngaged).toBe(true);
    expect(parsed.killSwitchReasons).toEqual(["max-drawdown", "latency-gate"]);
  });

  it("start() and stop() manage the interval lifecycle", () => {
    const t = new Telemetry({
      logDir,
      metricsIntervalSec: 60,
      snapshotProvider: () => ({
        equityUsd: 0,
        initialEquityUsd: 0,
        realizedPnlUsd: 0,
        unrealizedPnlUsd: 0,
        drawdownPct: 0,
        openPositions: 0,
        maxPositions: 0,
        counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
        killSwitchEngaged: false,
        killSwitchReasons: [],
        uptime: 0,
        uptimeHuman: "0s",
        activeStrategies: [],
      }),
    });
    t.start();
    t.stop();
    t.stop(); // idempotent
  });

  it("getLogger() returns a Logger with debug/info/warn/error methods", () => {
    const t = new Telemetry({ logDir, snapshotProvider: () => emptySnap() });
    const logger = t.getLogger();
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });
});

describe("formatUptime", () => {
  it("formats seconds", () => {
    expect(formatUptime(5_000)).toBe("5s");
    expect(formatUptime(59_000)).toBe("59s");
  });
  it("formats minutes", () => {
    expect(formatUptime(60_000)).toBe("1m 0s");
    expect(formatUptime(125_000)).toBe("2m 5s");
  });
  it("formats hours", () => {
    expect(formatUptime(3_600_000)).toBe("1h 0m");
    expect(formatUptime(3_725_000)).toBe("1h 2m");
  });
  it("handles negative", () => {
    expect(formatUptime(-1)).toBe("0s");
  });
});

describe("computeDrawdownPct", () => {
  it("returns 0 if peak is 0", () => {
    expect(computeDrawdownPct(100, 100, 0)).toBe(0);
  });
  it("returns 0 at peak", () => {
    expect(computeDrawdownPct(10_000, 10_000, 10_000)).toBe(0);
  });
  it("computes drawdown from peak", () => {
    expect(computeDrawdownPct(8_000, 10_000, 10_000)).toBeCloseTo(0.2);
  });
  it("returns 0 if equity > peak (no drawdown)", () => {
    expect(computeDrawdownPct(12_000, 10_000, 10_000)).toBe(0);
  });
});

function emptySnap() {
  return {
    equityUsd: 0,
    initialEquityUsd: 0,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    drawdownPct: 0,
    openPositions: 0,
    maxPositions: 0,
    counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    killSwitchEngaged: false,
    killSwitchReasons: [],
    uptime: 0,
    uptimeHuman: "0s",
    activeStrategies: [],
  };
}

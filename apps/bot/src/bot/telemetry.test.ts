/**
 * apps/bot/src/bot/telemetry.test.ts
 *
 * A `Telemetry` unit tesztjei — log structure, metrics emit, formatUptime.
 */

import { describe, expect, it } from "bun:test";

import { RecordingLogger } from "@logging-testing";
import { Telemetry as RuntimeTelemetry, computeDrawdownPct, formatUptime } from "./telemetry.js";

class Telemetry extends RuntimeTelemetry {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimeTelemetry>) {
    const [options] = arguments_;
    super({ ...options, logger: options.logger ?? new RecordingLogger() });
  }
}

describe("Telemetry", () => {
  it("emits metrics through the injected structured logger", () => {
    const logger = new RecordingLogger();
    const t = new Telemetry({
      logger,
      metricsIntervalSec: 60,
      snapshotProvider: () => ({
        equityUsd: 11_000,
        initialEquityUsd: 10_000,
        realizedPnlUsd: 1000,
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
    const metricsCall = logger.getCalls().find((call) => call.event === "telemetry.metrics.observed");
    if (metricsCall === undefined) throw new Error("expected telemetry metrics log call");
    expect(metricsCall.level).toBe("info");
    expect(metricsCall.fields).toMatchObject({ equityUsd: 11_000 });
  });

  it("setEngaged() updates kill-switch state in next metrics", () => {
    const logger = new RecordingLogger();
    const t = new Telemetry({
      logger,
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
    const metricsCall = logger.getCalls().find((call) => call.event === "telemetry.metrics.observed");
    if (metricsCall === undefined) throw new Error("expected telemetry metrics log call");
    expect(metricsCall.level).toBe("info");
    expect(metricsCall.fields).toMatchObject({
      killSwitchEngaged: true,
      killSwitchReasons: ["max-drawdown", "latency-gate"],
    });
  });

  it("start() and stop() manage the interval lifecycle", () => {
    const t = new Telemetry({
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
    t.start();
    t.stop();
    t.stop(); // idempotent
  });

  it("getLogger() returns a Logger with debug/info/warn/error methods", () => {
    const t = new Telemetry({ snapshotProvider: () => emptySnap() });
    const logger = t.getLogger();
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.critical).toBe("function");
  });
});

describe("formatUptime", () => {
  it("formats seconds", () => {
    expect(formatUptime(5000)).toBe("5s");
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
    expect(computeDrawdownPct(8000, 10_000, 10_000)).toBeCloseTo(0.2);
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

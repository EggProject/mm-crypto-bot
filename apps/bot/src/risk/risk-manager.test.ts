/**
 * apps/bot/src/risk/risk-manager.test.ts
 *
 * Unit tests for the `RiskManager` orchestrator. Targets 100% line +
 * branch coverage. The orchestrator's job is to wire the three
 * sub-modules together; the per-module logic is tested in the
 * individual test files.
 */

import { describe, expect, it } from "bun:test";

import { RecordingLogger } from "@logging-testing";
import { RiskManager as RuntimeRiskManager } from "./risk-manager.js";
import type { TrailingStopCloseEvent } from "./risk-manager.js";

class RiskManager extends RuntimeRiskManager {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimeRiskManager>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}

const BASE_CONFIG = {
  trailingStop: {
    enabled: true,
    atrPeriod: 14,
    atrMultiplier: 3,
    side: "both" as const,
  },
  kelly: {
    enabled: true,
    fraction: 0.25,
    windowSize: 50,
    minTrades: 10,
    fallbackFraction: 0.01,
    maxFraction: 0.1,
  },
  drawdownScaler: {
    enabled: true,
    maxDdPct: 0.2,
    initialEquity: 10_000,
  },
};

describe("RiskManager", () => {
  // -------------------------------------------------------------------------
  // Constructor — instantiates sub-modules
  // -------------------------------------------------------------------------
  it("constructor instantiates all three sub-modules", () => {
    const rm = new RiskManager(BASE_CONFIG);
    expect(rm.getTrailingStopManager().isEnabled()).toBe(true);
    expect(rm.getKellySizer().isEnabled()).toBe(true);
    expect(rm.getDrawdownScaler().getState().enabled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // onTick — fires close callback on breach
  // -------------------------------------------------------------------------
  it("onTick fires close callback when trailing stop breaches", () => {
    const rm = new RiskManager(BASE_CONFIG);
    rm.armTrailingStop("a:BTC/USDC:long", "long", 60_000, 100);
    const events: TrailingStopCloseEvent[] = [];
    rm.onTrailingStopClose((event) => {
      events.push(event);
    });
    // Move favorably
    rm.onTick({ positionId: "a:BTC/USDC:long", side: "long", currentPrice: 60_500, atr: 100 });
    // Breach
    rm.onTick({ positionId: "a:BTC/USDC:long", side: "long", currentPrice: 60_100, atr: 100 });
    expect(events.length).toBe(1);
    expect(events[0]?.closePrice).toBe(60_200);
    expect(events[0]?.reason).toMatch(/breach/);
  });

  it("onTick does NOT fire close callback on non-breach ticks", () => {
    const rm = new RiskManager(BASE_CONFIG);
    rm.armTrailingStop("a", "long", 60_000, 100);
    const events: TrailingStopCloseEvent[] = [];
    rm.onTrailingStopClose((event) => {
      events.push(event);
    });
    rm.onTick({ positionId: "a", side: "long", currentPrice: 60_500, atr: 100 });
    rm.onTick({ positionId: "a", side: "long", currentPrice: 61_000, atr: 100 });
    expect(events.length).toBe(0);
  });

  it("onTick swallows callback exceptions", () => {
    const rm = new RiskManager(BASE_CONFIG);
    rm.armTrailingStop("a", "long", 60_000, 100);
    rm.onTrailingStopClose(() => {
      throw new Error("callback boom");
    });
    // Should not throw despite the bad callback.
    rm.onTick({ positionId: "a", side: "long", currentPrice: 60_500, atr: 100 });
    rm.onTick({ positionId: "a", side: "long", currentPrice: 60_100, atr: 100 });
  });

  it("onTick also swallows callback Errors", () => {
    const rm = new RiskManager(BASE_CONFIG);
    rm.armTrailingStop("a", "long", 60_000, 100);
    rm.onTrailingStopClose(() => {
      throw new Error("plain callback failure");
    });
    rm.onTick({ positionId: "a", side: "long", currentPrice: 60_500, atr: 100 });
    expect(() => rm.onTick({ positionId: "a", side: "long", currentPrice: 60_100, atr: 100 })).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // armTrailingStop — respects enabled and side filter
  // -------------------------------------------------------------------------
  it("armTrailingStop is a no-op when trailing stop is disabled", () => {
    const rm = new RiskManager({
      ...BASE_CONFIG,
      trailingStop: { ...BASE_CONFIG.trailingStop, enabled: false },
    });
    rm.armTrailingStop("a", "long", 60_000, 100);
    expect(rm.getTrailingStopManager().getState("a")).toBeUndefined();
  });

  it("armTrailingStop respects the 'long' side filter for short positions", () => {
    const rm = new RiskManager({
      ...BASE_CONFIG,
      trailingStop: { ...BASE_CONFIG.trailingStop, side: "long" },
    });
    rm.armTrailingStop("a", "short", 60_000, 100);
    expect(rm.getTrailingStopManager().getState("a")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // disarmTrailingStop
  // -------------------------------------------------------------------------
  it("disarmTrailingStop removes the trail", () => {
    const rm = new RiskManager(BASE_CONFIG);
    rm.armTrailingStop("a", "long", 60_000, 100);
    expect(rm.getTrailingStopManager().getState("a")?.armed).toBe(true);
    rm.disarmTrailingStop("a");
    expect(rm.getTrailingStopManager().getState("a")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // onEquityUpdate → drawdown scaler
  // -------------------------------------------------------------------------
  it("onEquityUpdate propagates to the drawdown scaler", () => {
    const rm = new RiskManager(BASE_CONFIG);
    rm.onEquityUpdate(8500); // -15% drawdown (75% of 20%) → caution
    expect(rm.getDrawdownScaler().getState().region).toBe("caution");
  });

  // -------------------------------------------------------------------------
  // onTradeClosed → kelly sizer
  // -------------------------------------------------------------------------
  it("onTradeClosed propagates to the kelly sizer", () => {
    const rm = new RiskManager(BASE_CONFIG);
    for (let index = 0; index < 7; index++) rm.onTradeClosed(100, index);
    for (let index = 0; index < 3; index++) rm.onTradeClosed(-100, 100 + index);
    expect(rm.getKellySizer().getStats().region).toBe("active");
  });

  // -------------------------------------------------------------------------
  // evaluateNewPositionSize — composites Kelly × drawdownScale
  // -------------------------------------------------------------------------
  it("evaluateNewPositionSize returns 0 when drawdown scaler blocks new positions", () => {
    const rm = new RiskManager(BASE_CONFIG);
    rm.onEquityUpdate(8000); // -20% → 100% of 20% → kill
    const size = rm.evaluateNewPositionSize({ equityUsd: 8000, baseSizeFraction: 0.05 });
    expect(size).toBe(0);
  });

  it("evaluateNewPositionSize uses Kelly size when Kelly is enabled and drawdown allows", () => {
    const rm = new RiskManager(BASE_CONFIG);
    rm.onEquityUpdate(11_000); // new high — peak now 11_000, scale 1.0
    // Feed enough wins for the Kelly cold-start to pass.
    for (let index = 0; index < 7; index++) rm.onTradeClosed(100, index);
    for (let index = 0; index < 3; index++) rm.onTradeClosed(-100, 100 + index);
    const size = rm.evaluateNewPositionSize({ equityUsd: 11_000, baseSizeFraction: 0.05 });
    // p=0.7, b=1.0 → full=0.4, frac=0.1, capped at 0.1.
    // drawdownScale = 1.0 → size = 0.1
    expect(size).toBeCloseTo(0.1, 6);
  });

  it("evaluateNewPositionSize uses baseSizeFraction when Kelly is disabled", () => {
    const rm = new RiskManager({
      ...BASE_CONFIG,
      kelly: { ...BASE_CONFIG.kelly, enabled: false },
    });
    rm.onEquityUpdate(11_000);
    const size = rm.evaluateNewPositionSize({ equityUsd: 11_000, baseSizeFraction: 0.05 });
    expect(size).toBeCloseTo(0.05, 6);
  });

  it("evaluateNewPositionSize scales by drawdown scaler in caution region", () => {
    const rm = new RiskManager({
      ...BASE_CONFIG,
      kelly: { ...BASE_CONFIG.kelly, enabled: false },
    });
    rm.onEquityUpdate(8900); // -11% from 10_000 = 55% of 20% → caution (scale 0.5)
    const size = rm.evaluateNewPositionSize({ equityUsd: 8900, baseSizeFraction: 0.1 });
    expect(size).toBeCloseTo(0.05, 6);
  });

  it("evaluateNewPositionSize returns 0 when Kelly returns 0 (no edge)", () => {
    const rm = new RiskManager(BASE_CONFIG);
    rm.onEquityUpdate(11_000);
    // Only losses, no wins → no edge → Kelly=0
    for (let index = 0; index < 12; index++) rm.onTradeClosed(-100, index);
    const size = rm.evaluateNewPositionSize({ equityUsd: 11_000, baseSizeFraction: 0.05 });
    expect(size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // getSnapshot
  // -------------------------------------------------------------------------
  it("getSnapshot returns the full state", () => {
    const rm = new RiskManager(BASE_CONFIG);
    rm.armTrailingStop("a", "long", 60_000, 100);
    rm.onEquityUpdate(11_000);
    const snap = rm.getSnapshot();
    expect(snap.trailingStops.length).toBe(1);
    expect(snap.trailingStops[0]?.positionId).toBe("a");
    expect(snap.drawdown.currentEquity).toBe(11_000);
    expect(snap.kelly.trades).toBe(0);
    expect(snap.canOpenNewPosition).toBe(true);
  });

  it("getSnapshot reflects kill region in canOpenNewPosition", () => {
    const rm = new RiskManager(BASE_CONFIG);
    rm.onEquityUpdate(7000); // -30% from 10_000 = 150% of 20% → kill
    expect(rm.getSnapshot().canOpenNewPosition).toBe(false);
  });
});

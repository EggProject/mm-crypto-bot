/**
 * apps/bot/src/risk/drawdown-scaler.test.ts
 *
 * Unit tests for `DrawdownScaler`. Targets 100% line + branch coverage
 * (the constructor's three validation branches, the `updateEquity` /
 * `scaleFactor` / `canOpenNew` / `getState` / `reset` happy paths,
 * the `classify` 3-way branch, and the static `scaleFactorForRegion`).
 */

import { describe, expect, it } from "bun:test";

import { DrawdownScaler, type DrawdownState } from "./drawdown-scaler.js";

describe("DrawdownScaler", () => {
  // -------------------------------------------------------------------------
  // Constructor validation (3 branches)
  // -------------------------------------------------------------------------
  it("constructor rejects maxDdPct <= 0", () => {
    expect(() => {
      new DrawdownScaler({ enabled: true, maxDdPct: 0, initialEquity: 10_000 });
    }).toThrow(/maxDdPct must be in/);
  });

  it("constructor rejects maxDdPct > 1", () => {
    expect(() => {
      new DrawdownScaler({ enabled: true, maxDdPct: 1.5, initialEquity: 10_000 });
    }).toThrow(/maxDdPct must be in/);
  });

  it("constructor rejects non-positive initialEquity", () => {
    expect(() => {
      new DrawdownScaler({ enabled: true, maxDdPct: 0.15, initialEquity: 0 });
    }).toThrow(/initialEquity must be positive/);
    expect(() => {
      new DrawdownScaler({ enabled: true, maxDdPct: 0.15, initialEquity: -100 });
    }).toThrow(/initialEquity must be positive/);
  });

  it("constructor rejects non-finite maxDdPct", () => {
    expect(() => {
      new DrawdownScaler({ enabled: true, maxDdPct: NaN, initialEquity: 10_000 });
    }).toThrow(/maxDdPct/);
  });

  // -------------------------------------------------------------------------
  // Disabled scaler returns 1.0 scale
  // -------------------------------------------------------------------------
  it("disabled scaler always returns 1.0 scale", () => {
    const s = new DrawdownScaler({ enabled: false, maxDdPct: 0.15, initialEquity: 10_000 });
    s.updateEquity(5_000); // -50% drawdown
    expect(s.scaleFactor()).toBe(1.0);
    expect(s.canOpenNew()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // normal region → 1.0
  // -------------------------------------------------------------------------
  it("normal region: 1.0 scale (0% to 50% of maxDd)", () => {
    const s = new DrawdownScaler({ enabled: true, maxDdPct: 0.20, initialEquity: 10_000 });
    s.updateEquity(10_500); // +5% — new high
    s.updateEquity(9_500); // -9.5% from peak (47.5% of 20%) → normal
    expect(s.scaleFactor()).toBe(1.0);
    expect(s.canOpenNew()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // caution region → 0.5
  // -------------------------------------------------------------------------
  it("caution region: 0.5 scale (50% to 80% of maxDd)", () => {
    const s = new DrawdownScaler({ enabled: true, maxDdPct: 0.20, initialEquity: 10_000 });
    s.updateEquity(10_000); // peak = 10_000
    s.updateEquity(9_100); // -9% from peak = 45% of 20% → normal (just below 50%)
    expect(s.scaleFactor()).toBe(1.0);
    s.updateEquity(8_900); // -11% from peak = 55% of 20% → caution
    expect(s.scaleFactor()).toBe(0.5);
    expect(s.canOpenNew()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // kill region → 0.0
  // -------------------------------------------------------------------------
  it("kill region: 0.0 scale (80%+ of maxDd)", () => {
    const s = new DrawdownScaler({ enabled: true, maxDdPct: 0.20, initialEquity: 10_000 });
    s.updateEquity(10_000);
    s.updateEquity(8_300); // -17% from peak = 85% of 20% → kill
    expect(s.scaleFactor()).toBe(0.0);
    expect(s.canOpenNew()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Above maxDdPct also returns 0.0
  // -------------------------------------------------------------------------
  it("scale is 0.0 above maxDdPct", () => {
    const s = new DrawdownScaler({ enabled: true, maxDdPct: 0.15, initialEquity: 10_000 });
    s.updateEquity(8_000); // -20% from 10k = 133% of 15% → kill
    expect(s.scaleFactor()).toBe(0.0);
  });

  // -------------------------------------------------------------------------
  // Peak updates on new high
  // -------------------------------------------------------------------------
  it("peak updates when equity exceeds the high-water mark", () => {
    const s = new DrawdownScaler({ enabled: true, maxDdPct: 0.20, initialEquity: 10_000 });
    s.updateEquity(12_000);
    const state: DrawdownState = s.getState();
    expect(state.peakEquity).toBe(12_000);
    expect(state.currentEquity).toBe(12_000);
    expect(state.drawdownPct).toBe(0);
  });

  // -------------------------------------------------------------------------
  // getState returns expected snapshot
  // -------------------------------------------------------------------------
  it("getState returns the expected snapshot", () => {
    const s = new DrawdownScaler({ enabled: true, maxDdPct: 0.20, initialEquity: 10_000 });
    s.updateEquity(9_200); // -8% from 10k = 40% of 20% → normal
    const state: DrawdownState = s.getState();
    expect(state.enabled).toBe(true);
    expect(state.peakEquity).toBe(10_000);
    expect(state.currentEquity).toBe(9_200);
    expect(state.drawdownPct).toBeCloseTo(0.08, 5);
    expect(state.region).toBe("normal");
    expect(state.scaleFactor).toBe(1.0);
  });

  // -------------------------------------------------------------------------
  // Region transition log (just verify the state changes; the log
  // assertion is in the orchestrator test).
  // -------------------------------------------------------------------------
  it("region transitions correctly normal → caution → kill → normal", () => {
    const s = new DrawdownScaler({ enabled: true, maxDdPct: 0.20, initialEquity: 10_000 });
    s.updateEquity(9_500); // 25% of 20% → normal
    expect(s.getState().region).toBe("normal");
    s.updateEquity(8_900); // 55% → caution
    expect(s.getState().region).toBe("caution");
    s.updateEquity(8_200); // 90% → kill
    expect(s.getState().region).toBe("kill");
    s.updateEquity(10_500); // new high → normal
    expect(s.getState().region).toBe("normal");
  });

  // -------------------------------------------------------------------------
  // reset() — re-seeds the peak
  // -------------------------------------------------------------------------
  it("reset re-seeds the peak to a new value", () => {
    const s = new DrawdownScaler({ enabled: true, maxDdPct: 0.20, initialEquity: 10_000 });
    s.updateEquity(8_000); // kill region
    expect(s.scaleFactor()).toBe(0.0);
    s.reset(11_000);
    const state: DrawdownState = s.getState();
    expect(state.peakEquity).toBe(11_000);
    expect(state.currentEquity).toBe(11_000);
    expect(state.region).toBe("normal");
  });

  it("reset ignores non-positive new equity", () => {
    const s = new DrawdownScaler({ enabled: true, maxDdPct: 0.20, initialEquity: 10_000 });
    s.reset(0);
    expect(s.getState().peakEquity).toBe(10_000);
  });

  // -------------------------------------------------------------------------
  // Defensive updateEquity: ignores non-finite / non-positive samples
  // -------------------------------------------------------------------------
  it("updateEquity ignores non-finite samples", () => {
    const s = new DrawdownScaler({ enabled: true, maxDdPct: 0.20, initialEquity: 10_000 });
    s.updateEquity(NaN);
    s.updateEquity(-1);
    s.updateEquity(0);
    expect(s.getState().currentEquity).toBe(10_000);
  });

  // -------------------------------------------------------------------------
  // Static scaleFactorForRegion — every branch
  // -------------------------------------------------------------------------
  it("scaleFactorForRegion returns the right value for each region", () => {
    expect(DrawdownScaler.scaleFactorForRegion("normal")).toBe(1.0);
    expect(DrawdownScaler.scaleFactorForRegion("caution")).toBe(0.5);
    expect(DrawdownScaler.scaleFactorForRegion("kill")).toBe(0.0);
  });
});

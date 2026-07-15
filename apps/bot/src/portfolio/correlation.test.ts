/**
 * apps/bot/src/portfolio/correlation.test.ts
 *
 * A `CorrelationMatrix` unit tesztjei — görgető ablak, Pearson
 * korreláció, single fill update, edge case-ek (1 stratégia, nincs
 * elég adat, nulla variancia, identitás).
 */

import { describe, expect, it } from "bun:test";

import { CorrelationMatrix, CORRELATION_HARD_CAPS } from "./correlation.js";

describe("CorrelationMatrix", () => {
  // ---------------------------------------------------------------------------
  // 1) Constructor validation
  // ---------------------------------------------------------------------------
  describe("constructor", () => {
    it("uses default windowSize = 30", () => {
      const cm = new CorrelationMatrix();
      expect(cm.getWindowSize()).toBe(30);
    });

    it("accepts custom windowSize", () => {
      const cm = new CorrelationMatrix({ windowSize: 50 });
      expect(cm.getWindowSize()).toBe(50);
    });

    it("rejects non-integer windowSize", () => {
      expect(() => new CorrelationMatrix({ windowSize: 10.5 })).toThrow(RangeError);
    });

    it("rejects windowSize below minimum", () => {
      expect(() => new CorrelationMatrix({ windowSize: CORRELATION_HARD_CAPS.windowSizeMin - 1 })).toThrow(RangeError);
    });

    it("rejects windowSize above maximum", () => {
      expect(() => new CorrelationMatrix({ windowSize: CORRELATION_HARD_CAPS.windowSizeMax + 1 })).toThrow(RangeError);
    });

    it("accepts windowSize at boundaries", () => {
      expect(new CorrelationMatrix({ windowSize: CORRELATION_HARD_CAPS.windowSizeMin }).getWindowSize()).toBe(2);
      expect(new CorrelationMatrix({ windowSize: CORRELATION_HARD_CAPS.windowSizeMax }).getWindowSize()).toBe(1000);
    });
  });

  // ---------------------------------------------------------------------------
  // 2) recordFill + sample count tracking
  // ---------------------------------------------------------------------------
  describe("recordFill", () => {
    it("starts with 0 strategies and 0 sample count", () => {
      const cm = new CorrelationMatrix();
      expect(cm.getStrategyCount()).toBe(0);
      expect(cm.getSampleCount("nope")).toBe(0);
    });

    it("appends a return to a new strategy's stream", () => {
      const cm = new CorrelationMatrix();
      cm.recordFill("a", 0.01);
      expect(cm.getStrategyCount()).toBe(1);
      expect(cm.getSampleCount("a")).toBe(1);
    });

    it("appends multiple returns to the same strategy's stream", () => {
      const cm = new CorrelationMatrix();
      cm.recordFill("a", 0.01);
      cm.recordFill("a", 0.02);
      cm.recordFill("a", -0.01);
      expect(cm.getSampleCount("a")).toBe(3);
    });

    it("ignores non-finite return values", () => {
      const cm = new CorrelationMatrix();
      cm.recordFill("a", Number.NaN);
      cm.recordFill("a", Number.POSITIVE_INFINITY);
      cm.recordFill("a", Number.NEGATIVE_INFINITY);
      expect(cm.getSampleCount("a")).toBe(0);
    });

    it("drops the oldest sample when the window is full (FIFO)", () => {
      const cm = new CorrelationMatrix({ windowSize: 3 });
      cm.recordFill("a", 1);
      cm.recordFill("a", 2);
      cm.recordFill("a", 3);
      cm.recordFill("a", 4);
      expect(cm.getSampleCount("a")).toBe(3);
    });

    it("forgetStrategy removes a strategy's stream", () => {
      const cm = new CorrelationMatrix();
      cm.recordFill("a", 0.01);
      cm.recordFill("b", 0.01);
      cm.forgetStrategy("a");
      expect(cm.getStrategyCount()).toBe(1);
      expect(cm.getSampleCount("a")).toBe(0);
      expect(cm.getSampleCount("b")).toBe(1);
    });

    it("reset clears all streams", () => {
      const cm = new CorrelationMatrix();
      cm.recordFill("a", 0.01);
      cm.recordFill("b", 0.01);
      cm.reset();
      expect(cm.getStrategyCount()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 3) Correlation computation
  // ---------------------------------------------------------------------------
  describe("getCorrelation", () => {
    it("returns 1 for the same strategy", () => {
      const cm = new CorrelationMatrix();
      cm.recordFill("a", 0.01);
      expect(cm.getCorrelation("a", "a")).toBe(1);
    });

    it("returns 0 when either strategy has no stream", () => {
      const cm = new CorrelationMatrix();
      cm.recordFill("a", 0.01);
      expect(cm.getCorrelation("a", "missing")).toBe(0);
      expect(cm.getCorrelation("missing", "a")).toBe(0);
    });

    it("returns 0 when either stream has < 2 samples", () => {
      const cm = new CorrelationMatrix();
      cm.recordFill("a", 0.01);
      cm.recordFill("a", 0.02);
      cm.recordFill("b", 0.01);
      expect(cm.getCorrelation("a", "b")).toBe(0);
    });

    it("returns ~1 for two perfectly correlated streams", () => {
      const cm = new CorrelationMatrix({ windowSize: 20 });
      const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const ys = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
      for (let i = 0; i < xs.length; i++) {
        cm.recordFill("a", xs[i] ?? 0);
        cm.recordFill("b", ys[i] ?? 0);
      }
      const r = cm.getCorrelation("a", "b");
      expect(r).toBeGreaterThan(0.999);
      expect(r).toBeLessThanOrEqual(1);
    });

    it("returns ~-1 for two perfectly anti-correlated streams", () => {
      const cm = new CorrelationMatrix({ windowSize: 20 });
      const xs = [1, 2, 3, 4, 5];
      const ys = [5, 4, 3, 2, 1];
      for (let i = 0; i < xs.length; i++) {
        cm.recordFill("a", xs[i] ?? 0);
        cm.recordFill("b", ys[i] ?? 0);
      }
      const r = cm.getCorrelation("a", "b");
      expect(r).toBeLessThan(-0.999);
      expect(r).toBeGreaterThanOrEqual(-1);
    });

    it("returns ~0 for uncorrelated streams", () => {
      const cm = new CorrelationMatrix({ windowSize: 30 });
      // Use a roughly uncorrelated pattern
      const xs = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1];
      const ys = [1, 1, -1, -1, 1, 1, -1, -1, 1, 1];
      for (let i = 0; i < xs.length; i++) {
        cm.recordFill("a", xs[i] ?? 0);
        cm.recordFill("b", ys[i] ?? 0);
      }
      const r = cm.getCorrelation("a", "b");
      expect(Math.abs(r)).toBeLessThan(0.5);
    });

    it("returns 0 when one stream has zero variance", () => {
      const cm = new CorrelationMatrix();
      cm.recordFill("a", 0.01);
      cm.recordFill("a", 0.01);
      cm.recordFill("a", 0.01);
      cm.recordFill("b", 0.01);
      cm.recordFill("b", 0.02);
      cm.recordFill("b", 0.03);
      expect(cm.getCorrelation("a", "b")).toBe(0);
    });

    it("aligns streams to the shorter length (drops oldest of the longer)", () => {
      const cm = new CorrelationMatrix({ windowSize: 100 });
      // a: 5 samples, b: 3 samples → correlation uses 3 latest of a
      cm.recordFill("a", 1);
      cm.recordFill("a", 2);
      cm.recordFill("a", 3);
      cm.recordFill("a", 4);
      cm.recordFill("a", 5);
      cm.recordFill("b", 3);
      cm.recordFill("b", 4);
      cm.recordFill("b", 5);
      // Last 3 of a: 3, 4, 5; b: 3, 4, 5 → r = 1
      const r = cm.getCorrelation("a", "b");
      expect(r).toBeGreaterThan(0.999);
    });
  });

  // ---------------------------------------------------------------------------
  // 4) getMatrix
  // ---------------------------------------------------------------------------
  describe("getMatrix", () => {
    it("returns empty matrix for no strategies", () => {
      const cm = new CorrelationMatrix();
      const snap = cm.getMatrix();
      expect(snap.matrix.size).toBe(0);
      expect(snap.sampleCounts.size).toBe(0);
      expect(snap.windowSize).toBe(30);
    });

    it("returns symmetric matrix with diagonal 1.0", () => {
      const cm = new CorrelationMatrix({ windowSize: 10 });
      cm.recordFill("a", 0.01);
      cm.recordFill("a", 0.02);
      cm.recordFill("a", 0.03);
      cm.recordFill("b", 0.03);
      cm.recordFill("b", 0.02);
      cm.recordFill("b", 0.01);
      const snap = cm.getMatrix();
      expect(snap.matrix.size).toBe(2);
      const rowA = snap.matrix.get("a");
      const rowB = snap.matrix.get("b");
      expect(rowA?.get("a")).toBe(1);
      expect(rowB?.get("b")).toBe(1);
      // Symmetric
      expect(rowA?.get("b")).toBe(rowB?.get("a"));
      // Anti-correlated
      expect(rowA?.get("b")).toBeLessThan(-0.999);
    });

    it("records sample counts per strategy", () => {
      const cm = new CorrelationMatrix();
      cm.recordFill("a", 0.01);
      cm.recordFill("a", 0.02);
      cm.recordFill("b", 0.01);
      const snap = cm.getMatrix();
      expect(snap.sampleCounts.get("a")).toBe(2);
      expect(snap.sampleCounts.get("b")).toBe(1);
    });

    it("exposes windowSize in snapshot", () => {
      const cm = new CorrelationMatrix({ windowSize: 50 });
      expect(cm.getMatrix().windowSize).toBe(50);
    });
  });
});

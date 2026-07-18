/**
 * apps/web/src/lib/__tests__/chart-card-helpers.test.ts
 *
 * Phase 54E: unit tests for the pure helpers extracted from
 * `ChartCard.tsx`. Each helper is a tiny pure function; the
 * tests cover the originally-uncovered branches from the
 * Phase 53C coverage report (L146, L345, L517, L539).
 */

import { describe, expect, it } from "bun:test";
import {
  HEIGHTS,
  markersAreVisible,
  resolveHeight,
  strategyHasTitle,
  timeframeHasLabel,
} from "../chart-card-helpers.js";

describe("resolveHeight", () => {
  it("returns the numeric input unchanged (the originally-uncovered branch)", () => {
    expect(resolveHeight(100)).toBe(100);
    expect(resolveHeight(0)).toBe(0);
    expect(resolveHeight(9999)).toBe(9999);
  });

  it("returns HEIGHTS.sm for 'sm' input", () => {
    expect(resolveHeight("sm")).toBe(HEIGHTS.sm);
    expect(resolveHeight("sm")).toBe(220);
  });

  it("returns HEIGHTS.md for 'md' input", () => {
    expect(resolveHeight("md")).toBe(HEIGHTS.md);
    expect(resolveHeight("md")).toBe(320);
  });

  it("returns HEIGHTS.lg for 'lg' input", () => {
    expect(resolveHeight("lg")).toBe(HEIGHTS.lg);
    expect(resolveHeight("lg")).toBe(480);
  });

  it("returns HEIGHTS.md for undefined input (the default)", () => {
    expect(resolveHeight(undefined)).toBe(HEIGHTS.md);
  });
});

describe("markersAreVisible", () => {
  it("returns false when markers is undefined", () => {
    expect(markersAreVisible(undefined)).toBe(false);
  });

  it("returns false when markers is an empty array", () => {
    expect(markersAreVisible([])).toBe(false);
  });

  it("returns true when markers has at least one item", () => {
    expect(markersAreVisible([{ time: 1 }])).toBe(true);
    expect(markersAreVisible([1, 2, 3])).toBe(true);
  });
});

describe("strategyHasTitle", () => {
  it("returns false for empty string (the originally-uncovered branch)", () => {
    expect(strategyHasTitle("")).toBe(false);
  });

  it("returns true for non-empty string", () => {
    expect(strategyHasTitle("donchian_pivot_composition")).toBe(true);
    expect(strategyHasTitle("x")).toBe(true);
  });
});

describe("timeframeHasLabel", () => {
  it("returns false for empty string (the originally-uncovered branch)", () => {
    expect(timeframeHasLabel("")).toBe(false);
  });

  it("returns true for non-empty string", () => {
    expect(timeframeHasLabel("1h")).toBe(true);
    expect(timeframeHasLabel("4h")).toBe(true);
    expect(timeframeHasLabel("1d")).toBe(true);
  });
});

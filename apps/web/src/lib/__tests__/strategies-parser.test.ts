/**
 * apps/web/src/lib/__tests__/strategies-parser.test.ts
 *
 * Phase 54F: unit tests for the pure `parseStrategiesResponse`
 * helper extracted from `App.tsx`.
 *
 * Branch coverage: each early-return in the helper is a separate
 * branch in the lcov report. The "null body" branch was the
 * originally-uncovered one (typeof null === "object" passes
 * the first check, then `body !== null` rejects).
 */

import { describe, expect, it } from "bun:test";
import { parseStrategiesResponse } from "../strategies-parser.js";

describe("parseStrategiesResponse", () => {
  it("returns ok=false with 'null body' for null input (the originally-uncovered branch)", () => {
    const r = parseStrategiesResponse(null);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toBe("null body");
    }
  });

  it("returns ok=false for primitive (string) input", () => {
    const r = parseStrategiesResponse("not-an-object");
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toBe("not an object");
    }
  });

  it("returns ok=false for primitive (number) input", () => {
    const r = parseStrategiesResponse(42);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toBe("not an object");
    }
  });

  it("returns ok=false for array input (typeof 'object', but is array)", () => {
    const r = parseStrategiesResponse([1, 2, 3]);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toBe("array, not object");
    }
  });

  it("returns ok=false when the 'strategies' key is missing", () => {
    const r = parseStrategiesResponse({ other: "key" });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toBe("invalid /api/strategies response shape");
    }
  });

  it("returns ok=false when 'strategies' is not an array", () => {
    const r = parseStrategiesResponse({ strategies: "not-an-array" });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toBe("invalid /api/strategies response shape");
    }
  });

  it("returns ok=true for an empty strategies list", () => {
    const r = parseStrategiesResponse({ strategies: [] });
    expect(r.ok).toBe(true);
    if (r.ok === true) {
      expect(r.strategies).toEqual([]);
    }
  });

  it("returns ok=true for a valid strategies list", () => {
    const r = parseStrategiesResponse({
      strategies: [
        {
          name: "donchian_pivot_composition",
          enabled: true,
          symbols: ["BTCUSDT"],
          timeframes: ["1h", "4h"],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok === true) {
      expect(r.strategies.length).toBe(1);
      expect(r.strategies[0]?.name).toBe("donchian_pivot_composition");
    }
  });

  it("returns ok=false when 'strategies' is null", () => {
    const r = parseStrategiesResponse({ strategies: null });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toBe("invalid /api/strategies response shape");
    }
  });
});

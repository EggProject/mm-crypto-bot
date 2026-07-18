/**
 * apps/web/src/lib/__tests__/indicators-singleton.test.ts
 *
 * Phase 55-5: bun:test unit tests for the `indicators-singleton.ts`
 * module. The singleton must:
 *   - Lazily bootstrap the registry on first call
 *   - Register the four canonical renderers (donchian, funding,
 *     cascade, signals)
 *   - Return the SAME instance on every call (idempotent)
 *   - Allow test-only replacement via `setIndicatorRegistry`
 *     with a fresh registry
 *
 * The renderers themselves are tested in
 * `src/indicators/*.test.ts`; this file only tests the
 * singleton's API contract.
 */

import { afterEach, describe, expect, it } from "bun:test";

import {
  getIndicatorRegistry,
  setIndicatorRegistry,
} from "../indicators-singleton.js";
import { IndicatorRegistry } from "../../indicators/registry.js";

// ============================================================================
// Test setup / teardown
// ============================================================================

/**
 * Restore the singleton after each test. Without this, the
 * order-dependent state (a custom registry injected by one
 * test) would leak into the next test.
 */
const originalRegistry = getIndicatorRegistry();
afterEach(() => {
  setIndicatorRegistry(originalRegistry);
});

// ============================================================================
// getIndicatorRegistry
// ============================================================================

describe("getIndicatorRegistry", () => {
  it("returns a registry on the first call (lazy bootstrap)", () => {
    const r = getIndicatorRegistry();
    expect(r).toBeInstanceOf(IndicatorRegistry);
  });

  it("returns the same instance on every call (singleton)", () => {
    const a = getIndicatorRegistry();
    const b = getIndicatorRegistry();
    expect(a).toBe(b);
  });

  it("registers all four canonical indicators on first bootstrap", () => {
    const r = getIndicatorRegistry();
    expect(r.has("donchian")).toBe(true);
    expect(r.has("funding")).toBe(true);
    expect(r.has("cascade")).toBe(true);
    expect(r.has("signals")).toBe(true);
  });

  it("list() returns the four names in sorted order", () => {
    const r = getIndicatorRegistry();
    expect(r.list()).toEqual(["cascade", "donchian", "funding", "signals"]);
  });

  it("get('donchian') returns a function (the renderer)", () => {
    const r = getIndicatorRegistry();
    const renderer = r.get("donchian");
    expect(typeof renderer).toBe("function");
  });

  it("get() returns the same function reference on repeated calls", () => {
    const r = getIndicatorRegistry();
    expect(r.get("donchian")).toBe(r.get("donchian"));
    expect(r.get("funding")).toBe(r.get("funding"));
  });
});

// ============================================================================
// setIndicatorRegistry
// ============================================================================

describe("setIndicatorRegistry", () => {
  it("replaces the singleton with a custom registry", () => {
    const custom = new IndicatorRegistry();
    custom.register("test", () => ({
      name: "test",
      series: [],
      dispose: (): void => {
        // no-op
      },
    }));
    const prev = setIndicatorRegistry(custom);
    const after = getIndicatorRegistry();
    expect(after).toBe(custom);
    expect(after.has("test")).toBe(true);
    // The default 4 indicators are NOT in the custom registry.
    expect(after.has("donchian")).toBe(false);
    // The previous registry is returned so the caller can
    // restore it.
    expect(prev).toBeInstanceOf(IndicatorRegistry);
  });

  it("restoring the original registry (afterEach) keeps the singletons consistent", () => {
    // The afterEach should have restored the registry. Verify
    // by re-fetching.
    const r = getIndicatorRegistry();
    expect(r.has("donchian")).toBe(true);
  });
});

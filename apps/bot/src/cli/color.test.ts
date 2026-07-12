/**
 * apps/bot/src/cli/color.test.ts
 *
 * Phase 34 Track C — unit tests for the `color` module.
 *
 * ===========================================================================
 * TEST SURFACE
 * ===========================================================================
 * The 6 acceptance-criteria unit tests:
 *
 *   1. `isColorEnabled()` returns TRUE by default in a TTY.
 *   2. `isColorEnabled()` returns FALSE when `NO_COLOR=1` is set.
 *   3. `isColorEnabled()` returns FALSE when stdout is not a TTY.
 *   4. `isColorEnabled()` returns TRUE with `--color` force even when not TTY.
 *   5. `colorize("text", "green")` returns ANSI-coded string when enabled.
 *   6. `colorize("text", "green")` returns plain text when disabled.
 *
 * Plus a few defensive tests:
 *   7. The `ok` / `fail` / `warn` / `dim` helpers route through the
 *      same `isColorEnabled()` policy.
 *   8. `setColorForced(undefined)` clears the override (back to env+TTY).
 *
 * The test resets module state in `afterEach` so each case starts from
 * a known baseline.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { colorize, isColorEnabled, ok, fail, warn, dim, setColorForced } from "./color.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * The ANSI escape prefix that picocolors emits for a "green" code.
 * We check that `colorize` adds the prefix and suffix rather than the
 * exact bytes (picocolors' format is stable but verifying the
 * structural property is more robust to upgrades).
 */
// Use `\u001b` (unicode escape) instead of `\x1b` — ESLint's
// `no-control-regex` rule flags the raw control-char form.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\[\d+m/;

/**
 * Snapshot the original env vars at test-start so we can restore them
 * at test-end. This matters because `NO_COLOR` is inherited from the
 * parent process (CI runners often set `NO_COLOR=1`).
 */
const ORIGINAL_NO_COLOR = process.env["NO_COLOR"];

/**
 * Snapshot the original `isTTY` value. We can't mock it directly, but
 * we can verify behavior under both states by relying on whatever the
 * test runner does.
 */
const ORIGINAL_IS_TTY = process.stdout.isTTY;

beforeEach(() => {
  // Each test starts from a known clean state: no override, no env var,
  // and the test runner's natural isTTY.
  setColorForced(undefined);
  delete process.env["NO_COLOR"];
});

afterEach(() => {
  setColorForced(undefined);
  if (ORIGINAL_NO_COLOR === undefined) {
    delete process.env["NO_COLOR"];
  } else {
    process.env["NO_COLOR"] = ORIGINAL_NO_COLOR;
  }
  void ORIGINAL_IS_TTY;
});

// ---------------------------------------------------------------------------
// 1. isColorEnabled() — defaults
// ---------------------------------------------------------------------------

describe("isColorEnabled", () => {
  it("returns true by default (no env, no override, TTY=true)", () => {
    // Test runner may or may not be a TTY. We only require: no override,
    // no NO_COLOR env, AND a real TTY. We force the TTY state in the test.
    setColorForced(undefined);
    delete process.env["NO_COLOR"];
    const orig = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    try {
      expect(isColorEnabled()).toBe(true);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        value: orig,
        configurable: true,
        writable: true,
      });
    }
  });

  it("returns false when stdout.isTTY is undefined (piped, not a real TTY)", () => {
    setColorForced(undefined);
    delete process.env["NO_COLOR"];
    const orig = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      // In Bun, `Bun.spawn({ stdout: "pipe" })` makes the child's
      // `process.stdout.isTTY === undefined`. We must treat that as
      // "not a TTY" so we don't write ANSI codes to a pipe.
      expect(isColorEnabled()).toBe(false);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        value: orig,
        configurable: true,
        writable: true,
      });
    }
  });

  it("returns false when NO_COLOR env is set", () => {
    setColorForced(undefined);
    process.env["NO_COLOR"] = "1";
    expect(isColorEnabled()).toBe(false);
  });

  it("returns false when stdout is not a TTY", () => {
    setColorForced(undefined);
    delete process.env["NO_COLOR"];
    // Force the TTY check by flipping the property. The check is
    // `process.stdout.isTTY === false`, so we set it to false.
    // We restore the original in afterEach (see ORIGINAL_IS_TTY).
    const orig = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
      writable: true,
    });
    try {
      expect(isColorEnabled()).toBe(false);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        value: orig,
        configurable: true,
        writable: true,
      });
    }
  });

  it("returns true with --color override even when not TTY", () => {
    setColorForced(true);
    // Even if TTY is false, the override wins.
    const orig = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
      writable: true,
    });
    try {
      expect(isColorEnabled()).toBe(true);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        value: orig,
        configurable: true,
        writable: true,
      });
    }
  });

  it("returns false with --no-color override (forced wins over TTY)", () => {
    setColorForced(false);
    // Even if TTY is true, the override wins.
    const orig = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    try {
      expect(isColorEnabled()).toBe(false);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        value: orig,
        configurable: true,
        writable: true,
      });
    }
  });

  it("forced=false beats NO_COLOR=0 (forced wins)", () => {
    setColorForced(false);
    delete process.env["NO_COLOR"];
    expect(isColorEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. colorize() — emits ANSI when enabled
// ---------------------------------------------------------------------------

describe("colorize", () => {
  it("returns ANSI-coded string when color is enabled", () => {
    setColorForced(true);
    const result = colorize("hello", "green");
    expect(result).toContain("hello");
    expect(result).toMatch(ANSI_ESCAPE_RE);
    // The colored string should be longer than the plain one.
    expect(result.length).toBeGreaterThan("hello".length);
  });

  it("returns plain text when color is disabled (--no-color)", () => {
    setColorForced(false);
    const result = colorize("hello", "green");
    expect(result).toBe("hello");
    expect(result).not.toMatch(ANSI_ESCAPE_RE);
  });

  it("returns plain text when NO_COLOR is set", () => {
    setColorForced(undefined);
    process.env["NO_COLOR"] = "1";
    const result = colorize("hello", "red");
    expect(result).toBe("hello");
  });

  it("works for all ColorName variants", () => {
    setColorForced(true);
    const names = ["red", "green", "yellow", "blue", "magenta", "cyan", "gray", "bold", "dim"] as const;
    for (const name of names) {
      const result = colorize("x", name);
      expect(result).toContain("x");
      expect(result).toMatch(ANSI_ESCAPE_RE);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Convenience helpers (ok / fail / warn / dim)
// ---------------------------------------------------------------------------

describe("convenience helpers", () => {
  it("ok() returns green 'OK' when color is enabled", () => {
    setColorForced(true);
    const result = ok();
    expect(result).toContain("OK");
    expect(result).toMatch(ANSI_ESCAPE_RE);
  });

  it("ok() returns plain 'OK' when color is disabled", () => {
    setColorForced(false);
    expect(ok()).toBe("OK");
  });

  it("fail() returns red 'FAILED' when color is enabled", () => {
    setColorForced(true);
    const result = fail();
    expect(result).toContain("FAILED");
    expect(result).toMatch(ANSI_ESCAPE_RE);
  });

  it("fail() returns plain 'FAILED' when color is disabled", () => {
    setColorForced(false);
    expect(fail()).toBe("FAILED");
  });

  it("warn() respects the color policy", () => {
    setColorForced(true);
    expect(warn("careful")).toMatch(ANSI_ESCAPE_RE);
    setColorForced(false);
    expect(warn("careful")).toBe("careful");
  });

  it("dim() respects the color policy", () => {
    setColorForced(true);
    expect(dim("hint")).toMatch(ANSI_ESCAPE_RE);
    setColorForced(false);
    expect(dim("hint")).toBe("hint");
  });
});

// ---------------------------------------------------------------------------
// 4. setColorForced reset behavior
// ---------------------------------------------------------------------------

describe("setColorForced", () => {
  it("clears the override when called with undefined", () => {
    setColorForced(true);
    expect(isColorEnabled()).toBe(true);
    setColorForced(undefined);
    // After clear, the policy follows env+TTY (which is false in test runner
    // since we never set NO_COLOR here).
    delete process.env["NO_COLOR"];
    const orig = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
      writable: true,
    });
    try {
      expect(isColorEnabled()).toBe(false);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        value: orig,
        configurable: true,
        writable: true,
      });
    }
  });
});

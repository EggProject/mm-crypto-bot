import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildClosures, computeWouldTrigger, loadState } from "./kill-switch-dry-run.js";
import { makeDryRunPosition, makeDryRunState } from "./kill-switch-dry-run-test-support.test.js";

describe("kill-switch dry-run state", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "ksdr-state-"));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("loads valid state and rejects missing, malformed, unreadable, and schema-invalid state", () => {
    const valid = path.join(directory, "state.json");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant created in this test.
    writeFileSync(valid, JSON.stringify(makeDryRunState()), "utf8");
    expect(loadState(valid)).toEqual({ state: makeDryRunState(), error: undefined });
    expect(loadState(path.join(directory, "missing.json")).error).toContain("state file not found");
    const malformed = path.join(directory, "malformed.json");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant created in this test.
    writeFileSync(malformed, "not-json", "utf8");
    expect(loadState(malformed).error?.startsWith(`invalid JSON in ${malformed}:`)).toBe(true);
    const invalid = path.join(directory, "invalid.json");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant created in this test.
    writeFileSync(invalid, JSON.stringify({ version: 99 }), "utf8");
    expect(loadState(invalid).error).toContain("schema invalid");
    const unreadable = path.join(directory, "directory");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant created in this test.
    mkdirSync(unreadable);
    expect(loadState(unreadable).error).toContain("failed to read");
  });

  it("maps closures in order and only triggers for positioned threshold breaches", () => {
    const positions = [
      makeDryRunPosition(),
      makeDryRunPosition({ id: "pos-2", side: "short", unrealizedPnl: -100 }),
    ];
    expect(buildClosures(makeDryRunState({ positions }))).toEqual([
      expect.objectContaining({ id: "pos-1", estLossUsd: 500 }),
      expect.objectContaining({ id: "pos-2", side: "short", estLossUsd: -100 }),
    ]);
    expect(computeWouldTrigger(makeDryRunState(), 0.15)).toBe(false);
    expect(computeWouldTrigger(makeDryRunState({ positions, equityUsd: 8500 }), 0.15)).toBe(true);
    expect(computeWouldTrigger(makeDryRunState({ positions, equityUsd: 9000 }), 0.15)).toBe(false);
    expect(computeWouldTrigger(makeDryRunState({ positions, equityUsd: 0, initialEquityUsd: 0 }), 0.15)).toBe(
      false,
    );
  });

  it("uses the injected file port and returns a sanitized read failure", () => {
    const result = loadState("/external/state.json", {
      exists: () => true,
      readText: () => {
        throw new Error("read denied");
      },
    });
    expect(result).toEqual({ state: undefined, error: "failed to read /external/state.json: read denied" });
  });

  it("sanitizes non-Error state-file read failures", () => {
    const result = loadState("/external/state.json", {
      exists: () => true,
      readText: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- The injected hostile boundary may throw unknown values.
        throw "read denied";
      },
    });
    expect(result).toEqual({ state: undefined, error: "failed to read /external/state.json: read denied" });
  });
});

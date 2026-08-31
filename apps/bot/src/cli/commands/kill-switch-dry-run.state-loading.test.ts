import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadState } from "./kill-switch-dry-run.js";
import { makePosition, makeState } from "./kill-switch-dry-run.test-support.js";
import {
  buildClosures as buildSnapshotClosures,
  isKillSwitchWouldTriggered,
  loadState as loadSnapshotState,
} from "./kill-switch-dry-run-state.js";
import { loadValidatedStateSnapshot } from "./kill-switch-state-file.js";

describe("loadState", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "ksdr-state-"));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("returns an unavailable-state error when the file does not exist", () => {
    const missing = path.join(directory, "no-such-file.json");
    const result = loadState(missing);
    // eslint-disable-next-line unicorn/no-null -- The public CLI result uses null to represent unavailable state.
    expect(result).toEqual({ state: null, error: `state file not found: ${missing}` });
  });

  it("returns the validated state when the file is valid", async () => {
    const statePath = path.join(directory, "state.json");
    await Bun.write(statePath, JSON.stringify(makeState()));
    const result = loadState(statePath);
    expect(result.error).toBeNull();
    if (result.error !== null) {
      throw new Error(`expected valid state, received: ${result.error}`);
    }
    expect(result.state.equityUsd).toBe(10_000);
    expect(result.state.version).toBe(1);
  });

  it("returns error when JSON parse fails", async () => {
    const statePath = path.join(directory, "bad.json");
    await Bun.write(statePath, "{not valid json");
    const result = loadState(statePath);
    expect(result.state).toBeNull();
    expect(result.error).toContain("invalid JSON");
  });

  it("returns error when the schema is invalid (version mismatch)", async () => {
    const statePath = path.join(directory, "bad-schema.json");
    await Bun.write(statePath, JSON.stringify({ version: 99, savedAt: 1 }));
    const result = loadState(statePath);
    expect(result.state).toBeNull();
    expect(result.error).toContain("state file schema invalid");
  });

  it("returns error when readFileSync throws (e.g. state_file is a directory)", () => {
    const result = loadState(directory);
    expect(result.state).toBeNull();
    expect(result.error).toContain("failed to read");
    expect(result.error).toContain(directory);
  });

  it("covers the injected snapshot-file boundary without filesystem or order side effects", () => {
    const valid = makeState({ positions: [] });
    expect(loadSnapshotState("/missing", { exists: () => false, readText: () => "" })).toEqual({
      state: undefined,
      error: "state file not found: /missing",
    });
    expect(
      loadSnapshotState("/error", {
        exists: () => true,
        readText: () => {
          throw new Error("untrusted read failure");
        },
      }),
    ).toEqual({ state: undefined, error: "failed to read /error: untrusted read failure" });
    expect(
      loadSnapshotState("/error-message", {
        exists: () => true,
        readText: () => {
          throw new Error("read Error failure");
        },
      }),
    ).toEqual({ state: undefined, error: "failed to read /error-message: read Error failure" });
    expect(
      loadSnapshotState("/json", { exists: () => true, readText: () => "{" }).error?.startsWith(
        "invalid JSON in /json:",
      ),
    ).toBe(true);
    expect(
      loadSnapshotState("/schema", { exists: () => true, readText: () => JSON.stringify({ version: 99 }) })
        .error,
    ).toMatch(/^state file schema invalid:/u);
    expect(
      loadSnapshotState("/valid", { exists: () => true, readText: () => JSON.stringify(valid) }).state,
    ).toEqual(valid);
  });

  it("maps persisted positions and evaluates only the dry-run threshold", () => {
    const positioned = makeState({ positions: [makePosition({ unrealizedPnl: -2 })] });
    expect(buildSnapshotClosures(positioned)).toHaveLength(1);
    expect(isKillSwitchWouldTriggered(makeState({ positions: [] }), 0)).toBe(false);
    expect(isKillSwitchWouldTriggered({ ...positioned, initialEquityUsd: 0 }, 0.2)).toBe(false);
    expect(isKillSwitchWouldTriggered({ ...positioned, equityUsd: 8000 }, 0.2)).toBe(true);
  });

  it("accepts a valid snapshot path and rejects invalid boundary paths", async () => {
    const statePath = path.join(directory, "validated-state.json");
    await Bun.write(statePath, JSON.stringify(makeState()));
    expect(loadValidatedStateSnapshot(statePath).error).toBeUndefined();
    for (const invalidPath of ["", "\0", "."]) {
      expect(loadValidatedStateSnapshot(invalidPath)).toEqual({
        state: undefined,
        error: "invalid state file path: state file path must be a non-empty filesystem path",
      });
    }
  });
});

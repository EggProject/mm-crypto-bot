/**
 * apps/bot/src/bot/state-store.test.ts
 *
 * A `StateStore` unit tesztjei — atomic write, persistence round-trip,
 * invalid state handling.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BotStateSchema, StateStore } from "./state-store.js";
import type { BotState } from "./state-store.js";

function makeState(overrides: Partial<BotState> = {}): BotState {
  return {
    version: 1,
    savedAt: Date.now(),
    equityUsd: 10_000,
    initialEquityUsd: 10_000,
    realizedPnlUsd: 0,
    positions: [],
    closedTrades: [],
    inFlightOrderIds: [],
    counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    ...overrides,
  };
}

describe("StateStore", () => {
  let tmpDir: string;
  let stateFile: string;
  let store: StateStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-state-store-"));
    stateFile = join(tmpDir, "bot-state.json");
    store = new StateStore({ filePath: stateFile, debounceMs: 50 });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("load() returns null when file does not exist", () => {
    expect(store.load()).toBeNull();
  });

  it("flush() writes state to disk atomically", () => {
    store.flush(makeState({ equityUsd: 12_000 }));
    expect(existsSync(stateFile)).toBe(true);
    const raw = readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const validated = BotStateSchema.safeParse(parsed);
    expect(validated.success).toBe(true);
    if (validated.success) {
      expect(validated.data.equityUsd).toBe(12_000);
    }
  });

  it("writes to .tmp file first, then renames to .json", () => {
    store.flush(makeState());
    expect(existsSync(`${stateFile}.tmp`)).toBe(false);
    expect(existsSync(stateFile)).toBe(true);
  });

  it("load() reads the state back from a saved file", () => {
    const original = makeState({
      equityUsd: 11_111,
      realizedPnlUsd: 111,
      counters: { placed: 5, filled: 4, cancelled: 1, rejected: 0 },
      inFlightOrderIds: ["client-1", "client-2"],
    });
    store.flush(original);
    const loaded = store.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.equityUsd).toBe(11_111);
    expect(loaded?.realizedPnlUsd).toBe(111);
    expect(loaded?.counters.placed).toBe(5);
    expect(loaded?.inFlightOrderIds).toEqual(["client-1", "client-2"]);
  });

  it("load() returns null when file contains invalid JSON", () => {
    writeFileSync(stateFile, "this is not valid json {[", "utf8");
    expect(store.load()).toBeNull();
  });

  it("load() returns null when JSON is valid but schema-invalid", () => {
    writeFileSync(stateFile, JSON.stringify({ wrong: "shape" }), "utf8");
    expect(store.load()).toBeNull();
  });

  it("load() rejects state with wrong version", () => {
    writeFileSync(stateFile, JSON.stringify({ version: 99, equityUsd: 1 }), "utf8");
    expect(store.load()).toBeNull();
  });

  it("requestSave() is debounced", async () => {
    const startTime = Date.now();
    for (let i = 0; i < 5; i++) {
      store.requestSave(makeState({ equityUsd: 10_000 + i }));
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });
    const raw = readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw) as { equityUsd: number };
    expect(parsed.equityUsd).toBe(10_004);
    expect(Date.now() - startTime).toBeGreaterThan(40);
  });

  it("getCurrent() returns the latest requested state", () => {
    const s = makeState({ equityUsd: 9_999 });
    store.requestSave(s);
    expect(store.getCurrent()?.equityUsd).toBe(9_999);
  });

  it("getFilePath() returns the configured file path", () => {
    expect(store.getFilePath()).toBe(stateFile);
  });

  it("skips write when state is identical to last written", () => {
    const s = makeState({ equityUsd: 8_888 });
    store.flush(s);
    const mtime1 = statSync(stateFile).mtimeMs;
    store.flush(s);
    const mtime2 = statSync(stateFile).mtimeMs;
    expect(mtime2).toBe(mtime1);
  });

  it("BotStateSchema accepts a valid state", () => {
    const s = makeState();
    const validated = BotStateSchema.safeParse(s);
    expect(validated.success).toBe(true);
  });

  it("BotStateSchema rejects negative initialEquity", () => {
    const s = makeState({ initialEquityUsd: -100 });
    const validated = BotStateSchema.safeParse(s);
    expect(validated.success).toBe(false);
  });
});

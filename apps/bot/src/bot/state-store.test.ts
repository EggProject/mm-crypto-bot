/**
 * apps/bot/src/bot/state-store.test.ts
 *
 * A `StateStore` unit tesztjei — atomic write, persistence round-trip,
 * invalid state handling.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { RecordingLogger } from "@logging-testing";
import { BotStateSchema, StateStore as RuntimeStateStore, StateStoreError } from "./state-store.js";
import type { BotState } from "./state-store.js";

class StateStore extends RuntimeStateStore {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimeStateStore>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}

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
  let temporaryDirectory: string;
  let stateFile: string;
  let store: StateStore;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-state-store-"));
    stateFile = path.join(temporaryDirectory, "bot-state.json");
    store = new StateStore({ filePath: stateFile, debounceMs: 50 });
  });

  afterEach(() => {
    if (temporaryDirectory.length > 0) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("load() returns null when file does not exist", () => {
    expect(store.load()).toBeNull();
  });

  it("flush() writes state to disk atomically", async () => {
    store.flush(makeState({ equityUsd: 12_000 }));
    expect(await Bun.file(stateFile).exists()).toBe(true);
    const raw = await Bun.file(stateFile).text();
    const parsed = JSON.parse(raw) as unknown;
    const validated = BotStateSchema.safeParse(parsed);
    expect(validated.success).toBe(true);
    if (validated.success) {
      expect(validated.data.equityUsd).toBe(12_000);
    }
  });

  it("writes to .tmp file first, then renames to .json", async () => {
    store.flush(makeState());
    expect(await Bun.file(`${stateFile}.tmp`).exists()).toBe(false);
    expect(await Bun.file(stateFile).exists()).toBe(true);
  });

  it("creates a configured missing state directory before the atomic write", async () => {
    const nestedFile = path.join(temporaryDirectory, "runtime", "state", "bot-state.json");
    const nestedStore = new StateStore({ filePath: nestedFile, debounceMs: 50 });
    nestedStore.flush(makeState());
    expect(await Bun.file(nestedFile).exists()).toBe(true);
  });

  it("wraps a configured state-directory creation failure", async () => {
    const blockingFile = path.join(temporaryDirectory, "not-a-directory");
    await Bun.write(blockingFile, "file blocks nested state directory creation");
    const nestedStateFile = path.join(blockingFile, "runtime", "bot-state.json");
    const blockedStore = new StateStore({ filePath: nestedStateFile, debounceMs: 50 });

    expect(() => {
      blockedStore.flush(makeState());
    }).toThrow("[state-store] failed to create state directory");
  });

  it("wraps a circular runtime serialization failure with its original cause", () => {
    const circularReference: { self?: unknown } = {};
    circularReference.self = circularReference;
    const positionWithCircularRuntimeValue = {
      id: "circular-position",
      strategy: "state-store-test",
      symbol: "BTC/USDC",
      side: "long" as const,
      quantity: 1,
      entryPrice: 100,
      currentPrice: 100,
      leverage: 1,
      unrealizedPnl: 0,
      realizedPnl: 0,
      openedAt: 1,
      notionalUsd: 100,
      circularReference,
    };
    const stateWithCircularRuntimeValue = makeState({
      positions: [positionWithCircularRuntimeValue],
    });

    expect(() => {
      store.flush(stateWithCircularRuntimeValue);
    }).toThrow(StateStoreError);
    expect(() => {
      store.flush(stateWithCircularRuntimeValue);
    }).toThrow("[state-store] failed to serialize state:");
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

  it("load() returns null when file contains invalid JSON", async () => {
    await Bun.write(stateFile, "this is not valid json {[");
    expect(store.load()).toBeNull();
  });

  it("load() returns null when the configured state path cannot be read as a file", () => {
    const directoryStore = new StateStore({ filePath: temporaryDirectory, debounceMs: 50 });

    expect(directoryStore.load()).toBeNull();
  });

  it("load() returns null when JSON is valid but schema-invalid", async () => {
    await Bun.write(stateFile, JSON.stringify({ wrong: "shape" }));
    expect(store.load()).toBeNull();
  });

  it("load() rejects state with wrong version", async () => {
    await Bun.write(stateFile, JSON.stringify({ version: 99, equityUsd: 1 }));
    expect(store.load()).toBeNull();
  });

  it("requestSave() is debounced", async () => {
    const startTime = Date.now();
    for (let index = 0; index < 5; index++) {
      store.requestSave(makeState({ equityUsd: 10_000 + index }));
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });
    const raw = await Bun.file(stateFile).text();
    const parsed = JSON.parse(raw) as { equityUsd: number };
    expect(parsed.equityUsd).toBe(10_004);
    expect(Date.now() - startTime).toBeGreaterThan(40);
  });

  it("flush() cancels a pending debounce and writes the most recent requested snapshot", async () => {
    store.requestSave(makeState({ equityUsd: 10_321 }));
    store.flush();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    const parsed = JSON.parse(await Bun.file(stateFile).text()) as { readonly equityUsd: number };
    expect(parsed.equityUsd).toBe(10_321);
  });

  it("coalesces to the newest captured request and cancels it when flush supplies a snapshot", async () => {
    store.requestSave(makeState({ equityUsd: 10_101 }));
    store.requestSave(makeState({ equityUsd: 10_202 }));
    await Bun.sleep(100);
    let parsed = JSON.parse(await Bun.file(stateFile).text()) as { readonly equityUsd: number };
    expect(parsed.equityUsd).toBe(10_202);

    store.requestSave(makeState({ equityUsd: 10_303 }));
    store.flush(makeState({ equityUsd: 10_404 }));
    await Bun.sleep(100);
    parsed = JSON.parse(await Bun.file(stateFile).text()) as { readonly equityUsd: number };
    expect(parsed.equityUsd).toBe(10_404);
  });

  it("getCurrent() returns the latest requested state", () => {
    const s = makeState({ equityUsd: 9999 });
    store.requestSave(s);
    expect(store.getCurrent()?.equityUsd).toBe(9999);
  });

  it("getFilePath() returns the configured file path", () => {
    expect(store.getFilePath()).toBe(stateFile);
  });

  for (const invalidPath of ["", "\0state.json", "."] as const) {
    it(`rejects the invalid configured state path ${JSON.stringify(invalidPath)} before persistence`, () => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The test-created directory is the asserted persistence boundary.
      const directoryEntriesBeforeConstruction = readdirSync(temporaryDirectory);
      expect(() => new StateStore({ filePath: invalidPath, debounceMs: 50 })).toThrow(StateStoreError);

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The test-created directory is the asserted persistence boundary.
      const directoryEntriesAfterConstruction = readdirSync(temporaryDirectory);
      expect(directoryEntriesAfterConstruction).toEqual(directoryEntriesBeforeConstruction);
    });
  }

  it("skips write when state is identical to last written", () => {
    const s = makeState({ equityUsd: 8888 });
    store.flush(s);
    const mtime1 = Bun.file(stateFile).lastModified;
    store.flush(s);
    const mtime2 = Bun.file(stateFile).lastModified;
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

  it("StateStoreError is a real Error subclass with name and cause", () => {
    const cause = new Error("underlying io error");
    const error = new StateStoreError("save failed", cause);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(StateStoreError);
    expect(error.name).toBe("StateStoreError");
    expect(error.message).toBe("save failed");
    expect(error.cause).toBe(cause);
  });

  it("StateStoreError defaults cause to null when omitted", () => {
    const error = new StateStoreError("save failed");
    expect(error.cause).toBeNull();
  });
});

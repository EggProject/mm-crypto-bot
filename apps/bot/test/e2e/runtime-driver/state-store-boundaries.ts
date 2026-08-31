import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { RecordingLogger } from "@logging-testing";

import { StateStore, StateStoreError, type BotState } from "../../../src/bot/state-store.js";
import { assertCondition, expectFailure } from "./runtime-driver-core.js";

function state(equityUsd: number): BotState {
  return {
    version: 1,
    savedAt: 1,
    equityUsd,
    initialEquityUsd: 10_000,
    realizedPnlUsd: 0,
    positions: [],
    closedTrades: [],
    inFlightOrderIds: [],
    counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
  };
}

export async function runStateStoreBoundaries(): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-e2e-state-store-"));
  try {
    const filePath = path.join(directory, "nested", "state.json");
    const logger = new RecordingLogger();
    const store = new StateStore({ filePath, debounceMs: 5, logger });
    assertCondition(store.load() === null, "missing state file did not return null");
    store.flush(state(12_000));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is confined to a fresh process-owned temporary directory.
    assertCondition(existsSync(filePath), "flush did not atomically publish the snapshot");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The temporary name derives solely from the same fresh process-owned path.
    assertCondition(!existsSync(`${filePath}.tmp`), "temporary state file survived publication");
    assertCondition(store.load()?.equityUsd === 12_000, "published state did not round-trip");
    store.requestSave(state(13_000));
    store.requestSave(state(14_000));
    await Bun.sleep(20);
    assertCondition(store.load()?.equityUsd === 14_000, "debounce did not retain the newest state");
    assertCondition(store.getCurrent()?.equityUsd === 14_000, "current snapshot did not track the request");
    const unchangedRawState = await Bun.file(filePath).text();
    const savedBeforeIdenticalFlush = logger
      .getCalls()
      .filter((call) => call.event === "bot.state.saved").length;
    store.flush(state(14_000));
    assertCondition(
      (await Bun.file(filePath).text()) === unchangedRawState &&
        logger.getCalls().filter((call) => call.event === "bot.state.saved").length ===
          savedBeforeIdenticalFlush,
      "identical persisted state was unexpectedly written again",
    );
    assertCondition(store.getFilePath() === filePath, "configured state path changed");
    store.requestSave(state(15_000));
    store.flush();
    await Bun.sleep(20);
    assertCondition(store.load()?.equityUsd === 15_000, "flush did not cancel the pending debounce safely");
    const emptyFilePath = path.join(directory, "empty", "state.json");
    const emptyStore = new StateStore({
      filePath: emptyFilePath,
      debounceMs: 5,
      logger: new RecordingLogger(),
    });
    emptyStore.flush();
    await Bun.sleep(10);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is confined to a fresh process-owned temporary directory.
    assertCondition(!existsSync(emptyFilePath), "empty flush unexpectedly persisted a snapshot");
    const directoryStore = new StateStore({ filePath: directory, logger: new RecordingLogger() });
    assertCondition(directoryStore.load() === null, "directory-backed state path did not fail closed");

    const blockedParent = path.join(directory, "blocked-parent");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The blocker is confined to the same fresh process-owned temporary directory.
    writeFileSync(blockedParent, "file-not-directory", "utf8");
    const blockedStore = new StateStore({
      filePath: path.join(blockedParent, "child", "state.json"),
      logger: new RecordingLogger(),
    });
    let blockedWriteError: unknown;
    try {
      blockedStore.flush(state(16_000));
    } catch (error) {
      blockedWriteError = error;
    }
    assertCondition(
      blockedWriteError instanceof StateStoreError && blockedWriteError.cause instanceof Error,
      "invalid state directory did not expose its Node Error cause",
    );
    if (!(blockedWriteError instanceof StateStoreError) || !(blockedWriteError.cause instanceof Error)) {
      throw new Error("invalid state directory error narrowing failed");
    }
    assertCondition(
      blockedWriteError.message ===
        `[state-store] failed to create state directory ${blockedParent}/child: ${String(blockedWriteError.cause)}`,
      "invalid state directory did not preserve the canonical Node Error diagnostic",
    );

    const circularReference: { self?: unknown } = {};
    circularReference.self = circularReference;
    const circularPosition = {
      id: "e2e-circular-position",
      strategy: "state-store-boundary",
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
    let circularSerializationError: unknown;
    try {
      store.flush({ ...state(16_000), positions: [circularPosition] });
    } catch (error) {
      circularSerializationError = error;
    }
    assertCondition(
      circularSerializationError instanceof StateStoreError &&
        circularSerializationError.cause instanceof Error &&
        circularSerializationError.message.startsWith("[state-store] failed to serialize state:"),
      "circular StateStore flush did not preserve its typed serialization cause",
    );

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is confined to a fresh process-owned temporary directory.
    writeFileSync(filePath, "not-json", "utf8");
    assertCondition(store.load() === null, "invalid JSON state did not fail closed");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is confined to a fresh process-owned temporary directory.
    writeFileSync(filePath, JSON.stringify({ version: 99 }), "utf8");
    assertCondition(store.load() === null, "schema-invalid state did not fail closed");

    for (const invalidPath of ["", "\0state.json", "."] as const) {
      expectFailure(
        () => new StateStore({ filePath: invalidPath, logger: new RecordingLogger() }),
        `invalid state path ${JSON.stringify(invalidPath)}`,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

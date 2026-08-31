import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { RecordingLogger } from "@logging-testing";
import { configWithStateFile, rejectWith, waitUntil } from "./start-command.test-support.js";
import { runHeadless, type RuntimeLogger } from "./start.js";

describe("headless lifecycle", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-crypto-bot-headless-"));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("returns zero after a normal start completion without requesting stop", async () => {
    let starts = 0;
    let stops = 0;
    const logger = new RecordingLogger();
    const code = await runHeadless(
      {
        start: (): Promise<void> => {
          starts += 1;
          return Promise.resolve();
        },
        stop: (): Promise<void> => {
          stops += 1;
          return Promise.resolve();
        },
      },
      configWithStateFile(path.join(temporaryDirectory, "normal.json")),
      logger,
    );

    expect(code).toBe(0);
    expect(starts).toBe(1);
    expect(stops).toBe(0);
    expect(logger.getCalls()).toContainEqual({
      event: "bot.lifecycle.run.completed",
      fields: undefined,
      level: "info",
    });
  });

  it("returns one and records Error and non-Error startup failures", async () => {
    for (const failure of [new Error("startup exploded"), "startup rejected"] as const) {
      const logger = new RecordingLogger();
      const code = await runHeadless(
        {
          start: (): Promise<never> => rejectWith(failure),
          stop: (): Promise<void> => Promise.resolve(),
        },
        configWithStateFile(path.join(temporaryDirectory, `${typeof failure}.json`)),
        logger,
      );
      expect(code).toBe(1);
      expect(logger.getCalls()).toContainEqual({
        event: "bot.lifecycle.run.failed",
        fields: { error: failure },
        level: "error",
      });
    }
  });

  it("stores one shutdown promise, ignores a second signal, and awaits cleanup before return", async () => {
    const startGate = Promise.withResolvers<undefined>();
    const stopGate = Promise.withResolvers<undefined>();
    const baselineTermListeners = process.listenerCount("SIGTERM");
    let stops = 0;
    let isCleanupFinished = false;
    const logger = new RecordingLogger();

    const running = runHeadless(
      {
        start: async (): Promise<void> => startGate.promise,
        stop: async (): Promise<void> => {
          stops += 1;
          await stopGate.promise;
          isCleanupFinished = true;
        },
      },
      configWithStateFile(path.join(temporaryDirectory, "signal.json")),
      logger,
    );

    await waitUntil(() => process.listenerCount("SIGTERM") > baselineTermListeners);
    process.emit("SIGTERM", "SIGTERM");
    process.emit("SIGINT", "SIGINT");
    await waitUntil(() => stops === 1);
    startGate.resolve(undefined);

    let isReturned = false;
    void running.then(() => {
      isReturned = true;
    });
    await Bun.sleep(10);
    expect(isReturned).toBe(false);
    expect(isCleanupFinished).toBe(false);

    stopGate.resolve(undefined);
    expect(await running).toBe(0);
    expect(stops).toBe(1);
    expect(isCleanupFinished).toBe(true);
    expect(process.listenerCount("SIGTERM")).toBe(baselineTermListeners);
    expect(logger.getCalls()).toContainEqual({
      event: "bot.lifecycle.shutdown.completed",
      fields: { signal: "SIGTERM" },
      level: "info",
    });
  });

  it("stops exactly once when signal lifecycle info and error logging throws", async () => {
    const startGate = Promise.withResolvers<undefined>();
    const baselineTermListeners = process.listenerCount("SIGTERM");
    let errorLogs = 0;
    let infoLogs = 0;
    let stops = 0;
    const logger: RuntimeLogger = {
      critical: (): void => undefined,
      debug: (): void => undefined,
      error: (): never => {
        errorLogs += 1;
        throw new Error("error logger failed");
      },
      info: (): never => {
        infoLogs += 1;
        throw new Error("info logger failed");
      },
      shutdown: (): Promise<void> => Promise.resolve(),
      warn: (): void => undefined,
    };
    const running = runHeadless(
      {
        start: async (): Promise<void> => startGate.promise,
        stop: (): Promise<never> => {
          stops += 1;
          return rejectWith(new Error("stop failed"));
        },
      },
      configWithStateFile(path.join(temporaryDirectory, "throwing-signal-logger.json")),
      logger,
    );

    await waitUntil(() => process.listenerCount("SIGTERM") > baselineTermListeners);
    process.emit("SIGTERM", "SIGTERM");
    process.emit("SIGINT", "SIGINT");
    await waitUntil(() => stops === 1);
    startGate.resolve(undefined);

    expect(await running).toBe(1);
    expect(errorLogs).toBe(1);
    expect(infoLogs).toBeGreaterThan(0);
    expect(stops).toBe(1);
    expect(process.listenerCount("SIGTERM")).toBe(baselineTermListeners);
  });

  it("settles and logs a rejected shutdown before returning", async () => {
    for (const failure of [new Error("stop Error"), "stop rejected"] as const) {
      const startGate = Promise.withResolvers<undefined>();
      const baselineTermListeners = process.listenerCount("SIGTERM");
      const logger = new RecordingLogger();
      const running = runHeadless(
        {
          start: async (): Promise<void> => startGate.promise,
          stop: (): Promise<never> => rejectWith(failure),
        },
        configWithStateFile(path.join(temporaryDirectory, `failed-stop-${typeof failure}.json`)),
        logger,
      );

      await waitUntil(() => process.listenerCount("SIGTERM") > baselineTermListeners);
      process.emit("SIGTERM", "SIGTERM");
      startGate.resolve(undefined);
      expect(await running).toBe(1);
      expect(logger.getCalls()).toContainEqual({
        event: "bot.lifecycle.shutdown.failed",
        fields: { error: failure, signal: "SIGTERM" },
        level: "error",
      });
    }
  });
});

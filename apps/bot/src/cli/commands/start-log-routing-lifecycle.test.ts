import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";
import type { BotConfig } from "../../config/schema.js";
import { runHeadless } from "./start.js";

function configWithStateFile(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile },
  };
}

function rejectWith(reason: unknown): Promise<never> {
  const rejection = Promise.withResolvers<never>();
  queueMicrotask(() => {
    rejection.reject(reason);
  });
  return rejection.promise;
}

async function waitUntil(isSatisfied: () => boolean, timeoutMilliseconds = 2e3): Promise<void> {
  const deadlineMilliseconds = Date.now() + timeoutMilliseconds;
  while (!isSatisfied()) {
    if (Date.now() >= deadlineMilliseconds) throw new Error("timed out waiting for test condition");
    await Bun.sleep(5);
  }
}

describe("headless lifecycle", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-crypto-bot-headless-"));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("returns zero after a normal start completion without requesting stop", async () => {
    let startCalls = 0;
    let stopCalls = 0;
    const code = await runHeadless(
      {
        start: (): Promise<void> =>
          Promise.try(() => {
            startCalls += 1;
            console.log("normal completion");
          }),
        stop: (): Promise<void> =>
          Promise.try(() => {
            stopCalls += 1;
          }),
      },
      configWithStateFile(path.join(temporaryDirectory, "normal.json")),
    );

    expect(code).toBe(0);
    expect(startCalls).toBe(1);
    expect(stopCalls).toBe(0);
    expect(await Bun.file(path.join(temporaryDirectory, "normal.json.log")).text()).toContain(
      "normal completion",
    );
  });

  it("returns one and records Error and non-Error startup failures", async () => {
    for (const failure of [new Error("startup exploded"), "startup rejected"] as const) {
      const stateFile = path.join(temporaryDirectory, `${typeof failure}.json`);
      const code = await runHeadless(
        {
          start: (): Promise<never> => rejectWith(failure),
          stop: (): Promise<void> => Promise.resolve(),
        },
        configWithStateFile(stateFile),
      );
      expect(code).toBe(1);
      expect(await Bun.file(`${stateFile}.log`).text()).toContain(
        typeof failure === "string" ? failure : failure.message,
      );
    }
  });

  it("stores one shutdown promise, ignores a second signal, and awaits cleanup before return", async () => {
    const startGate = Promise.withResolvers<undefined>();
    const stopGate = Promise.withResolvers<undefined>();
    const baselineTermListeners = process.listenerCount("SIGTERM");
    let stopCalls = 0;
    let hasCleanupFinished = false;

    const running = runHeadless(
      {
        start: (): Promise<undefined> => startGate.promise,
        stop: async (): Promise<void> => {
          stopCalls += 1;
          await stopGate.promise;
          hasCleanupFinished = true;
        },
      },
      configWithStateFile(path.join(temporaryDirectory, "signal.json")),
    );

    await waitUntil(() => process.listenerCount("SIGTERM") > baselineTermListeners);
    process.emit("SIGTERM", "SIGTERM");
    process.emit("SIGINT", "SIGINT");
    await waitUntil(() => stopCalls === 1);
    startGate.resolve(undefined);

    let hasReturned = false;
    void running.then(() => {
      hasReturned = true;
    });
    await Bun.sleep(10);
    expect(hasReturned).toBe(false);
    expect(hasCleanupFinished).toBe(false);

    stopGate.resolve(undefined);
    expect(await running).toBe(0);
    expect(stopCalls).toBe(1);
    expect(hasCleanupFinished).toBe(true);
    expect(process.listenerCount("SIGTERM")).toBe(baselineTermListeners);
  });

  it("settles and logs a rejected shutdown before returning", async () => {
    for (const failure of [new Error("stop Error"), "stop rejected"] as const) {
      const startGate = Promise.withResolvers<undefined>();
      const baselineTermListeners = process.listenerCount("SIGTERM");
      const stateFile = path.join(temporaryDirectory, `failed-stop-${typeof failure}.json`);
      const running = runHeadless(
        {
          start: (): Promise<undefined> => startGate.promise,
          stop: (): Promise<never> => rejectWith(failure),
        },
        configWithStateFile(stateFile),
      );

      await waitUntil(() => process.listenerCount("SIGTERM") > baselineTermListeners);
      process.emit("SIGTERM", "SIGTERM");
      startGate.resolve(undefined);
      expect(await running).toBe(1);
      expect(await Bun.file(`${stateFile}.log`).text()).toContain(
        typeof failure === "string" ? failure : failure.message,
      );
    }
  });
});

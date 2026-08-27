import { describe, expect, it } from "bun:test";

import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";
import type { BotConfig } from "../../config/schema.js";
import { installConsoleRedirection, resolveLogFilePath, restoreConsoleRedirection } from "./start.js";

function configWithStateFile(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile },
  };
}

describe("headless log-path boundary", () => {
  it("derives the adjacent log path for relative and absolute state files", () => {
    expect(resolveLogFilePath(configWithStateFile("data/bot-state.json"))).toBe("data/bot-state.json.log");
    expect(resolveLogFilePath(configWithStateFile("/var/lib/mm-crypto-bot/state.json"))).toBe(
      "/var/lib/mm-crypto-bot/state.json.log",
    );
    expect(resolveLogFilePath(configWithStateFile("bot-state"))).toBe("bot-state.log");
  });

  it("rejects empty, non-normalized, and null-byte paths before filesystem access", () => {
    expect(() => resolveLogFilePath(configWithStateFile(""))).toThrow(/normalized file path/);
    expect(() => resolveLogFilePath(configWithStateFile("data/../state.json"))).toThrow(
      /normalized file path/,
    );
    expect(() => resolveLogFilePath(configWithStateFile("data/\0state.json"))).toThrow(
      /normalized file path/,
    );
  });
});

describe("headless console redirection", () => {
  it("captures strings, errors, and structured values and restores console methods", async () => {
    const writes: string[] = [];
    const stream = {
      write: (data: string): Promise<void> =>
        Promise.try(() => {
          writes.push(data);
        }),
      close: (): Promise<void> => Promise.resolve(),
    };
    const originalLog = console.log;
    const originalError = console.error;
    const backup = installConsoleRedirection(stream);
    try {
      console.log("hello world");
      console.error("oh no");
      console.log({ structured: "object" });
    } finally {
      restoreConsoleRedirection(backup);
    }
    await backup.drain();

    expect(console.log).toBe(originalLog);
    expect(console.error).toBe(originalError);
    expect(writes.join("")).toContain("[log] hello world");
    expect(writes.join("")).toContain("[error] oh no");
    expect(writes.join("")).toContain('[log] {"structured":"object"}');
  });

  it("settles rejected writes while draining so shutdown can still close the file", async () => {
    const rejectedWrite = Promise.withResolvers<never>();
    const backup = installConsoleRedirection({
      write: (): Promise<never> => rejectedWrite.promise,
      close: (): Promise<void> => Promise.resolve(),
    });
    try {
      console.error("cannot persist");
    } finally {
      restoreConsoleRedirection(backup);
    }
    const draining = backup.drain();
    let hasDrained = false;
    void draining.then(() => {
      hasDrained = true;
    });
    await Bun.sleep(5);
    expect(hasDrained).toBe(false);
    rejectedWrite.reject(new Error("disk unavailable"));
    await draining;
    expect(hasDrained).toBe(true);
  });
});

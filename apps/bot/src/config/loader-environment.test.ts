import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigError, loadBotConfig } from "./loader.js";

function expectConfigError(action: () => unknown): ConfigError {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("Expected loadBotConfig to throw ConfigError");
}

describe("loader environment overrides", () => {
  it("rejects BUN_ENV=live before it can activate a paper TOML configuration", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const configPath = join(directory, "paper.toml");
    writeFileSync(configPath, '[bot]\nmode = "paper"\n', "utf8");
    try {
      const configuredPaperMode = loadBotConfig(configPath, {}).bot.mode;
      const error = expectConfigError(() => loadBotConfig(configPath, { BUN_ENV: "live" }));
      expect(configuredPaperMode).toBe("paper");
      expect(error.path).toBe("BUN_ENV");
      expect(error.issues).toEqual([{ path: "BUN_ENV", message: "BUN_ENV=live cannot activate live mode." }]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("applies BUN_ENV=paper", () => {
    expect(loadBotConfig(undefined, { BUN_ENV: "paper" }).bot.mode).toBe("paper");
  });

  it("applies LOG_LEVEL=debug", () => {
    expect(loadBotConfig(undefined, { LOG_LEVEL: "debug" }).bot.log_level).toBe("debug");
  });

  it("ignores an invalid LOG_LEVEL", () => {
    expect(loadBotConfig(undefined, { LOG_LEVEL: "invalid" }).bot.log_level).toBe("info");
  });

  it("ignores an invalid BUN_ENV", () => {
    expect(loadBotConfig(undefined, { BUN_ENV: "test" }).bot.mode).toBe("paper");
  });

  it("applies LOG_LEVEL after TOML content", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const configPath = join(directory, "log-level.toml");
    writeFileSync(configPath, '[bot]\nlog_level = "warn"\n', "utf8");
    try {
      expect(loadBotConfig(configPath, { LOG_LEVEL: "debug" }).bot.log_level).toBe("debug");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

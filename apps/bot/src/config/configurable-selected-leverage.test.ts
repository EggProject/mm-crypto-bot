import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { requireConfigError } from "./config-test-fixtures.test-support.js";
import { ConfigError, loadBotConfig } from "./loader.js";

async function writeTemporaryFixture(filePath: string, contents: string): Promise<void> {
  await Bun.write(filePath, contents);
}

describe("risk maximum leverage configuration", () => {
  it("loads the optimized paper profile without changing risk.max_leverage semantics", () => {
    const configPath = nodePath.resolve("run-bot/config/paper-backtest-optimized.toml");

    expect(loadBotConfig(configPath).risk.max_leverage).toBe(10);
  });

  it("REJECTS risk.max_leverage = 5 instead of treating 10x as a cap", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "non-fixed-leverage.toml");
    await writeTemporaryFixture(path, "[risk]\nmax_leverage = 5\n");
    try {
      let caught: unknown;
      try {
        loadBotConfig(path);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      expect(requireConfigError(caught).path).toBe("risk.max_leverage");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("configurable selected leverage configuration", () => {
  it("defaults the omitted selected leverage to exact canonical 10", () => {
    expect(loadBotConfig().bot.selected_leverage.canonical).toBe("10");
  });

  it("accepts canonical 2.5 through a paper configuration load without numeric conversion", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "paper-selected-leverage.toml");
    await writeTemporaryFixture(path, '[bot]\nmode = "paper"\nselected_leverage = "2.5"\n');
    try {
      expect(loadBotConfig(path).bot.selected_leverage.canonical).toBe("2.5");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["numeric", "10"],
    ["trailing fractional zero", '"2.0"'],
    ["leading zero", '"01"'],
    ["zero", '"0"'],
    ["unknown alias", '"ten"'],
  ])("rejects %s selected leverage at bot.selected_leverage", async (_description, value) => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "invalid-selected-leverage.toml");
    await writeTemporaryFixture(path, `[bot]\nselected_leverage = ${value}\n`);
    try {
      let caught: unknown;
      try {
        loadBotConfig(path);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      expect(requireConfigError(caught).path).toBe("bot.selected_leverage");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

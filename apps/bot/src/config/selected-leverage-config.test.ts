import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ConfigError, loadBotConfig } from "./loader.js";
import { ConfigStore } from "./store.js";
import { BotConfigSchema } from "./schema.js";

function withTemporaryConfig(contents: string, action: (path: string) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), "mm-selected-leverage-"));
  const configPath = path.join(directory, "config.toml");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact file is a child of this test's fresh mkdtemp directory.
  writeFileSync(configPath, contents, "utf8");
  try {
    action(configPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function selectedLeverageCanonical(config: object): unknown {
  const bot: unknown = Reflect.get(config, "bot");
  if (bot === null || typeof bot !== "object") return undefined;
  const selectedLeverage: unknown = Reflect.get(bot, "selected_leverage");
  if (selectedLeverage === null || typeof selectedLeverage !== "object") return undefined;
  return Reflect.get(selectedLeverage, "canonical");
}

function requireConfigError(error: unknown): ConfigError {
  if (error instanceof ConfigError) return error;
  throw new Error("Expected ConfigError");
}

describe("selected leverage configuration", () => {
  it("defaults to exact canonical 10", () => {
    expect(selectedLeverageCanonical(loadBotConfig(undefined, {}))).toBe("10");
  });

  it("loads canonical 2.5 without numeric conversion", () => {
    withTemporaryConfig('[bot]\nselected_leverage = "2.5"\n', (path) => {
      expect(selectedLeverageCanonical(loadBotConfig(path, {}))).toBe("2.5");
    });
  });

  it.each(["2.0", "01", "0", "-1", "ten"])(
    "rejects noncanonical or invalid selected leverage %p at the bot boundary",
    (value) => {
      const result = BotConfigSchema.safeParse({ bot: { selected_leverage: value } });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.join(".") === "bot.selected_leverage")).toBe(
          true,
        );
      }
    },
  );

  it("rejects a numeric TOML selected leverage without coercion", () => {
    withTemporaryConfig("[bot]\nselected_leverage = 10\n", (path) => {
      let caught: unknown;
      try {
        loadBotConfig(path, {});
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      expect(requireConfigError(caught).path).toBe("bot.selected_leverage");
    });
  });

  it("stores the exact canonical representation and restores it", () => {
    withTemporaryConfig("", (path) => {
      const store = new ConfigStore(path);
      const config = BotConfigSchema.parse({ bot: { selected_leverage: "2.5" } });
      store.write(config);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact file is a child of this test's fresh mkdtemp directory.
      expect(readFileSync(path, "utf8")).toContain('selected_leverage = "2.5"');
      expect(selectedLeverageCanonical(store.read())).toBe("2.5");
    });
  });

  it("fails closed when a hostile selected leverage value reaches the store", () => {
    const store = new ConfigStore(path.join(tmpdir(), "mm-selected-leverage-hostile.toml"));
    const hostile = new Proxy(
      {},
      {
        get(): never {
          throw new Error("hostile selected leverage");
        },
      },
    );
    expect(() => store.validate({ bot: { selected_leverage: hostile } })).toThrow();
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { createTestBotConfig } from "./config-test-fixtures.test-support.js";
import { ConfigStore, type ConfigStoreDependencies } from "./store.js";

const fileSystem = await import("node:fs");

function createTemporaryDirectory(prefix: string): string {
  return mkdtempSync(nodePath.join(tmpdir(), prefix));
}

describe("ConfigStore write failures and backups", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = createTemporaryDirectory("mm-bot-store-write-");
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("wraps non-Error read failures and generic parser failures", () => {
    const readFailure = new ConfigStore(nodePath.join(temporaryDirectory, "read-failure.toml"), {
      readText: () => {
        throw new Error("plain read failure");
      },
    });
    expect(() => readFailure.read()).toThrow("plain read failure");

    const parseFailure = new ConfigStore(nodePath.join(temporaryDirectory, "parse-failure.toml"), {
      readText: () => "",
      parse: () => {
        throw new Error("generic parse failure");
      },
    });
    expect(() => parseFailure.read()).toThrow("generic parse failure");
  });

  it("wraps Error and non-Error round-trip parser failures", () => {
    for (const failure of [new Error("round-trip Error"), "round-trip string"] as const) {
      const store = new ConfigStore(nodePath.join(temporaryDirectory, `roundtrip-${typeof failure}.toml`), {
        parse: () => {
          throw failure instanceof Error ? failure : new Error(failure);
        },
      });
      expect(() => {
        store.write(store.validate({}));
      }).toThrow(typeof failure === "string" ? failure : failure.message);
    }
  });

  it("wraps Error and non-Error atomic write failures", () => {
    for (const failure of [new Error("atomic Error"), "atomic string"] as const) {
      const dependencies: Partial<ConfigStoreDependencies> = {
        atomicWrite: () => {
          throw failure instanceof Error ? failure : new Error(failure);
        },
      };
      const store = new ConfigStore(
        nodePath.join(temporaryDirectory, `atomic-${typeof failure}.toml`),
        dependencies,
      );
      expect(() => {
        store.write(store.validate({}));
      }).toThrow(typeof failure === "string" ? failure : failure.message);
    }
  });

  it("wraps Error and non-Error audit append failures before writing live config", () => {
    for (const failure of [new Error("audit Error"), "audit string"] as const) {
      const store = new ConfigStore(nodePath.join(temporaryDirectory, `audit-${typeof failure}.toml`), {
        appendText: () => {
          throw failure instanceof Error ? failure : new Error(failure);
        },
      });
      store.write(createTestBotConfig());
      const live = createTestBotConfig({ bot: { mode: "live" } });
      expect(() => store.writeAfterTypedLive(live, "LIVE")).toThrow(
        typeof failure === "string" ? failure : failure.message,
      );
    }
  });

  it("write() creates the parent directory if it doesn't exist", () => {
    const path = nodePath.join(temporaryDirectory, "deep/nested/mm-bot.toml");
    new ConfigStore(path).write(createTestBotConfig());
    expect(fileSystem.existsSync(path)).toBe(true);
  });

  it("write() preserves the previous file as .bak (byte-identical copy)", () => {
    const path = nodePath.join(temporaryDirectory, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(createTestBotConfig({ risk: { risk_per_trade: 0.01 } }));
    const beforeContents = fileSystem.readFileSync(path, "utf8");
    store.write(createTestBotConfig({ risk: { risk_per_trade: 0.05 } }));
    const backupContents = fileSystem.readFileSync(`${path}.bak`, "utf8");
    expect(backupContents).toBe(beforeContents);
    expect(fileSystem.readFileSync(path, "utf8")).not.toBe(backupContents);
  });

  it("write() does NOT create a .bak on the first write (no previous file)", () => {
    const path = nodePath.join(temporaryDirectory, "mm-bot.toml");
    new ConfigStore(path).write(createTestBotConfig());
    expect(fileSystem.existsSync(`${path}.bak`)).toBe(false);
  });

  it("write() copies an existing file to .bak (manual pre-seed)", () => {
    const path = nodePath.join(temporaryDirectory, "mm-bot.toml");
    fileSystem.writeFileSync(path, "placeholder\n", "utf8");
    new ConfigStore(path).write(createTestBotConfig());
    expect(fileSystem.existsSync(`${path}.bak`)).toBe(true);
    expect(fileSystem.readFileSync(`${path}.bak`, "utf8")).toBe("placeholder\n");
  });

  it("write() handles the copyFileSync path correctly when path is relative", () => {
    const path = nodePath.join(temporaryDirectory, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(createTestBotConfig());
    expect(() => {
      copyFileSync(path, `${path}.bak`);
    }).not.toThrow();
  });
});

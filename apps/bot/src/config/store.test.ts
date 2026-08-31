import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { SelectedLeverage } from "@mm-crypto-bot/numeric";

import { createTestBotConfig } from "./config-test-fixtures.test-support.js";
import type { BotConfig } from "./schema.js";
import {
  ConfigLiveConfirmError,
  ConfigReadError,
  ConfigStore,
  ConfigValidationError,
  getConfigStore,
  resetConfigStoreCache,
} from "./store.js";

const fileSystem = await import("node:fs");

function createTemporaryDirectory(prefix: string): string {
  return mkdtempSync(nodePath.join(tmpdir(), prefix));
}

function requireReadError(error: unknown): ConfigReadError {
  if (error instanceof ConfigReadError) return error;
  throw new Error("Expected ConfigReadError");
}

function requireValidationError(error: unknown): ConfigValidationError {
  if (error instanceof ConfigValidationError) return error;
  throw new Error("Expected ConfigValidationError");
}

function requireLiveConfirmError(error: unknown): ConfigLiveConfirmError {
  if (error instanceof ConfigLiveConfirmError) return error;
  throw new Error("Expected ConfigLiveConfirmError");
}

describe("ConfigStore", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = createTemporaryDirectory("mm-bot-store-");
    resetConfigStoreCache();
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    resetConfigStoreCache();
  });

  it("read() returns Zod defaults for a valid empty file", () => {
    const path = nodePath.join(temporaryDirectory, "mm-bot.toml");
    fileSystem.writeFileSync(path, "", "utf8");
    const config = new ConfigStore(path).read();
    expect(config.bot.mode).toBe("paper");
    expect(config.risk.risk_per_trade).toBe(0.01);
    expect(config.risk.max_leverage).toBe(10);
  });

  it("read() throws ConfigReadError if file is missing", () => {
    const path = nodePath.join(temporaryDirectory, "does-not-exist.toml");
    let caught: unknown;
    try {
      new ConfigStore(path).read();
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigReadError);
    expect(requireReadError(caught).path).toBe(path);
  });

  it("read() throws ConfigReadError on invalid TOML syntax", () => {
    const path = nodePath.join(temporaryDirectory, "bad.toml");
    fileSystem.writeFileSync(path, "this is not [ valid TOML", "utf8");
    let caught: unknown;
    try {
      new ConfigStore(path).read();
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigReadError);
    expect(requireReadError(caught).message).toContain("Failed to parse TOML");
  });

  it("read() throws ConfigValidationError on Zod-rejected file", () => {
    const path = nodePath.join(temporaryDirectory, "bad-zod.toml");
    fileSystem.writeFileSync(path, "[risk]\nmax_leverage = 15\n", "utf8");
    let caught: unknown;
    try {
      new ConfigStore(path).read();
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
    const validationError = requireValidationError(caught);
    expect(validationError.fieldErrors["risk.max_leverage"]).toBeDefined();
    expect(validationError.fieldErrors["risk.max_leverage"]?.[0]).toContain("10");
  });

  it("validate() round-trips a parsed object", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "round-trip.toml"));
    const validated = store.validate({
      bot: { mode: "paper", log_level: "info" },
      risk: { risk_per_trade: 0.02, max_leverage: 10 },
    });
    expect(validated.risk.risk_per_trade).toBe(0.02);
    expect(validated.risk.max_leverage).toBe(10);
    expect(validated.bot.mode).toBe("paper");
  });

  it("validate() throws ConfigValidationError on max_leverage = 15", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "validation.toml"));
    expect(() => store.validate({ risk: { max_leverage: 15 } })).toThrow(ConfigValidationError);
  });

  it("validate() throws ConfigValidationError on bot.mode = 'invalid'", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "validation.toml"));
    expect(() => store.validate({ bot: { mode: "invalid" } })).toThrow(ConfigValidationError);
  });

  it("write() creates the file and the .bak on the second write", () => {
    const path = nodePath.join(temporaryDirectory, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(createTestBotConfig({ risk: { risk_per_trade: 0.01 } }));
    expect(fileSystem.existsSync(path)).toBe(true);
    expect(fileSystem.existsSync(`${path}.bak`)).toBe(false);
    store.write(createTestBotConfig({ risk: { risk_per_trade: 0.02 } }));
    expect(fileSystem.existsSync(`${path}.bak`)).toBe(true);
    const backupContents = fileSystem.readFileSync(`${path}.bak`, "utf8");
    expect(backupContents).toContain("risk_per_trade = 0.01");
    expect(backupContents).not.toContain("risk_per_trade = 0.02");
  });

  it("write() + read() round-trip preserves the config", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "mm-bot.toml"));
    store.write(
      createTestBotConfig({
        risk: { risk_per_trade: 0.03, max_leverage: 10 },
        symbols: { enabled: ["BTC/USDC", "ETH/USDC", "SOL/USDC"] },
      }),
    );
    const reloaded = store.read();
    expect(reloaded.risk.risk_per_trade).toBe(0.03);
    expect(reloaded.risk.max_leverage).toBe(10);
    expect(reloaded.symbols.enabled).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
  });

  it("writes and reads canonical selected leverage without changing it", () => {
    const path = nodePath.join(temporaryDirectory, "selected-leverage.toml");
    const store = new ConfigStore(path);
    const configured = store.validate({ bot: { selected_leverage: "2.5" } });

    store.write(configured);

    expect(fileSystem.readFileSync(path, "utf8")).toContain('selected_leverage = "2.5"');
    expect(store.read().bot.selected_leverage.canonical).toBe("2.5");
  });

  it("writes the default selected leverage as canonical 10", () => {
    const path = nodePath.join(temporaryDirectory, "default-selected-leverage.toml");
    const store = new ConfigStore(path);

    store.write(createTestBotConfig());

    expect(fileSystem.readFileSync(path, "utf8")).toContain('selected_leverage = "10"');
  });

  it("validate() rejects noncanonical, non-string, and forged raw selected leverage values", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "selected-leverage-validation.toml"));
    const rawCandidates: readonly unknown[] = [
      { bot: { selected_leverage: "2.0" } },
      { bot: { selected_leverage: "01" } },
      { bot: { selected_leverage: 2.5 } },
      { bot: { selected_leverage: { canonical: "2.5" } } },
    ];

    for (const rawCandidate of rawCandidates) {
      let caught: unknown;
      try {
        store.validate(rawCandidate);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigValidationError);
      expect(requireValidationError(caught).fieldErrors["bot.selected_leverage"]).toBeDefined();
    }
  });

  it("rejects a lossy selected leverage codec before filesystem side effects", () => {
    const calls: string[] = [];
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "lossy-selected-leverage.toml"), {
      stringify: () => {
        calls.push("stringify");
        return "lossy";
      },
      parse: () => ({ bot: { selected_leverage: "2.6" } }),
      exists: () => {
        calls.push("exists");
        return false;
      },
      ensureDirectory: () => {
        calls.push("ensureDirectory");
      },
      copy: () => {
        calls.push("copy");
      },
      atomicWrite: () => {
        calls.push("atomicWrite");
      },
    });

    let caught: unknown;
    try {
      store.write(store.validate({ bot: { selected_leverage: "10" } }));
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigValidationError);
    expect(requireValidationError(caught).fieldErrors["bot.selected_leverage"]).toBeDefined();
    expect(calls).toEqual(["stringify"]);
  });

  it("rejects forged selected leverage values before serialization or filesystem side effects", () => {
    const calls: string[] = [];
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "forged-selected-leverage.toml"), {
      stringify: () => {
        calls.push("stringify");
        return "";
      },
      exists: () => {
        calls.push("exists");
        return false;
      },
      ensureDirectory: () => {
        calls.push("ensureDirectory");
      },
      copy: () => {
        calls.push("copy");
      },
      atomicWrite: () => {
        calls.push("atomicWrite");
      },
    });
    const valid = store.validate({ bot: { selected_leverage: "10" } });
    const prototypeForgery = {};
    Object.setPrototypeOf(prototypeForgery, SelectedLeverage.prototype);
    const forgedValues: readonly unknown[] = [
      { canonical: "10" },
      prototypeForgery,
      new Proxy(valid.bot.selected_leverage, {}),
    ];

    for (const forgedValue of forgedValues) {
      let caught: unknown;
      try {
        const write = (next: BotConfig): void => {
          store.write(next);
        };
        Reflect.apply(write, undefined, [
          { ...valid, bot: { ...valid.bot, selected_leverage: forgedValue } },
        ]);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigValidationError);
      expect(requireValidationError(caught).fieldErrors["bot.selected_leverage"]).toBeDefined();
    }
    expect(calls).toEqual([]);
  });

  it("records only a pending audit entry when a live codec loses selected leverage", () => {
    const auditEntries: string[] = [];
    const calls: string[] = [];
    let parseCount = 0;
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "lossy-live-selected-leverage.toml"), {
      readText: () => "existing",
      stringify: () => {
        calls.push("stringify");
        return "lossy";
      },
      parse: () => {
        parseCount += 1;
        return parseCount === 1
          ? { bot: { mode: "paper", selected_leverage: "10" } }
          : { bot: { mode: "live", selected_leverage: "2.5" } };
      },
      appendText: (_path, contents) => {
        auditEntries.push(contents);
      },
      exists: () => {
        calls.push("exists");
        return false;
      },
      ensureDirectory: () => {
        calls.push("ensureDirectory");
      },
      copy: () => {
        calls.push("copy");
      },
      atomicWrite: () => {
        calls.push("atomicWrite");
      },
    });
    const live = store.validate({ bot: { mode: "live", selected_leverage: "10" } });

    expect(() => store.writeAfterTypedLive(live, "LIVE")).toThrow(ConfigValidationError);
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toContain('"status":"pending"');
    expect(auditEntries[0]).not.toContain('"status":"committed"');
    expect(calls).toEqual(["stringify"]);
  });

  it("rejects a forged live selected leverage value before recording an audit entry", () => {
    const calls: string[] = [];
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "forged-live-selected-leverage.toml"), {
      stringify: () => {
        calls.push("stringify");
        return "";
      },
      appendText: () => {
        calls.push("appendAudit");
      },
      readText: () => {
        calls.push("readText");
        return "";
      },
    });
    const live = store.validate({ bot: { mode: "live", selected_leverage: "10" } });
    const forged = {
      ...live,
      bot: { ...live.bot, selected_leverage: new Proxy(live.bot.selected_leverage, {}) },
    };

    let caught: unknown;
    try {
      const writeAfterTypedLive = (next: unknown, typedValue: string): void => {
        store.writeAfterTypedLive(next, typedValue);
      };
      Reflect.apply(writeAfterTypedLive, undefined, [forged, "LIVE"]);
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigValidationError);
    expect(requireValidationError(caught).fieldErrors["bot.selected_leverage"]).toBeDefined();
    expect(calls).toEqual([]);
  });

  it("write() rejects Zod-invalid input (max_leverage = 15)", () => {
    const path = nodePath.join(temporaryDirectory, "mm-bot.toml");
    const store = new ConfigStore(path);
    const write = (candidate: BotConfig): void => {
      store.write(candidate);
    };
    expect(() => {
      Reflect.apply(write, undefined, [{ risk: { max_leverage: 15 } }]);
    }).toThrow(ConfigValidationError);
    expect(fileSystem.existsSync(path)).toBe(false);
  });

  it('writeAfterTypedLive("LIVE") writes the config + audit entry', () => {
    const path = nodePath.join(temporaryDirectory, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(createTestBotConfig());
    const current = store.read();
    current.bot.mode = "live";
    const entry = store.writeAfterTypedLive(current, "LIVE");
    expect(entry.event).toBe("live-mode-confirm");
    expect(entry.previousMode).toBe("paper");
    expect(entry.newMode).toBe("live");
    expect(entry.status).toBe("committed");
    const auditContents = fileSystem.readFileSync(`${path}.audit.log`, "utf8");
    expect(auditContents).toContain("live-mode-confirm");
    expect(auditContents).toContain('"previousMode":"paper"');
    expect(auditContents).toContain('"newMode":"live"');
    expect(store.read().bot.mode).toBe("live");
  });

  it('writeAfterTypedLive("live") throws ConfigLiveConfirmError', () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "mm-bot.toml"));
    store.write(createTestBotConfig());
    const current = store.read();
    current.bot.mode = "live";
    let caught: unknown;
    try {
      store.writeAfterTypedLive(current, "live");
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigLiveConfirmError);
    expect(requireLiveConfirmError(caught).typedValue).toBe("live");
  });

  it('writeAfterTypedLive("") throws ConfigLiveConfirmError', () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "mm-bot.toml"));
    expect(() => store.writeAfterTypedLive(createTestBotConfig({ bot: { mode: "live" } }), "")).toThrow(
      ConfigLiveConfirmError,
    );
  });

  it("getConfigStore(<path>) returns the same instance (singleton)", () => {
    const path = nodePath.join(temporaryDirectory, "mm-bot.toml");
    expect(getConfigStore(path)).toBe(getConfigStore(path));
  });

  it("getConfigStore(<path1>) and getConfigStore(<path2>) return different instances", () => {
    const firstPath = nodePath.join(temporaryDirectory, "first.toml");
    const secondPath = nodePath.join(temporaryDirectory, "second.toml");
    const first = getConfigStore(firstPath);
    const second = getConfigStore(secondPath);
    expect(first).not.toBe(second);
    expect(first.path).toBe(firstPath);
    expect(second.path).toBe(secondPath);
  });

  it("resetConfigStoreCache() clears the cache", () => {
    const path = nodePath.join(temporaryDirectory, "mm-bot.toml");
    const first = getConfigStore(path);
    resetConfigStoreCache();
    const second = getConfigStore(path);
    expect(first).not.toBe(second);
    expect(first.path).toBe(path);
    expect(second.path).toBe(path);
  });

  it("getConfigStore() resolves and caches the default path", () => {
    const first = getConfigStore();
    expect(first).toBe(getConfigStore());
    expect(first.path.endsWith("/mm-bot.toml")).toBe(true);
  });

  it("validate reports a root-level issue for a non-object candidate", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "root-invalid.toml"));
    let caught: unknown;
    try {
      store.validate(undefined);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
    expect(requireValidationError(caught).fieldErrors["<root>"]).toBeDefined();
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { createTestBotConfig } from "./config-test-fixtures.test-support.js";
import { ConfigReadError, ConfigStore, ConfigValidationError } from "./store.js";

const fileSystem = await import("node:fs");

function createTemporaryDirectory(prefix: string): string {
  return mkdtempSync(nodePath.join(tmpdir(), prefix));
}

function createSeededStore(path: string): ConfigStore {
  const store = new ConfigStore(path);
  store.write(createTestBotConfig());
  return store;
}

function expectValidationFailure(action: () => void): void {
  expect(action).toThrow(ConfigValidationError);
}

describe("ConfigStore section setters", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = createTemporaryDirectory("mm-bot-store-sections-");
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("setStrategyEnabled: flips a strategy to enabled and persists", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setStrategyEnabled("funding_flip_kill_switch", true);
    expect(store.read().strategies.funding_flip_kill_switch.enabled).toBe(true);
  });

  it("setStrategyEnabled: flips a strategy to disabled and persists", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setStrategyEnabled("donchian_pivot_composition", false);
    expect(store.read().strategies.donchian_pivot_composition.enabled).toBe(false);
  });

  it("setStrategyEnabled: creates a .bak on a subsequent write (atomic + .bak)", () => {
    const path = nodePath.join(temporaryDirectory, "bot.toml");
    const store = createSeededStore(path);
    store.setStrategyEnabled("regime_detector", true);
    expect(fileSystem.existsSync(`${path}.bak`)).toBe(true);
  });

  it("setStrategyEnabled: preserves other strategy fields (cap etc.)", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setStrategyEnabled("donchian_pivot_composition", false);
    expect(store.read().strategies.donchian_pivot_composition.cap).toBe(0.2);
  });

  it("setStrategySetting: updates the 'cap' field and persists", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setStrategySetting("donchian_pivot_composition", "cap", 0.5);
    expect(store.read().strategies.donchian_pivot_composition.cap).toBe(0.5);
  });

  it("setStrategySetting: rejects the removed dydx carry leverage selector", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    expectValidationFailure(() => {
      store.setStrategySetting("dydx_cex_carry", "leverage", 10);
    });
  });

  it("setStrategySetting: rejects a removed dydx carry leverage selector with another value", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    expectValidationFailure(() => {
      store.setStrategySetting("dydx_cex_carry", "leverage", 15);
    });
  });

  it("setStrategySetting: rejects cap > 1.0", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    expectValidationFailure(() => {
      store.setStrategySetting("donchian_pivot_composition", "cap", 1.5);
    });
  });

  it("setStrategySetting: updates the supported carry notional field", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setStrategySetting("dydx_cex_carry", "notional_per_leg_usd", 250_000);
    expect(store.read().strategies.dydx_cex_carry.notional_per_leg_usd).toBe(250_000);
  });

  it("setStrategySetting: rejects value with wrong type (string for numeric field)", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    expectValidationFailure(() => {
      store.setStrategySetting("dydx_cex_carry", "notional_per_leg_usd", "five");
    });
  });

  it("setStrategySetting: preserves the 'enabled' field when changing 'cap'", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setStrategySetting("donchian_pivot_composition", "cap", 0.42);
    expect(store.read().strategies.donchian_pivot_composition).toMatchObject({ enabled: true, cap: 0.42 });
  });

  it("setExchangeConfig: updates slippage_pct and persists", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setExchangeConfig({ slippage_pct: 0.1 });
    expect(store.read().exchange.slippage_pct).toBe(0.1);
  });

  it("setExchangeConfig: updates fee_tier to 'vip'", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setExchangeConfig({ fee_tier: "vip" });
    expect(store.read().exchange.fee_tier).toBe("vip");
  });

  it("setExchangeConfig: updates rate_limit_per_min", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setExchangeConfig({ rate_limit_per_min: 300 });
    expect(store.read().exchange.rate_limit_per_min).toBe(300);
  });

  it("setExchangeConfig: updates ws_reconnect_delay_ms", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setExchangeConfig({ ws_reconnect_delay_ms: 5000 });
    expect(store.read().exchange.ws_reconnect_delay_ms).toBe(5000);
  });

  it("setExchangeConfig: partial update preserves other fields (merge)", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setExchangeConfig({ slippage_pct: 0.2 });
    expect(store.read().exchange).toMatchObject({ fee_tier: "standard", rate_limit_per_min: 120 });
  });

  it("setExchangeConfig: rejects slippage_pct > 1.0 (Zod range)", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    expectValidationFailure(() => {
      store.setExchangeConfig({ slippage_pct: 2 });
    });
  });

  it("setExchangeConfig: rejects invalid fee_tier enum", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "bot.toml"));
    expectValidationFailure(() => store.validate({ exchange: { fee_tier: "platinum" } }));
  });

  it("setExchangeConfig: rejects rate_limit_per_min > 600 (Zod hard cap)", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    expectValidationFailure(() => {
      store.setExchangeConfig({ rate_limit_per_min: 1000 });
    });
  });

  it("setExchangeConfig: rejects ws_reconnect_delay_ms > 10000 (Zod hard cap)", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    expectValidationFailure(() => {
      store.setExchangeConfig({ ws_reconnect_delay_ms: 20_000 });
    });
  });

  it("setExchangeConfig: triggers a .bak write (atomic + .bak pattern)", () => {
    const path = nodePath.join(temporaryDirectory, "bot.toml");
    createSeededStore(path).setExchangeConfig({ slippage_pct: 0.2 });
    expect(fileSystem.existsSync(`${path}.bak`)).toBe(true);
  });

  it("setSymbols: replaces the enabled list and persists", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setSymbols(["BTC/USDT", "ETH/USDT"]);
    expect(store.read().symbols.enabled).toEqual(["BTC/USDT", "ETH/USDT"]);
  });

  it("setSymbols: accepts an empty list", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setSymbols([]);
    expect(store.read().symbols.enabled).toEqual([]);
  });

  it("setSymbols: triggers a .bak write on subsequent update", () => {
    const path = nodePath.join(temporaryDirectory, "bot.toml");
    createSeededStore(path).setSymbols(["SOL/USDC"]);
    expect(fileSystem.existsSync(`${path}.bak`)).toBe(true);
  });

  it("setTelemetryConfig: updates log_level and persists", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setTelemetryConfig({ log_level: "debug" });
    expect(store.read().telemetry.log_level).toBe("debug");
  });

  it("setTelemetryConfig: updates log_destination to 'file'", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setTelemetryConfig({ log_destination: "file" });
    expect(store.read().telemetry.log_destination).toBe("file");
  });

  it("setTelemetryConfig: updates metrics_enabled to false", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setTelemetryConfig({ metrics_enabled: false });
    expect(store.read().telemetry.metrics_enabled).toBe(false);
  });

  it("setTelemetryConfig: updates heartbeat_interval_sec", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setTelemetryConfig({ heartbeat_interval_sec: 60 });
    expect(store.read().telemetry.heartbeat_interval_sec).toBe(60);
  });

  it("setTelemetryConfig: rejects invalid log_level enum", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "bot.toml"));
    expectValidationFailure(() => store.validate({ telemetry: { log_level: "trace" } }));
  });

  it("setTelemetryConfig: rejects invalid log_destination enum", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "bot.toml"));
    expectValidationFailure(() => store.validate({ telemetry: { log_destination: "stdout" } }));
  });

  it("setTelemetryConfig: rejects heartbeat_interval_sec > 300 (Zod hard cap)", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    expectValidationFailure(() => {
      store.setTelemetryConfig({ heartbeat_interval_sec: 500 });
    });
  });

  it("setTelemetryConfig: partial update preserves other fields (merge)", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setTelemetryConfig({ log_level: "warn" });
    expect(store.read().telemetry).toMatchObject({
      log_dir: "logs/bot",
      metrics_interval_sec: 60,
      log_destination: "both",
      metrics_enabled: true,
      heartbeat_interval_sec: 30,
    });
  });

  it("all 5 setters: .tmp file is cleaned up (no leftover)", () => {
    const path = nodePath.join(temporaryDirectory, "bot.toml");
    const store = createSeededStore(path);
    store.setStrategyEnabled("regime_detector", true);
    store.setStrategySetting("donchian_pivot_composition", "cap", 0.5);
    store.setExchangeConfig({ slippage_pct: 0.2 });
    store.setSymbols(["XRP/USDC"]);
    store.setTelemetryConfig({ heartbeat_interval_sec: 15 });
    expect(fileSystem.existsSync(path)).toBe(true);
    expect(fileSystem.existsSync(`${path}.bak`)).toBe(true);
  });

  it("all 5 setters: round-trip preserves the config (smol-toml no data loss)", () => {
    const store = createSeededStore(nodePath.join(temporaryDirectory, "bot.toml"));
    store.setStrategyEnabled("regime_detector", true);
    store.setStrategySetting("donchian_pivot_composition", "cap", 0.5);
    store.setExchangeConfig({ slippage_pct: 0.2, fee_tier: "vip" });
    store.setSymbols(["BTC/USDC", "ETH/USDC", "SOL/USDC", "XRP/USDC"]);
    store.setTelemetryConfig({ heartbeat_interval_sec: 15, log_level: "debug" });
    expect(store.read()).toMatchObject({
      strategies: { regime_detector: { enabled: true }, donchian_pivot_composition: { cap: 0.5 } },
      exchange: { slippage_pct: 0.2, fee_tier: "vip" },
      telemetry: { heartbeat_interval_sec: 15, log_level: "debug" },
    });
  });

  it("setStrategySetting: read on missing file → ConfigReadError", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "missing.toml"));
    expect(() => {
      store.setStrategySetting("donchian_pivot_composition", "cap", 0.5);
    }).toThrow("Failed to read config file");
  });

  it("setStrategyEnabled: read on missing file → ConfigReadError", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "missing.toml"));
    expect(() => {
      store.setStrategyEnabled("regime_detector", true);
    }).toThrow("Failed to read config file");
  });

  it("setExchangeConfig: read on missing file → ConfigReadError", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "missing.toml"));
    expect(() => {
      store.setExchangeConfig({ slippage_pct: 0.2 });
    }).toThrow("Failed to read config file");
  });

  it("setSymbols: read on missing file → ConfigReadError", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "missing.toml"));
    expect(() => {
      store.setSymbols(["BTC/USDC"]);
    }).toThrow("Failed to read config file");
  });

  it("setTelemetryConfig: read on missing file → ConfigReadError", () => {
    const store = new ConfigStore(nodePath.join(temporaryDirectory, "missing.toml"));
    expect(() => {
      store.setTelemetryConfig({ log_level: "debug" });
    }).toThrow("Failed to read config file");
  });

  it("preserves dependency failure causes at the public ConfigStore boundary", () => {
    const readFailure = new Error("read dependency failure");
    const readStore = new ConfigStore(nodePath.join(temporaryDirectory, "read.toml"), {
      readText: () => {
        throw readFailure;
      },
    });
    expect(() => readStore.read()).toThrow("read dependency failure");
    let readError: unknown;
    try {
      readStore.read();
    } catch (error: unknown) {
      readError = error;
    }
    expect(readError).toBeInstanceOf(ConfigReadError);
    if (!(readError instanceof ConfigReadError)) throw new Error("Expected ConfigReadError");
    expect(readError.originalCause).toBe(readFailure);
    expect(readError.cause).toBe(readFailure);

    const parseFailure = new Error("round-trip dependency failure");
    const parseStore = new ConfigStore(nodePath.join(temporaryDirectory, "parse.toml"), {
      parse: () => {
        throw parseFailure;
      },
    });
    expect(() => {
      parseStore.write(createTestBotConfig());
    }).toThrow("round-trip dependency failure");

    const writeFailure = new Error("atomic dependency failure");
    const writeStore = new ConfigStore(nodePath.join(temporaryDirectory, "write.toml"), {
      atomicWrite: () => {
        throw writeFailure;
      },
    });
    expect(() => {
      writeStore.write(createTestBotConfig());
    }).toThrow("atomic dependency failure");

    const auditFailure = new Error("audit dependency failure");
    const auditStore = new ConfigStore(nodePath.join(temporaryDirectory, "audit.toml"), {
      appendText: () => {
        throw auditFailure;
      },
    });
    auditStore.write(createTestBotConfig());
    expect(() =>
      auditStore.writeAfterTypedLive(createTestBotConfig({ bot: { mode: "live" } }), "LIVE"),
    ).toThrow("audit dependency failure");
  });

  it("setStrategyEnabled: works with copyFileSync path resolution (path is relative)", () => {
    const path = nodePath.join(temporaryDirectory, "bot.toml");
    createSeededStore(path).setStrategyEnabled("regime_detector", true);
    expect(fileSystem.existsSync(`${path}.bak`)).toBe(true);
    expect(fileSystem.readFileSync(`${path}.bak`, "utf8")).toContain("regime_detector");
  });
});

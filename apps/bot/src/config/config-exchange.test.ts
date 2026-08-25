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

describe("exchange and compliance configuration", () => {
  it("leaves exchange.endpoint undefined by default", () => {
    expect(loadBotConfig().exchange.endpoint).toBeUndefined();
  });

  it("accepts a valid HTTPS exchange endpoint", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const configPath = join(directory, "endpoint.toml");
    writeFileSync(configPath, '[exchange]\nendpoint = "https://api.bybit.jp"\n', "utf8");
    try {
      expect(loadBotConfig(configPath).exchange.endpoint).toBe("https://api.bybit.jp");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports exchange.endpoint for an invalid endpoint", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const configPath = join(directory, "invalid-endpoint.toml");
    writeFileSync(configPath, '[exchange]\nendpoint = "not-a-url"\n', "utf8");
    try {
      expect(expectConfigError(() => loadBotConfig(configPath)).path).toBe("exchange.endpoint");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses the default exchange timeout", () => {
    expect(loadBotConfig().exchange.timeout_ms).toBe(10_000);
  });

  it("accepts an exchange timeout override", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const configPath = join(directory, "timeout.toml");
    writeFileSync(configPath, "[exchange]\ntimeout_ms = 5000\n", "utf8");
    try {
      expect(loadBotConfig(configPath).exchange.timeout_ms).toBe(5000);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports exchange.timeout_ms below its minimum", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const configPath = join(directory, "small-timeout.toml");
    writeFileSync(configPath, "[exchange]\ntimeout_ms = 50\n", "utf8");
    try {
      expect(expectConfigError(() => loadBotConfig(configPath)).path).toBe("exchange.timeout_ms");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts a WebSocket exchange endpoint", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const configPath = join(directory, "websocket.toml");
    writeFileSync(configPath, '[exchange]\nws_endpoint = "wss://stream.bybit.jp"\n', "utf8");
    try {
      expect(loadBotConfig(configPath).exchange.ws_endpoint).toBe("wss://stream.bybit.jp");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses EU compliance defaults", () => {
    const compliance = loadBotConfig().compliance;
    expect(compliance.jurisdiction).toBe("EU");
    expect(compliance.jp_msb_registered).toBe(false);
  });

  it("accepts the JP compliance jurisdiction", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const configPath = join(directory, "jurisdiction.toml");
    writeFileSync(configPath, '[compliance]\njurisdiction = "JP"\n', "utf8");
    try {
      expect(loadBotConfig(configPath).compliance.jurisdiction).toBe("JP");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports an unsupported compliance jurisdiction", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const configPath = join(directory, "invalid-jurisdiction.toml");
    writeFileSync(configPath, '[compliance]\njurisdiction = "US"\n', "utf8");
    try {
      expect(expectConfigError(() => loadBotConfig(configPath)).path).toBe("compliance.jurisdiction");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts the JP registration flag", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const configPath = join(directory, "registration.toml");
    writeFileSync(configPath, "[compliance]\njp_msb_registered = true\n", "utf8");
    try {
      expect(loadBotConfig(configPath).compliance.jp_msb_registered).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("loads a complete explicit live TOML configuration", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const configPath = join(directory, "live.toml");
    writeFileSync(
      configPath,
      [
        "[bot]",
        'mode = "live"',
        "",
        "[exchange]",
        'id = "bybiteu"',
        'endpoint = "https://api.bybit.jp"',
        'ws_endpoint = "wss://stream.bybit.jp"',
        "timeout_ms = 5000",
        "rate_limit_ms = 80",
        "slippage_pct = 0.03",
        'fee_tier = "vip"',
        "",
        "[compliance]",
        'jurisdiction = "JP"',
        "jp_msb_registered = false",
        "",
      ].join("\n"),
      "utf8",
    );
    try {
      const config = loadBotConfig(configPath);
      expect(config.bot.mode).toBe("live");
      expect(config.exchange.endpoint).toBe("https://api.bybit.jp");
      expect(config.exchange.ws_endpoint).toBe("wss://stream.bybit.jp");
      expect(config.exchange.timeout_ms).toBe(5000);
      expect(config.exchange.slippage_pct).toBe(0.03);
      expect(config.compliance.jurisdiction).toBe("JP");
      expect(config.compliance.jp_msb_registered).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

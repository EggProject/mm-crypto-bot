/**
 * Exchange configuration boundary tests.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ConfigError, loadBotConfig } from "./loader.js";
import { requireConfigError } from "./config-test-fixtures.test-support.js";
import { BotConfigSchema } from "./schema.js";

async function writeTemporaryFixture(filePath: string, contents: string): Promise<void> {
  await Bun.write(filePath, contents);
}

describe("loadBotConfig", () => {
  it("returns schema defaults when no path is provided", () => {
    const config = loadBotConfig();
    expect(config.bot.mode).toBe("paper");
    expect(config.bot.log_level).toBe("info");
    expect(config.bot.state_file).toBe("data/bot-state.json");
    expect(config.exchange.id).toBe("bybiteu");
    expect(config.exchange.rate_limit_ms).toBe(100);
    expect(config.risk.risk_per_trade).toBe(0.01);
    expect(config.risk.kelly_fraction).toBe(0.25);
    expect(config.risk.max_drawdown_pct).toBe(0.15);
    expect(config.risk.max_positions).toBe(3);
    expect(config.risk.max_leverage).toBe(10);
    expect(config.symbols.enabled).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
    expect(config.telemetry.log_dir).toBe("logs/bot");
    expect(config.telemetry.metrics_interval_sec).toBe(60);
  });

  it("parses the minimal paper configuration with Bybit EU", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-"));
    const filePath = path.join(directory, "paper-minimal.toml");
    await writeTemporaryFixture(filePath, '[bot]\nmode = "paper"\n');
    try {
      const config = loadBotConfig(filePath);
      expect(config.bot.mode).toBe("paper");
      expect(config.exchange.id).toBe("bybiteu");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains every omitted nested risk default while applying a partial risk table", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-"));
    const filePath = path.join(directory, "partial-risk.toml");
    await writeTemporaryFixture(
      filePath,
      ["[risk]", "risk_per_trade = 0.02", "", "[risk.trailing_stop]", "enabled = true"].join("\n"),
    );
    try {
      const config = loadBotConfig(filePath);
      expect(config.risk.risk_per_trade).toBe(0.02);
      expect(config.risk.max_leverage).toBe(10);
      expect(config.risk.trailing_stop).toEqual({
        enabled: true,
        atr_period: 14,
        atr_multiplier: 3,
        side: "both",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a non-table risk value instead of replacing it with defaults", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-"));
    const filePath = path.join(directory, "non-table-risk.toml");
    await writeTemporaryFixture(filePath, "risk = 1\n");
    try {
      expect(() => loadBotConfig(filePath)).toThrow(ConfigError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects sandbox and endpoint overrides individually and together", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-"));
    const cases: readonly (readonly [string, string])[] = [
      ["sandbox", "sandbox = false"],
      ["endpoint", 'endpoint = "https://api.bybit.eu"'],
      ["ws_endpoint", 'ws_endpoint = "wss://stream.bybit.eu/v5/private"'],
      [
        "combined connection overrides",
        [
          "sandbox = false",
          'endpoint = "https://api.bybit.eu"',
          'ws_endpoint = "wss://stream.bybit.eu/v5/private"',
        ].join("\n"),
      ],
    ];
    try {
      for (const [name, fields] of cases) {
        const filePath = path.join(directory, `${name.replaceAll(" ", "-")}.toml`);
        await writeTemporaryFixture(filePath, `[exchange]\n${fields}\n`);
        expect(() => loadBotConfig(filePath)).toThrow(ConfigError);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects every other unknown exchange key", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-"));
    const filePath = path.join(directory, "unknown-exchange-key.toml");
    await writeTemporaryFixture(filePath, "[exchange]\nunexpected = true\n");
    try {
      expect(() => loadBotConfig(filePath)).toThrow(ConfigError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects unknown keys at every closed configuration boundary", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-"));
    const cases: readonly (readonly [string, string])[] = [
      ["root", "unexpected = true"],
      ["bot", "[bot]\nunexpected = true"],
      ["risk", "[risk]\nunexpected = true"],
      ["trailing-stop risk", "[risk.trailing_stop]\nunexpected = true"],
      ["kelly risk", "[risk.kelly]\nunexpected = true"],
      ["drawdown-scaler risk", "[risk.drawdown_scaler]\nunexpected = true"],
      ["strategy name", "[strategies.unknown_strategy]\nenabled = true"],
      ["strategy field", "[strategies.dydx_cex_carry]\nunexpected = true"],
      [
        "strategy timeframes",
        [
          "[strategies.dydx_cex_carry.timeframes]",
          'htf = "4h"',
          'mtf = "1h"',
          'ltf = "15m"',
          "unexpected = true",
        ].join("\n"),
      ],
      ["telemetry", "[telemetry]\nunexpected = true"],
      ["portfolio", "[portfolio]\nunexpected = true"],
      ["compliance", "[compliance]\nunexpected = true"],
      ["symbols", "[symbols]\nunexpected = true"],
    ];
    try {
      for (const [name, contents] of cases) {
        const filePath = path.join(directory, `${name.replaceAll(" ", "-")}.toml`);
        await writeTemporaryFixture(filePath, `${contents}\n`);
        expect(() => loadBotConfig(filePath)).toThrow(ConfigError);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an array that replaces the closed symbols section", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-"));
    const filePath = path.join(directory, "symbols-array.toml");
    await writeTemporaryFixture(filePath, "symbols = []\n");
    try {
      expect(() => loadBotConfig(filePath)).toThrow(ConfigError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid dydx carry cap and the removed leverage selector at schema and TOML boundaries", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-"));
    const invalidSchemaConfigs = [
      { strategies: { dydx_cex_carry: { enabled: true, cap: 0.6 } } },
      { strategies: { dydx_cex_carry: { enabled: true, leverage: 10 } } },
    ];
    const tomlCases: readonly (readonly [string, string])[] = [
      ["cap above the carry limit", "cap = 0.6"],
      ["removed leverage selector", "leverage = 10"],
    ];
    try {
      for (const raw of invalidSchemaConfigs) {
        expect(BotConfigSchema.safeParse(raw).success).toBe(false);
      }

      for (const [name, field] of tomlCases) {
        const filePath = path.join(directory, `${name.replaceAll(" ", "-")}.toml`);
        await writeTemporaryFixture(filePath, `[strategies.dydx_cex_carry]\nenabled = true\n${field}\n`);
        expect(() => loadBotConfig(filePath)).toThrow(ConfigError);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects every per-strategy leverage selector in the closed schema", () => {
    const strategyNames = [
      "donchian_pivot_composition",
      "dydx_cex_carry",
      "cascade_fade",
      "funding_flip_kill_switch",
      "regime_detector",
    ] as const;

    for (const strategyName of strategyNames) {
      expect(
        BotConfigSchema.safeParse({ strategies: { [strategyName]: { enabled: true, leverage: 2 } } }).success,
      ).toBe(false);
    }
  });

  it("uses a 10000 ms exchange timeout by default", () => {
    const config = loadBotConfig();
    expect(config.exchange.timeout_ms).toBe(10_000);
  });

  it("accepts an explicit exchange timeout", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-"));
    const filePath = path.join(directory, "explicit-timeout.toml");
    await writeTemporaryFixture(filePath, "[exchange]\ntimeout_ms = 5000\n");
    try {
      const config = loadBotConfig(filePath);
      expect(config.exchange.timeout_ms).toBe(5000);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an exchange timeout below the minimum", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-"));
    const filePath = path.join(directory, "tiny-timeout.toml");
    await writeTemporaryFixture(filePath, "[exchange]\ntimeout_ms = 50\n");
    try {
      let caught: unknown;
      try {
        loadBotConfig(filePath);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      const error = requireConfigError(caught);
      expect(error.path).toBe("exchange.timeout_ms");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("parses a complete live configuration without connection overrides", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-"));
    const filePath = path.join(directory, "live-eu.toml");
    await writeTemporaryFixture(
      filePath,
      [
        "[bot]",
        'mode = "live"',
        "",
        "[exchange]",
        'id = "bybiteu"',
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
    );
    try {
      const config = loadBotConfig(filePath);
      expect(config.bot.mode).toBe("live");
      expect(config.exchange.timeout_ms).toBe(5000);
      expect(config.exchange.slippage_pct).toBe(0.03);
      expect(config.compliance.jurisdiction).toBe("JP");
      expect(config.compliance.jp_msb_registered).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

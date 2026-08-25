import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_BOT_CONFIG } from "./defaults.js";
import { ConfigError, loadBotConfig } from "./loader.js";
import { BotConfigSchema } from "./schema.js";

function withConfigFile(content: string, action: (configPath: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
  const configPath = join(directory, "config.toml");
  writeFileSync(configPath, content, "utf8");
  try {
    action(configPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function expectConfigError(action: () => unknown): ConfigError {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("Expected loadBotConfig to throw ConfigError");
}

describe("loadBotConfig", () => {
  it("returns schema defaults without a config file", () => {
    const config = loadBotConfig(undefined, {});
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

  it("merges a valid TOML file over the defaults", () => {
    withConfigFile(
      [
        "[bot]",
        'mode = "live"',
        'log_level = "debug"',
        'state_file = "data/prod-state.json"',
        "",
        "[risk]",
        "risk_per_trade = 0.02",
        "max_leverage = 5",
      ].join("\n"),
      (configPath) => {
        const config = loadBotConfig(configPath, {});
        expect(config.bot.mode).toBe("live");
        expect(config.bot.log_level).toBe("debug");
        expect(config.bot.state_file).toBe("data/prod-state.json");
        expect(config.risk.risk_per_trade).toBe(0.02);
        expect(config.risk.max_leverage).toBe(5);
        expect(config.risk.kelly_fraction).toBe(0.25);
        expect(config.risk.max_drawdown_pct).toBe(0.15);
        expect(config.symbols.enabled).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
      },
    );
  });

  it("reports malformed TOML at the parse boundary", () => {
    withConfigFile("this is = not valid TOML [[[", (configPath) => {
      expect(expectConfigError(() => loadBotConfig(configPath, {})).path).toBe("<toml-parse>");
    });
  });

  it("reports a scalar TOML document at the parse boundary", () => {
    withConfigFile("42", (configPath) => {
      expect(expectConfigError(() => loadBotConfig(configPath, {})).path).toBe("<toml-parse>");
    });
  });

  it("reports an array TOML document at the parse boundary", () => {
    withConfigFile("[]", (configPath) => {
      expect(expectConfigError(() => loadBotConfig(configPath, {})).path).toBe("<toml-parse>");
    });
  });

  it("reports validation errors with their field path", () => {
    withConfigFile("[risk]\nmax_leverage = 15\n", (configPath) => {
      const error = expectConfigError(() => loadBotConfig(configPath, {}));
      expect(error.path).toBe("risk.max_leverage");
      expect(error.message).toContain("risk.max_leverage");
      expect(error.message).toContain("10");
    });
  });

  it("rejects leverage above ten", () => {
    withConfigFile("[risk]\nmax_leverage = 15\n", (configPath) => {
      expect(() => loadBotConfig(configPath, {})).toThrow(/max_leverage/);
    });
  });

  it("rejects drawdown above its limit", () => {
    withConfigFile("[risk]\nmax_drawdown_pct = 0.6\n", (configPath) => {
      expect(() => loadBotConfig(configPath, {})).toThrow(/max_drawdown_pct/);
    });
  });

  it("rejects an invalid bot mode", () => {
    withConfigFile('[bot]\nmode = "invalid"\n', (configPath) => {
      expect(() => loadBotConfig(configPath, {})).toThrow(/bot\.mode/);
    });
  });

  it("preserves disabled strategies and defaults", () => {
    withConfigFile("[strategies.donchian_pivot_composition]\nenabled = false\n", (configPath) => {
      const strategies = loadBotConfig(configPath, {}).strategies;
      expect(strategies.donchian_pivot_composition.enabled).toBe(false);
      expect(strategies.dydx_cex_carry.enabled).toBe(false);
    });
  });

  it("preserves future strategy fields alongside validated fields", () => {
    withConfigFile(
      [
        "[strategies.donchian_pivot_composition]",
        "enabled = true",
        "min_consensus = 1",
        'custom_field_v2 = "future use case"',
      ].join("\n"),
      (configPath) => {
        const strategy = loadBotConfig(configPath, {}).strategies.donchian_pivot_composition;
        expect(strategy.enabled).toBe(true);
        expect(strategy.min_consensus).toBe(1);
        expect(strategy["custom_field_v2"]).toBe("future use case");
      },
    );
  });

  it("accepts only one or two as schema min_consensus", () => {
    for (const minConsensus of [1, 2]) {
      expect(
        BotConfigSchema.safeParse({
          strategies: { donchian_pivot_composition: { enabled: true, min_consensus: minConsensus } },
        }).success,
      ).toBe(true);
    }
    for (const minConsensus of [0, 3, 1.5]) {
      const parsed = BotConfigSchema.safeParse({
        strategies: { donchian_pivot_composition: { enabled: true, min_consensus: minConsensus } },
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.path.join(".")).toBe(
          "strategies.donchian_pivot_composition.min_consensus",
        );
      }
    }
  });

  it("accepts only one or two as TOML min_consensus", () => {
    withConfigFile(
      "[strategies.donchian_pivot_composition]\nenabled = true\nmin_consensus = 1\n",
      (configPath) => {
        expect(loadBotConfig(configPath, {}).strategies.donchian_pivot_composition.min_consensus).toBe(1);
      },
    );
    withConfigFile(
      "[strategies.donchian_pivot_composition]\nenabled = true\nmin_consensus = 3\n",
      (configPath) => {
        expect(() => loadBotConfig(configPath, {})).toThrow(
          /strategies\.donchian_pivot_composition\.min_consensus/,
        );
      },
    );
  });

  it("deep-merges strategy fields over their defaults", () => {
    withConfigFile("[strategies.dydx_cex_carry]\nnotional_per_leg_usd = 250000\n", (configPath) => {
      const strategy = loadBotConfig(configPath, {}).strategies.dydx_cex_carry;
      expect(strategy["notional_per_leg_usd"]).toBe(250_000);
      expect(strategy.cap).toBe(0.025);
      expect(strategy.enabled).toBe(false);
    });
  });

  it("keeps default configuration reproducible", () => {
    const config = loadBotConfig(undefined, {});
    expect(DEFAULT_BOT_CONFIG.bot.mode).toBe(config.bot.mode);
    expect(DEFAULT_BOT_CONFIG.risk.max_leverage).toBe(config.risk.max_leverage);
    expect(DEFAULT_BOT_CONFIG.risk.max_drawdown_pct).toBe(config.risk.max_drawdown_pct);
    expect(DEFAULT_BOT_CONFIG.symbols.enabled).toEqual(config.symbols.enabled);
    expect(JSON.stringify(DEFAULT_BOT_CONFIG)).toBe(JSON.stringify(config));
  });

  it("reports missing config files", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    try {
      expect(() => loadBotConfig(join(directory, "missing.toml"), {})).toThrow(ConfigError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

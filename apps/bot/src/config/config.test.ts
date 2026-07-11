/**
 * apps/bot/src/config/config.test.ts
 *
 * A `loadBotConfig` + `BotConfigSchema` Zod-validáció unit tesztjei.
 *
 * Coverage (≥ 8 assertions, all on `bun:test`):
 *   1. `loadBotConfig()` no path → returns schema defaults
 *   2. `loadBotConfig(path)` valid TOML → parses + merges
 *   3. `loadBotConfig(path)` invalid TOML → throws ConfigError
 *   4. `loadBotConfig(path)` valid file with bad field → throws ConfigError
 *      with the field path in the message
 *   5. `risk.max_leverage = 15` REJECTED (1:10 mandate)
 *   6. `risk.max_drawdown_pct = 0.6` REJECTED (max 0.5)
 *   7. `bot.mode = "invalid"` REJECTED (enum)
 *   8. Env override: `BUN_ENV=live` flips `bot.mode` to "live"
 *   9. Env override: `LOG_LEVEL=debug` flips `bot.log_level` to "debug"
 *  10. Per-strategy enabled=false is preserved through load
 *  11. Forward-compat: per-strategy extra fields pass via `.passthrough()`
 *  12. Deep-merge: per-section nested fields override defaults correctly
 *  13. Default config is reproducible (`BotConfigSchema.parse({})` == x2)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_BOT_CONFIG } from "./defaults.js";
import { ConfigError, loadBotConfig } from "./loader.js";

describe("loadBotConfig", () => {
  // --------------------------------------------------------------------------
  // 1) No path → returns Zod defaults
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // 2) Valid TOML → parses + merges with defaults
  // --------------------------------------------------------------------------
  it("parses a valid TOML file and merges over defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const path = join(dir, "valid.toml");
    writeFileSync(
      path,
      `
[bot]
mode = "live"
log_level = "debug"
state_file = "data/prod-state.json"

[risk]
risk_per_trade = 0.02
max_leverage = 5
`,
      "utf8",
    );
    try {
      const config = loadBotConfig(path);
      // Overridden fields
      expect(config.bot.mode).toBe("live");
      expect(config.bot.log_level).toBe("debug");
      expect(config.bot.state_file).toBe("data/prod-state.json");
      expect(config.risk.risk_per_trade).toBe(0.02);
      expect(config.risk.max_leverage).toBe(5);
      // Preserved defaults
      expect(config.risk.kelly_fraction).toBe(0.25);
      expect(config.risk.max_drawdown_pct).toBe(0.15);
      expect(config.symbols.enabled).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 3) Invalid TOML syntax → throws ConfigError
  // --------------------------------------------------------------------------
  it("throws ConfigError for malformed TOML", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const path = join(dir, "broken.toml");
    writeFileSync(path, "this is = not valid TOML [[[", "utf8");
    try {
      expect(() => loadBotConfig(path)).toThrow(ConfigError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 4) Schema-rejected field → throws ConfigError with field path
  // --------------------------------------------------------------------------
  it("throws ConfigError with field path when a field fails validation", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const path = join(dir, "bad-field.toml");
    writeFileSync(
      path,
      `
[risk]
max_leverage = 15
`,
      "utf8",
    );
    try {
      let caught: unknown;
      try {
        loadBotConfig(path);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      const err = caught as ConfigError;
      expect(err.path).toBe("risk.max_leverage");
      expect(err.message).toContain("risk.max_leverage");
      expect(err.message).toContain("10");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 5) 1:10 leverage mandate — `risk.max_leverage = 15` rejected
  // --------------------------------------------------------------------------
  it("REJECTS risk.max_leverage = 15 (1:10 mandate)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const path = join(dir, "leverage-violation.toml");
    writeFileSync(path, "[risk]\nmax_leverage = 15\n", "utf8");
    try {
      expect(() => loadBotConfig(path)).toThrow(/max_leverage/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 6) `risk.max_drawdown_pct = 0.6` rejected (max 0.5)
  // --------------------------------------------------------------------------
  it("REJECTS risk.max_drawdown_pct = 0.6 (max 0.5)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const path = join(dir, "dd-violation.toml");
    writeFileSync(path, "[risk]\nmax_drawdown_pct = 0.6\n", "utf8");
    try {
      expect(() => loadBotConfig(path)).toThrow(/max_drawdown_pct/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 7) `bot.mode = "invalid"` rejected (enum)
  // --------------------------------------------------------------------------
  it("REJECTS bot.mode = 'invalid' (enum)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const path = join(dir, "mode-violation.toml");
    writeFileSync(path, "[bot]\nmode = \"invalid\"\n", "utf8");
    try {
      expect(() => loadBotConfig(path)).toThrow(/bot\.mode/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 8) Per-strategy `enabled = false` survives load
  // --------------------------------------------------------------------------
  it("preserves per-strategy enabled = false through load", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const path = join(dir, "strategy-off.toml");
    writeFileSync(
      path,
      `
[strategies.donchian_pivot_composition]
enabled = false
`,
      "utf8",
    );
    try {
      const config = loadBotConfig(path);
      expect(config.strategies.donchian_pivot_composition.enabled).toBe(false);
      // Other defaults preserved
      expect(config.strategies.dydx_cex_carry.enabled).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 9) Forward-compat: per-strategy passthrough fields are preserved
  // --------------------------------------------------------------------------
  it("preserves per-strategy passthrough fields (forward-compat)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const path = join(dir, "passthrough.toml");
    writeFileSync(
      path,
      `
[strategies.donchian_pivot_composition]
enabled = true
min_consensus = 1
custom_field_v2 = "future use case"
`,
      "utf8",
    );
    try {
      const config = loadBotConfig(path);
      const section = config.strategies.donchian_pivot_composition;
      expect(section.enabled).toBe(true);
      // The Zod passthrough preserves `min_consensus` and the custom field
      expect((section as { min_consensus?: number }).min_consensus).toBe(1);
      expect((section as { custom_field_v2?: string }).custom_field_v2).toBe(
        "future use case",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 10) Deep-merge: nested per-strategy fields override defaults
  // --------------------------------------------------------------------------
  it("deep-merges per-strategy fields over defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const path = join(dir, "deep-merge.toml");
    writeFileSync(
      path,
      `
[strategies.dydx_cex_carry]
notional_per_leg_usd = 250000
`,
      "utf8",
    );
    try {
      const config = loadBotConfig(path);
      // Overridden via TOML
      expect(
        (config.strategies.dydx_cex_carry as { notional_per_leg_usd?: number })
          .notional_per_leg_usd,
      ).toBe(250_000);
      // Preserved default
      expect(config.strategies.dydx_cex_carry.cap).toBe(0.025);
      expect(config.strategies.dydx_cex_carry.enabled).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 11) Reproducibility: defaults are deterministic
  // --------------------------------------------------------------------------
  it("default config is reproducible across parse calls", () => {
    const a = DEFAULT_BOT_CONFIG;
    const b = loadBotConfig();
    expect(a.bot.mode).toBe(b.bot.mode);
    expect(a.risk.max_leverage).toBe(b.risk.max_leverage);
    expect(a.risk.max_drawdown_pct).toBe(b.risk.max_drawdown_pct);
    expect(a.symbols.enabled).toEqual(b.symbols.enabled);
    // Don't deep-equal references (clone comparison), but value-equal:
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // --------------------------------------------------------------------------
  // 12) File not found → ConfigError
  // --------------------------------------------------------------------------
  it("throws ConfigError when the file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const missing = join(dir, "does-not-exist.toml");
    try {
      expect(() => loadBotConfig(missing)).toThrow(ConfigError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("env overrides", () => {
  // Save the current env so we can restore after each test.  We track
  // a fixed list of override keys (the env-var keys our loader reads)
  // explicitly — keeping the `delete` calls literal-string-keyed to
  // satisfy `@typescript-eslint/no-dynamic-delete`.
  const ORIGINAL_BUN_ENV = process.env["BUN_ENV"];
  const ORIGINAL_LOG_LEVEL = process.env["LOG_LEVEL"];
  beforeEach(() => {
    // Strip known override keys to start clean.
    delete process.env["BUN_ENV"];
    delete process.env["LOG_LEVEL"];
  });
  afterEach(() => {
    // Restore original.  Use literal keys (not dynamic) to satisfy
    // `@typescript-eslint/no-dynamic-delete`.
    if (ORIGINAL_BUN_ENV === undefined) {
      delete process.env["BUN_ENV"];
    } else {
      process.env["BUN_ENV"] = ORIGINAL_BUN_ENV;
    }
    if (ORIGINAL_LOG_LEVEL === undefined) {
      delete process.env["LOG_LEVEL"];
    } else {
      process.env["LOG_LEVEL"] = ORIGINAL_LOG_LEVEL;
    }
  });

  it("BUN_ENV=live overrides bot.mode", () => {
    process.env["BUN_ENV"] = "live";
    const config = loadBotConfig();
    expect(config.bot.mode).toBe("live");
  });

  it("BUN_ENV=paper overrides bot.mode", () => {
    process.env["BUN_ENV"] = "paper";
    const config = loadBotConfig();
    expect(config.bot.mode).toBe("paper");
  });

  it("LOG_LEVEL=debug overrides bot.log_level", () => {
    process.env["LOG_LEVEL"] = "debug";
    const config = loadBotConfig();
    expect(config.bot.log_level).toBe("debug");
  });

  it("LOG_LEVEL=invalid is ignored (default 'info' retained)", () => {
    process.env["LOG_LEVEL"] = "invalid";
    const config = loadBotConfig();
    expect(config.bot.log_level).toBe("info");
  });

  it("BUN_ENV=invalid is ignored (default 'paper' retained)", () => {
    process.env["BUN_ENV"] = "test";
    const config = loadBotConfig();
    expect(config.bot.mode).toBe("paper");
  });

  it("env override applies AFTER TOML file content (later wins)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-config-"));
    const path = join(dir, "env-wins.toml");
    writeFileSync(path, "[bot]\nmode = \"paper\"\n", "utf8");
    process.env["BUN_ENV"] = "live";
    try {
      const config = loadBotConfig(path);
      expect(config.bot.mode).toBe("live");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

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
 *   8. Env override: `BUN_ENV=live` is rejected while live activation is closed
 *   9. Env override: `LOG_LEVEL=debug` flips `bot.log_level` to "debug"
 *  10. Per-strategy enabled=false is preserved through load
 *  11. Unknown per-strategy fields are rejected
 *  12. Deep-merge: per-section nested fields override defaults correctly
 *  13. Default config is reproducible (`BotConfigSchema.parse({})` == x2)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { DEFAULT_BOT_CONFIG } from "./defaults.js";
import { requireConfigError } from "./config-test-fixtures.test-support.js";
import { ConfigError, loadBotConfig } from "./loader.js";
import { BotConfigSchema } from "./schema.js";

async function writeTemporaryFixture(filePath: string, contents: string): Promise<void> {
  await Bun.write(filePath, contents);
}

describe("loadBotConfig", () => {
  // --------------------------------------------------------------------------
  // 2) Valid TOML → parses + merges with defaults
  // --------------------------------------------------------------------------
  it("parses a valid TOML file and merges over defaults", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "valid.toml");
    await writeTemporaryFixture(
      path,
      `
[bot]
mode = "live"
log_level = "debug"
state_file = "data/prod-state.json"

[risk]
risk_per_trade = 0.02
max_leverage = 10
`,
    );
    try {
      const config = loadBotConfig(path);
      // Overridden fields
      expect(config.bot.mode).toBe("live");
      expect(config.bot.log_level).toBe("debug");
      expect(config.bot.state_file).toBe("data/prod-state.json");
      expect(config.risk.risk_per_trade).toBe(0.02);
      expect(config.risk.max_leverage).toBe(10);
      // Preserved defaults
      expect(config.risk.kelly_fraction).toBe(0.25);
      expect(config.risk.max_drawdown_pct).toBe(0.15);
      expect(config.symbols.enabled).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 3) Invalid TOML syntax → throws ConfigError
  // --------------------------------------------------------------------------
  it("throws ConfigError for malformed TOML", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "broken.toml");
    await writeTemporaryFixture(path, "this is = not valid TOML [[[");
    try {
      expect(() => loadBotConfig(path)).toThrow(ConfigError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 4) Schema-rejected field → throws ConfigError with field path
  // --------------------------------------------------------------------------
  it("throws ConfigError with field path when a field fails validation", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "bad-field.toml");
    await writeTemporaryFixture(
      path,
      `
[risk]
max_leverage = 15
`,
    );
    try {
      let caught: unknown;
      try {
        loadBotConfig(path);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      const error = requireConfigError(caught);
      expect(error.path).toBe("risk.max_leverage");
      expect(error.message).toContain("risk.max_leverage");
      expect(error.message).toContain("10");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("formats a root-level validation error with a root path", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "unexpected-root.toml");
    await writeTemporaryFixture(path, "unexpected = true\n");
    try {
      expect(() => loadBotConfig(path)).toThrow("<root>");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 5) 1:10 leverage mandate — `risk.max_leverage = 15` rejected
  // --------------------------------------------------------------------------
  it("REJECTS risk.max_leverage = 15 (1:10 mandate)", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "leverage-violation.toml");
    await writeTemporaryFixture(path, "[risk]\nmax_leverage = 15\n");
    try {
      expect(() => loadBotConfig(path)).toThrow(/max_leverage/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 6) `risk.max_drawdown_pct = 0.6` rejected (max 0.5)
  // --------------------------------------------------------------------------
  it("REJECTS risk.max_drawdown_pct = 0.6 (max 0.5)", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "dd-violation.toml");
    await writeTemporaryFixture(path, "[risk]\nmax_drawdown_pct = 0.6\n");
    try {
      expect(() => loadBotConfig(path)).toThrow(/max_drawdown_pct/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 7) `bot.mode = "invalid"` rejected (enum)
  // --------------------------------------------------------------------------
  it("REJECTS bot.mode = 'invalid' (enum)", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "mode-violation.toml");
    await writeTemporaryFixture(path, '[bot]\nmode = "invalid"\n');
    try {
      expect(() => loadBotConfig(path)).toThrow(/bot\.mode/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 8) Per-strategy `enabled = false` survives load
  // --------------------------------------------------------------------------
  it("preserves per-strategy enabled = false through load", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "strategy-off.toml");
    await writeTemporaryFixture(
      path,
      `
[strategies.donchian_pivot_composition]
enabled = false
`,
    );
    try {
      const config = loadBotConfig(path);
      expect(config.strategies.donchian_pivot_composition.enabled).toBe(false);
      // Other defaults preserved
      expect(config.strategies.dydx_cex_carry.enabled).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 9) Unknown per-strategy fields are rejected
  // --------------------------------------------------------------------------
  it("rejects unknown per-strategy fields", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "passthrough.toml");
    await writeTemporaryFixture(
      path,
      `
[strategies.donchian_pivot_composition]
enabled = true
min_consensus = 1
custom_field_v2 = "future use case"
`,
    );
    try {
      expect(() => loadBotConfig(path)).toThrow(/strategies\.donchian_pivot_composition/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("strictly validates donchian_pivot_composition.min_consensus in the schema", () => {
    for (const minConsensus of [1, 2]) {
      const parsed = BotConfigSchema.safeParse({
        strategies: {
          donchian_pivot_composition: { enabled: true, min_consensus: minConsensus },
        },
      });
      expect(parsed.success).toBe(true);
    }

    for (const minConsensus of [0, 3, 1.5]) {
      const parsed = BotConfigSchema.safeParse({
        strategies: {
          donchian_pivot_composition: { enabled: true, min_consensus: minConsensus },
        },
      });
      expect(parsed.success).toBe(false);
      if (parsed.success) continue;
      expect(parsed.error.issues[0]?.path.join(".")).toBe(
        "strategies.donchian_pivot_composition.min_consensus",
      );
    }
  });

  it("accepts only min_consensus 1 or 2 from TOML", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    try {
      for (const minConsensus of [1, 2]) {
        const path = nodePath.join(directory, `valid-consensus-${String(minConsensus)}.toml`);
        await writeTemporaryFixture(
          path,
          `[strategies.donchian_pivot_composition]\nenabled = true\nmin_consensus = ${String(minConsensus)}\n`,
        );
        expect(loadBotConfig(path).strategies.donchian_pivot_composition.min_consensus).toBe(minConsensus);
      }

      for (const minConsensus of [0, 3, 1.5]) {
        const path = nodePath.join(directory, `invalid-consensus-${String(minConsensus)}.toml`);
        await writeTemporaryFixture(
          path,
          `[strategies.donchian_pivot_composition]\nenabled = true\nmin_consensus = ${String(minConsensus)}\n`,
        );
        expect(() => loadBotConfig(path)).toThrow(/strategies\.donchian_pivot_composition\.min_consensus/);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 10) Deep-merge: nested per-strategy fields override defaults
  // --------------------------------------------------------------------------
  it("deep-merges per-strategy fields over defaults", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "deep-merge.toml");
    await writeTemporaryFixture(
      path,
      `
[strategies.dydx_cex_carry]
notional_per_leg_usd = 250000
`,
    );
    try {
      const config = loadBotConfig(path);
      // Overridden via TOML
      expect(config.strategies.dydx_cex_carry.notional_per_leg_usd).toBe(250_000);
      // Preserved default
      expect(config.strategies.dydx_cex_carry.cap).toBe(0.025);
      expect(config.strategies.dydx_cex_carry.enabled).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
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
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const missing = nodePath.join(directory, "does-not-exist.toml");
    try {
      expect(() => loadBotConfig(missing)).toThrow(ConfigError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 18) Phase 37 Track 5 — compliance block defaults (jurisdiction=EU,
  //     jp_msb_registered=false)
  // --------------------------------------------------------------------------
  it("Phase 37 Track 5: compliance defaults to EU + jp_msb_registered=false", () => {
    const config = loadBotConfig();
    expect(config.compliance.jurisdiction).toBe("EU");
    expect(config.compliance.jp_msb_registered).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 19) Phase 37 Track 5 — compliance.jurisdiction accepts "JP"
  // --------------------------------------------------------------------------
  it('Phase 37 Track 5: compliance.jurisdiction accepts "JP"', async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "jp-jur.toml");
    await writeTemporaryFixture(path, '[compliance]\njurisdiction = "JP"\n');
    try {
      const config = loadBotConfig(path);
      expect(config.compliance.jurisdiction).toBe("JP");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 20) Phase 37 Track 5 — compliance.jurisdiction REJECTS unknown values
  // --------------------------------------------------------------------------
  it("Phase 37 Track 5: REJECTS compliance.jurisdiction = 'US' (unknown)", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "bad-jur.toml");
    await writeTemporaryFixture(path, '[compliance]\njurisdiction = "US"\n');
    try {
      let caught: unknown;
      try {
        loadBotConfig(path);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      const error = requireConfigError(caught);
      expect(error.path).toBe("compliance.jurisdiction");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 21) Phase 37 Track 5 — compliance.jp_msb_registered boolean override
  // --------------------------------------------------------------------------
  it("Phase 37 Track 5: compliance.jp_msb_registered accepts true", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "msb-on.toml");
    await writeTemporaryFixture(path, "[compliance]\njp_msb_registered = true\n");
    try {
      const config = loadBotConfig(path);
      expect(config.compliance.jp_msb_registered).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
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

  it("BUN_ENV=live is a stable typed error and never upgrades the default configuration", () => {
    process.env["BUN_ENV"] = "live";
    expect(() => loadBotConfig()).toThrow(ConfigError);
    expect(() => loadBotConfig()).toThrow("BUN_ENV=live cannot activate live mode.");
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

  it("BUN_ENV=live rejects a paper TOML instead of upgrading it", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "mm-bot-config-"));
    const path = nodePath.join(directory, "env-wins.toml");
    await writeTemporaryFixture(path, '[bot]\nmode = "paper"\n');
    process.env["BUN_ENV"] = "live";
    try {
      expect(() => loadBotConfig(path)).toThrow(ConfigError);
      expect(() => loadBotConfig(path)).toThrow("BUN_ENV=live cannot activate live mode.");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

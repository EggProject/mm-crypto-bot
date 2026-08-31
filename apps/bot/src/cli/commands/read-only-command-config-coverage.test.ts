import { describe, expect, it, spyOn } from "bun:test";

import { ConfigError } from "../../config/index.js";
import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";
import { BotConfigSchema, type BotConfig } from "../../config/schema.js";
import { parseArgv } from "../argv.js";
import type { CliContext } from "../router.js";

import { createKillSwitchesCommand } from "./kill-switches.js";
import { createStrategiesCommand } from "./strategies.js";

const CLI_CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };

function resolvedRuntimeRoot() {
  return {
    ok: true as const,
    runtimeRoot: "/var/lib/mm-bot",
    configPath: "/var/lib/mm-bot/config/default.toml",
  };
}

async function capture(
  action: () => Promise<number>,
): Promise<{ readonly code: number; readonly output: string }> {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...values: unknown[]) => {
    lines.push(values.map(String).join(" "));
  });
  const error = spyOn(console, "error").mockImplementation((...values: unknown[]) => {
    lines.push(values.map(String).join(" "));
  });
  try {
    return { code: await action(), output: lines.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

function configuredStrategies(): BotConfig {
  return BotConfigSchema.parse({
    ...DEFAULT_BOT_CONFIG,
    bot: {
      mode: DEFAULT_BOT_CONFIG.bot.mode,
      log_level: DEFAULT_BOT_CONFIG.bot.log_level,
      state_file: DEFAULT_BOT_CONFIG.bot.state_file,
      selected_leverage: DEFAULT_BOT_CONFIG.bot.selected_leverage.canonical,
    },
    strategies: {
      ...DEFAULT_BOT_CONFIG.strategies,
      donchian_pivot_composition: {
        ...DEFAULT_BOT_CONFIG.strategies.donchian_pivot_composition,
        enabled: true,
        cap: 0.1,
        symbols: ["BTC/USDT"],
        timeframes: { htf: "1d", mtf: "4h", ltf: "1h" },
      },
      dydx_cex_carry: { ...DEFAULT_BOT_CONFIG.strategies.dydx_cex_carry, enabled: false },
    },
  });
}

describe("strategies command coverage", () => {
  it("renders the valid configured strategy boundary and enabled states", async () => {
    const result = await capture(async () =>
      createStrategiesCommand({
        loadConfig: configuredStrategies,
        resolveRuntimeRoot: resolvedRuntimeRoot,
      })(parseArgv(["strategies"]), CLI_CONTEXT),
    );
    expect(result.code).toBe(0);
    expect(result.output).toContain("Strategies:");
    expect(result.output).toContain("[ON ");
    expect(result.output).toContain("cap = 0.1");
    expect(result.output).toContain('symbols = ["BTC/USDT"]');
    expect(result.output).toContain('timeframes = { htf = "1d", mtf = "4h", ltf = "1h" }');
    expect(result.output).toContain("dydx_cex_carry");
    expect(result.output.indexOf("cap = 0.1")).toBeLessThan(result.output.indexOf('symbols = ["BTC/USDT"]'));
    expect(result.output.indexOf('symbols = ["BTC/USDT"]')).toBeLessThan(
      result.output.indexOf('timeframes = { htf = "1d", mtf = "4h", ltf = "1h" }'),
    );
  });

  it("returns ConfigError, Error, and hostile load failures distinctly", async () => {
    const failures: readonly unknown[] = [
      new ConfigError("invalid", "bot", []),
      new Error("config Error"),
      "config hostile",
    ];
    for (const failure of failures) {
      const result = await capture(async () =>
        createStrategiesCommand({
          loadConfig: () => {
            throw failure;
          },
          resolveRuntimeRoot: resolvedRuntimeRoot,
        })(parseArgv(["strategies"]), CLI_CONTEXT),
      );
      expect(result.code).toBe(failure instanceof ConfigError ? 2 : 1);
    }
  });
});

describe("kill-switches command coverage", () => {
  it("renders armed and disarmed switches from valid configuration", async () => {
    const result = await capture(async () =>
      createKillSwitchesCommand({
        loadConfig: configuredStrategies,
        resolveRuntimeRoot: resolvedRuntimeRoot,
      })(parseArgv(["kill-switches"]), CLI_CONTEXT),
    );
    expect(result.code).toBe(0);
    expect(result.output).toContain("[ARMED");
    expect(result.output).toContain("[DISARMED]");
    expect(result.output).toContain("Max drawdown");
    expect(result.output).toContain("Per-strategy kill-switches");
  });

  it("returns ConfigError, Error, and hostile load failures distinctly", async () => {
    const failures: readonly unknown[] = [
      new ConfigError("invalid", "bot", []),
      new Error("config Error"),
      "config hostile",
    ];
    for (const failure of failures) {
      const result = await capture(async () =>
        createKillSwitchesCommand({
          loadConfig: () => {
            throw failure;
          },
          resolveRuntimeRoot: resolvedRuntimeRoot,
        })(parseArgv(["kill-switches"]), CLI_CONTEXT),
      );
      expect(result.code).toBe(failure instanceof ConfigError ? 2 : 1);
    }
  });
});

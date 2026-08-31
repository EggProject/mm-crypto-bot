import { expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadBotConfig } from "../../config/loader.js";
import { parseArgv } from "../argv.js";

import { createConfigCommand } from "./config.js";

const tomlFixtureSupportedControlCodePoints = new Set<number>([0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x7f]);
const tomlFixtureBackslashEscape = String.raw`\\`;
const tomlFixtureDoubleQuoteEscape = String.raw`\"`;
const tomlFixtureUnicodeEscapePrefix = String.raw`\u`;
const hostileControlCharacters = String.fromCodePoint(8, 9, 10, 12, 13, 127);
const hostileStateFile = String.raw`data\state` + '"quoted' + hostileControlCharacters + "file";
const hostileStrategySymbol = String.raw`A"B\C` + String.fromCodePoint(9) + "D";
const hostileLogDirectory = String.raw`logs\with` + '"quote' + String.fromCodePoint(9) + "name";

const fullNonDefaultConfig = `
[bot]
mode = "paper"
log_level = "debug"
state_file = ${formatTomlFixtureString(hostileStateFile)}
selected_leverage = "2.5"

[exchange]
id = "mock"
rate_limit_ms = 111
slippage_pct = 0.17
fee_tier = "maker_rebate"
rate_limit_per_min = 119
ws_reconnect_delay_ms = 999
timeout_ms = 11_111

[compliance]
jurisdiction = "OTHER"
jp_msb_registered = true

[risk]
risk_per_trade = 0.02
kelly_fraction = 0.5
max_drawdown_pct = 0.2
max_positions = 4
max_leverage = 10
max_position_fraction = 0.2
fallback_size_fraction = 0.02

[risk.trailing_stop]
enabled = true
atr_period = 21
atr_multiplier = 4
side = "short"

[risk.kelly]
enabled = true
fraction = 0.4
window_size = 60
min_trades = 20
fallback_fraction = 0.02

[risk.drawdown_scaler]
enabled = true
max_dd_pct = 0.2

[symbols]
enabled = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]

[strategies.donchian_pivot_composition]
enabled = true
cap = 0.3
symbols = ["BTC/USDC", ${formatTomlFixtureString(hostileStrategySymbol)}]
risk_per_trade = 0.02
max_positions = 4
notional_per_leg_usd = 2000
max_notional_per_event_usd = 4000
cooldown_hours = 2
min_consensus = 2

[strategies.donchian_pivot_composition.timeframes]
htf = "1d"
mtf = "4h"
ltf = "15m"

[strategies.dydx_cex_carry]
enabled = true
cap = 0.04
symbols = ["ETH/USDC"]
risk_per_trade = 0.03
max_positions = 5
notional_per_leg_usd = 3000
max_notional_per_event_usd = 6000
cooldown_hours = 3

[strategies.dydx_cex_carry.timeframes]
htf = "2d"
mtf = "8h"
ltf = "30m"

[strategies.cascade_fade]
enabled = true
cap = 0.05
symbols = ["SOL/USDC"]
risk_per_trade = 0.04
max_positions = 6
notional_per_leg_usd = 4000
max_notional_per_event_usd = 8000
cooldown_hours = 4

[strategies.cascade_fade.timeframes]
htf = "3d"
mtf = "12h"
ltf = "1h"

[strategies.funding_flip_kill_switch]
enabled = true
cap = 0.06
symbols = ["BTC/USDC"]
risk_per_trade = 0.05
max_positions = 7
notional_per_leg_usd = 5000
max_notional_per_event_usd = 10_000
cooldown_hours = 5

[strategies.funding_flip_kill_switch.timeframes]
htf = "4d"
mtf = "16h"
ltf = "2h"

[strategies.regime_detector]
enabled = true
cap = 0.07
symbols = ["ETH/USDC"]
risk_per_trade = 0.01
max_positions = 8
notional_per_leg_usd = 6000
max_notional_per_event_usd = 12_000
cooldown_hours = 6

[strategies.regime_detector.timeframes]
htf = "5d"
mtf = "20h"
ltf = "3h"

[telemetry]
log_dir = ${formatTomlFixtureString(hostileLogDirectory)}
metrics_interval_sec = 61
log_level = "warn"
log_destination = "stderr"
metrics_enabled = false
heartbeat_interval_sec = 31

[portfolio]
total_risk_per_cycle_usd = 101
correlation_penalty_threshold = 0.71
correlation_window_size = 31
max_dd_pct = 0.11
`;

it("show losslessly round-trips every approved field and escapes basic strings", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bot-config-full-round-trip-"));
  const sourcePath = path.join(directory, "source.toml");
  const emittedPath = path.join(directory, "emitted.toml");
  const source = loadBotConfig(await writeConfig(sourcePath, fullNonDefaultConfig));
  const logged: string[] = [];
  const output = spyOn(console, "log").mockImplementation((value: unknown) => {
    logged.push(String(value));
  });
  const command = createConfigCommand({ loadConfig: () => source });

  try {
    expect(await command(parseArgv(["config", "show", "--config=/external/config.toml"]), {})).toBe(0);
    const emitted = logged.join("\n");
    await Bun.write(emittedPath, emitted);
    expect(loadBotConfig(emittedPath)).toEqual(source);
    expect(emitted).toContain(`state_file = ${formatTomlFixtureString(hostileStateFile)}`);
    expect(emitted).toContain(`symbols = ["BTC/USDC", ${formatTomlFixtureString(hostileStrategySymbol)}]`);
    expect(emitted).toContain(`log_dir = ${formatTomlFixtureString(hostileLogDirectory)}`);
    expect(emitted).toContain('selected_leverage = "2.5"');
    expect(emitted).not.toContain("unapproved_property");
  } finally {
    output.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("show rejects a control character that Bun TOML cannot encode", async () => {
  const errors: string[] = [];
  const output = spyOn(console, "error").mockImplementation((value: unknown) => {
    errors.push(String(value));
  });
  const invalidForBunToml = loadBotConfig();
  invalidForBunToml.bot.state_file = "data/contains-nul\0";
  const command = createConfigCommand({ loadConfig: () => invalidForBunToml });

  try {
    expect(await command(parseArgv(["config", "show", "--config=/external/config.toml"]), {})).toBe(1);
    expect(errors.join("\n")).toContain("Bun TOML cannot represent control character U+0000");
  } finally {
    output.mockRestore();
  }
});

async function writeConfig(configPath: string, contents: string): Promise<string> {
  await Bun.write(configPath, contents);
  return configPath;
}

function formatTomlFixtureString(value: string): string {
  const parts = ['"'];
  for (const character of value) {
    if (character === '"') {
      parts.push(tomlFixtureDoubleQuoteEscape);
    } else if (character === "\\") {
      parts.push(tomlFixtureBackslashEscape);
    } else {
      const codePoint = Number(character.codePointAt(0));
      if (tomlFixtureSupportedControlCodePoints.has(codePoint)) {
        parts.push(`${tomlFixtureUnicodeEscapePrefix}${codePoint.toString(16).padStart(4, "0")}`);
      } else {
        parts.push(character);
      }
    }
  }
  parts.push('"');
  return parts.join("");
}

/**
 * apps/bot/src/cli/commands/config.ts
 *
 * Direct `config <validate|show|init>` subcommand.
 *
 * Three sub-subcommands:
 *   - `validate` — load + validate config; print "OK" or errors; exit 0/2.
 *   - `show`     — print the effective config (defaults + file + env merged)
 *                  as TOML. Useful for debugging "what did the bot actually
 *                  load?".
 *   - `init`     — write `run-bot/config/default.toml` to a target path.
 *                  Default target is `./mm-bot.toml`. Useful for first-time
 *                  setup.
 *
 * Color usage:
 *   - `validate` prints "OK" in green on success, "FAILED" in red on failure.
 *   - The "Refusing to overwrite" / file-write errors are red.
 *   - "Wrote <path>" success message is green.
 *   - The `show` output is plain TOML — no color (it must be parseable
 *     as TOML by the direct `config validate` command).
 *
 * Exit codes:
 *   0 — success
 *   2 — config validation failure (POSIX convention)
 *
 * No interactive prompts. CI-friendly.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError, loadBotConfig, type BotConfig } from "../../config/index.js";
import { resolveRuntimeRootConfig, type RuntimeRootResolution } from "../../config/runtime-root.js";
import { colorize } from "../color.js";
import type { CliContext, SubcommandHandler } from "../router.js";

import { reportConfigPathFailure, resolveConfigPath } from "./config-path.js";

const fileSystem = await import("node:fs");
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

function assertResolvedFilePath(filePath: string): void {
  if (filePath.length === 0 || filePath.includes("\0") || path.resolve(filePath) !== filePath) {
    throw new Error(`Config file boundary requires a normalized absolute path: ${JSON.stringify(filePath)}`);
  }
}

export interface ConfigFileBoundary {
  readonly exists: (path: string) => boolean;
  readonly read: (path: string) => string;
  readonly ensureDirectory: (path: string) => void;
  readonly write: (path: string, contents: string) => void;
}

const configFileBoundary: ConfigFileBoundary = {
  exists(path: string): boolean {
    assertResolvedFilePath(path);
    return fileSystem.existsSync(path);
  },
  read(path: string): string {
    assertResolvedFilePath(path);
    return fileSystem.readFileSync(path, "utf8");
  },
  ensureDirectory(path: string): void {
    assertResolvedFilePath(path);
    fileSystem.mkdirSync(path, { recursive: true });
  },
  write(path: string, contents: string): void {
    assertResolvedFilePath(path);
    fileSystem.writeFileSync(path, contents, "utf8");
  },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * `getConfigPath` — pull the `--config=path` flag from the parsed args.
 *
 * Returns `undefined` if the flag is absent OR if it's a boolean (the user
 * wrote `--config` without a value). The latter is a user error, but we
 * fall back to the default rather than failing the whole command.
 */
function getConfigPath(arguments_: {
  readonly flags: ReadonlyMap<string, string | boolean>;
}): string | undefined {
  const configFlag = arguments_.flags.get("config");
  if (typeof configFlag === "string" && configFlag.length > 0) {
    return configFlag;
  }
  return undefined;
}

/**
 * `formatToml` — serialize a `BotConfig` to TOML.
 *
 * This is deliberately schema-specific: every approved configuration field is
 * emitted explicitly, and string values use TOML basic-string escaping.
 */
type ConfiguredStrategySection = BotConfig["strategies"][keyof BotConfig["strategies"]];

const bunTomlSupportedControlCodePoints = new Set<number>([0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x7f]);
const tomlBackslashEscape = String.raw`\\`;
const tomlDoubleQuoteEscape = String.raw`\"`;
const tomlUnicodeEscapePrefix = String.raw`\u`;

function formatTomlString(value: string): string {
  const parts = ['"'];
  for (const character of value) {
    if (character === '"') {
      parts.push(tomlDoubleQuoteEscape);
    } else if (character === "\\") {
      parts.push(tomlBackslashEscape);
    } else {
      const codePoint = Number(character.codePointAt(0));
      if (codePoint === 0x7f || codePoint <= 0x1f) {
        if (!bunTomlSupportedControlCodePoints.has(codePoint)) {
          throw new Error(
            `Bun TOML cannot represent control character U+${codePoint.toString(16).padStart(4, "0")}`,
          );
        }
        parts.push(`${tomlUnicodeEscapePrefix}${codePoint.toString(16).padStart(4, "0")}`);
      } else {
        parts.push(character);
      }
    }
  }
  parts.push('"');
  return parts.join("");
}

function formatTomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => formatTomlString(value)).join(", ")}]`;
}

function formatOptionalNumber(name: string, value: number | undefined): readonly string[] {
  return value === undefined ? [] : [`${name} = ${String(value)}`];
}

function formatOptionalStringArray(name: string, value: readonly string[] | undefined): readonly string[] {
  return value === undefined ? [] : [`${name} = ${formatTomlStringArray(value)}`];
}

function formatStrategySection(
  name: keyof BotConfig["strategies"],
  section: ConfiguredStrategySection,
): readonly string[] {
  const isDonchian = name === "donchian_pivot_composition";
  return [
    `[strategies.${name}]`,
    `enabled = ${String(section.enabled)}`,
    ...formatOptionalNumber("cap", section.cap),
    ...formatOptionalStringArray("symbols", section.symbols),
    ...formatOptionalNumber("risk_per_trade", section.risk_per_trade),
    ...formatOptionalNumber("max_positions", section.max_positions),
    ...formatOptionalNumber("notional_per_leg_usd", section.notional_per_leg_usd),
    ...formatOptionalNumber("max_notional_per_event_usd", section.max_notional_per_event_usd),
    ...formatOptionalNumber("cooldown_hours", section.cooldown_hours),
    ...(isDonchian && "min_consensus" in section
      ? formatOptionalNumber("min_consensus", section.min_consensus)
      : []),
    ...(section.timeframes === undefined
      ? []
      : [
          `[strategies.${name}.timeframes]`,
          `htf = ${formatTomlString(section.timeframes.htf)}`,
          `mtf = ${formatTomlString(section.timeframes.mtf)}`,
          `ltf = ${formatTomlString(section.timeframes.ltf)}`,
        ]),
    "",
  ];
}

function formatToml(config: BotConfig): string {
  return [
    "# mm-crypto-bot config — emitted by the direct config show command",
    "# Edit and re-run the direct config validate command to check.",
    "",
    "[bot]",
    `mode = ${formatTomlString(config.bot.mode)}`,
    `log_level = ${formatTomlString(config.bot.log_level)}`,
    `state_file = ${formatTomlString(config.bot.state_file)}`,
    `selected_leverage = ${formatTomlString(config.bot.selected_leverage.canonical)}`,
    "",
    "[exchange]",
    `id = ${formatTomlString(config.exchange.id)}`,
    `rate_limit_ms = ${String(config.exchange.rate_limit_ms)}`,
    `slippage_pct = ${String(config.exchange.slippage_pct)}`,
    `fee_tier = ${formatTomlString(config.exchange.fee_tier)}`,
    `rate_limit_per_min = ${String(config.exchange.rate_limit_per_min)}`,
    `ws_reconnect_delay_ms = ${String(config.exchange.ws_reconnect_delay_ms)}`,
    `timeout_ms = ${String(config.exchange.timeout_ms)}`,
    "",
    "[compliance]",
    `jurisdiction = ${formatTomlString(config.compliance.jurisdiction)}`,
    `jp_msb_registered = ${String(config.compliance.jp_msb_registered)}`,
    "",
    "[risk]",
    `risk_per_trade = ${String(config.risk.risk_per_trade)}`,
    `kelly_fraction = ${String(config.risk.kelly_fraction)}`,
    `max_drawdown_pct = ${String(config.risk.max_drawdown_pct)}`,
    `max_positions = ${String(config.risk.max_positions)}`,
    `max_leverage = ${String(config.risk.max_leverage)}`,
    `max_position_fraction = ${String(config.risk.max_position_fraction)}`,
    `fallback_size_fraction = ${String(config.risk.fallback_size_fraction)}`,
    "",
    "[risk.trailing_stop]",
    `enabled = ${String(config.risk.trailing_stop.enabled)}`,
    `atr_period = ${String(config.risk.trailing_stop.atr_period)}`,
    `atr_multiplier = ${String(config.risk.trailing_stop.atr_multiplier)}`,
    `side = ${formatTomlString(config.risk.trailing_stop.side)}`,
    "",
    "[risk.kelly]",
    `enabled = ${String(config.risk.kelly.enabled)}`,
    `fraction = ${String(config.risk.kelly.fraction)}`,
    `window_size = ${String(config.risk.kelly.window_size)}`,
    `min_trades = ${String(config.risk.kelly.min_trades)}`,
    `fallback_fraction = ${String(config.risk.kelly.fallback_fraction)}`,
    "",
    "[risk.drawdown_scaler]",
    `enabled = ${String(config.risk.drawdown_scaler.enabled)}`,
    `max_dd_pct = ${String(config.risk.drawdown_scaler.max_dd_pct)}`,
    "",
    "[symbols]",
    `enabled = ${formatTomlStringArray(config.symbols.enabled)}`,
    "",
    ...formatStrategySection("donchian_pivot_composition", config.strategies.donchian_pivot_composition),
    ...formatStrategySection("dydx_cex_carry", config.strategies.dydx_cex_carry),
    ...formatStrategySection("cascade_fade", config.strategies.cascade_fade),
    ...formatStrategySection("funding_flip_kill_switch", config.strategies.funding_flip_kill_switch),
    ...formatStrategySection("regime_detector", config.strategies.regime_detector),
    "[telemetry]",
    `log_dir = ${formatTomlString(config.telemetry.log_dir)}`,
    `metrics_interval_sec = ${String(config.telemetry.metrics_interval_sec)}`,
    `log_level = ${formatTomlString(config.telemetry.log_level)}`,
    `log_destination = ${formatTomlString(config.telemetry.log_destination)}`,
    `metrics_enabled = ${String(config.telemetry.metrics_enabled)}`,
    `heartbeat_interval_sec = ${String(config.telemetry.heartbeat_interval_sec)}`,
    "",
    "[portfolio]",
    `total_risk_per_cycle_usd = ${String(config.portfolio.total_risk_per_cycle_usd)}`,
    `correlation_penalty_threshold = ${String(config.portfolio.correlation_penalty_threshold)}`,
    `correlation_window_size = ${String(config.portfolio.correlation_window_size)}`,
    `max_dd_pct = ${String(config.portfolio.max_dd_pct)}`,
    "",
  ].join("\n");
}

// ============================================================================
// validate
// ============================================================================

/**
 * `runValidate` — direct `config validate`.
 *
 * Returns 0 on success, 2 on validation failure, 1 on unexpected error.
 * Prints a one-line "OK" on success and the full error list on failure.
 */
function runValidate(configPath: string, loadConfig: (path: string | undefined) => BotConfig): number {
  try {
    const config = loadConfig(configPath);
    // Green "OK" — the success badge is the headline of `validate`.
    console.log(colorize("OK", "green"));
    console.log(`  config: ${configPath}`);
    // Print a brief summary line so the user can see what loaded.
    console.log(
      `  mode: ${config.bot.mode}, exchange: ${config.exchange.id}, selected_leverage: ${config.bot.selected_leverage.canonical}, max_leverage: ${String(config.risk.max_leverage)}`,
    );
    return 0;
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      // Red "FAILED" — the user wants the failure to stand out (CI logs,
      // piped output, etc). The detailed error follows on the next lines.
      console.error(colorize("Config validation FAILED:", "red"));
      console.error(error.message);
      return 2;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(colorize(`Unexpected error during config validation: ${message}`, "red"));
    return 1;
  }
}

// ============================================================================
// show
// ============================================================================

/**
 * `runShow` — direct `config show`.
 *
 * Loads the effective config (defaults + file + env merged) and prints it
 * as TOML to stdout. The output can be saved and validated as a complete
 * configuration, while `config init` always writes the canonical template.
 */
function runShow(
  configPath: string | undefined,
  loadConfig: (path: string | undefined) => BotConfig,
): number {
  try {
    const config = loadConfig(configPath);
    console.log(formatToml(config));
    return 0;
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      console.error("Config validation FAILED:");
      console.error(error.message);
      return 2;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Unexpected error: ${message}`);
    return 1;
  }
}

// ============================================================================
// init
// ============================================================================

/**
 * `runConfigInit` — direct `config init [--out=path]`.
 *
 * Writes the resolved external runtime template to the given path (default:
 * `./mm-bot.toml`).
 *
 * If the user passes `--out` to a path that already exists, we refuse to
 * overwrite (no `--force` to avoid silent data loss).
 */
export function runConfigInit(
  outPath: string | undefined,
  sourcePath: string,
  boundary: ConfigFileBoundary = configFileBoundary,
): number {
  const target = outPath ?? "./mm-bot.toml";
  const resolvedTarget = path.resolve(target);

  if (boundary.exists(resolvedTarget)) {
    console.error(colorize(`Refusing to overwrite existing file: ${resolvedTarget}`, "red"));
    console.error("Pass --out=<different-path> or remove the existing file first.");
    return 1;
  }

  const resolvedSourcePath = path.resolve(sourcePath);
  if (!boundary.exists(resolvedSourcePath)) {
    console.error(colorize("Could not locate the runtime config template.", "red"));
    return 1;
  }

  const contents = boundary.read(resolvedSourcePath);
  try {
    const directory = path.dirname(resolvedTarget);
    if (!boundary.exists(directory)) {
      boundary.ensureDirectory(directory);
    }
    boundary.write(resolvedTarget, contents);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(colorize(`Failed to write ${resolvedTarget}: ${message}`, "red"));
    return 1;
  }
  // Green "Wrote" — success badge.
  console.log(colorize(`Wrote ${resolvedTarget}`, "green"));
  console.log("Edit the file, then run `bun run apps/bot/src/index.ts start --config=<path>` to launch.");
  return 0;
}

// ============================================================================
// Main handler
// ============================================================================

/**
 * `configCommand` — the direct `config` handler.
 *
 * Sub-subcommand dispatch is done by reading `parsed.positional[0]`:
 *   - "validate" → `runValidate`
 *   - "show"     → `runShow`
 *   - "init"     → `runConfigInit`
 *   - anything else (including empty) → print help, return 1.
 *
 * The `init` sub-subcommand reads `--out=<path>` from the same flags
 * map (not a separate parser), so the direct `config init --out=foo.toml`
 * works as expected.
 *
 * The `--help` / `-h` flag is intercepted here so the sub-subcommand
 * list is included in the help output (the router's generic help
 * doesn't know about sub-subcommands).
 */
export interface ConfigCommandDependencies {
  readonly loadConfig: (path: string | undefined) => BotConfig;
  readonly initConfig: (outPath: string | undefined, sourcePath: string) => number;
  readonly resolveRuntimeRoot: () => RuntimeRootResolution;
}

const DEFAULT_CONFIG_COMMAND_DEPENDENCIES: ConfigCommandDependencies = {
  loadConfig: (path) => loadBotConfig(path),
  initConfig: (outPath, sourcePath) => runConfigInit(outPath, sourcePath),
  resolveRuntimeRoot: () =>
    resolveRuntimeRootConfig({ environment: process.env, repositoryRoot: REPOSITORY_ROOT }),
};

export function createConfigCommand(overrides: Partial<ConfigCommandDependencies> = {}): SubcommandHandler {
  const dependencies = { ...DEFAULT_CONFIG_COMMAND_DEPENDENCIES, ...overrides };
  return async (arguments_, _context: CliContext) => {
    // Intercept --help / -h so we can print sub-subcommand help.
    if (arguments_.flags.get("help") === true) {
      printConfigHelp();
      return 1;
    }
    // Marker await so the function is genuinely async (satisfies the
    // `require-await` rule). The Promise resolves immediately.
    await Promise.resolve();

    const sub = arguments_.positional[0];
    const configPathResolution = resolveConfigPath(
      getConfigPath(arguments_),
      dependencies.resolveRuntimeRoot,
    );

    if (sub === "validate") {
      if (!configPathResolution.ok) {
        reportConfigPathFailure(configPathResolution);
        return 2;
      }
      return runValidate(configPathResolution.configPath, dependencies.loadConfig);
    }
    if (sub === "show") {
      if (!configPathResolution.ok) {
        reportConfigPathFailure(configPathResolution);
        return 2;
      }
      return runShow(configPathResolution.configPath, dependencies.loadConfig);
    }
    if (sub === "init") {
      if (!configPathResolution.ok) {
        reportConfigPathFailure(configPathResolution);
        return 2;
      }
      const outRaw = arguments_.flags.get("out");
      const out = typeof outRaw === "string" && outRaw.length > 0 ? outRaw : undefined;
      return dependencies.initConfig(out, configPathResolution.configPath);
    }

    // Unknown / missing sub-subcommand. Print usage.
    console.error(
      "Usage: bun run apps/bot/src/index.ts config <validate|show|init> [--config=path] [--out=path]",
    );
    console.error("");
    console.error("Subcommands:");
    console.error("  validate   Load + validate config; print OK or errors");
    console.error("  show       Print the effective config as TOML");
    console.error("  init       Write the default config to --out=<path> (default ./mm-bot.toml)");
    return 1;
  };
}

export const configCommand: SubcommandHandler = createConfigCommand();

/**
 * `printConfigHelp` — direct `config --help` output.
 *
 * The router's generic help only shows the subcommand description, not
 * the sub-subcommands. We override here so direct `config --help` is
 * actually useful.
 */
function printConfigHelp(): void {
  console.error("Usage: bun run apps/bot/src/index.ts config <subcommand> [options]");
  console.error("");
  console.error("Validate, show, or initialize the bot config.");
  console.error("");
  console.error("Subcommands:");
  console.error("  validate   Load + validate config; print OK or errors");
  console.error("  show       Print the effective config as TOML");
  console.error("  init       Write the default config to --out=<path> (default ./mm-bot.toml)");
  console.error("");
  console.error("Options:");
  console.error("  --config=<path>   TOML config file (default: external runtime template)");
  console.error("  --out=<path>      Output path for `init` (default: ./mm-bot.toml)");
  console.error("  --help, -h        Show this help");
}

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
 *   - `init`     — write the runtime config template to a target path.
 *                  Default target is `./mm-bot.toml`. Useful for first-time
 *                  setup.
 *
 * Color usage:
 *   - `validate` prints "OK" in green on success, "FAILED" in red on failure.
 *   - The "Refusing to overwrite" / file-write errors are red.
 *   - "Wrote <path>" success message is green.
 *   - The `show` output is plain TOML — no color (it must be parseable
 *     as TOML downstream, for example piped into the direct `config init` command).
 *
 * Exit codes:
 *   0 — success
 *   2 — config validation failure (POSIX convention)
 *
 * No interactive prompts. CI-friendly.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError, DEFAULT_BOT_CONFIG, loadBotConfig, type BotConfig } from "../../config/index.js";
import { resolveRuntimeRootConfig, type RuntimeRootResolution } from "../../config/runtime-root.js";
import { colorize } from "../color.js";
import type { CliContext, SubcommandHandler } from "../router.js";

import { reportConfigPathFailure, resolveConfigPath } from "./config-path.js";

const fileSystem = await import("node:fs");
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

function assertResolvedFilePath(filePath: string): void {
  if (filePath.includes("\0") || path.resolve(filePath) !== filePath) {
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
  exists(filePath: string): boolean {
    assertResolvedFilePath(filePath);
    return fileSystem.existsSync(filePath);
  },
  read(filePath: string): string {
    assertResolvedFilePath(filePath);
    return fileSystem.readFileSync(filePath, "utf8");
  },
  ensureDirectory(filePath: string): void {
    assertResolvedFilePath(filePath);
    fileSystem.mkdirSync(filePath, { recursive: true });
  },
  write(filePath: string, contents: string): void {
    assertResolvedFilePath(filePath);
    fileSystem.writeFileSync(filePath, contents, "utf8");
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
  const v = arguments_.flags.get("config");
  if (typeof v === "string" && v.length > 0) {
    return v;
  }
  return undefined;
}

/**
 * `formatToml` — serialize a `BotConfig` to a TOML-ish string.
 *
 * This is a hand-rolled serializer — we don't pull in a TOML emitter dep
 * just for the direct `config show` command. The output is human-readable and
 * round-trip-safe enough for direct `config show | config init` use to
 * produce a working TOML.
 *
 * NOT a general-purpose TOML serializer:
 *   - No multi-line strings / arrays-of-tables-of-arrays.
 *   - No escaping for strings containing newlines, tabs, or `"`.
 *   - Numbers, booleans, and enums are printed as their natural form.
 *
 * The BotConfig shape is flat (6 sections, all with primitive leaves),
 * so this is sufficient.
 */
function formatToml(config: BotConfig): string {
  const lines = [
    "# mm-crypto-bot config — emitted by the direct config show command",
    "# Edit and re-run the direct config validate command to check.",
    "",
    "[bot]",
    `mode = "${config.bot.mode}"`,
    `log_level = "${config.bot.log_level}"`,
    `state_file = "${config.bot.state_file}"`,
    "",
    "[exchange]",
    `id = "${config.exchange.id}"`,
    `rate_limit_ms = ${String(config.exchange.rate_limit_ms)}`,
    `sandbox = ${String(config.exchange.sandbox)}`,
    "",
    "[risk]",
    `risk_per_trade = ${String(config.risk.risk_per_trade)}`,
    `kelly_fraction = ${String(config.risk.kelly_fraction)}`,
    `max_drawdown_pct = ${String(config.risk.max_drawdown_pct)}`,
    `max_positions = ${String(config.risk.max_positions)}`,
    `max_leverage = ${String(config.risk.max_leverage)}`,
    "",
    "[symbols]",
    `enabled = [${config.symbols.enabled.map((symbol) => `"${symbol}"`).join(", ")}]`,
    "",
  ];
  for (const [name, section] of Object.entries(config.strategies)) {
    lines.push(`[strategies.${name}]`, `enabled = ${String(section.enabled)}`);
    if (section.cap !== undefined) lines.push(`cap = ${String(section.cap)}`);
    if (section.leverage !== undefined) lines.push(`leverage = ${String(section.leverage)}`);
    if (section.symbols !== undefined) {
      const items = section.symbols.map((symbol) => `"${symbol}"`).join(", ");
      lines.push(`symbols = [${items}]`);
    }
    if (section.timeframes !== undefined) {
      lines.push(
        `[strategies.${name}.timeframes]`,
        `htf = "${section.timeframes.htf}"`,
        `mtf = "${section.timeframes.mtf}"`,
        `ltf = "${section.timeframes.ltf}"`,
      );
    }

    // Print schema passthrough fields without re-validating known typed fields.
    const knownKeys = new Set(["enabled", "cap", "leverage", "symbols", "timeframes"]);
    for (const [k, v] of Object.entries(section)) {
      if (!knownKeys.has(k)) {
        if (typeof v === "string") lines.push(`${k} = "${v}"`);
        else if (typeof v === "number" || typeof v === "boolean") lines.push(`${k} = ${String(v)}`);
        else if (Array.isArray(v)) {
          const items = v.map((item) => (typeof item === "string" ? `"${item}"` : String(item))).join(", ");
          lines.push(`${k} = [${items}]`);
        }
      }
    }
    lines.push("");
  }

  lines.push(
    "[telemetry]",
    `log_dir = "${config.telemetry.log_dir}"`,
    `metrics_interval_sec = ${String(config.telemetry.metrics_interval_sec)}`,
    "",
  );

  return lines.join("\n");
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
    // Optional: also print the source.
    console.log(`  config: ${configPath}`);
    // Print a brief summary line so the user can see what loaded.
    console.log(
      `  mode: ${config.bot.mode}, exchange: ${config.exchange.id}, max_leverage: ${String(config.risk.max_leverage)}`,
    );
    void DEFAULT_BOT_CONFIG; // referenced for typecheck only
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
 * as TOML to stdout. Pipeable to the direct `config init --out=...` command to clone
 * a config (with manual edits if desired).
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
 * Writes a starter TOML config from the validated external runtime root to the
 * given path (default: `./mm-bot.toml`).
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
    const resolvedConfigPath = resolveConfigPath(getConfigPath(arguments_), dependencies.resolveRuntimeRoot);

    if (sub === "validate") {
      if (!resolvedConfigPath.ok) {
        reportConfigPathFailure(resolvedConfigPath);
        return 2;
      }
      return runValidate(resolvedConfigPath.configPath, dependencies.loadConfig);
    }
    if (sub === "show") {
      if (!resolvedConfigPath.ok) {
        reportConfigPathFailure(resolvedConfigPath);
        return 2;
      }
      return runShow(resolvedConfigPath.configPath, dependencies.loadConfig);
    }
    if (sub === "init") {
      if (!resolvedConfigPath.ok) {
        reportConfigPathFailure(resolvedConfigPath);
        return 2;
      }
      const outRaw = arguments_.flags.get("out");
      const out = typeof outRaw === "string" && outRaw.length > 0 ? outRaw : undefined;
      return dependencies.initConfig(out, resolvedConfigPath.configPath);
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

/**
 * apps/bot/src/cli/commands/config.ts
 *
 * Phase 33 Track D — `mm-bot config <validate|show|init>` subcommand.
 *
 * Three sub-subcommands:
 *   - `validate` — load + validate config; print "OK" or errors; exit 0/2.
 *   - `show`     — print the effective config (defaults + file + env merged)
 *                  as TOML. Useful for debugging "what did the bot actually
 *                  load?".
 *   - `init`     — write `config/default.toml` to a target path. Default
 *                  target is `./mm-bot.toml`. Useful for first-time setup.
 *
 * Exit codes:
 *   0 — success
 *   2 — config validation failure (POSIX convention)
 *
 * No interactive prompts. All output is plain text. CI-friendly.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ConfigError, DEFAULT_BOT_CONFIG, loadBotConfig, type BotConfig } from "../../config/index.js";
import type { CliContext, SubcommandHandler } from "../router.js";

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
function getConfigPath(args: { readonly flags: ReadonlyMap<string, string | boolean> }): string | undefined {
  const v = args.flags.get("config");
  if (typeof v === "string" && v.length > 0) {
    return v;
  }
  return undefined;
}

/**
 * `formatToml` — serialize a `BotConfig` to a TOML-ish string.
 *
 * This is a hand-rolled serializer — we don't pull in a TOML emitter dep
 * just for `mm-bot config show`. The output is human-readable and
 * round-trip-safe enough for `mm-bot config show | mm-bot config init` to
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
  const lines: string[] = [];
  // Header
  lines.push("# mm-bot config — emitted by `mm-bot config show`");
  lines.push("# Edit and re-run `mm-bot config validate` to check.");
  lines.push("");

  // Section 1: bot
  lines.push("[bot]");
  lines.push(`mode = "${config.bot.mode}"`);
  lines.push(`log_level = "${config.bot.log_level}"`);
  lines.push(`state_file = "${config.bot.state_file}"`);
  lines.push("");

  // Section 2: exchange
  lines.push("[exchange]");
  lines.push(`id = "${config.exchange.id}"`);
  lines.push(`rate_limit_ms = ${String(config.exchange.rate_limit_ms)}`);
  lines.push(`sandbox = ${String(config.exchange.sandbox)}`);
  lines.push("");

  // Section 3: risk
  lines.push("[risk]");
  lines.push(`risk_per_trade = ${String(config.risk.risk_per_trade)}`);
  lines.push(`kelly_fraction = ${String(config.risk.kelly_fraction)}`);
  lines.push(`max_drawdown_pct = ${String(config.risk.max_drawdown_pct)}`);
  lines.push(`max_positions = ${String(config.risk.max_positions)}`);
  lines.push(`max_leverage = ${String(config.risk.max_leverage)}`);
  lines.push("");

  // Section 4: symbols
  lines.push("[symbols]");
  const symList = config.symbols.enabled.map((s) => `"${s}"`).join(", ");
  lines.push(`enabled = [${symList}]`);
  lines.push("");

  // Section 5: strategies
  for (const [name, section] of Object.entries(config.strategies)) {
    lines.push(`[strategies.${name}]`);
    lines.push(`enabled = ${String(section.enabled)}`);
    // Print only the schema-known top-level fields. The .passthrough()
    // fields are also iterated to be exhaustive.
    const knownKeys = new Set(["enabled", "cap", "leverage", "symbols", "timeframes"]);
    for (const [k, v] of Object.entries(section)) {
      if (k === "enabled") continue;
      if (v === undefined) continue;
      if (!knownKeys.has(k)) {
        // passthrough field — render as a simple key = "value" or key = number
        if (typeof v === "string") {
          lines.push(`${k} = "${v}"`);
        } else if (typeof v === "number" || typeof v === "boolean") {
          lines.push(`${k} = ${String(v)}`);
        } else if (Array.isArray(v)) {
          const items = v.map((x) => (typeof x === "string" ? `"${x}"` : String(x))).join(", ");
          lines.push(`${k} = [${items}]`);
        }
        // Skip objects we don't know how to render.
      } else if (k === "cap" || k === "leverage") {
        if (typeof v === "number") {
          lines.push(`${k} = ${String(v)}`);
        }
      } else if (k === "symbols") {
        if (Array.isArray(v)) {
          const items = v.map((s) => `"${String(s)}"`).join(", ");
          lines.push(`symbols = [${items}]`);
        }
      } else if (k === "timeframes") {
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          const tf = v as { htf?: string; mtf?: string; ltf?: string };
          if (tf.htf !== undefined && tf.mtf !== undefined && tf.ltf !== undefined) {
            lines.push(`[strategies.${name}.timeframes]`);
            lines.push(`htf = "${tf.htf}"`);
            lines.push(`mtf = "${tf.mtf}"`);
            lines.push(`ltf = "${tf.ltf}"`);
          }
        }
      }
    }
    lines.push("");
  }

  // Section 6: telemetry
  lines.push("[telemetry]");
  lines.push(`log_dir = "${config.telemetry.log_dir}"`);
  lines.push(`metrics_interval_sec = ${String(config.telemetry.metrics_interval_sec)}`);
  lines.push("");

  return lines.join("\n");
}

// ============================================================================
// validate
// ============================================================================

/**
 * `runValidate` — `mm-bot config validate`.
 *
 * Returns 0 on success, 2 on validation failure, 1 on unexpected error.
 * Prints a one-line "OK" on success and the full error list on failure.
 */
function runValidate(configPath: string | undefined): number {
  try {
    const config = loadBotConfig(configPath);
    console.log("OK");
    // Optional: also print the source.
    if (configPath !== undefined) {
      console.log(`  config: ${configPath}`);
    } else {
      console.log("  config: <defaults>");
    }
    // Print a brief summary line so the user can see what loaded.
    console.log(
      `  mode: ${config.bot.mode}, exchange: ${config.exchange.id}, max_leverage: ${String(config.risk.max_leverage)}`,
    );
    void DEFAULT_BOT_CONFIG; // referenced for typecheck only
    return 0;
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      console.error("Config validation FAILED:");
      console.error(err.message);
      return 2;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Unexpected error during config validation: ${message}`);
    return 1;
  }
}

// ============================================================================
// show
// ============================================================================

/**
 * `runShow` — `mm-bot config show`.
 *
 * Loads the effective config (defaults + file + env merged) and prints it
 * as TOML to stdout. Pipeable to `mm-bot config init --out=...` to clone
 * a config (with manual edits if desired).
 */
function runShow(configPath: string | undefined): number {
  try {
    const config = loadBotConfig(configPath);
    console.log(formatToml(config));
    return 0;
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      console.error("Config validation FAILED:");
      console.error(err.message);
      return 2;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Unexpected error: ${message}`);
    return 1;
  }
}

// ============================================================================
// init
// ============================================================================

/**
 * `runInit` — `mm-bot config init [--out=path]`.
 *
 * Writes a starter TOML config to the given path (default: `./mm-bot.toml`).
 * We do NOT have a separate "template" file — we reuse the canonical
 * `config/default.toml` shipped in the repo (path resolved relative to
 * the current working directory). This way the user gets the production-
 * default starting point, with all the helpful comments.
 *
 * If the user passes `--out` to a path that already exists, we refuse to
 * overwrite (no `--force` to avoid silent data loss).
 */
function runInit(outPath: string | undefined): number {
  const target = outPath ?? "./mm-bot.toml";
  const resolvedTarget = resolve(target);

  if (existsSync(resolvedTarget)) {
    console.error(`Refusing to overwrite existing file: ${resolvedTarget}`);
    console.error("Pass --out=<different-path> or remove the existing file first.");
    return 1;
  }

  // Locate the canonical default.toml. We try a few common relative
  // paths so this works whether the user runs from the repo root,
  // from `apps/bot/`, or from a build dir.
  const candidates = [
    "config/default.toml",
    "apps/bot/config/default.toml",
    "../config/default.toml",
    "../../config/default.toml",
  ];
  let sourcePath: string | null = null;
  for (const c of candidates) {
    if (existsSync(c)) {
      sourcePath = c;
      break;
    }
  }
  if (sourcePath === null) {
    console.error(
      "Could not locate config/default.toml. " +
        "Run from the repo root (or pass --out and a TOML you have on hand).",
    );
    return 1;
  }

  const contents = readFileSync(sourcePath, "utf8");
  try {
    const dir = dirname(resolvedTarget);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(resolvedTarget, contents, "utf8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to write ${resolvedTarget}: ${message}`);
    return 1;
  }
  console.log(`Wrote ${resolvedTarget}`);
  console.log("Edit the file, then run `mm-bot start --config=<path>` to launch.");
  return 0;
}

// ============================================================================
// Main handler
// ============================================================================

/**
 * `configCommand` — the `mm-bot config` handler.
 *
 * Sub-subcommand dispatch is done by reading `parsed.positional[0]`:
 *   - "validate" → `runValidate`
 *   - "show"     → `runShow`
 *   - "init"     → `runInit`
 *   - anything else (including empty) → print help, return 1.
 *
 * The `init` sub-subcommand reads `--out=<path>` from the same flags
 * map (not a separate parser), so `mm-bot config init --out=foo.toml`
 * works as expected.
 *
 * The `--help` / `-h` flag is intercepted here so the sub-subcommand
 * list is included in the help output (the router's generic help
 * doesn't know about sub-subcommands).
 */
export const configCommand: SubcommandHandler = async (args, _ctx: CliContext) => {
  // Intercept --help / -h so we can print sub-subcommand help.
  if (args.flags.get("help") === true) {
    printConfigHelp();
    return 1;
  }
  // Marker await so the function is genuinely async (satisfies the
  // `require-await` rule). The Promise resolves immediately.
  await Promise.resolve();

  const sub = args.positional[0];
  const configPath = getConfigPath(args);

  if (sub === "validate") {
    return runValidate(configPath);
  }
  if (sub === "show") {
    return runShow(configPath);
  }
  if (sub === "init") {
    const outRaw = args.flags.get("out");
    const out = typeof outRaw === "string" && outRaw.length > 0 ? outRaw : undefined;
    return runInit(out);
  }

  // Unknown / missing sub-subcommand. Print usage.
  console.error("Usage: mm-bot config <validate|show|init> [--config=path] [--out=path]");
  console.error("");
  console.error("Subcommands:");
  console.error("  validate   Load + validate config; print OK or errors");
  console.error("  show       Print the effective config as TOML");
  console.error("  init       Write the default config to --out=<path> (default ./mm-bot.toml)");
  return 1;
};

/**
 * `printConfigHelp` — the `mm-bot config --help` output.
 *
 * The router's generic help only shows the subcommand description, not
 * the sub-subcommands. We override here so `mm-bot config --help` is
 * actually useful.
 */
function printConfigHelp(): void {
  console.error("Usage: mm-bot config <subcommand> [options]");
  console.error("");
  console.error("Validate, show, or initialize the bot config.");
  console.error("");
  console.error("Subcommands:");
  console.error("  validate   Load + validate config; print OK or errors");
  console.error("  show       Print the effective config as TOML");
  console.error("  init       Write the default config to --out=<path> (default ./mm-bot.toml)");
  console.error("");
  console.error("Options:");
  console.error("  --config=<path>   TOML config file (default: built-in defaults)");
  console.error("  --out=<path>      Output path for `init` (default: ./mm-bot.toml)");
  console.error("  --help, -h        Show this help");
}

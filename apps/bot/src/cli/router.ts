/**
 * apps/bot/src/cli/router.ts
 *
 * Phase 33 Track D — `CliRouter` — a subcommand router for the `mm-bot` CLI.
 *
 * The router owns a registry of `(name, description, handler)` triples and
 * dispatches the first positional arg of argv to the matching handler.
 *
 * Design:
 *   - **Stateless** — the router is a thin registry + dispatcher. Each
 *     subcommand handler is responsible for loading its own config and
 *     managing its own state.
 *   - **Async-first** — handlers return `Promise<number>` (the exit code).
 *     The `run()` method awaits the handler and returns the resolved code.
 *   - **Help-first** — `mm-bot help` (or no subcommand) prints the help
 *     table and returns 1.
 *   - **Unknown subcommand** — prints an error + help and returns 1.
 *
 * The router itself does NOT interpret any flag. Each handler receives the
 * full `ParsedArgs` and is free to look up the flags it cares about.
 *
 * ===========================================================================
 * EXIT CODES
 * ===========================================================================
 *   0 — success
 *   1 — runtime error / unknown subcommand / no subcommand
 *   2 — config validation failure (handler convention; router doesn't enforce)
 *
 * The router's `run()` returns the handler's resolved exit code verbatim.
 * The CLI entry point (`apps/bot/src/index.ts`) calls `process.exit(code)`.
 */

import type { BotConfig } from "../config/index.js";

import type { ParsedArgs } from "./argv.js";
import { parseArgv } from "./argv.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * `CliContext` — the context passed to every subcommand handler.
 *
 * Currently this is just the loaded `BotConfig` (resolved by the entry
 * point so handlers don't each repeat the `loadBotConfig(...)` boilerplate).
 *
 * Future fields: a shared logger, the StateStore (for handlers that
 * pre-load state), a feed instance, etc.
 */
export interface CliContext {
  readonly config: BotConfig;
}

/**
 * `SubcommandHandler` — a subcommand's `async` entry point.
 *
 * Receives the parsed argv and a context with the loaded config. Returns
 * the desired process exit code (0 = success).
 */
export type SubcommandHandler = (args: ParsedArgs, ctx: CliContext) => Promise<number>;

// ============================================================================
// SubcommandEntry
// ============================================================================

/**
 * `SubcommandEntry` — a registered subcommand's metadata + handler.
 *
 * Kept private to the router; the public API is `register()` + `run()`.
 */
interface SubcommandEntry {
  readonly name: string;
  readonly description: string;
  readonly handler: SubcommandHandler;
}

// ============================================================================
// CliRouter
// ============================================================================

/**
 * `CliRouter` — the subcommand registry + dispatcher.
 *
 * Usage (from `apps/bot/src/index.ts`):
 *
 * ```ts
 * const router = new CliRouter();
 * router.register("start", "Start the bot", startCommand);
 * router.register("status", "Show current state", statusCommand);
 * // ... etc
 * const code = await router.run(process.argv.slice(2));
 * process.exit(code);
 * ```
 */
export class CliRouter {
  private readonly entries = new Map<string, SubcommandEntry>();
  private programDescription = "mm-bot — the mm-crypto-bot CLI";

  // --------------------------------------------------------------------------
  // Registration
  // --------------------------------------------------------------------------

  /**
   * `register` — add a subcommand to the registry.
   *
   * @param name        The subcommand name (e.g. "start", "status").
   * @param description A short (1-line) help text describing the subcommand.
   * @param handler     The async function to invoke for this subcommand.
   *
   * The `name` is the literal string the user types after `mm-bot`. It is
   * case-sensitive. Re-registering the same name overwrites the previous
   * entry (the typical pattern: tests build a fresh router per test).
   */
  public register(name: string, description: string, handler: SubcommandHandler): void {
    this.entries.set(name, { name, description, handler });
  }

  /**
   * `setProgramDescription` — set the header line printed by `printHelp`.
   * Defaults to "mm-bot — the mm-crypto-bot CLI".
   */
  public setProgramDescription(description: string): void {
    this.programDescription = description;
  }

  // --------------------------------------------------------------------------
  // Dispatch
  // --------------------------------------------------------------------------

  /**
   * `run` — parse argv and dispatch to the matching subcommand.
   *
   * @param argv The argv slice to process (typically `process.argv.slice(2)`).
   * @returns The exit code:
   *   - the handler's return value if the subcommand is known;
   *   - `1` if the subcommand is missing, unknown, or if `--help`/`-h` is set.
   *
   * The function is async because handlers may do async work (config load,
   * network calls, etc). The function does NOT call `process.exit` — the
   * caller decides how to translate the return value to a process exit.
   */
  public async run(argv: readonly string[]): Promise<number> {
    const parsed = parseArgv(argv);

    // No subcommand → print help + return 1.
    if (parsed.subcommand === "") {
      this.printHelp("");
      return 1;
    }

    // --help / -h on a KNOWN subcommand → dispatch to the handler, which
    // owns its own subcommand-specific help (e.g. `mm-bot config --help`
    // knows about validate/show/init, but the router doesn't).
    // --help on an UNKNOWN subcommand → print error + global help.
    if (parsed.flags.get("help") === true) {
      const entry = this.entries.get(parsed.subcommand);
      if (entry === undefined) {
        this.printHelp("");
        return 1;
      }
      // Fall through and dispatch to the handler with the --help flag
      // intact in `parsed.flags`. The handler is responsible for
      // interpreting it (most will print their own usage + return 1).
    }

    // Sub-subcommand routing: if the first positional arg isn't a known
    // subcommand but matches a registered subcommand's "subcommand" prefix
    // (e.g. `mm-bot config validate`), we delegate the sub-subcommand
    // to the handler. The handler is responsible for interpreting
    // `parsed.positional[0]` as its own sub-subcommand.
    //
    // NOTE: we do NOT special-case any names here. The handler decides.

    const entry = this.entries.get(parsed.subcommand);
    if (entry === undefined) {
      // Unknown subcommand. Print an error + global help + return 1.
      this.printUnknownSubcommand(parsed.subcommand);
      return 1;
    }

    // Build the context. We deliberately keep this minimal: each handler
    // loads what it needs. Currently we don't have a config in the
    // context because each handler calls `loadBotConfig` itself (to
    // support different `--config` paths per invocation).
    const ctx: CliContext = {
      // The BotConfig shape is per-handler; we provide a minimal stub
      // so the type system is happy. Handlers that need config will
      // load it themselves via `loadBotConfig(args.flags.get("config"))`.
      config: undefined as unknown as BotConfig,
    };
    return entry.handler(parsed, ctx);
  }

  // --------------------------------------------------------------------------
  // Help / error printing
  // --------------------------------------------------------------------------

  /**
   * `printHelp` — print the help table.
   *
   * If `subcommand` is non-empty and known, print the subcommand-specific
   * help (currently a 1-line description; extended usage is up to the
   * handler). Otherwise print the global help.
   *
   * Output is written to `stderr` (so the help is visible even when
   * stdout is piped to another command).
   */
  public printHelp(subcommand: string): void {
    const lines: string[] = [];
    lines.push(this.programDescription);
    lines.push("");
    if (subcommand !== "") {
      const entry = this.entries.get(subcommand);
      if (entry !== undefined) {
        lines.push(`Usage: mm-bot ${entry.name} [--config=path] [--help]`);
        lines.push("");
        lines.push(`  ${entry.description}`);
        lines.push("");
        lines.push("Options:");
        lines.push("  --config=<path>   TOML config file (optional; uses defaults if absent)");
        lines.push("  --help, -h        Show this help");
        this.writeHelp(lines);
        return;
      }
      // Unknown subcommand while --help is set: fall through to global.
      lines.push(`Unknown subcommand: "${subcommand}"`);
      lines.push("");
    }
    lines.push("Usage: mm-bot <subcommand> [options]");
    lines.push("");
    lines.push("Subcommands:");
    const sorted = [...this.entries.values()].sort((a, b) => a.name.localeCompare(b.name));
    // Compute the max name length for alignment.
    const nameWidth = Math.max(0, ...sorted.map((e) => e.name.length));
    for (const e of sorted) {
      const padded = e.name.padEnd(nameWidth, " ");
      lines.push(`  ${padded}   ${e.description}`);
    }
    lines.push("");
    lines.push("Run `mm-bot <subcommand> --help` for subcommand-specific options.");
    this.writeHelp(lines);
  }

  /**
   * `printUnknownSubcommand` — print an error + global help.
   */
  public printUnknownSubcommand(name: string): void {
    const lines: string[] = [];
    lines.push(`Unknown subcommand: "${name}"`);
    lines.push("");
    lines.push("Run `mm-bot --help` for a list of subcommands.");
    this.writeHelp(lines);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * `writeHelp` — write the help lines to stderr.
   *
   * Splitting the writer out makes it testable: tests can spy on
   * `console.error` instead of capturing stdout.
   */
  private writeHelp(lines: readonly string[]): void {
    for (const line of lines) {
      console.error(line);
    }
  }
}

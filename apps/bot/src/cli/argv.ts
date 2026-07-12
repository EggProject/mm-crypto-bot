/**
 * apps/bot/src/cli/argv.ts
 *
 * Phase 33 Track D — hand-rolled argv parser for the `mm-bot` CLI.
 *
 * Design goals (user mandate 2026-07-11 23:42 Budapest):
 *   - **Zero external dependencies** — no `commander`, no `yargs`, no `minimist`.
 *     The parser is a 50-line hand-rolled state machine.
 *   - **POSIX-ish flag syntax** — supports both `--flag=value` and `--flag value`.
 *   - **Negation** — `--no-flag` produces `flag: false`.
 *   - **Subcommand + flags + positional** — the first non-flag token is the
 *     subcommand, the rest are flags or positional args.
 *   - **`--help` / `-h`** — a special flag that prints help (handled by the router).
 *   - **Deterministic** — given the same argv, always returns the same result.
 *
 * This is intentionally minimal. The CLI has at most a dozen subcommands and
 * a handful of flags each — anything more complex warrants a real library.
 *
 * ===========================================================================
 * GRAMMAR (informal)
 * ===========================================================================
 *
 *   argv        := (subcommand)? (flag | positional)*
 *   flag        := '--' name ('=' value)?
 *                | '--no-' name                    → boolean false
 *                | '-' short_name                  → short flag (help only)
 *   name        := [a-zA-Z0-9_-]+
 *   value       := next argv element (if it doesn't start with '--')
 *
 * The first non-flag token is the subcommand. Tokens after the subcommand
 * are scanned for `--flag` and consumed (with their value) or recorded as
 * positional args.
 *
 * ===========================================================================
 * EDGE CASES
 * ===========================================================================
 *
 *   - `--flag= `          → empty-string value, NOT treated as boolean
 *   - `--flag`  (last)    → boolean true (no value follows)
 *   - `--flag --other`    → `flag: true` (boolean), `--other` is its own flag
 *   - `--no-flag value`   → `flag: false` (boolean), `value` is positional
 *   - `start --`          → stop flag-parsing; remaining is positional
 *
 * The "treat next as value" logic skips the next arg ONLY if it doesn't
 * start with `--` (a new flag) AND the current flag is not a known
 * boolean negation (`--no-X`).
 */

// ============================================================================
// Public types
// ============================================================================

/**
 * `ParsedArgs` — the result of `parseArgv`.
 *
 * - `subcommand` — the first non-flag positional argument. Empty string if
 *   no subcommand was given (the router prints help + returns 1 in that case).
 * - `flags`      — a readonly `Map` of flag name → value. Values are:
 *     - `string`  — for `--flag=value` or `--flag value`
 *     - `true`    — for `--flag` (boolean flag with no value)
 *     - `false`   — for `--no-flag` (negation)
 * - `positional` — non-flag arguments that appear AFTER the subcommand.
 *   Useful for `mm-bot config <validate|show|init>` (sub-subcommands).
 */
export interface ParsedArgs {
  readonly subcommand: string;
  readonly flags: ReadonlyMap<string, string | boolean>;
  readonly positional: readonly string[];
}

// ============================================================================
// Parser
// ============================================================================

/**
 * `parseArgv` — tokenize a POSIX-ish argv into `(subcommand, flags, positional)`.
 *
 * @param argv The argv slice to parse. Typically `process.argv.slice(2)`.
 *   MUST NOT include the node/bun binary path or the script path.
 * @returns A `ParsedArgs` value. Never throws; an empty argv yields
 *   `{ subcommand: "", flags: new Map(), positional: [] }`.
 *
 * The function is pure (no side effects) and synchronous.
 */
export function parseArgv(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  let subcommand = "";

  // Phase 1: walk the argv, classifying each token.
  // We split the iteration into "before-subcommand" and "after-subcommand":
  // the first non-flag token becomes the subcommand and we record the rest.
  let i = 0;
  let foundSubcommand = false;
  let stopFlags = false;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) {
      // Defensive: argv[i] is typed `string | undefined` because of
      // `noUncheckedIndexedAccess`. The loop guard ensures this branch
      // is dead, but TS requires the check.
      break;
    }

    // The `--` sentinel terminates flag parsing.
    if (arg === "--") {
      stopFlags = true;
      i += 1;
      continue;
    }

    if (stopFlags || !arg.startsWith("-")) {
      // Positional argument.
      if (!foundSubcommand) {
        subcommand = arg;
        foundSubcommand = true;
      } else {
        positional.push(arg);
      }
      i += 1;
      continue;
    }

    // We have a flag. Two forms:
    //   - long:   --name, --name=value, --no-name
    //   - short:  -x
    if (arg.startsWith("--")) {
      // A bare `--` is caught by the `arg === "--"` check at the top of
      // the loop and never reaches here, so `arg.slice(2)` is always
      // non-empty.
      const body = arg.slice(2);

      // Negation: --no-<name>  →  flags.set(name, false)
      //
      // If the negation regex fails (e.g. `--no-foo!` with an invalid char),
      // we FALL THROUGH to the subsequent checks instead of silently dropping
      // the arg. The next branches (`--name=value` and the bare-name check)
      // will then classify the malformed arg as either a valid flag (if its
      // name happens to match the regex on a different slice) or push it to
      // positional via the malformed-flag branch at the bottom. This is a
      // data-loss fix: previously `--no-foo!` was silently discarded.
      if (body.startsWith("no-") && body.length > 3) {
        const name = body.slice(3);
        if (name.length > 0 && /^[a-zA-Z0-9_-]+$/.test(name)) {
          flags.set(name, false);
          i += 1;
          continue;
        }
        // fall through (do not consume the arg here)
      }

      // --name=value
      const eqIdx = body.indexOf("=");
      if (eqIdx >= 0) {
        const name = body.slice(0, eqIdx);
        const value = body.slice(eqIdx + 1);
        if (name.length > 0 && /^[a-zA-Z0-9_-]+$/.test(name)) {
          // Empty value is allowed (--name= → "")
          flags.set(name, value);
          i += 1;
          continue;
        }
        // fall through (name is empty or invalid — do not drop silently)
      }

      // --name (with possible value as the next token)
      if (/^[a-zA-Z0-9_-]+$/.test(body)) {
        const next = argv[i + 1];
        // A value is "the next token" if it exists AND does not start with `-`.
        // This handles both `--flag value` and `--flag` (boolean).
        if (next !== undefined && !next.startsWith("-")) {
          flags.set(body, next);
          i += 2;
        } else {
          flags.set(body, true);
          i += 1;
        }
        continue;
      }

      // Malformed long flag. We never silently drop the arg: if we don't
      // have a subcommand yet, the malformed token BECOMES the subcommand
      // (the router can then emit "unknown subcommand"); otherwise it's
      // recorded as positional. This is a data-loss fix: previously
      // malformed flags with no subcommand were silently discarded.
      if (!foundSubcommand) {
        subcommand = arg;
        foundSubcommand = true;
      } else {
        positional.push(arg);
      }
      i += 1;
      continue;
    }

    // Short flag: -x or -h. We only special-case -h → help. Other short
    // flags become positional so they aren't silently dropped (the router
    // can decide what to do with them).
    if (arg === "-h") {
      flags.set("help", true);
      i += 1;
      continue;
    }
    if (/^-[a-zA-Z]$/.test(arg)) {
      // Single-char short flag (not -h). Record as the bare letter, no value.
      const letter = arg.slice(1);
      flags.set(letter, true);
      i += 1;
      continue;
    }

    // Bundled short flags (-abc) or unknown. Like malformed long flags,
    // we never silently drop the arg: if we don't have a subcommand yet,
    // the bundled token BECOMES the subcommand; otherwise it's recorded
    // as positional.
    if (!foundSubcommand) {
      subcommand = arg;
      foundSubcommand = true;
    } else {
      positional.push(arg);
    }
    i += 1;
  }

  return { subcommand, flags, positional };
}

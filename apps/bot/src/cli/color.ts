/**
 * apps/bot/src/cli/color.ts
 *
 * Phase 34 Track C — terminal-color helper for the `mm-bot` CLI.
 *
 * ===========================================================================
 * USER MANDATE (2026-07-12 02:00 BUDAPEST)
 * ===========================================================================
 * "Headless mode-ban ki lehessen kapcsolni a color-t, de default color
 *  output legyen."
 *  = "In headless mode, color can be turned off, but default is color
 *     output."
 *
 * This module is the single source of truth for "should this process emit
 * ANSI color codes?". The rules, in order:
 *
 *   1. **Forced override** — `setColorForced(true|false)` flips the
 *      decision. Used by `index.ts` to honor the `--color` / `--no-color`
 *      CLI flags. `--no-color` is *also* propagated to the `NO_COLOR=1`
 *      env var (per https://no-color.org/) so downstream libs (Ink,
 *      picocolors) see the same signal.
 *   2. **`NO_COLOR` env var** — if set to any non-empty value, color is
 *      OFF (https://no-color.org/).
 *   3. **TTY auto-detect** — if `process.stdout.isTTY === false` (piped
 *      to `less` / `grep` / a file), color is OFF. This prevents
 *      unreadable log files full of `^[[31m` escape sequences.
 *   4. **Default** — color is ON.
 *
 * The `colorize()` helper returns the input untouched when color is OFF
 * (so log files / pipes contain clean text), or wrapped in ANSI codes
 * via `picocolors` when color is ON.
 *
 * ===========================================================================
 * DESIGN: SINGLETON + EXPLICIT SETTER
 * ===========================================================================
 * We use a single module-level `forced` flag because the CLI is a short-
 * lived process: parse argv once in `index.ts`, call `setColorForced()`,
 * then every command's `colorize()` call sees the same decision. No need
 * for a context object threaded through every function call.
 *
 * Tests use the same setter (with an `afterEach` reset) to flip the
 * decision in-process.
 *
 * ===========================================================================
 * WHY PICOLORS?
 * ===========================================================================
 * `picocolors` is a 2KB zero-dep ANSI color library — it's what Bun,
 * Vite, and many others use. We rely on its formatter functions
 * (`pc.red`, `pc.green`, etc.) for the actual escape sequences, and
 * layer our own policy on top via `isColorEnabled()`.
 */

import pc from "picocolors";

// ============================================================================
// Module-level state
// ============================================================================

/**
 * `forced` — explicit override from CLI flags. If set, it short-circuits
 * the env-var + TTY detection. `undefined` means "no override, follow
 * env + TTY rules".
 */
let forced: boolean | undefined = undefined;

// ============================================================================
// Public API — flags
// ============================================================================

/**
 * `setColorForced` — explicit override for the color decision.
 *
 * @param enabled - `true` forces color on, `false` forces color off,
 *   `undefined` clears the override (default: follow env + TTY).
 *
 * Called by `apps/bot/src/index.ts` after the early argv parse:
 *   - `--color`       → `setColorForced(true)`
 *   - `--no-color`    → `setColorForced(false)` + `process.env.NO_COLOR = "1"`
 *
 * Tests use this to flip the decision in-process; the `color.test.ts`
 * suite calls `setColorForced(undefined)` in `afterEach` to reset.
 */
export function setColorForced(enabled: boolean | undefined): void {
  forced = enabled;
}

/**
 * `isColorEnabled` — should the current process emit ANSI color codes?
 *
 * Decision order (first match wins):
 *   1. `forced` (set via `setColorForced`)
 *   2. `NO_COLOR` env var (any non-empty value → OFF)
 *   3. `process.stdout.isTTY === false` → OFF
 *   4. Default: ON
 *
 * Note: we deliberately do NOT honor `FORCE_COLOR` — the user mandate
 * only mentions `NO_COLOR`, and the `--color` flag is our native way to
 * force color on (via `setColorForced(true)`).
 */
export function isColorEnabled(): boolean {
  // 1. Forced override (--color / --no-color).
  if (forced !== undefined) {
    return forced;
  }
  // 2. NO_COLOR env var (per https://no-color.org/).
  const noColor = process.env["NO_COLOR"];
  if (noColor !== undefined && noColor !== "") {
    return false;
  }
  // 3. TTY auto-detect: piped stdout (log file, grep, less) → no color.
  //
  // IMPORTANT: we negate the `isTTY` rather than check `=== false`. In
  // Node/Bun, `process.stdout.isTTY` is `undefined` when stdout is
  // redirected to a pipe (e.g. `Bun.spawn({ stdout: "pipe" })`,
  // `cmd | less`, `> file`). Treating `undefined` as "not a TTY" is
  // what we want — the user has redirected output, so the escape codes
  // would corrupt the destination (a log file, a pipe, a JSON consumer).
  if (!process.stdout.isTTY) {
    return false;
  }
  // 4. Default: color on.
  return true;
}

// ============================================================================
// Public API — colorize
// ============================================================================

/**
 * `ColorName` — the subset of picocolors formatters we expose. We don't
 * export the full picocolors `Colors` interface because:
 *   - The CLI only needs a handful of colors (status, success, error,
 *     warning, dim/bold) — exposing all 30+ would invite inconsistency.
 *   - Type-safe color names prevent typos like `colorize(t, "gren")`.
 *   - The wrapper signature `colorize(text, name)` is stable even if
 *     picocolors' internals change.
 */
export type ColorName =
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "gray"
  | "bold"
  | "dim";

/**
 * `colorize` — wrap `text` in ANSI codes for `color`, or return `text`
 * untouched if color is disabled.
 *
 * @param text  The text to colorize.
 * @param color The picocolors formatter to apply.
 * @returns `pc[color](text)` when color is enabled, otherwise `text`.
 *
 * The function is total: it does not throw for unknown colors (TypeScript
 * prevents that at compile time) or when color is disabled.
 *
 * ---------------------------------------------------------------------------
 * WHY `pc.createColors(true)` INSTEAD OF THE DEFAULT `pc.red(...)`?
 * ---------------------------------------------------------------------------
 * The default `pc.red(...)` calls honor `pc.isColorSupported`, which
 * picocolors snapshots ONCE at module-load time (based on `NO_COLOR`
 * and TTY at that moment). If the process started with a piped stdout
 * (e.g. `mm-bot ... | less`), picocolors' snapshot says "no color"
 * and stays that way for the rest of the process — even if the user
 * later sets `--color` to force enable.
 *
 * `pc.createColors(enabled)` returns a fresh `Colors` instance with
 * the `isColorSupported` flag forced to the given value. We use it
 * to honor our own policy (`isColorEnabled()`), so the CLI respects
 * `--color` and `--no-color` regardless of when the picocolors module
 * was first loaded.
 *
 * The cost: one extra closure per call (~10ns). Negligible.
 */
export function colorize(text: string, color: ColorName): string {
  if (!isColorEnabled()) {
    return text;
  }
  // Force-enable picocolors so the override flag works even if picocolors
  // was first loaded with a non-TTY stdout.
  const c = pc.createColors(true);
  switch (color) {
    case "red": {
      return c.red(text);
    }
    case "green": {
      return c.green(text);
    }
    case "yellow": {
      return c.yellow(text);
    }
    case "blue": {
      return c.blue(text);
    }
    case "magenta": {
      return c.magenta(text);
    }
    case "cyan": {
      return c.cyan(text);
    }
    case "gray": {
      return c.gray(text);
    }
    case "bold": {
      return c.bold(text);
    }
    case "dim": {
      return c.dim(text);
    }
  }
}

// ============================================================================
// Convenience: combined badges
// ============================================================================

/**
 * `ok` — green "OK" badge, or plain "OK" when color is off.
 *
 * Used in: `config validate` success, "command succeeded" footers.
 */
export function ok(text = "OK"): string {
  return colorize(text, "green");
}

/**
 * `fail` — red "FAILED" badge, or plain "FAILED" when color is off.
 *
 * Used in: `config validate` failures, runtime error footers.
 */
export function fail(text = "FAILED"): string {
  return colorize(text, "red");
}

/**
 * `warn` — yellow warning text, or plain text when color is off.
 */
export function warn(text: string): string {
  return colorize(text, "yellow");
}

/**
 * `dim` — dim/gray secondary text (e.g. labels, hints), or plain when off.
 */
export function dim(text: string): string {
  return colorize(text, "dim");
}

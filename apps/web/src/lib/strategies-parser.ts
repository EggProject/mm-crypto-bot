/**
 * apps/web/src/lib/strategies-parser.ts
 * Phase 54F: pure helper extracted from App.tsx for the
 * /api/strategies response shape check (unit-testable).
 * The 4-condition chain has 4 defensive branches.
 * Phase 59.1 source map fix: docstring shortened + import
 * type moved below the function. The Vite dev server's
 * source-map generator was collapsing the function into
 * lines 1-16 of the instrumented file (the long docstring
 * + type-only import at lines 1-23 confused the bundler).
 * Moving the type import below the function AND shortening
 * the docstring keeps the function body near the top of
 * the file so the istanbul instrumentation attributes the
 * branches to the correct line numbers.
 *
 * **Phase 59.4 (2026-07-19):** the previous attempt to fix
 * the CT-side source map by moving the import type caused
 * a merge mismatch with the e2e production build. The
 * current state (post-revert) keeps the import type at the
 * top but shortens the docstring. The strategies-parser
 * branches are still attributed to wrong lines (0% in CI)
 * — a structural Vite + istanbul + esbuild source map
 * issue for files with heavy docstrings + type-only imports.
 * Workaround: covered via `serviceWorkers: 'block'` per-test
 * bypass in e2e (Phase 59.2).
 */

import type { StrategyDescriptor } from "../components/ChartGrid.js";

/** Discriminated union result of `parseStrategiesResponse`. */
export type StrategiesResult =
  | { readonly ok: true; readonly strategies: readonly StrategyDescriptor[] }
  | { readonly ok: false; readonly error: string };

/**
 * `parseStrategiesResponse(body)` — validate the shape of a
 * parsed `/api/strategies` JSON body.
 *
 * Expected shape: `{ strategies: StrategyDescriptor[] }`.
 * Anything else (null, primitive, missing key, wrong type
 * for `strategies`) returns `{ ok: false, error: "..." }`.
 */
export function parseStrategiesResponse(body: unknown): StrategiesResult {
  if (body === null) {
    return { ok: false, error: "null body" };
  }
  if (typeof body !== "object") {
    return { ok: false, error: "not an object" };
  }
  if (Array.isArray(body)) {
    return { ok: false, error: "array, not object" };
  }
  const strategies = (body as { strategies?: unknown }).strategies;
  if (!Array.isArray(strategies)) {
    return { ok: false, error: "invalid /api/strategies response shape" };
  }
  return { ok: true, strategies: strategies as readonly StrategyDescriptor[] };
}

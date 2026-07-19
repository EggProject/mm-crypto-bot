/**
 * apps/web/src/lib/strategies-parser.ts
 *
 * Phase 54F: pure helper extracted from `App.tsx` to make the
 * `/api/strategies` response shape check directly unit-testable.
 *
 * The original inline code (in `App.tsx`'s `useEffect`):
 *   if (typeof body === "object" && body !== null &&
 *       "strategies" in body && Array.isArray(body.strategies)) {
 *     setStrategies(body.strategies);
 *   } else {
 *     setStrategiesError("invalid /api/strategies response shape");
 *   }
 *
 * The 4-condition chain has 4 branches. The "null body" branch
 * (typeof null === "object" passes the first check, but the
 * `body !== null` check rejects it) was uncovered in Phase 53C
 * coverage. Extracting to a pure function with explicit early-
 * returns makes each branch a single `return` statement, and
 * the helper is unit-testable without mounting React.
 *
 * **Phase 59.1 source map REVERTED (2026-07-19):** an attempt
 * to fix the Vite dev-server source-map misalignment by moving
 * the `import type` declaration below the function DEFINITELY
 * fixed the CT-side attribution (CT now sees 10/10 stmts,
 * 8/4 branches, 1/1 fns). But the e2e production build (vite
 * build → vite preview) produces a DIFFERENT instrumentation
 * for the modified file: 20 stmts, 8 branches, 2 fns. The merge
 * `map.merge()` in `dashboard.spec.ts` afterAll is a per-file
 * line/branch union, and mismatched source maps between e2e
 * and CT produce broken merges — the defensive parser
 * coverage DROPPED from 100% CT to 30% merged.
 *
 * Reverted: import type goes back to the top of the file (the
 * natural location for the import to live).
 */

import type { StrategyDescriptor } from "../components/ChartGrid.js";

/** Discriminated union result of `parseStrategiesResponse`. */
export type StrategiesResult =
  | { readonly ok: true; readonly strategies: readonly StrategyDescriptor[] }
  | { readonly ok: false; readonly error: string };

/**
 * `parseStrategiesResponse(body)` — validate the shape of a
 * parsed `/api/strategies` JSON body and return either the
 * validated strategies list or a human-readable error string.
 *
 * Expected shape: `{ strategies: StrategyDescriptor[] }`.
 * Anything else (null, primitive, missing key, wrong type for
 * `strategies`) is treated as `{ ok: false, error: "..." }`.
 *
 * Pure: no I/O, no React, no side effects. Unit-testable.
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

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

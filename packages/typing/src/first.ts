import type { NonEmptyArray } from "./typing";

/**
 * Returns the first element of a statically non-empty immutable tuple.
 */
export function first<Value>(values: NonEmptyArray<Value>): Value {
  return values[0];
}

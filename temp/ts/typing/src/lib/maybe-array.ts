/**
 * Represents a value that can be either a single item of type T or an array of T.
 *
 * This utility type is useful for APIs that accept flexible input formats, allowing
 * functions to handle both single values and arrays without requiring separate overloads.
 * It simplifies function signatures while maintaining type safety.
 *
 * @template T - The type of the value or array elements
 */
export type MaybeArray<T> = T | T[];

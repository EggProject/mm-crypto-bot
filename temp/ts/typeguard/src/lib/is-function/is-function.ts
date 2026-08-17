/**
 * Type guard that checks if a value is a function.
 * This includes regular functions, arrow functions, async functions, and class constructors.
 *
 * Uses generics to preserve the original function type from union types,
 * enabling proper type narrowing without explicit type assertions.
 *
 * @param value - The value to check
 * @returns `true` if the value is a function, `false` otherwise
 *
 * @example
 * ```typescript
 * const value: string | ((x: number) => boolean) = ...;
 * if (isFunction(value)) {
 *   // value is now (x: number) => boolean, NOT (...args: unknown[]) => unknown
 *   value(42); // TypeScript knows the signature!
 * }
 * ```
 */
export function isFunction<T>(value: T): value is Extract<T, (...arguments_: never[]) => unknown> {
  return typeof value === 'function';
}

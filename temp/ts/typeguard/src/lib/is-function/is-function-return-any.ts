/**
 * Type guard that checks if a value is a function with an `any` return type.
 * This is similar to `isFunction` but explicitly types the return value as `any`.
 *
 * @param obj - The value to check
 * @returns `true` if the value is a function, `false` otherwise
 */

export function isFunctionReturnAny(object: unknown): object is (...arguments_: never) => never {
  return typeof object === 'function';
}

import { AssertIsFunctionException } from './assert-is-function.exception';
import { isFunction } from '@streamnet/ts-typeguard';

/**
 * Asserts that a value is a function.
 * Throws an AssertIsFunctionException if the value is not a function.
 *
 * Uses generics to preserve the original function type from union types,
 * enabling proper type narrowing without explicit type assertions.
 *
 * This includes regular functions, arrow functions, async functions, generators, and class constructors.
 *
 * @param value - The value to check
 * @param message - Error message to include in the exception if assertion fails
 * @throws {AssertIsFunctionException} When value is not a function
 *
 * @example
 * ```typescript
 * const value: string | ((x: number) => boolean) = ...;
 * assertIsFunction(value, 'Must be a function');
 * // value is now (x: number) => boolean, NOT Function
 * value(42); // TypeScript knows the signature!
 * ```
 */
export function assertIsFunction<T>(
  value: T,
  message: string,
): asserts value is Extract<T, (...arguments_: never[]) => unknown> {
  if (!isFunction(value)) {
    throw new AssertIsFunctionException(message);
  }
}

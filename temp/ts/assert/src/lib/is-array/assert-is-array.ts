import { AssertIsArrayException } from './assert-is-array.exception';

/**
 * Asserts that a value is an array.
 * Throws an AssertIsArrayException if the value is not an array.
 *
 * This function uses Array.isArray() internally for reliable array detection,
 * including arrays from different execution contexts (iframes).
 *
 * @template T - The expected type of array elements
 * @param value - The value to check
 * @param message - Error message to include in the exception if assertion fails
 * @throws {AssertIsArrayException} When value is not an array
 */
export function assertIsArray<T>(value: unknown, message: string): asserts value is T[] {
  if (!Array.isArray(value)) {
    throw new AssertIsArrayException(message);
  }
}

import { AssertIsNotEmptyArrayException } from './assert-is-not-empty-array.exception';
import type { NonEmptyArray } from '@streamnet/ts-typing';

/**
 * Asserts that a value is a non-empty array.
 * Throws an AssertIsNotEmptyArrayException if the value is not an array or is empty.
 *
 * This ensures that the array has at least one element, narrowing the type to NonEmptyArray<T>.
 *
 * @template T - The expected type of array elements
 * @param value - The value to check
 * @param message - Error message to include in the exception if assertion fails
 * @throws {AssertIsNotEmptyArrayException} When value is not an array or is empty
 */
export function assertIsNotEmptyArray<T>(
  value: unknown,
  message: string,
): asserts value is NonEmptyArray<T> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AssertIsNotEmptyArrayException(message);
  }
}

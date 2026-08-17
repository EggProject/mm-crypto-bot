import { AssertIsNotNilException } from './assert-is-not-nil.exception';
import { isNil } from '@streamnet/ts-typeguard';

/**
 * Asserts that a value is not nil (not null and not undefined).
 * Throws an AssertIsNotNilException if the value is null or undefined.
 *
 * @param value - The value to check
 * @param message - Error message to include in the exception if assertion fails
 * @throws {AssertIsNotNilException} When value is null or undefined
 */
export function assertIsNotNil<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (isNil(value)) {
    throw new AssertIsNotNilException(message);
  }
}

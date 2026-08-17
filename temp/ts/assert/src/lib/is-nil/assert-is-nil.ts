import { AssertIsNilException } from './assert-is-nil.exception';
import { isNil } from '@streamnet/ts-typeguard';

/**
 * Asserts that a value is nil (null or undefined).
 * Throws an AssertIsNilException if the value is not null or undefined.
 *
 * @param value - The value to check
 * @param message - Error message to include in the exception if assertion fails
 * @throws {AssertIsNilException} When value is not null or undefined
 */
export function assertIsNil(value: unknown, message: string): asserts value is null | undefined {
  if (!isNil(value)) {
    throw new AssertIsNilException(message);
  }
}

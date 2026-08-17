import { AssertIsStringException } from './assert-is-string.exception';
import { isString } from '@streamnet/ts-typeguard';

/**
 * Asserts that a value is a string.
 * Throws an AssertIsStringException if the value is not a string.
 *
 * This includes all string types: regular strings, empty strings, and template literals.
 *
 * @param value - The value to check
 * @param message - Error message to include in the exception if assertion fails
 * @throws {AssertIsStringException} When value is not a string
 */
export function assertIsString(value: unknown, message: string): asserts value is string {
  if (!isString(value)) {
    throw new AssertIsStringException(message);
  }
}

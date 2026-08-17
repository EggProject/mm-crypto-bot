import { AssertIsIntException } from './assert-is-int.exception';
import { isInt } from '@streamnet/ts-typeguard';

/**
 * Asserts that a value is an integer number.
 * Throws an AssertIsIntException if the value is not an integer.
 *
 * An integer is a whole number without a fractional part.
 * This function rejects NaN, Infinity, floats, and non-numeric values.
 *
 * @param value - The value to check
 * @param message - Error message to include in the exception if assertion fails
 * @throws {AssertIsIntException} When value is not an integer
 */
export function assertIsInt(value: unknown, message: string): asserts value is number {
  if (!isInt(value)) {
    throw new AssertIsIntException(message);
  }
}

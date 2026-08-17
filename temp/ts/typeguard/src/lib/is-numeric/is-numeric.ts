import { isString } from '../is-string/is-string';
import type { NumericString } from '@streamnet/ts-typing';

/**
 * Type guard that checks if a value is a numeric string.
 * A numeric string is a string that can be converted to a valid finite number.
 * This excludes hexadecimal, binary, and octal notation.
 *
 * @param obj - The value to check
 * @returns `true` if the value is a numeric string, `false` otherwise
 */
export function isNumeric(object?: unknown): object is NumericString {
  if (!isString(object)) {
    return false;
  }

  if (object.trim() === '') {
    return false;
  }

  // Reject hexadecimal, binary, and octal notation
  if (/^0[xbo]/i.test(object.trim())) {
    return false;
  }

  const number_ = Number(object);
  return !Number.isNaN(number_) && Number.isFinite(number_);
}

import { isFloat } from '../is-float/is-float';
import { isInt } from '../is-int/is-int';

/**
 * Type guard that checks if a value is a valid number (either integer or float).
 * This excludes NaN and Infinity.
 *
 * @param n - The value to check
 * @returns `true` if the value is a number (integer or float), `false` otherwise
 */
export function isNumber(n?: unknown): n is number {
  return isInt(n) || isFloat(n);
}

import { isInt } from '../is-int/is-int';

/**
 * Type guard that checks if a value is an array of Date objects.
 * Optionally validates that the array has a specific expectedLength.
 *
 * @param dates - The value to check
 * @param expectedLength - Optional expected expectedLength of the array
 * @returns `true` if the value is an array of Date objects (and matches the expectedLength if provided), `false` otherwise
 */
export function isDateArray(dates: unknown, expectedLength?: number): dates is Date[] {
  const isResult = Array.isArray(dates) && dates.every(value => value instanceof Date);

  if (isInt(expectedLength)) {
    return isResult && dates.length === expectedLength;
  }

  return isResult;
}

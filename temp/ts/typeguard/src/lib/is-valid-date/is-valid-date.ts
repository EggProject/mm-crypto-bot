/**
 * Type guard that checks if a value is a valid Date object.
 * Unlike checking for `instanceof Date`, this also verifies that the date is not invalid.
 *
 * @param value - The value to check
 * @returns `true` if the value is a valid Date object, `false` otherwise
 */
export function isValidDate(value?: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

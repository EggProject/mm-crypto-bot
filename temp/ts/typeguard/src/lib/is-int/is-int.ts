/**
 * Type guard that checks if a value is an integer number.
 * An integer is a whole number without a fractional part.
 *
 * @param n - The value to check
 * @returns `true` if the value is an integer, `false` otherwise
 */
export function isInt(n?: unknown): n is number {
  return Number.isSafeInteger(n);
}

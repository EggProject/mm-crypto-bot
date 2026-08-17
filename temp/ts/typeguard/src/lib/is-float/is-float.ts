/**
 * Type guard that checks if a value is a floating-point number.
 * A float is a number that has a fractional part (not an integer).
 *
 * @param n - The value to check
 * @returns `true` if the value is a floating-point number, `false` otherwise
 */
export function isFloat(n?: unknown): n is number {
  return Number(n) === n && Number.isFinite(n as number) && n % 1 !== 0;
}

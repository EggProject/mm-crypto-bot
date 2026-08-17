/**
 * Type guard that checks if a value is a string.
 *
 * @param arg - The value to check
 * @returns `true` if the value is a string, `false` otherwise
 */
export function isString(argument?: unknown): argument is string {
  return typeof argument === 'string';
}

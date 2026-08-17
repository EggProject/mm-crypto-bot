/**
 * Type guard that checks if a value is a boolean.
 *
 * @param obj - The value to check
 * @returns `true` if the value is a boolean, `false` otherwise
 */
export function isBoolean(object?: unknown): object is boolean {
  return typeof object === 'boolean';
}

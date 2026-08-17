/**
 * Type guard that checks if a value is a plain object.
 * This excludes null, arrays, and other special objects.
 *
 * @param item - The value to check
 * @returns `true` if the value is a plain object, `false` otherwise
 */
export function isObject(item?: unknown): item is object {
  return item !== null && !Array.isArray(item) && typeof item === 'object';
}

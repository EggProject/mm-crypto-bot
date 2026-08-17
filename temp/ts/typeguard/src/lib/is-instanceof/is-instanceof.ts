import type { Constructor } from '@streamnet/ts-typing';

/**
 * Type guard that checks if a value is an instance of a specific class or constructor.
 * This is a type-safe wrapper around the `instanceof` operator.
 *
 * @param obj - The value to check
 * @param type - The constructor/class to check against
 * @returns `true` if the value is an instance of the specified type, `false` otherwise
 */
export function isInstanceof<T>(object: unknown, type: Constructor<T>): object is T {
  return object instanceof type;
}

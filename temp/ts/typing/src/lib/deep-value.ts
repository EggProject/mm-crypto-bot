import type { DeepKeys } from './deep-keys';

/**
 * Resolves the value type at a given dot-notation path in T.
 *
 * @example
 * ```typescript
 * interface User { address: { city: string } }
 * type City = DeepValue<User, 'address.city'>; // string
 * ```
 */
export type DeepValue<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? DeepValue<T[Head], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

/**
 * Resolve a nested value from an object using a dot-notation path string.
 * This is the untyped runtime core — use `getDeepValue` for type-safe access.
 *
 * @param source - Source object
 * @param path - Dot-notation path (e.g. 'address.city')
 * @returns The value at the given path, or undefined if any segment is missing
 */
export function resolveNestedPath(source: object, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (current !== null && current !== undefined && typeof current === 'object') {
      current = Reflect.get(current as object, key);
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Type-safe runtime utility to access a nested value using dot-notation path.
 *
 * @param object_ - Source object
 * @param path - Dot-notation path (e.g. 'address.city')
 * @returns The value at the given path, or undefined if any segment is missing
 */
export function getDeepValue<T extends object, P extends DeepKeys<T>>(
  object_: T,
  path: P,
): DeepValue<T, P & string> {
  return resolveNestedPath(object_, path as string) as DeepValue<T, P & string>;
}

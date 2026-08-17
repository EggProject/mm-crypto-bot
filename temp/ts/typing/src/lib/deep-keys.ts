/**
 * Recursively generates dot-notation string union of all nested property paths in T.
 *
 * Stops recursion at:
 * - Depth limit (uses a tuple counter, stops when tuple reaches [0,0,0,0,0])
 * - Arrays, Dates, Functions
 * - Non-object types
 *
 * @example
 * ```typescript
 * interface User {
 *   name: string;
 *   address: { city: string; zip: string };
 * }
 * type Keys = DeepKeys<User>; // 'name' | 'address' | 'address.city' | 'address.zip'
 * ```
 */
export type DeepKeys<T, D extends readonly number[] = []> = D extends [
  number,
  number,
  number,
  number,
  number,
]
  ? never
  : T extends object
    ? T extends readonly unknown[] | Date | ((...arguments_: never[]) => unknown)
      ? never
      : {
          [K in keyof T & string]: K | `${K}.${DeepKeys<T[K], [...D, 0]>}`;
        }[keyof T & string]
    : never;

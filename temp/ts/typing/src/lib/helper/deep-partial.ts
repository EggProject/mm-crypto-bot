/**
 * Recursively makes all properties of a type optional, including nested objects.
 *
 * Unlike TypeScript's built-in `Partial<T>` which only affects the top level,
 * this utility type recursively applies optionality to all nested properties.
 * It preserves functions and arrays as-is, only making object properties optional.
 *
 * @template T - The type to make deeply optional
 *
 * @example
 * ```typescript
 * // Flat object
 * interface User {
 *   id: number;
 *   name: string;
 *   email: string;
 * }
 *
 * type PartialUser = DeepPartial<User>;
 * // Result: { id?: number; name?: string; email?: string }
 *
 * const user: PartialUser = { name: 'Alice' }; // Valid
 * ```
 */
export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? T extends (...arguments_: never[]) => unknown
      ? T
      : { [P in keyof T]?: DeepPartial<T[P]> }
    : T;

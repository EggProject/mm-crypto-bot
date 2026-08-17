/**
 * Represents a value that can be either a static string or a function that resolves to a string.
 *
 * This type is useful for APIs that accept either a direct value or a function that computes
 * the value based on context. Common in configuration, styling, and data transformation.
 *
 * @template T - The type of the item passed to the resolver function
 *
 * @example
 * ```typescript
 * // Direct string value
 * const staticLabel: StringResolver<any> = 'User Name';
 *
 * // Function that resolves to string
 * const dynamicLabel: StringResolver<{ name: string }> = (item) => item.name;
 *
 * function getLabel<T>(item: T, resolver: StringResolver<T>): string {
 *   return typeof resolver === 'function' ? resolver(item) : resolver;
 * }
 * ```
 */
export type StringResolver<T> = string | ((item: T) => string);

/**
 * Represents a value that can be either a static number or a function that resolves to a number.
 *
 * @template T - The type of the item passed to the resolver function
 *
 * @example
 * ```typescript
 * const staticValue: NumberResolver<any> = 42;
 * const dynamicValue: NumberResolver<{ age: number }> = (item) => item.age;
 * ```
 */
export type NumberResolver<T> = number | ((item: T) => number);

/**
 * Represents a value that can be either a static integer or a function that resolves to an integer.
 *
 * Note: TypeScript doesn't have a distinct integer type, so this is semantically the same as
 * NumberResolver but conveys intent for integer values.
 *
 * @template T - The type of the item passed to the resolver function
 *
 * @example
 * ```typescript
 * const staticCount: IntResolver<any> = 10;
 * const dynamicCount: IntResolver<{ items: any[] }> = (item) => item.items.length;
 * ```
 */
export type IntResolver<T> = number | ((item: T) => number);

/**
 * Represents a value that can be either a static float or a function that resolves to a float.
 *
 * Note: TypeScript doesn't distinguish between integer and float types, so this is semantically
 * the same as NumberResolver but conveys intent for floating-point values.
 *
 * @template T - The type of the item passed to the resolver function
 *
 * @example
 * ```typescript
 * const staticPrice: FloatResolver<any> = 99.99;
 * const dynamicPrice: FloatResolver<{ price: number }> = (item) => item.price * 1.2;
 * ```
 */
export type FloatResolver<T> = number | ((item: T) => number);

/**
 * Represents a value that can be either a static boolean or a function that resolves to a boolean.
 *
 * @template T - The type of the item passed to the resolver function
 *
 * @example
 * ```typescript
 * const staticFlag: BooleanResolver<any> = true;
 * const dynamicFlag: BooleanResolver<{ active: boolean }> = (item) => item.active;
 * ```
 */
export type BooleanResolver<T> = boolean | ((item: T) => boolean);

export type ValueResolver<T, R> = R | ((item: T) => R);

/**
 * Represents an array that is guaranteed to contain at least one element.
 *
 * This type ensures compile-time safety for operations that require non-empty arrays,
 * preventing runtime errors when accessing the first element or performing operations
 * that assume the array is not empty.
 *
 * @template T - The type of elements in the array
 *
 * @example
 * ```typescript
 * // Valid: Array with at least one element
 * const validArray: NonEmptyArray<number> = [1, 2, 3];
 * const singleElement: NonEmptyArray<string> = ['hello'];
 *
 * // TypeScript error: Empty array not allowed
 * const invalidArray: NonEmptyArray<number> = [];
 *
 * // Safe access to first element
 * function getFirst<T>(arr: NonEmptyArray<T>): T {
 *   return arr[0]; // Always safe, no undefined check needed
 * }
 *
 * const firstNumber = getFirst([1, 2, 3]); // 1
 * ```
 *
 * @example
 * ```typescript
 * // Use with function parameters
 * function sum(numbers: NonEmptyArray<number>): number {
 *   return numbers.reduce((a, b) => a + b);
 * }
 *
 * sum([5, 10, 15]); // 30
 * // sum([]); // TypeScript error
 * ```
 */
export type NonEmptyArray<T> = [T, ...T[]];

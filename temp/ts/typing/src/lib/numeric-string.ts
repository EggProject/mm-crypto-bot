/**
 * Represents a string that contains a valid numeric value.
 *
 * This type uses TypeScript's template literal types to enforce that a string
 * represents a number at compile time. It's useful for APIs that accept numeric
 * values as strings, query parameters, or form inputs.
 *
 * @example
 * ```typescript
 * // Valid: Strings that represent numbers
 * const integer: NumericString = '42';
 * const negative: NumericString = '-10';
 * const decimal: NumericString = '3.14159';
 * const exponential: NumericString = '1e10';
 * const zero: NumericString = '0';
 *
 * // TypeScript error: Non-numeric strings
 * const invalid: NumericString = 'hello'; // Error
 * const empty: NumericString = ''; // Error
 * const withUnit: NumericString = '42px'; // Error
 * ```
 *
 * @example
 * ```typescript
 * // Use in function parameters
 * function parsePrice(price: NumericString): number {
 *   return parseFloat(price);
 * }
 *
 * const total = parsePrice('99.99'); // 99.99
 * const quantity = parsePrice('5'); // 5
 * ```
 *
 * @example
 * ```typescript
 * // Use with API query parameters
 * interface SearchParams {
 *   page: NumericString;
 *   limit: NumericString;
 *   minPrice?: NumericString;
 * }
 *
 * const params: SearchParams = {
 *   page: '1',
 *   limit: '20',
 *   minPrice: '10.50'
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Type guard for runtime validation
 * function isNumericString(value: string): value is NumericString {
 *   return !isNaN(Number(value)) && value.trim() !== '';
 * }
 *
 * const input = '42';
 * if (isNumericString(input)) {
 *   const num = Number(input); // Safe to convert
 * }
 * ```
 */
export type NumericString = `${number}`;

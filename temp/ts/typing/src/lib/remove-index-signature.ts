/**
 * Removes index signatures from a type, keeping only explicitly defined properties.
 *
 * This utility type filters out index signatures ([key: string]: any or [key: number]: any)
 * from a type, preserving only the named properties. It's useful when you want to work
 * with known properties without the dynamic index signature interfering with type operations.
 *
 * @template T - The type to remove index signatures from
 *
 * @example
 * ```typescript
 * // Basic usage with string index signature
 * interface Config {
 *   apiUrl: string;
 *   timeout: number;
 *   [key: string]: any; // Index signature
 * }
 *
 * type StrictConfig = RemoveIndexSignature<Config>;
 * // Result: { apiUrl: string; timeout: number }
 * // Index signature is removed
 *
 * const config: StrictConfig = {
 *   apiUrl: 'https://api.example.com',
 *   timeout: 5000,
 *   // dynamicProp: 'value', // Error: not allowed
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Working with Record types
 * interface ApiResponse {
 *   status: number;
 *   message: string;
 *   [key: string]: unknown;
 * }
 *
 * type KnownFields = RemoveIndexSignature<ApiResponse>;
 * // Result: { status: number; message: string }
 *
 * function validateResponse(response: ApiResponse): boolean {
 *   const known: KnownFields = {
 *     status: response.status,
 *     message: response.message,
 *   };
 *   return known.status === 200;
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Extract known properties for type-safe operations
 * interface DynamicObject {
 *   id: number;
 *   name: string;
 *   type: 'user' | 'admin';
 *   [key: string]: any;
 * }
 *
 * type StaticProps = RemoveIndexSignature<DynamicObject>;
 * // Result: { id: number; name: string; type: 'user' | 'admin' }
 *
 * function getStaticProps(obj: DynamicObject): StaticProps {
 *   return {
 *     id: obj.id,
 *     name: obj.name,
 *     type: obj.type,
 *   };
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Use with keyof to get only named keys
 * interface FlexibleData {
 *   version: string;
 *   timestamp: Date;
 *   [key: string]: any;
 * }
 *
 * type KnownKeys = keyof RemoveIndexSignature<FlexibleData>;
 * // Result: 'version' | 'timestamp'
 *
 * const keys: KnownKeys[] = ['version', 'timestamp'];
 * // 'randomKey' would cause an error
 * ```
 *
 * @example
 * ```typescript
 * // Handle numeric index signatures
 * interface ArrayLike {
 *   length: number;
 *   [index: number]: string;
 * }
 *
 * type ArrayLikeProps = RemoveIndexSignature<ArrayLike>;
 * // Result: { length: number }
 * // Numeric index signature is removed
 *
 * const props: ArrayLikeProps = {
 *   length: 3,
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Combine with Pick for strict property selection
 * interface MixedObject {
 *   id: number;
 *   name: string;
 *   tags: string[];
 *   [key: string]: any;
 * }
 *
 * type StrictPick<T, K extends keyof RemoveIndexSignature<T>> =
 *   Pick<RemoveIndexSignature<T>, K>;
 *
 * type NameOnly = StrictPick<MixedObject, 'name'>;
 * // Result: { name: string }
 * ```
 */
export type RemoveIndexSignature<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

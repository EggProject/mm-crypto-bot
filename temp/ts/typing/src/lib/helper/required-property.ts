/**
 * Makes specific properties of a type required while keeping the rest unchanged.
 *
 * This utility type takes a base type T and a set of keys K, and returns a new type
 * where the specified properties are required (non-optional), while all other properties
 * retain their original optionality. The `-?` modifier removes the optional flag.
 *
 * @template T - The base type to modify
 * @template K - The keys of T to make required
 *
 * @example
 * ```typescript
 * // Define an interface with optional properties
 * interface User {
 *   id: number;
 *   name?: string;
 *   email?: string;
 *   age?: number;
 * }
 *
 * // Make specific properties required
 * type UserWithRequiredName = RequiredProperty<User, 'name'>;
 * // Result: { id: number; name: string; email?: string; age?: number }
 *
 * const user: UserWithRequiredName = {
 *   id: 1,
 *   name: 'Alice', // Now required
 *   // email is still optional
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Make multiple properties required
 * interface Product {
 *   id: number;
 *   title?: string;
 *   description?: string;
 *   price?: number;
 *   category?: string;
 * }
 *
 * type ProductForm = RequiredProperty<Product, 'title' | 'price'>;
 * // Result: { id: number; title: string; price: number; description?: string; category?: string }
 *
 * const product: ProductForm = {
 *   id: 1,
 *   title: 'Laptop',
 *   price: 999.99,
 *   // description and category are still optional
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Use in function parameters
 * interface Config {
 *   apiUrl?: string;
 *   timeout?: number;
 *   retries?: number;
 *   debug?: boolean;
 * }
 *
 * function initializeApi(config: RequiredProperty<Config, 'apiUrl'>): void {
 *   console.log(`Connecting to ${config.apiUrl}`);
 *   const timeout = config.timeout ?? 5000;
 *   const retries = config.retries ?? 3;
 * }
 *
 * // apiUrl is now required
 * initializeApi({ apiUrl: 'https://api.example.com' });
 * ```
 *
 * @example
 * ```typescript
 * // Gradual type strengthening
 * interface Draft {
 *   title?: string;
 *   content?: string;
 *   author?: string;
 *   publishedAt?: Date;
 * }
 *
 * type ReadyToPublish = RequiredProperty<Draft, 'title' | 'content' | 'author'>;
 * type Published = RequiredProperty<ReadyToPublish, 'publishedAt'>;
 *
 * function publish(draft: ReadyToPublish): Published {
 *   return { ...draft, publishedAt: new Date() };
 * }
 * ```
 */
export type RequiredProperty<T, K extends keyof T> = T & { [P in K]-?: T[P] };

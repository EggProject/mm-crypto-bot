/**
 * Converts optional properties (T | undefined) to nullable properties (T | null).
 *
 * This utility type transforms all properties that can be undefined into properties
 * that can be null instead. All properties become required (non-optional), and their
 * undefined values are replaced with null. This is useful when working with APIs
 * that prefer explicit null values over undefined.
 *
 * @template T - The type whose optional properties should be converted to nullable
 *
 * @example
 * ```typescript
 * // Basic conversion
 * interface User {
 *   id: number;
 *   name?: string;
 *   email?: string;
 *   age: number;
 * }
 *
 * type NullableUser = OptionalToNullable<User>;
 * // Result: { id: number; name: string | null; email: string | null; age: number }
 *
 * const user: NullableUser = {
 *   id: 1,
 *   name: 'Alice',
 *   email: null, // Must use null instead of leaving it out
 *   age: 30,
 * };
 * ```
 *
 * @example
 * ```typescript
 * // API request/response handling
 * interface ApiRequest {
 *   userId: number;
 *   filter?: string;
 *   sortBy?: string;
 *   limit?: number;
 * }
 *
 * type NullableApiRequest = OptionalToNullable<ApiRequest>;
 *
 * const request: NullableApiRequest = {
 *   userId: 123,
 *   filter: null,
 *   sortBy: 'name',
 *   limit: null,
 * };
 *
 * // Useful for JSON serialization where undefined is problematic
 * const json = JSON.stringify(request);
 * ```
 *
 * @example
 * ```typescript
 * // Database models
 * interface UserInput {
 *   username: string;
 *   bio?: string;
 *   website?: string;
 *   company?: string;
 * }
 *
 * type UserRecord = OptionalToNullable<UserInput>;
 *
 * function createUser(input: UserInput): UserRecord {
 *   return {
 *     username: input.username,
 *     bio: input.bio ?? null,
 *     website: input.website ?? null,
 *     company: input.company ?? null,
 *   };
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Form data normalization
 * interface FormData {
 *   title: string;
 *   description?: string;
 *   tags?: string[];
 *   publishedAt?: Date;
 * }
 *
 * function normalizeForm(data: FormData): OptionalToNullable<FormData> {
 *   return {
 *     title: data.title,
 *     description: data.description ?? null,
 *     tags: data.tags ?? null,
 *     publishedAt: data.publishedAt ?? null,
 *   };
 * }
 * ```
 */
export type OptionalToNullable<T> = {
  [K in keyof T]-?: T[K] extends infer U | undefined
    ? U extends undefined
      ? null
      : U | null
    : never;
};

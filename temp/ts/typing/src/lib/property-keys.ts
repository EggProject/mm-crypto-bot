/**
 * Extracts the keys of non-function properties from a type.
 *
 * This utility type filters out all method/function properties and returns
 * a union of keys that correspond to data properties only. It's the opposite
 * of FunctionPropertyNames and is useful for distinguishing data from behavior.
 *
 * @template T - The type to extract property keys from
 *
 * @example
 * ```typescript
 * // Basic usage
 * class User {
 *   id: number;
 *   name: string;
 *   email: string;
 *
 *   constructor(id: number, name: string, email: string) {
 *     this.id = id;
 *     this.name = name;
 *     this.email = email;
 *   }
 *
 *   getName(): string {
 *     return this.name;
 *   }
 *
 *   setEmail(email: string): void {
 *     this.email = email;
 *   }
 * }
 *
 * type UserProps = PropertyKeys<User>;
 * // Result: 'id' | 'name' | 'email'
 * // Methods getName and setEmail are excluded
 * ```
 *
 * @example
 * ```typescript
 * // Use in serialization
 * interface Product {
 *   id: number;
 *   title: string;
 *   price: number;
 *   getDisplayPrice(): string;
 *   updatePrice(newPrice: number): void;
 * }
 *
 * type ProductData = PropertyKeys<Product>;
 * // Result: 'id' | 'title' | 'price'
 *
 * function serialize<T>(obj: T, keys: PropertyKeys<T>[]): Partial<T> {
 *   const result: any = {};
 *   for (const key of keys) {
 *     result[key] = obj[key];
 *   }
 *   return result;
 * }
 *
 * const product: Product = {
 *   id: 1,
 *   title: 'Laptop',
 *   price: 999,
 *   getDisplayPrice: () => '$999',
 *   updatePrice: () => {},
 * };
 *
 * const data = serialize(product, ['id', 'title', 'price']);
 * ```
 *
 * @example
 * ```typescript
 * // Extract data for cloning
 * interface State {
 *   count: number;
 *   items: string[];
 *   timestamp: Date;
 *   increment(): void;
 *   reset(): void;
 * }
 *
 * type StateData = PropertyKeys<State>;
 * // Result: 'count' | 'items' | 'timestamp'
 *
 * function cloneState<T>(state: T): Pick<T, PropertyKeys<T>> {
 *   const keys = Object.keys(state).filter(
 *     (key) => typeof state[key as keyof T] !== 'function'
 *   ) as PropertyKeys<T>[];
 *
 *   const result: any = {};
 *   for (const key of keys) {
 *     result[key] = state[key];
 *   }
 *   return result;
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Use in form field generation
 * interface FormModel {
 *   firstName: string;
 *   lastName: string;
 *   age: number;
 *   validate(): boolean;
 *   submit(): Promise<void>;
 * }
 *
 * type FormFields = PropertyKeys<FormModel>;
 * // Result: 'firstName' | 'lastName' | 'age'
 *
 * const fields: FormFields[] = ['firstName', 'lastName', 'age'];
 * // Can iterate over data fields without methods
 * ```
 *
 * @example
 * ```typescript
 * // Distinguish data from behavior in DTOs
 * class UserDto {
 *   username: string;
 *   email: string;
 *   createdAt: Date;
 *
 *   constructor(data: Pick<UserDto, PropertyKeys<UserDto>>) {
 *     this.username = data.username;
 *     this.email = data.email;
 *     this.createdAt = data.createdAt;
 *   }
 *
 *   toJSON(): object {
 *     return {
 *       username: this.username,
 *       email: this.email,
 *       createdAt: this.createdAt,
 *     };
 *   }
 * }
 * ```
 */
export type PropertyKeys<T> = {
  [K in keyof T]: T[K] extends (...arguments_: never[]) => unknown ? never : K;
}[keyof T];

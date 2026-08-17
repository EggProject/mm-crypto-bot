/**
 * Represents a constructor function type that creates instances of type T.
 *
 * This type is useful for working with class constructors in a type-safe manner,
 * particularly in factory patterns, dependency injection, and generic class handling.
 *
 * @template T - The type of instance that the constructor creates
 *
 * @example
 * ```typescript
 * // Basic usage with classes
 * class User {
 *   constructor(public name: string, public age: number) {}
 * }
 *
 * const UserConstructor: Constructor<User> = User;
 * const user = new UserConstructor('Alice', 30);
 * console.log(user.name); // 'Alice'
 * ```
 *
 * @example
 * ```typescript
 * // Factory function pattern
 * function createInstance<T>(ctor: Constructor<T>, ...args: any[]): T {
 *   return new ctor(...args);
 * }
 *
 * class Product {
 *   constructor(public id: number, public name: string) {}
 * }
 *
 * const product = createInstance(Product, 1, 'Laptop');
 * console.log(product.name); // 'Laptop'
 * ```
 *
 * @example
 * ```typescript
 * // Dependency injection container
 * class Container {
 *   private instances = new Map<Constructor<any>, any>();
 *
 *   register<T>(ctor: Constructor<T>, instance: T): void {
 *     this.instances.set(ctor, instance);
 *   }
 *
 *   resolve<T>(ctor: Constructor<T>): T {
 *     return this.instances.get(ctor);
 *   }
 * }
 *
 * const container = new Container();
 * container.register(User, new User('Bob', 25));
 * const user = container.resolve(User);
 * ```
 *
 * @example
 * ```typescript
 * // Mixin pattern
 * function applyMixins<T>(targetCtor: Constructor<T>, ...mixins: Constructor<any>[]): void {
 *   mixins.forEach(mixin => {
 *     Object.getOwnPropertyNames(mixin.prototype).forEach(name => {
 *       Object.defineProperty(
 *         targetCtor.prototype,
 *         name,
 *         Object.getOwnPropertyDescriptor(mixin.prototype, name) || Object.create(null)
 *       );
 *     });
 *   });
 * }
 * ```
 */
export type Constructor<T> = new (...arguments_: never[]) => T;

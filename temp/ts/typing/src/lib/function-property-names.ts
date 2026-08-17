/**
 * Represents a utility type that extracts the property names of a given type `T`
 * which are functions.
 *
 * @template T The target type from which to extract function property names.
 *
 * This type maps over all keys of `T`, verifying if the property associated with each key
 * is a function type (a callable property). If the property is a function, it retains the key;
 * otherwise, it outputs `never`. The resulting mapped type is then indexed to produce a union of
 * all function property names in the target `T`.
 */
export type FunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends (...arguments_: never[]) => unknown ? K : never;
}[keyof T];

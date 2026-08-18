/**
 * A class constructor usable by guards and dependency injection ports.
 */
export type Constructor<Instance, Arguments extends unknown[] = never[]> = new (
  ...arguments_: Arguments
) => Instance;

/**
 * Recursively makes object properties optional while preserving arrays and functions.
 */
export type DeepPartial<Value> = Value extends (infer Item)[]
  ? DeepPartial<Item>[]
  : Value extends readonly (infer Item)[]
    ? readonly DeepPartial<Item>[]
    : Value extends (...arguments_: never[]) => unknown
      ? Value
      : Value extends object
        ? { [Key in keyof Value]?: DeepPartial<Value[Key]> }
        : Value;

/**
 * A value accepted either once or as an immutable list.
 */
export type MaybeArray<Value> = Value | readonly Value[];

/**
 * An immutable tuple with at least one element.
 */
export type NonEmptyArray<Value> = readonly [Value, ...Value[]];

/**
 * Makes selected properties required without changing the remaining keys.
 */
export type RequiredProperty<Value, Key extends keyof Value> = Omit<Value, Key> & Required<Pick<Value, Key>>;

/**
 * Removes broad string and number index signatures while keeping declared keys.
 */
export type RemoveIndexSignature<Value> = {
  [Key in keyof Value as string extends Key ? never : number extends Key ? never : Key]: Value[Key];
};

/**
 * A constant result or a deterministic resolver for one subject.
 */
export type ValueResolver<Subject, Result> = Result | ((subject: Subject) => Result);

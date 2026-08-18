import type { Constructor, NonEmptyArray } from "@mm-crypto-bot/typing";

export type UnknownRecord = Record<string, unknown>;

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value);
}

export function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function isFunction(value: unknown): value is (...arguments_: never[]) => unknown {
  return typeof value === "function";
}

export function isConstructor(value: unknown): value is Constructor<unknown> {
  if (typeof value !== "function") return false;

  try {
    Reflect.construct(Function, [], value);
    return true;
  } catch {
    return false;
  }
}

export function isInstanceOf<Instance>(
  value: unknown,
  constructor_: Constructor<Instance>,
): value is Instance {
  return value instanceof constructor_;
}

export function isDate(value: unknown): value is Date {
  if (typeof value !== "object" || value === null) return false;

  try {
    const timestamp: unknown = Date.prototype.getTime.call(value);
    return typeof timestamp === "number" && Number.isFinite(timestamp);
  } catch {
    return false;
  }
}

export function isNonEmptyArray(value: unknown): value is NonEmptyArray<unknown> {
  return Array.isArray(value) && value.length > 0;
}

import type { NonEmptyArray } from "@mm-crypto-bot/typing";
import { isInteger, isNil, isNonEmptyArray, isRecord, isString } from "@mm-crypto-bot/typeguard";

export type AssertionCode = "defined" | "integer" | "non-empty-array" | "record" | "string";

export class AssertionError extends Error {
  public constructor(
    readonly code: AssertionCode,
    message: string,
  ) {
    super(message);
    this.name = "AssertionError";
  }
}

function fail(code: AssertionCode, message: string): never {
  throw new AssertionError(code, message);
}

export function assertDefined<Value>(value: Value, message: string): asserts value is NonNullable<Value> {
  if (isNil(value)) fail("defined", message);
}

export function assertInteger(value: unknown, message: string): asserts value is number {
  if (!isInteger(value)) fail("integer", message);
}

export function assertNonEmptyArray(
  value: unknown,
  message: string,
): asserts value is NonEmptyArray<unknown> {
  if (!isNonEmptyArray(value)) fail("non-empty-array", message);
}

export function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail("record", message);
}

export function assertString(value: unknown, message: string): asserts value is string {
  if (!isString(value)) fail("string", message);
}

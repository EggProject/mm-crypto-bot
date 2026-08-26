import { ExactRational, type ExactRationalSnapshot } from "@mm-crypto-bot/numeric";

import type { HistoricalPositionSide } from "./exact-historical-market-data-contracts.js";

export function fail(message: string): never {
  throw new Error(`Invalid exact historical market data: ${message}`);
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  try {
    const prototype = Reflect.getPrototypeOf(input);
    return prototype === null || prototype === Object.prototype;
  } catch {
    return false;
  }
}

function hasExactDataKeys(input: Record<string, unknown>, keys: readonly string[]): boolean {
  try {
    const actualKeys = Reflect.ownKeys(input);
    if (actualKeys.length !== keys.length) return false;
    return actualKeys.every((key) => {
      if (!keys.includes(String(key))) return false;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      return (
        descriptor?.enumerable === true &&
        Object.hasOwn(descriptor, "value") &&
        descriptor.get === undefined &&
        descriptor.set === undefined
      );
    });
  } catch {
    return false;
  }
}

export function requireRecord(
  input: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isPlainRecord(input) || !hasExactDataKeys(input, keys)) return fail(`${label} has an invalid shape.`);
  return input;
}

export function requireString(input: unknown, label: string): string {
  if (typeof input !== "string") return fail(`${label} must be a string.`);
  return input;
}

export function requireSymbol(input: unknown): string {
  const symbol = requireString(input, "symbol");
  if (symbol.length === 0 || symbol.trim() !== symbol)
    return fail("symbol must be a nonempty trimmed string.");
  return symbol;
}

export function requireSide(input: unknown): HistoricalPositionSide {
  if (input === "long" || input === "short") return input;
  return fail("side must be long or short.");
}

export function requireRational(input: ExactRational, label: string): ExactRational {
  try {
    input.toSnapshot();
    return input;
  } catch {
    return fail(`${label} must be an intact ExactRational.`);
  }
}

export function requireNonNegative(input: ExactRational, label: string): ExactRational {
  if (input.isNegative()) return fail(`${label} must be non-negative.`);
  return input;
}

export function requirePositive(input: ExactRational, label: string): ExactRational {
  if (input.isNegative() || input.isZero()) return fail(`${label} must be positive.`);
  return input;
}

export function rationalFromSnapshot(input: unknown, label: string): ExactRational {
  try {
    return ExactRational.fromSnapshot(input);
  } catch {
    return fail(`${label} is not an exact rational snapshot.`);
  }
}

export function snapshotRational(input: ExactRational): ExactRationalSnapshot {
  return input.toSnapshot();
}

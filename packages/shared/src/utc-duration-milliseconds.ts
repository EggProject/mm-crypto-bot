import { MAXIMUM_CANONICAL_DECIMAL_LENGTH } from "@mm-crypto-bot/numeric";

import type { UtcDurationMillisecondsSnapshot } from "./exact-historical-market-data-contracts.js";
import { fail, requireRecord } from "./exact-historical-market-data-validation.js";

export class UtcDurationMilliseconds {
  public static fromCanonical(input: unknown): UtcDurationMilliseconds {
    if (
      typeof input !== "string" ||
      input === "-0" ||
      input.length === 0 ||
      input.length > MAXIMUM_CANONICAL_DECIMAL_LENGTH ||
      !/^-?(?:0|[1-9][0-9]*)$/u.test(input)
    ) {
      return fail("UTC duration milliseconds must be a canonical integer string.");
    }
    return new UtcDurationMilliseconds(BigInt(input));
  }

  public static fromSnapshot(input: unknown): UtcDurationMilliseconds {
    const record = requireRecord(input, ["schema", "value"], "UTC duration snapshot");
    if (record["schema"] !== "utc-duration-milliseconds@1")
      return fail("UTC duration snapshot schema is unsupported.");
    return this.fromCanonical(record["value"]);
  }

  readonly #value: bigint;

  private constructor(value: bigint) {
    this.#value = value;
    Object.freeze(this);
  }

  public equals(other: unknown): boolean {
    return other instanceof UtcDurationMilliseconds && this.#value === other.#value;
  }

  public toBigInt(): bigint {
    return this.#value;
  }

  public toCanonical(): string {
    return this.#value.toString();
  }

  public toSnapshot(): UtcDurationMillisecondsSnapshot {
    return Object.freeze({ schema: "utc-duration-milliseconds@1" as const, value: this.toCanonical() });
  }
}

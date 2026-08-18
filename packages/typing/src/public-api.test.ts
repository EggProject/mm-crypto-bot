import { describe, expect, expectTypeOf, it } from "vitest";

import { first } from "@mm-crypto-bot/typing";
import type { NonEmptyArray } from "@mm-crypto-bot/typing";

const internalSubpath = "@mm-crypto-bot/typing/src/typing";

describe("typing public API", () => {
  it("exposes the public barrel without requiring a source-tree import", () => {
    const values: NonEmptyArray<number> = [7, 11];

    expect(first(values)).toBe(7);
    expectTypeOf(first(values)).toEqualTypeOf<number>();
  });

  it("rejects a physical internal subpath outside the export map", async () => {
    await expect(import("@mm-crypto-bot/typing")).resolves.toHaveProperty("first");
    await expect(import(internalSubpath)).rejects.toThrow();
  });
});

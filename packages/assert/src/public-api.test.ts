import { describe, expect, it } from "vitest";

import { assertString } from "@mm-crypto-bot/assert";

const internalSubpath = "@mm-crypto-bot/assert/src/index";

describe("assert public API", () => {
  it("exports assertions and rejects physical deep imports", async () => {
    expect(() => {
      assertString("value", "text required");
    }).not.toThrow();
    await expect(import("@mm-crypto-bot/assert")).resolves.toHaveProperty("assertString");
    await expect(import(internalSubpath)).rejects.toThrow();
  });
});

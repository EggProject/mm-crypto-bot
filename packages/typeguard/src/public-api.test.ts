import { describe, expect, it } from "vitest";

import { isString } from "@mm-crypto-bot/typeguard";

const internalSubpath = "@mm-crypto-bot/typeguard/src/index";

describe("typeguard public API", () => {
  it("exports the guard barrel and rejects physical deep imports", async () => {
    expect(isString("value")).toBe(true);
    await expect(import("@mm-crypto-bot/typeguard")).resolves.toHaveProperty("isString");
    await expect(import(internalSubpath)).rejects.toThrow();
  });
});

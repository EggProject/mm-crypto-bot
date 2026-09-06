import { describe, expect, it } from "bun:test";

import { ClientOrderIdError, makeClientOrderId } from "./client-order-id.js";

describe("makeClientOrderId", () => {
  it.each(["A", "Order-1_under-score", "x".repeat(36)])(
    "preserves a canonical opaque identifier",
    (identifier) => {
      expect(makeClientOrderId(identifier)).toBe(identifier);
    },
  );

  it.each([
    ["", "1 to 36 characters"],
    ["id with space", "only ASCII letters"],
    ["id/with-slash", "only ASCII letters"],
    ["café", "only ASCII letters"],
    ["x".repeat(37), "1 to 36 characters"],
    [42, "must be a string"],
  ])("rejects an invalid client order identifier", (value, message) => {
    expect(() => makeClientOrderId(value)).toThrow(ClientOrderIdError);
    expect(() => makeClientOrderId(value)).toThrow(message);
  });
});

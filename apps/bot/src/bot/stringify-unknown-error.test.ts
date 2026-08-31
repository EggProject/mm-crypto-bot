import { describe, expect, it } from "vitest";

import { stringifyUnknownError } from "./stringify-unknown-error.js";

class ForeignFault {
  public toString(): string {
    return "injected foreign fault";
  }
}

describe("stringifyUnknownError", () => {
  it("preserves Error diagnostics and stringifies typed foreign faults", () => {
    expect(stringifyUnknownError(new Error("simulator failed"))).toBe("Error: simulator failed");
    expect(stringifyUnknownError(new ForeignFault())).toBe("injected foreign fault");
  });
});

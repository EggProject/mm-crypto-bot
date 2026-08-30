import { describe, expect, it } from "vitest";
import "./index.js";

const packageDirectoryName = process.cwd().split("/").at(-1) ?? "shared";

describe(`${packageDirectoryName} scaffold`, () => {
  it("loads", () => {
    expect(1 + 1).toBe(2);
  });
});

/**
 * Scaffold-stage placeholder test.
 */
import { describe, expect, it } from "bun:test";
import "./index.js";

const packageDirectoryName = process.cwd().split("/").at(-1) ?? "unknown-package";

describe(`${packageDirectoryName} scaffold`, () => {
  it("loads", () => {
    expect(1 + 1).toBe(2);
  });
});

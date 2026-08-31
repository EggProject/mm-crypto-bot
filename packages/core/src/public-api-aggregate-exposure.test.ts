import { describe, expect, it } from "bun:test";
import * as core from "./index.js";
import { MAX_ALLOWED_PLUGIN_AGGREGATE_EFFECTIVE_LEVERAGE } from "./index.js";

describe("core public API aggregate effective-exposure limit", () => {
  it("exports the canonical plugin aggregate effective-exposure limit", () => {
    expect(MAX_ALLOWED_PLUGIN_AGGREGATE_EFFECTIVE_LEVERAGE).toBe(10);
    expect(Reflect.has(core, "MAX_ALLOWED_PLUGIN_LEVERAGE")).toBeFalse();
  });
});

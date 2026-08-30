import { describe, expect, it } from "bun:test";
import { createStrategy } from "./index.js";
import "./index.js";

describe("core scaffold", () => {
  it("loads", () => {
    expect(1 + 1).toBe(2);
  });

  it("createStrategy factory returns the default Donchian-Pivot Composition strategy", () => {
    const strategy = createStrategy();
    expect(strategy).toBeDefined();
    expect(typeof strategy.onCandle).toBe("function");
    expect(typeof strategy.warmup).toBe("function");
    expect(typeof strategy.name).toBe("string");
  });
});

import { describe, expect, it } from "vitest";

import { DEFAULT_LATENCY_GATE_DISABLED, createLatencyGate } from "./multi-class-ensemble.js";

describe("multi-class ensemble latency gates", () => {
  it("allows only latency at or below the configured public threshold", () => {
    const allowed = createLatencyGate(
      { pair: "bybit-eu-dydx-btc", roundTripMsMax: 500, sourceJsonPath: "latency.json" },
      500,
    );
    const blocked = createLatencyGate(
      { pair: "bybit-eu-dydx-btc", roundTripMsMax: 501, sourceJsonPath: "latency.json" },
      500,
    );

    expect(allowed.isCarryAllowed()).toBe(true);
    expect(blocked.isCarryAllowed()).toBe(false);
    expect(DEFAULT_LATENCY_GATE_DISABLED.isCarryAllowed()).toBe(true);
  });
});

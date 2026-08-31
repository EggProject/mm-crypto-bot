import { describe, expect, it } from "vitest";

import { RecordingLogger } from "@logging-testing";

import { KillSwitchRegistry, MaxDrawdownKillSwitch } from "./kill-switches.js";

describe("KillSwitchRegistry fault boundaries", () => {
  it("retains its drawdown state for invalid equity and records callback failures", async () => {
    const logger = new RecordingLogger();
    const drawdown = new MaxDrawdownKillSwitch({ maxDrawdownPct: 0.1, initialEquity: 100 });
    const registry = new KillSwitchRegistry({ switches: [drawdown], logger });
    registry.updateEquity(-1);
    registry.updateEquity(NaN);
    expect(drawdown.evaluate().engaged).toBe(false);

    registry.onTrigger(() => {
      throw new Error("shutdown callback failed");
    });
    registry.updateEquity(80);
    expect(registry.evaluate().engaged).toBe(true);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(logger.getCalls().some((call) => call.event === "risk.killswitch.callback.failed")).toBe(true);
  });

  it("records a trigger callback Error as structured text", async () => {
    const logger = new RecordingLogger();
    const registry = new KillSwitchRegistry({
      switches: [new MaxDrawdownKillSwitch({ maxDrawdownPct: 0.1, initialEquity: 100 })],
      logger,
    });
    registry.onTrigger(() => {
      throw new Error("shutdown callback failed");
    });

    registry.updateEquity(80);
    registry.evaluate();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(logger.getCalls()).toContainEqual({
      level: "error",
      event: "risk.killswitch.callback.failed",
      fields: { error: "shutdown callback failed" },
    });
  });

  it("does not calculate drawdown before a positive peak exists", () => {
    const drawdown = new MaxDrawdownKillSwitch({ maxDrawdownPct: 0.1, initialEquity: 0 });

    expect(drawdown.evaluate()).toMatchObject({ engaged: false, reason: "no peak yet" });
  });
});

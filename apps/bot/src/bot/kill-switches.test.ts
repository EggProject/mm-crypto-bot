/**
 * apps/bot/src/bot/kill-switches.test.ts
 *
 * A `KillSwitchRegistry` és a beépített kill-switchek unit tesztjei.
 */

import { describe, expect, it } from "bun:test";
import { asSymbol, type Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";

import { PositionManager } from "./position-manager.js";
import {
  KillSwitchRegistry,
  LatencyGateKillSwitch,
  MaxDrawdownKillSwitch,
  MaxPositionsKillSwitch,
  PerStrategyKillSwitch,
  _rebrandSymbolString,
  createDefaultRegistry,
} from "./kill-switches.js";

function makeSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
}

describe("MaxDrawdownKillSwitch", () => {
  it("engages when drawdown >= max", () => {
    const sw = new MaxDrawdownKillSwitch({ maxDrawdownPct: 0.15, initialEquity: 10_000 });
    sw.updateEquity(10_000); // peak = 10_000
    sw.updateEquity(8_000); // drawdown 20% > 15%
    const v = sw.evaluate();
    expect(v.engaged).toBe(true);
    expect(v.switchId).toBe("max-drawdown");
  });

  it("does not engage when drawdown < max", () => {
    const sw = new MaxDrawdownKillSwitch({ maxDrawdownPct: 0.15, initialEquity: 10_000 });
    sw.updateEquity(10_000);
    sw.updateEquity(9_000); // 10% drawdown
    const v = sw.evaluate();
    expect(v.engaged).toBe(false);
  });

  it("peak follows equity upward", () => {
    const sw = new MaxDrawdownKillSwitch({ maxDrawdownPct: 0.15, initialEquity: 10_000 });
    sw.updateEquity(12_000);
    sw.updateEquity(10_200); // 15% drawdown from peak
    const v = sw.evaluate();
    expect(v.engaged).toBe(true);
  });
});

describe("MaxPositionsKillSwitch", () => {
  it("engages when positionCount >= maxPositions", () => {
    const pm = new PositionManager({
      initialEquityUsd: 1_000_000,
      maxPositions: 2,
      maxLeverage: 1,
    });
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 1);
    pm.openPosition(
      "strategy-b",
      asSymbol("ETH/USDC") as unknown as ExchangeSymbol,
      "long",
      0.01,
      3_000,
      1,
    );
    const sw = new MaxPositionsKillSwitch({ positionManager: pm });
    const v = sw.evaluate();
    expect(v.engaged).toBe(true);
  });

  it("does not engage when below max", () => {
    const pm = new PositionManager({
      initialEquityUsd: 1_000_000,
      maxPositions: 3,
      maxLeverage: 1,
    });
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 1);
    const sw = new MaxPositionsKillSwitch({ positionManager: pm });
    const v = sw.evaluate();
    expect(v.engaged).toBe(false);
  });
});

describe("LatencyGateKillSwitch", () => {
  it("engages when gate is denied", () => {
    const gate = {
      isCarryAllowed: (): boolean => false,
      arbThresholdMs: 500,
    };
    const sw = new LatencyGateKillSwitch({ gate });
    const v = sw.evaluate();
    expect(v.engaged).toBe(true);
  });

  it("does not engage when gate is allowed", () => {
    const gate = {
      isCarryAllowed: (): boolean => true,
      arbThresholdMs: 500,
    };
    const sw = new LatencyGateKillSwitch({ gate });
    const v = sw.evaluate();
    expect(v.engaged).toBe(false);
  });

  it("does not engage when disabled (sentinel)", () => {
    const gate = {
      isCarryAllowed: (): boolean => true,
      arbThresholdMs: Number.POSITIVE_INFINITY,
    };
    const sw = new LatencyGateKillSwitch({ gate });
    const v = sw.evaluate();
    expect(v.engaged).toBe(false);
    expect(v.reason).toBe("latency gate disabled");
  });
});

describe("PerStrategyKillSwitch", () => {
  it("engages when predicate returns true", () => {
    let engaged = false;
    const sw = new PerStrategyKillSwitch({
      id: "test",
      description: "test switch",
      engaged: () => engaged,
    });
    expect(sw.evaluate().engaged).toBe(false);
    engaged = true;
    expect(sw.evaluate().engaged).toBe(true);
  });

  it("uses custom reason function", () => {
    const sw = new PerStrategyKillSwitch({
      id: "test",
      description: "test switch",
      engaged: () => true,
      reason: () => "custom reason",
    });
    const v = sw.evaluate();
    expect(v.reason).toBe("custom reason");
  });
});

describe("KillSwitchRegistry", () => {
  it("aggregates verdicts from multiple switches", () => {
    const sw1 = new MaxDrawdownKillSwitch({ maxDrawdownPct: 0.15, initialEquity: 10_000 });
    const sw2 = new PerStrategyKillSwitch({
      id: "test2",
      description: "test2",
      engaged: () => false,
    });
    const reg = new KillSwitchRegistry({ switches: [sw1, sw2] });
    const snap = reg.evaluate();
    expect(snap.engaged).toBe(false);
    expect(snap.verdicts.length).toBe(2);
  });

  it("engaged = true when any switch fires", () => {
    const sw1 = new PerStrategyKillSwitch({
      id: "sw1",
      description: "d",
      engaged: () => false,
    });
    const sw2 = new PerStrategyKillSwitch({
      id: "sw2",
      description: "d",
      engaged: () => true,
    });
    const reg = new KillSwitchRegistry({ switches: [sw1, sw2] });
    const snap = reg.evaluate();
    expect(snap.engaged).toBe(true);
    expect(snap.reasons.length).toBe(1);
  });

  it("onTrigger callback fires once on first engagement", () => {
    let calls = 0;
    const sw = new PerStrategyKillSwitch({
      id: "sw",
      description: "d",
      engaged: () => true,
    });
    const reg = new KillSwitchRegistry({ switches: [sw] });
    reg.onTrigger(() => {
      calls++;
    });
    reg.evaluate();
    reg.evaluate();
    reg.evaluate();
    expect(calls).toBe(1); // fired once
  });

  it("reset() allows trigger to fire again", async () => {
    let calls = 0;
    const sw = new PerStrategyKillSwitch({
      id: "sw",
      description: "d",
      engaged: () => true,
    });
    const reg = new KillSwitchRegistry({ switches: [sw] });
    reg.onTrigger(() => {
      calls++;
    });
    reg.evaluate();
    await new Promise<void>((r) => {
      setTimeout(r, 10);
    });
    reg.reset();
    reg.evaluate();
    await new Promise<void>((r) => {
      setTimeout(r, 10);
    });
    expect(calls).toBe(2);
  });

  it("getSwitchIds returns all registered switch ids", () => {
    const reg = new KillSwitchRegistry({
      switches: [
        new PerStrategyKillSwitch({ id: "a", description: "d", engaged: () => false }),
        new PerStrategyKillSwitch({ id: "b", description: "d", engaged: () => false }),
      ],
    });
    expect(reg.getSwitchIds()).toEqual(["a", "b"]);
  });
});

describe("createDefaultRegistry", () => {
  it("builds registry with max-drawdown + max-positions switches", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const reg = createDefaultRegistry({
      positionManager: pm,
      maxDrawdownPct: 0.15,
      maxPositions: 3,
    });
    const ids = reg.getSwitchIds();
    expect(ids).toContain("max-drawdown");
    expect(ids).toContain("max-positions");
    expect(ids).not.toContain("latency-gate");
  });

  it("includes latency-gate when provided", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const reg = createDefaultRegistry({
      positionManager: pm,
      maxDrawdownPct: 0.15,
      maxPositions: 3,
      latencyGate: { isCarryAllowed: (): boolean => true, arbThresholdMs: 500 },
    });
    expect(reg.getSwitchIds()).toContain("latency-gate");
  });

  it("includes per-strategy switches when provided", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const reg = createDefaultRegistry({
      positionManager: pm,
      maxDrawdownPct: 0.15,
      maxPositions: 3,
      perStrategyKillSwitches: [
        new PerStrategyKillSwitch({ id: "p1", description: "d", engaged: () => false }),
      ],
    });
    expect(reg.getSwitchIds()).toContain("p1");
  });
});

describe("kill-switches — helper utilities", () => {
  it("getSnapshot returns the last evaluated snapshot (default = not engaged)", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const reg = createDefaultRegistry({
      positionManager: pm,
      maxDrawdownPct: 0.15,
      maxPositions: 3,
    });
    const snap = reg.getSnapshot();
    expect(snap.engaged).toBe(false);
    expect(snap.reasons).toEqual([]);
    expect(snap.verdicts).toEqual([]);
  });

  it("_rebrandSymbolString is a type-witness helper that returns the input unchanged", () => {
    // The function is a type-system witness, not a real transformation.
    // It returns the same string cast to the branded `Symbol` type.
    const input = "BTC/USDC";
    const result = _rebrandSymbolString(input);
    expect(result).toBe(input);
  });
});

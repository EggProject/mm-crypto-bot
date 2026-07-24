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
  it("engages when positionCount EXCEEDS maxPositions", () => {
    // Phase 70 fix: a kill-switch csak TúLLÉPÉS esetén tüzel (current > max),
    // nem cap-eléréskor (current >= max). Ez a teszt 3 pozíciót tölt be 2-es
    // cap-re a Phase 68 `restorePosition` útvonalon (amely szándékosan
    // bypassolja a cap-check-et, hogy a perzisztált state-et vissza tudja
    // tölteni). Az `openPosition` a cap-en throwol, ezért restore kell.
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
    // 3rd position: túllépés a 2-es cap-en. restorePosition szándékosan
    // NEM ellenőrzi a cap-et (lásd Phase 68 a `position-manager.ts`-ben).
    pm.restorePosition({
      strategy: "strategy-c",
      symbol: asSymbol("SOL/USDC") as unknown as ExchangeSymbol,
      side: "long",
      quantity: 0.01,
      entryPrice: 100,
      currentPrice: 100,
      leverage: 1,
      unrealizedPnl: 0,
      realizedPnl: 0,
      openedAt: 1_700_000_000_000,
      notionalUsd: 1,
    });
    const sw = new MaxPositionsKillSwitch({ positionManager: pm });
    const v = sw.evaluate();
    expect(v.engaged).toBe(true);
    // A reason szövegnek tükröznie kell az új `>` szemantikát.
    expect(v.reason).toBe("positions 3 > max 2");
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

  // Phase 70 regression — PR #188 (Phase 69) introduced
  // `paper-backtest-verified.toml` with `min_consensus = 1`, which let
  // the Donchian strategy open 1 position per enabled symbol (BTC/ETH/SOL
  // = 3) within seconds of starting. The old `>=` immediately fired the
  // kill-switch and the bot could not start. The fix (`>`) ensures:
  //
  //   1) empty state (count=0) does NOT trip the kill-switch
  //   2) 1 position loaded (count=1) does NOT trip the kill-switch
  //
  // Both are below the cap, and "at the cap" (count == max) is also
  // legitimate (Phase 68 state-restore can put the bot there). The
  // kill-switch should only fire when the cap is EXCEEDED.
  it("Phase 70: does NOT trigger on empty state (count=0, max=3)", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    expect(pm.getPositionCount()).toBe(0);
    const sw = new MaxPositionsKillSwitch({ positionManager: pm });
    const v = sw.evaluate();
    expect(v.engaged).toBe(false);
    expect(v.switchId).toBe("max-positions");
    expect(v.reason).toBe("positions 0 < max 3");
  });

  it("Phase 70: does NOT trigger with 1 position loaded (count=1, max=3)", () => {
    // Reproduces the Phase 68 state-restore path: bot restart, state file
    // has 1 position, the restorePosition() call bypasses the cap check
    // by design. With the old `>=` operator the kill-switch did not fire
    // (1 < 3), but with the spec change we want this path explicitly
    // covered — a "near-cap" warning is fine, but NOT an engage.
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    pm.restorePosition({
      strategy: "dydx_cex_carry",
      symbol: makeSymbol(),
      side: "long",
      quantity: 0.01,
      entryPrice: 60_000,
      currentPrice: 60_000,
      leverage: 10,
      unrealizedPnl: 0,
      realizedPnl: 0,
      openedAt: 1_700_000_000_000,
      notionalUsd: 600,
    });
    expect(pm.getPositionCount()).toBe(1);
    const sw = new MaxPositionsKillSwitch({ positionManager: pm });
    const v = sw.evaluate();
    expect(v.engaged).toBe(false);
    expect(v.switchId).toBe("max-positions");
    // Az 1 pozíció a 3-as cap 33%-ánál jár — nincs soft-cap warning sem
    // (softCapFraction=0.9, floor(3*0.9)=2; 1 < 2).
    expect(v.reason).toBe("positions 1 < max 3");
  });

  it("Phase 70: does NOT trigger when count EQUALS max (3 positions, max=3)", () => {
    // Ez a Phase 70 fix legfontosabb regressziós tesztje. A Phase 69
    // óta ez a NORMÁL üzemállapot: 1 pozíció / symbol × 3 symbol = 3
    // pozíció, max = 3. A kill-switch NEM tüzel — csak a soft-cap
    // warning szövege jelenik meg ("approaching max", nem "engaged").
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    pm.restorePosition({
      strategy: "donchian_pivot_composition",
      symbol: makeSymbol(),
      side: "long",
      quantity: 0.01,
      entryPrice: 60_000,
      currentPrice: 60_000,
      leverage: 10,
      unrealizedPnl: 0,
      realizedPnl: 0,
      openedAt: 1_700_000_000_000,
      notionalUsd: 600,
    });
    pm.restorePosition({
      strategy: "donchian_pivot_composition",
      symbol: asSymbol("ETH/USDC") as unknown as ExchangeSymbol,
      side: "long",
      quantity: 0.01,
      entryPrice: 3_000,
      currentPrice: 3_000,
      leverage: 10,
      unrealizedPnl: 0,
      realizedPnl: 0,
      openedAt: 1_700_000_000_000,
      notionalUsd: 30,
    });
    pm.restorePosition({
      strategy: "donchian_pivot_composition",
      symbol: asSymbol("SOL/USDC") as unknown as ExchangeSymbol,
      side: "long",
      quantity: 0.1,
      entryPrice: 150,
      currentPrice: 150,
      leverage: 10,
      unrealizedPnl: 0,
      realizedPnl: 0,
      openedAt: 1_700_000_000_000,
      notionalUsd: 15,
    });
    expect(pm.getPositionCount()).toBe(3);
    const sw = new MaxPositionsKillSwitch({ positionManager: pm });
    const v = sw.evaluate();
    // A Phase 70 fix előtt ez volt a bug: 3 >= 3 = true → kill-switch
    // tüzelt. A fix után: 3 > 3 = false → nem tüzel.
    expect(v.engaged).toBe(false);
    // A soft-cap warning viszont tüzel (floor(3 * 0.9) = 2; 3 >= 2),
    // tehát a szöveg "approaching max" — ez NEM engaged, csak info.
    expect(v.reason).toBe("positions 3 approaching max 3");
  });

  it("Phase 70: DOES trigger when count EXCEEDS max (4 positions, max=3)", () => {
    // A Phase 68 state-restore: ha a config `max_positions=3`-ra
    // csökkent, de a perzisztált state 4 pozíciót tartalmaz, a
    // restorePosition mind a 4-et betölti (a cap-check szándékosan
    // ki van kapcsolva). Ezt az inkonzisztens állapotot KELL jeleznie
    // a kill-switchnek — 4 > 3, tehát a `>` operátor triggerel.
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const syms = [
      makeSymbol(),
      asSymbol("ETH/USDC") as unknown as ExchangeSymbol,
      asSymbol("SOL/USDC") as unknown as ExchangeSymbol,
      asSymbol("AVAX/USDC") as unknown as ExchangeSymbol,
    ];
    for (const s of syms) {
      pm.restorePosition({
        strategy: "donchian_pivot_composition",
        symbol: s,
        side: "long",
        quantity: 0.01,
        entryPrice: 60_000,
        currentPrice: 60_000,
        leverage: 10,
        unrealizedPnl: 0,
        realizedPnl: 0,
        openedAt: 1_700_000_000_000,
        notionalUsd: 600,
      });
    }
    expect(pm.getPositionCount()).toBe(4);
    const sw = new MaxPositionsKillSwitch({ positionManager: pm });
    const v = sw.evaluate();
    expect(v.engaged).toBe(true);
    expect(v.reason).toBe("positions 4 > max 3");
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

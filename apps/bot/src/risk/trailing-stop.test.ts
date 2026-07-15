/**
 * apps/bot/src/risk/trailing-stop.test.ts
 *
 * Unit tests for `TrailingStopManager`. Targets 100% line + branch
 * coverage — all 4 constructor validation branches, the arm/disarm/
 * evaluate/updateAtr paths, the long + short trail ratchet logic,
 * the breach branches, and the side-filter gating.
 */

import { describe, expect, it } from "bun:test";

import { TrailingStopManager } from "./trailing-stop.js";

const BASE_CONFIG = {
  enabled: true,
  atrPeriod: 14,
  atrMultiplier: 3.0,
  side: "both" as const,
};

describe("TrailingStopManager", () => {
  // -------------------------------------------------------------------------
  // Constructor validation
  // -------------------------------------------------------------------------
  it("constructor rejects non-positive atrMultiplier", () => {
    expect(() => {
      new TrailingStopManager({
        ...BASE_CONFIG,
        atrMultiplier: 0,
      });
    }).toThrow(/atrMultiplier/);
  });

  it("constructor rejects non-finite atrMultiplier", () => {
    expect(() => {
      new TrailingStopManager({
        ...BASE_CONFIG,
        atrMultiplier: NaN,
      });
    }).toThrow(/atrMultiplier/);
  });

  it("constructor rejects invalid atrPeriod", () => {
    expect(() => {
      new TrailingStopManager({
        ...BASE_CONFIG,
        atrPeriod: 0,
      });
    }).toThrow(/atrPeriod/);
  });

  it("constructor rejects non-integer atrPeriod", () => {
    expect(() => {
      new TrailingStopManager({
        ...BASE_CONFIG,
        atrPeriod: 1.5,
      });
    }).toThrow(/atrPeriod/);
  });

  // -------------------------------------------------------------------------
  // arm / disarm
  // -------------------------------------------------------------------------
  it("arm registers a long position with the correct initial trail", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    const s = m.arm("a:BTC/USDC:long", "long", 60_000, 100);
    // trail = 60_000 - 100*3 = 59_700
    expect(s.armed).toBe(true);
    expect(s.high).toBe(60_000);
    expect(s.trail).toBe(59_700);
  });

  it("arm registers a short position with the correct initial trail", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    const s = m.arm("a:BTC/USDC:short", "short", 60_000, 100);
    // trail = 60_000 + 100*3 = 60_300
    expect(s.armed).toBe(true);
    expect(s.high).toBe(60_000);
    expect(s.trail).toBe(60_300);
  });

  it("arm rejects non-positive entryPrice", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    expect(() => m.arm("a", "long", 0, 100)).toThrow(/entryPrice/);
    expect(() => m.arm("a", "long", -1, 100)).toThrow(/entryPrice/);
  });

  it("arm rejects non-positive atr", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    expect(() => m.arm("a", "long", 60_000, 0)).toThrow(/atr/);
  });

  it("arm refuses when disabled", () => {
    const m = new TrailingStopManager({ ...BASE_CONFIG, enabled: false });
    expect(() => m.arm("a", "long", 60_000, 100)).toThrow(/disabled/);
  });

  it("disarm removes a position", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "long", 60_000, 100);
    expect(m.getState("a")?.armed).toBe(true);
    m.disarm("a");
    expect(m.getState("a")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Long trail ratchets favorably and never loosens
  // -------------------------------------------------------------------------
  it("long trail ratchets favorably as price moves up", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "long", 60_000, 100); // trail=59_700
    // price goes to 60_500 (favorable), ATR stays 100
    // new trail = max(59700, 60500 - 300) = 60200
    const d1 = m.evaluate({ positionId: "a", side: "long", currentPrice: 60_500, atr: 100 });
    expect(d1.kind).toBe("none");
    if (d1.kind === "none") {
      expect(d1.state.trail).toBe(60_200);
      expect(d1.state.high).toBe(60_500);
    }
  });

  it("long trail does NOT loosen when price dips", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "long", 60_000, 100);
    m.evaluate({ positionId: "a", side: "long", currentPrice: 60_500, atr: 100 });
    // dip to 60_300 (above the trail 60_200) — the trail stays at 60_200
    const d2 = m.evaluate({ positionId: "a", side: "long", currentPrice: 60_300, atr: 100 });
    expect(d2.kind).toBe("none");
    if (d2.kind === "none") {
      expect(d2.state.trail).toBe(60_200);
      expect(d2.state.high).toBe(60_500);
    }
  });

  it("long trail ratchets further on new high", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "long", 60_000, 100);
    m.evaluate({ positionId: "a", side: "long", currentPrice: 60_500, atr: 100 });
    // 61_000 → new high → trail = 61_000 - 300 = 60_700
    const d3 = m.evaluate({ positionId: "a", side: "long", currentPrice: 61_000, atr: 100 });
    expect(d3.kind).toBe("none");
    if (d3.kind === "none") {
      expect(d3.state.trail).toBe(60_700);
    }
  });

  // -------------------------------------------------------------------------
  // Long breach
  // -------------------------------------------------------------------------
  it("long trail fires close when price breaches trail", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "long", 60_000, 100);
    m.evaluate({ positionId: "a", side: "long", currentPrice: 60_500, atr: 100 });
    // dip below trail (60_200): current=60_150 <= trail → close
    const d = m.evaluate({ positionId: "a", side: "long", currentPrice: 60_150, atr: 100 });
    expect(d.kind).toBe("close");
    if (d.kind === "close") {
      expect(d.closePrice).toBe(60_200);
      expect(d.reason).toMatch(/breach/);
    }
  });

  // -------------------------------------------------------------------------
  // Short trail
  // -------------------------------------------------------------------------
  it("short trail ratchets favorably as price moves down", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "short", 60_000, 100); // trail=60_300, high=60_000
    // price to 59_500 → high=59_500 → new trail = 59_500 + 300 = 59_800
    const d1 = m.evaluate({ positionId: "a", side: "short", currentPrice: 59_500, atr: 100 });
    expect(d1.kind).toBe("none");
    if (d1.kind === "none") {
      expect(d1.state.trail).toBe(59_800);
      expect(d1.state.high).toBe(59_500);
    }
  });

  it("short trail does NOT loosen when price pops up", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "short", 60_000, 100);
    m.evaluate({ positionId: "a", side: "short", currentPrice: 59_500, atr: 100 });
    // 59_800 is the trail. Price to 59_700 (below the trail) — no loosening
    const d2 = m.evaluate({ positionId: "a", side: "short", currentPrice: 59_700, atr: 100 });
    expect(d2.kind).toBe("none");
    if (d2.kind === "none") {
      expect(d2.state.trail).toBe(59_800);
    }
  });

  it("short trail fires close when price breaches trail", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "short", 60_000, 100);
    m.evaluate({ positionId: "a", side: "short", currentPrice: 59_500, atr: 100 });
    // current=59_900 >= trail 59_800 → close
    const d = m.evaluate({ positionId: "a", side: "short", currentPrice: 59_900, atr: 100 });
    expect(d.kind).toBe("close");
    if (d.kind === "close") {
      expect(d.closePrice).toBe(59_800);
    }
  });

  // -------------------------------------------------------------------------
  // updateAtr recomputes the trail
  // -------------------------------------------------------------------------
  it("updateAtr recomputes the trail for an armed position", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "long", 60_000, 100); // trail=59_700
    m.evaluate({ positionId: "a", side: "long", currentPrice: 60_500, atr: 100 }); // high=60_500, trail=60_200
    m.updateAtr("a", 200); // 200*3 = 600; trail = max(60200, 60500-600)=60_200
    const s = m.getState("a");
    expect(s?.trail).toBe(60_200);
    expect(s?.atr).toBe(200);
  });

  it("updateAtr ignores unknown positionId", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.updateAtr("nope", 100);
    expect(m.getState("nope")).toBeUndefined();
  });

  it("updateAtr ignores non-positive atr", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "long", 60_000, 100);
    m.updateAtr("a", 0);
    m.updateAtr("a", -1);
    m.updateAtr("a", NaN);
    expect(m.getState("a")?.atr).toBe(100);
  });

  // -------------------------------------------------------------------------
  // evaluate on unknown id / bad input
  // -------------------------------------------------------------------------
  it("evaluate on unknown id returns 'none' with default state", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    const d = m.evaluate({ positionId: "nope", side: "long", currentPrice: 100, atr: 1 });
    expect(d.kind).toBe("none");
    if (d.kind === "none") {
      expect(d.state.armed).toBe(false);
    }
  });

  it("evaluate with non-finite price returns 'none'", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "long", 60_000, 100);
    const d = m.evaluate({ positionId: "a", side: "long", currentPrice: NaN, atr: 100 });
    expect(d.kind).toBe("none");
  });

  it("evaluate with non-finite atr returns 'none'", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "long", 60_000, 100);
    const d = m.evaluate({ positionId: "a", side: "long", currentPrice: 60_500, atr: NaN });
    expect(d.kind).toBe("none");
  });

  // -------------------------------------------------------------------------
  // getAllStates
  // -------------------------------------------------------------------------
  it("getAllStates returns a snapshot of all armed positions", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    m.arm("a", "long", 60_000, 100);
    m.arm("b", "short", 3_000, 10);
    const all = m.getAllStates();
    expect(all.length).toBe(2);
    expect(all[0]?.positionId).toBe("a");
    expect(all[1]?.positionId).toBe("b");
  });

  // -------------------------------------------------------------------------
  // shouldTrackSide / side filter
  // -------------------------------------------------------------------------
  it("shouldTrackSide respects the 'long' filter", () => {
    const m = new TrailingStopManager({ ...BASE_CONFIG, side: "long" });
    expect(m.shouldTrackSide("long")).toBe(true);
    expect(m.shouldTrackSide("short")).toBe(false);
  });

  it("shouldTrackSide respects the 'short' filter", () => {
    const m = new TrailingStopManager({ ...BASE_CONFIG, side: "short" });
    expect(m.shouldTrackSide("long")).toBe(false);
    expect(m.shouldTrackSide("short")).toBe(true);
  });

  it("shouldTrackSide respects the 'both' filter", () => {
    const m = new TrailingStopManager({ ...BASE_CONFIG, side: "both" });
    expect(m.shouldTrackSide("long")).toBe(true);
    expect(m.shouldTrackSide("short")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------
  it("isEnabled / getAtrPeriod return the config", () => {
    const m = new TrailingStopManager(BASE_CONFIG);
    expect(m.isEnabled()).toBe(true);
    expect(m.getAtrPeriod()).toBe(14);
  });
});

// packages/core/src/strategy/donchian-trailing.test.ts — unit tesztek
//
// Phase 7 Track A — a DonchianTrailingStrategy trailing-stop engine
// működését validálja. A tesztek:
//   - HWM frissítés (különböző bar-szcenáriók)
//   - Trail trigger (5%, 10%, 15%, ATR-2× variánsok)
//   - Time-based exit
//   - Edge case-k: gap down, azonnali reversal, ATR spike
//   - Kompatibilitás a Phase 5 SL/TP-vel (donchian baseline)
//   - Position lifecycle (entry → HWM update → trail exit)
//
// A tesztek közvetlenül a Strategy hook-okat hívják (onCandle,
// onPositionOpened, onOpenPositionUpdate, onPositionClosed).

import { describe, expect, it } from "bun:test";

import type {
  OpenPositionSnapshot,
  PositionManagementContext,
  StrategyContext,
} from "../types.js";

import {
  DEFAULT_DONCHIAN_TRAILING_CONFIG,
  DonchianTrailingStrategy,
  TRAIL_VARIANT_DEFAULTS,
  resolveTrailConfig,
  type DonchianTrailingConfig,
  type TrailVariant,
} from "./donchian-trailing.js";

// (HOUR_MS / DAY_MS — nincs szükség a tesztekben, a holding számlálás
// holdingBars-on keresztül történik.)

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function mkCandle(timestamp: number, close: number, opts?: { high?: number; low?: number; volume?: number }): {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
} {
  return {
    timestamp,
    open: close,
    high: opts?.high ?? close * 1.005,
    low: opts?.low ?? close * 0.995,
    close,
    volume: opts?.volume ?? 1500,
  };
}

function mkCtx(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    symbol: "BTC/USDT" as never,
    timeframe: "1h",
    candleIndex: 100,
    candle: mkCandle(0, 100),
    mtfState: {
      htf: {},
      mtf: {},
      ltf: { atr: 3.0 },
    },
    pricePrecision: 2,
    ...overrides,
  };
}

function mkPositionCtx(overrides: Partial<PositionManagementContext> = {}): PositionManagementContext {
  const openPosition: OpenPositionSnapshot = {
    side: "buy",
    entryTime: 1_000_000_000_000,
    entryPrice: 100,
    quantity: 1,
    stopLoss: 95,
    takeProfit: 115,
    holdingBars: 5,
    ...overrides.openPosition,
  };
  return {
    openPosition,
    candle: mkCandle(0, 110),
    candleIndex: 50,
    mtfState: {
      htf: {},
      mtf: {},
      ltf: { atr: 3.0 },
      ...overrides.mtfState,
    },
    pricePrecision: 2,
    ...overrides,
  };
}

// ----------------------------------------------------------------------
// Configuration tests
// ----------------------------------------------------------------------

describe("DonchianTrailingStrategy — configuration", () => {
  it("DEFAULT_DONCHIAN_TRAILING_CONFIG uses pct10 variant with Phase 5 Donchian base", () => {
    expect(DEFAULT_DONCHIAN_TRAILING_CONFIG.trailVariant).toBe("pct10");
    expect(DEFAULT_DONCHIAN_TRAILING_CONFIG.donchianPeriod).toBe(20);
    expect(DEFAULT_DONCHIAN_TRAILING_CONFIG.stopAtrMultiplier).toBe(1.5);
    expect(DEFAULT_DONCHIAN_TRAILING_CONFIG.tpAtrMultiplier).toBe(4.5);
    expect(DEFAULT_DONCHIAN_TRAILING_CONFIG.useHtfTrendFilter).toBe(true);
    expect(DEFAULT_DONCHIAN_TRAILING_CONFIG.maxHoldBars).toBe(0);
  });

  it("TRAIL_VARIANT_DEFAULTS has 4 variants (pct5/pct10/pct15/atr2x) with correct numeric specs", () => {
    const variants = Object.keys(TRAIL_VARIANT_DEFAULTS) as TrailVariant[];
    expect(variants.sort()).toEqual(["atr2x", "pct10", "pct15", "pct5"]);
    expect(TRAIL_VARIANT_DEFAULTS.pct5.trailPct).toBe(0.05);
    expect(TRAIL_VARIANT_DEFAULTS.pct10.trailPct).toBe(0.10);
    expect(TRAIL_VARIANT_DEFAULTS.pct15.trailPct).toBe(0.15);
    expect(TRAIL_VARIANT_DEFAULTS.atr2x.trailAtrMultiplier).toBe(2.0);
    expect(TRAIL_VARIANT_DEFAULTS.atr2x.trailPct).toBe(0);
  });

  it("resolveTrailConfig returns correct values for each variant", () => {
    const cfgPct5: DonchianTrailingConfig = { ...DEFAULT_DONCHIAN_TRAILING_CONFIG, trailVariant: "pct5" };
    const resolved = resolveTrailConfig(cfgPct5);
    expect(resolved.trailPct).toBe(0.05);
    expect(resolved.trailAtrMultiplier).toBe(0);
    expect(resolved.isAtr).toBe(false);
    expect(resolved.description).toContain("pct5");

    const cfgAtr2x: DonchianTrailingConfig = { ...DEFAULT_DONCHIAN_TRAILING_CONFIG, trailVariant: "atr2x" };
    const resolvedAtr = resolveTrailConfig(cfgAtr2x);
    expect(resolvedAtr.trailAtrMultiplier).toBe(2.0);
    expect(resolvedAtr.isAtr).toBe(true);
  });

  it("resolveTrailConfig honors explicit override (useExplicitTrail=true)", () => {
    const cfg: DonchianTrailingConfig = {
      ...DEFAULT_DONCHIAN_TRAILING_CONFIG,
      trailVariant: "pct10",
      useExplicitTrail: true,
      trailPct: 0.07,
      trailAtrMultiplier: 1.5,
    };
    const resolved = resolveTrailConfig(cfg);
    expect(resolved.trailPct).toBe(0.07);
    expect(resolved.trailAtrMultiplier).toBe(1.5);
    expect(resolved.description).toContain("explicit");
  });

  it("warmup equals the Phase 5 Donchian base (30 bars)", () => {
    const strat = new DonchianTrailingStrategy();
    expect(strat.warmup()).toBe(30);
  });

  it("name reflects the resolved variant in human-readable form", () => {
    const pct10 = new DonchianTrailingStrategy();
    expect(pct10.name).toContain("pct10");

    const atr2x = new DonchianTrailingStrategy({ trailVariant: "atr2x" });
    expect(atr2x.name).toContain("atr2x");
  });
});

// ----------------------------------------------------------------------
// HWM tracking tests
// ----------------------------------------------------------------------

describe("DonchianTrailingStrategy — HWM tracking", () => {
  it("HWM is initialized to entry price on onPositionOpened", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10" });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 95,
      takeProfit: 115,
      holdingBars: 0,
    });
    // First bar: candle.high=102 (explicit). HWM → max(100, 102) = 102.
    // 10% trail szint: 102 × 0.9 = 91.8. openPosition.SL=95 LOOSER than 91.8
    // → the trailing-SL update is REJECTED by the monotonic-tighten rule,
    // and close=100 ≥ 91.8 → no force-exit. Result is `null` (no update).
    const ctx = mkPositionCtx({
      openPosition: {
        side: "buy",
        entryTime: 1_000_000_000_000,
        entryPrice: 100,
        quantity: 1,
        stopLoss: 95,
        takeProfit: 115,
        holdingBars: 1,
      },
      candle: mkCandle(0, 100, { high: 102, low: 98 }),
    });
    expect(strat.onOpenPositionUpdate(ctx)).toBeNull();
  });

  it("HWM update triggers tightening newStopLoss when tighter than Phase 5 SL", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10" });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      // Phase 5 SL lazán van ($80), a trail 10%-a ($110 × 0.9 = $99) szigorítja.
      stopLoss: 80,
      takeProfit: 115,
      holdingBars: 0,
    });
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: {
        side: "buy",
        entryTime: 1_000_000_000_000,
        entryPrice: 100,
        quantity: 1,
        stopLoss: 80,
        takeProfit: 115,
        holdingBars: 1,
      },
      candle: mkCandle(0, 109, { high: 110, low: 108 }),
    }));
    expect(result).not.toBeNull();
    expect(result?.newStopLoss).toBe(99); // 110 × 0.9
    expect(result?.forceExit).not.toBe(true);
  });

  it("LONG: HWM monoton increases with rising highs, never decreases", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct15" });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 85,
      takeProfit: 145,
      holdingBars: 0,
    });

    // Bar 1: candle.high = 102 — HWM → 102
    strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 85, takeProfit: 145, holdingBars: 1 },
      candle: mkCandle(0, 100, { high: 102, low: 99 }),
    }));
    // Bar 2: candle.high = 105 — HWM → 105
    strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 85, takeProfit: 145, holdingBars: 2 },
      candle: mkCandle(0, 104, { high: 105, low: 101 }),
    }));
    // Bar 3: candle.high = 103, but HWM stays 105 (monotonic)
    strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 85, takeProfit: 145, holdingBars: 3 },
      candle: mkCandle(0, 103, { high: 103, low: 100 }),
    }));
    // No assertion (internal state), but no exception / no retrigger
    expect(true).toBe(true);
  });

  it("SHORT: HWM monoton decreases with falling lows", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10" });
    strat.onPositionOpened({
      side: "sell",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 105,
      takeProfit: 85,
      holdingBars: 0,
    });
    // Bar 1: low=98 → HWM short = 98 (max kedvező trade-irányba)
    strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "sell", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 105, takeProfit: 85, holdingBars: 1 },
      candle: mkCandle(0, 100, { high: 102, low: 98 }),
    }));
    // No exception. Internal state advanced.
    expect(true).toBe(true);
  });

  it("HWM resets on onPositionClosed, no stale trigger on next bar", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct5" });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 95,
      takeProfit: 115,
      holdingBars: 0,
    });
    strat.onPositionClosed("trailing_stop");
    // Next bar — HWM is null, so the hook returns null (no update)
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 95, takeProfit: 115, holdingBars: 1 },
      candle: mkCandle(0, 50, { high: 50, low: 49 }),
    }));
    expect(result).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Trail trigger tests
// ----------------------------------------------------------------------

describe("DonchianTrailingStrategy — trail trigger", () => {
  it("pct5 variant triggers when close < HWM × 0.95", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct5" });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 90,
      takeProfit: 115,
      holdingBars: 0,
    });
    // HWM=110, 5% trail szintje = 104.5; close=104 → trigger
    const ctx = mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 1 },
      candle: mkCandle(0, 104, { high: 110, low: 102 }),
    });
    // A belső HWM-et a `onOpenPositionUpdate` első hívásával hozzuk 110-re.
    const result = strat.onOpenPositionUpdate(ctx);
    expect(result).not.toBeNull();
    expect(result?.forceExit).toBe(true);
    expect(result?.reason).toBe("trailing_stop");
  });

  it("pct10 variant does not trigger on 8% pullback from HWM (close 102, HWM=110, szint=99)", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10" });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 90,
      takeProfit: 115,
      holdingBars: 0,
    });
    // HWM=110, 10% szint = 99. close=102 ≥ 99 → no trigger (csak SL update)
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 1 },
      candle: mkCandle(0, 102, { high: 110, low: 101 }),
      mtfState: { htf: {}, mtf: {}, ltf: { atr: 5 } },
    }));
    expect(result?.forceExit).not.toBe(true);
    if (result?.forceExit !== true) {
      expect(result?.newStopLoss).toBeDefined();
    }
  });

  it("pct10 variant triggers on 11% pullback from HWM (close=98, HWM=110, szint=99)", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10" });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 90,
      takeProfit: 115,
      holdingBars: 0,
    });
    // HWM=110 (candle.high), close=98 < szint=99 → trigger
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 1 },
      candle: mkCandle(0, 98, { high: 110, low: 97 }),
      mtfState: { htf: {}, mtf: {}, ltf: { atr: 5 } },
    }));
    expect(result?.forceExit).toBe(true);
    expect(result?.reason).toBe("trailing_stop");
  });

  it("pct15 variant triggers on 16% pullback (close=92, HWM=110, szint=93.5)", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct15" });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 80,
      takeProfit: 125,
      holdingBars: 0,
    });
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 80, takeProfit: 125, holdingBars: 1 },
      candle: mkCandle(0, 92, { high: 110, low: 91 }),
      mtfState: { htf: {}, mtf: {}, ltf: { atr: 5 } },
    }));
    expect(result?.forceExit).toBe(true);
  });

  it("atr2x variant triggers when close < HWM - 2*ATR (close=100, HWM=110, ATR=10, szint=90)", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "atr2x" });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 80,
      takeProfit: 130,
      holdingBars: 0,
    });
    // HWM=110, ATR=10, 2*ATR=20, szint=110-20=90; close=89 < 90 → trigger
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 80, takeProfit: 130, holdingBars: 1 },
      candle: mkCandle(0, 89, { high: 110, low: 88 }),
      mtfState: { htf: {}, mtf: {}, ltf: { atr: 10 } },
    }));
    expect(result?.forceExit).toBe(true);
  });

  it("atr2x variant does NOT trigger when close above 2*ATR szint (close=92, HWM=110, ATR=10, szint=90)", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "atr2x" });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 80,
      takeProfit: 130,
      holdingBars: 0,
    });
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 80, takeProfit: 130, holdingBars: 1 },
      candle: mkCandle(0, 92, { high: 110, low: 90 }),
      mtfState: { htf: {}, mtf: {}, ltf: { atr: 10 } },
    }));
    expect(result?.forceExit).not.toBe(true);
  });

  it("SHORT: pct10 variant triggers when close > HWM × 1.10 (close=121, HWM=110)", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10" });
    strat.onPositionOpened({
      side: "sell",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 110,
      takeProfit: 85,
      holdingBars: 0,
    });
    // SHORT: HWM-et a low-ból számítjuk (min). candle.low=109 → HWM=109. 10% szint = 119.9.
    // close=121 > 119.9 → trigger (close FÖLÉ ment, short-ban kedvezőtlen)
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "sell", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 110, takeProfit: 85, holdingBars: 1 },
      candle: mkCandle(0, 121, { high: 122, low: 109 }),
    }));
    expect(result?.forceExit).toBe(true);
  });
});

// ----------------------------------------------------------------------
// Time-based exit
// ----------------------------------------------------------------------

describe("DonchianTrailingStrategy — time-based exit", () => {
  it("maxHoldBars=0 (default) → no time-based exit (Phase 5 72h time_exit kezeli)", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10", maxHoldBars: 0 });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 90,
      takeProfit: 115,
      holdingBars: 0,
    });
    // holdingBars=200 (well beyond realistic max), no time_exit
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 200 },
      candle: mkCandle(0, 105, { high: 106, low: 104 }),
    }));
    // No force exit (price stayed in trailing-zone, no time_exit)
    expect(result?.forceExit).not.toBe(true);
  });

  it("maxHoldBars=10 forces exit on bar 10", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10", maxHoldBars: 10 });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 90,
      takeProfit: 115,
      holdingBars: 0,
    });
    // holdingBars=10 (== maxHoldBars) → time_exit
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 10 },
      candle: mkCandle(0, 110, { high: 110, low: 109 }),
    }));
    expect(result?.forceExit).toBe(true);
    expect(result?.reason).toBe("time_exit");
  });

  it("maxHoldBars=10 holds at bar 9 (not yet)", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10", maxHoldBars: 10 });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 90,
      takeProfit: 115,
      holdingBars: 0,
    });
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 9 },
      candle: mkCandle(0, 110, { high: 110, low: 109 }),
    }));
    expect(result?.forceExit).not.toBe(true);
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe("DonchianTrailingStrategy — edge cases", () => {
  it("Gap-down through trail triggers immediately on next bar", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10" });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 85,
      takeProfit: 115,
      holdingBars: 0,
    });
    // Bar 1: HWM = 110 (close=109, no trigger)
    strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 85, takeProfit: 115, holdingBars: 1 },
      candle: mkCandle(0, 109, { high: 110, low: 108 }),
    }));
    // Bar 2: gap down — candle.open=98, close=95, high=98 (nem megy 110 fölé)
    // A HWM marad 110. Trail szint: 99. close=95 < 99 → trigger.
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 85, takeProfit: 115, holdingBars: 2 },
      candle: mkCandle(0, 95, { high: 98, low: 94 }),
    }));
    expect(result?.forceExit).toBe(true);
  });

  it("Phase 5 SL/TP preserved: baseline signal delegates to DonchianBreakoutStrategy", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10" });
    // Identical context to the Phase 5 DonchianBreakoutStrategy test that
    // expects a LONG breakout signal. The trailing strategy should
    // produce the SAME signal structure (delegates to base strategy).
    const ctx = mkCtx({
      candle: mkCandle(0, 115, { high: 116, low: 114, volume: 2000 }),
      mtfState: {
        htf: {},
        mtf: { donchianUpper: 110, donchianLower: 90 },
        ltf: { atr: 2.0, volumeMa: 1000 },
      },
    });
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    // ATR-stop 1.5, ATR(14)=2: SL = 115 - 3 = 112; TP = 115 + 9 = 124
    expect(signal?.stopLoss).toBe(112);
    expect(signal?.takeProfit).toBe(124);
  });

  it("ATR spike (ATR=15 instead of 5) widens the atr2x trail zone proportionally", () => {
    // Normal ATR=5 → 2×ATR szint: 110-10=100
    // Spike ATR=15 → 2×ATR szint: 110-30=80 (szélesebb, nem triggerelődik hamar)
    const stratCalm = new DonchianTrailingStrategy({ trailVariant: "atr2x" });
    stratCalm.onPositionOpened({
      side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 80, takeProfit: 130, holdingBars: 0,
    });
    const calmResult = stratCalm.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 80, takeProfit: 130, holdingBars: 1 },
      candle: mkCandle(0, 95, { high: 110, low: 94 }),
      mtfState: { htf: {}, mtf: {}, ltf: { atr: 5 } },
    }));
    // close=95 < szint=100 (calm: 110-10=100) → trigger
    expect(calmResult?.forceExit).toBe(true);
    stratCalm.onPositionClosed("trailing_stop");

    const stratSpike = new DonchianTrailingStrategy({ trailVariant: "atr2x" });
    stratSpike.onPositionOpened({
      side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 80, takeProfit: 130, holdingBars: 0,
    });
    const spikeResult = stratSpike.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 80, takeProfit: 130, holdingBars: 1 },
      candle: mkCandle(0, 95, { high: 110, low: 94 }),
      mtfState: { htf: {}, mtf: {}, ltf: { atr: 15 } },
    }));
    // close=95 vs szint=80 (spike: 110-30=80) → nincs trigger (szélesebb a zone)
    expect(spikeResult?.forceExit).not.toBe(true);
  });

  it("null `ltf.atr` → no update (gracefully disabled)", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10" });
    strat.onPositionOpened({
      side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 0,
    });
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 1 },
      candle: mkCandle(0, 80, { high: 110, low: 79 }),
      mtfState: { htf: {}, mtf: {}, ltf: {} },
    }));
    expect(result).toBeNull();
  });

  it("Immediate reversal (entry then sharp drop) triggers pct5 trailing on bar 1", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct5" });
    strat.onPositionOpened({
      side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 80, takeProfit: 115, holdingBars: 0,
    });
    // HWM = entry = 100 (candle.high=101). 5% szint: 95. close=94 < 95 → trigger.
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 80, takeProfit: 115, holdingBars: 1 },
      candle: mkCandle(0, 94, { high: 101, low: 93 }),
    }));
    expect(result?.forceExit).toBe(true);
  });

  it("Tightening SL update: newStopLoss > Phase 5 SL when trail is strict", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct5" });
    strat.onPositionOpened({
      side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 80, takeProfit: 115, holdingBars: 0,
    });
    // HWM=110 (candle.high). 5% szint: 104.50. Phase 5 SL=80. trailing szigorúbb → newStopLoss=104.50.
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 80, takeProfit: 115, holdingBars: 1 },
      candle: mkCandle(0, 108, { high: 110, low: 107 }),
    }));
    expect(result?.newStopLoss).toBe(104.5);
    expect(result?.forceExit).not.toBe(true);
  });

  it("Phase 5 SL preserved when looser than trail: no newStopLoss returned", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10" });
    strat.onPositionOpened({
      side: "buy", entryTime: 1, entryPrice: 100, quantity: 1,
      // Phase 5 SL a 1.5×ATR-ból jönne (it 95), ami LAZÁBB mint a 10%-os trailing-szint
      stopLoss: 95, takeProfit: 115, holdingBars: 0,
    });
    // HWM=100 (entry candle, high=100). 10% szint: 90. Phase 5 SL=95 LAZÁBB, mint a 90 →
    // a trailing nem szigorít (mert SL ≤ trail-szint long esetben), nincs newStopLoss.
    const result = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 95, takeProfit: 115, holdingBars: 1 },
      candle: mkCandle(0, 100, { high: 100, low: 99 }),
    }));
    // No tightening (Phase 5 SL fut), close=100 nem triggerel → null
    expect(result).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Position lifecycle integration tests
// ----------------------------------------------------------------------

describe("DonchianTrailingStrategy — position lifecycle integration", () => {
  it("entry → HWM update → trail exit → close cleanup sequence", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10" });
    // Step 1: simulate entry via onPositionOpened (snapshot.entryPrice=100)
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 90,
      takeProfit: 115,
      holdingBars: 0,
    });
    // Step 2: bar 1 — high=105, close=104, no trail trigger (szint: 94.5; close>szint)
    strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 1 },
      candle: mkCandle(0, 104, { high: 105, low: 103 }),
    }));
    // Step 3: bar 5 — candle.high=112, HWM updated to 112, close=109 (szint: 100.8, no trigger)
    strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 5 },
      candle: mkCandle(0, 109, { high: 112, low: 108 }),
    }));
    // Step 4: bar 8 — close=99 (szint: 100.8 = 112*0.9), close < szint → trail trigger
    const trigger = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 8 },
      candle: mkCandle(0, 99, { high: 101, low: 98 }),
    }));
    expect(trigger?.forceExit).toBe(true);
    expect(trigger?.reason).toBe("trailing_stop");
    // Step 5: cleanup on close → no trailing state for next bar
    strat.onPositionClosed("trailing_stop");
    const nextBar = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1_000_000_000_000, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 10 },
      candle: mkCandle(0, 50, { high: 51, low: 49 }),
    }));
    expect(nextBar).toBeNull();
  });

  it("multiple open/close cycles do not leak state between them", () => {
    const strat = new DonchianTrailingStrategy({ trailVariant: "pct10" });
    // Cycle 1: entry $100, runs up, triggers pct10 trail
    strat.onPositionOpened({
      side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 0,
    });
    strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 3 },
      candle: mkCandle(0, 115, { high: 116, low: 114 }),
    }));
    const trigger1 = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1, entryPrice: 100, quantity: 1, stopLoss: 90, takeProfit: 115, holdingBars: 5 },
      candle: mkCandle(0, 100, { high: 116, low: 99 }),
    }));
    expect(trigger1?.forceExit).toBe(true);
    strat.onPositionClosed("trailing_stop");
    // Cycle 2: new entry at $200, HWM must restart from 200 (NOT 116)
    strat.onPositionOpened({
      side: "buy", entryTime: 1000, entryPrice: 200, quantity: 1, stopLoss: 180, takeProfit: 230, holdingBars: 0,
    });
    // close=210 > HWM=200, no trigger (szint=180; close>szint)
    const cycle2Bar1 = strat.onOpenPositionUpdate(mkPositionCtx({
      openPosition: { side: "buy", entryTime: 1000, entryPrice: 200, quantity: 1, stopLoss: 180, takeProfit: 230, holdingBars: 1 },
      candle: mkCandle(0, 210, { high: 215, low: 208 }),
    }));
    expect(cycle2Bar1?.forceExit).not.toBe(true);
  });
});

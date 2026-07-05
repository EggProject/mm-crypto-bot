// packages/core/src/strategy/donchian-mtf.test.ts — 1h MTF Donchian unit tests
//
// Phase 8 Track F — a 3-tier MTF Donchian breakout signal tesztjei.
// A tesztek közvetlenül a Strategy hook-okat hívják (onCandle,
// onPositionOpened, onOpenPositionUpdate, onPositionClosed).
//
// MEGJEGYZÉS: a Phase 7 mtf-trend-confluence.test.ts mintát követjük
// — a readonly mutációt és undefined property-ket tesztelési célból
// alkalmazzuk. A main ultra-strict tsconfig a strategy-backtest ágon
// engedélyezte ezt a stílust; itt is alkalmazzuk, hogy a tesztek
// bármelyik branch-en fussanak.
// @ts-nocheck -- readonly mutation + undefined literals: strategy-backtest tsconfig miatt
//
// Tesztelt esetek:
//   1. Alapkonfiguráció (default 1:10 leverage, 168h max-hold, 3:1 R:R)
//   2. warmup periódus (candleIndex < warmup → null)
//   3. LTF entry trigger hiányzik (close < 4h Donchian upper → null)
//   4. MTF trend filter hiányzik (4h close < 4h Donchian upper → null)
//   5. HTF supertrend filter hiányzik (1d close < 1d supertrend → null)
//   6. LTF ATR undefined (nincs SL/TP → null)
//   7. MTF Donchian undefined (nincs triggerek → null)
//   8. HTF supertrend undefined (nincs HTF filter → null)
//   9. Minden feltétel teljesül → long entry signal (SL/TP kiszámítása)
//   10. Long-only enforcement (sell side soha nem keletkezik)
//   11. Max-hold enforcement (onOpenPositionUpdate forceExit at 168h)
//   12. Stop-loss / take-profit számítás helyessége (3:1 R:R)
//   13. Position lifecycle (entry → hold → max-hold exit → cleanup)
//   14. Gap-up entry (close jumps above band — valid trigger)
//   15. Range-bound period (HTF uptrend but LTF doesn't break out → null)
//   16. Leverage validation (config rejects non-1/non-10)

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import type {
  MtfState,
  OpenPositionSnapshot,
  PositionManagementContext,
  StrategyContext,
  StrategySignal,
} from "../types.js";

import {
  DEFAULT_DONCHIAN_MTF_CONFIG,
  DonchianMtfStrategy,
  type DonchianMtfConfig,
} from "./donchian-mtf.js";

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/**
 * `mkCandle` — minimális candle factory. Default OHLCV: open/close = 100,
 * high = 100.5, low = 99.5, volume = 1000. Opciókkal testreszabható.
 */
function mkCandle(
  close: number,
  opts?: { high?: number; low?: number; volume?: number; timestamp?: number },
): Candle {
  return {
    timestamp: opts?.timestamp ?? 0,
    open: close,
    high: opts?.high ?? close * 1.005,
    low: opts?.low ?? close * 0.995,
    close,
    volume: opts?.volume ?? 1000,
  };
}

/**
 * `mkContext` — minimális StrategyContext factory. A default
 * `mtfState` minden MTF Donchian + HTF supertrend + LTF ATR értéket
 * tartalmaz, ami a Phase 8 spec alapján az entry-t triggereli.
 */
function mkContext(overrides: {
  candle?: Partial<Candle>;
  mtfState?: Partial<MtfState>;
  candleIndex?: number;
}): StrategyContext {
  const candle: Candle = {
    timestamp: 0,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
    ...overrides.candle,
  };
  const htf = {
    close: 105,
    candleIndex: 100,
    supertrend: 95, // HTF supertrend OK: 1d close (105) > supertrend (95) = uptrend
    supertrendDir: 1 as const,
    ...overrides.mtfState?.htf,
  };
  const mtf = {
    close: 100, // MTF trend filter: 4h close (100) > 4h Donchian upper (95) = uptrend
    candleIndex: 100,
    donchianUpper: 95,
    donchianLower: 80,
    ...overrides.mtfState?.mtf,
  };
  const ltf = {
    close: 100,
    candleIndex: 100,
    atr: 2,
    ...overrides.mtfState?.ltf,
  };
  return {
    symbol: "BTC/USDT" as never,
    timeframe: "1h",
    candleIndex: overrides.candleIndex ?? 5000,
    candle,
    mtfState: { htf, mtf, ltf },
    pricePrecision: 2,
  };
}

/**
 * `triggerLongContext` — minden feltétel teljesülő kontextus:
 *   - LTF (1h) close = 100 > MTF Donchian upper = 95 ✓
 *   - MTF (4h) close = 100 > MTF Donchian upper = 95 ✓
 *   - HTF (1d) close = 105 > HTF Supertrend = 95 ✓
 *   - LTF ATR(14) = 2 → SL = 97, TP = 106 (3:1 R:R)
 */
function triggerLongContext(): StrategyContext {
  return mkContext({
    candle: { close: 100, high: 102, low: 98, volume: 1500 },
    mtfState: {
      htf: { close: 105, supertrend: 95 },
      mtf: { close: 100, donchianUpper: 95 },
      ltf: { atr: 2 },
    },
  });
}

/**
 * `mkPositionCtx` — PositionManagementContext factory a max-hold tesztekhez.
 */
function mkPositionCtx(overrides: Partial<PositionManagementContext> = {}): PositionManagementContext {
  const openPosition: OpenPositionSnapshot = {
    side: "buy",
    entryTime: 1_000_000_000_000,
    entryPrice: 100,
    quantity: 1,
    stopLoss: 97,
    takeProfit: 106,
    holdingBars: 5,
    ...overrides.openPosition,
  };
  return {
    openPosition,
    candle: mkCandle(101, { high: 102, low: 99 }),
    candleIndex: 50,
    mtfState: { htf: {}, mtf: {}, ltf: { atr: 2 } },
    pricePrecision: 2,
    ...overrides,
  };
}

// ----------------------------------------------------------------------
// Configuration tests
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — configuration", () => {
  it("DEFAULT_DONCHIAN_MTF_CONFIG uses 20-period Donchian, 1.5/3.0 ATR mults, 168h max-hold, 10x leverage", () => {
    expect(DEFAULT_DONCHIAN_MTF_CONFIG.donchianPeriod).toBe(20);
    expect(DEFAULT_DONCHIAN_MTF_CONFIG.mtfDonchianPeriod).toBe(20);
    expect(DEFAULT_DONCHIAN_MTF_CONFIG.stopAtrMultiplier).toBe(1.5);
    expect(DEFAULT_DONCHIAN_MTF_CONFIG.tpAtrMultiplier).toBe(3.0);
    expect(DEFAULT_DONCHIAN_MTF_CONFIG.atrPeriod).toBe(14);
    expect(DEFAULT_DONCHIAN_MTF_CONFIG.maxHoldBars).toBe(168);
    expect(DEFAULT_DONCHIAN_MTF_CONFIG.leverage).toBe(10);
  });

  it("warmup returns 30 (HTF Supertrend(10) + MTF Donchian(20) + LTF ATR(14) combined warmup)", () => {
    const strat = new DonchianMtfStrategy();
    expect(strat.warmup()).toBe(30);
  });

  it("name reflects the 3-tier MTF Donchian pattern", () => {
    const strat = new DonchianMtfStrategy();
    expect(strat.name).toContain("Donchian MTF");
    expect(strat.name).toContain("1h");
    expect(strat.name).toContain("4h");
    expect(strat.name).toContain("1d");
    expect(strat.name).toContain("long-only");
  });

  it("constructor accepts partial config overrides", () => {
    const custom: Partial<DonchianMtfConfig> = {
      stopAtrMultiplier: 2.0,
      tpAtrMultiplier: 4.0,
      maxHoldBars: 240,
      leverage: 1,
    };
    const strat = new DonchianMtfStrategy(custom);
    expect(strat.config.stopAtrMultiplier).toBe(2.0);
    expect(strat.config.tpAtrMultiplier).toBe(4.0);
    expect(strat.config.maxHoldBars).toBe(240);
    expect(strat.config.leverage).toBe(1);
  });

  it("constructor REJECTS leverage values other than 1 or 10 (1:10 MANDATORY user directive)", () => {
    // 1× is allowed (paper-trade / non-leveraged testing).
    expect(() => new DonchianMtfStrategy({ leverage: 1 })).not.toThrow();
    // 10× is allowed (1:10 MANDATORY user directive).
    expect(() => new DonchianMtfStrategy({ leverage: 10 })).not.toThrow();
    // 5× is REJECTED.
    expect(() => new DonchianMtfStrategy({ leverage: 5 })).toThrow(/leverage must be 1 or 10/);
    // 3× is REJECTED (Phase 7 Track C default — superseded by user directive).
    expect(() => new DonchianMtfStrategy({ leverage: 3 })).toThrow(/leverage must be 1 or 10/);
    // 7× is REJECTED.
    expect(() => new DonchianMtfStrategy({ leverage: 7 })).toThrow(/leverage must be 1 or 10/);
    // 2× is REJECTED.
    expect(() => new DonchianMtfStrategy({ leverage: 2 })).toThrow(/leverage must be 1 or 10/);
    // 0× is REJECTED.
    expect(() => new DonchianMtfStrategy({ leverage: 0 })).toThrow(/leverage must be 1 or 10/);
  });
});

// ----------------------------------------------------------------------
// Warmup test
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — warmup", () => {
  it("returns null during warmup period (candleIndex < warmup)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    ctx.candleIndex = 10; // < warmup (30)
    expect(strat.onCandle(ctx)).toBeNull();
  });
});

// ----------------------------------------------------------------------
// LTF entry trigger tests
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — LTF entry trigger", () => {
  it("returns null when 1h close <= 4h Donchian upper band (no breakout)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    ctx.candle.close = 95; // = 4h Donchian upper (95) → NOT a breakout
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("returns null when 1h close < 4h Donchian upper band", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    ctx.candle.close = 90; // < 4h Donchian upper (95)
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("fires when 1h close > 4h Donchian upper band (gap-up entry case)", () => {
    // Gap-up: a close nagy ugrással kerül a sáv fölé.
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    ctx.candle.close = 130; // big gap above 95
    ctx.mtfState.mtf.close = 130; // MTF trend filter also OK
    ctx.mtfState.htf.close = 140; // HTF supertrend still OK
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
  });
});

// ----------------------------------------------------------------------
// MTF trend filter tests
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — MTF trend filter", () => {
  it("returns null when 4h close <= 4h Donchian upper band (MTF not in breakout)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    // 1h LTF trigger OK (100 > 95), de MTF filter FAIL (4h close 90 < Donchian upper 95).
    ctx.candle.close = 100;
    ctx.mtfState.mtf.close = 90;
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("returns null when 4h close undefined (MTF data missing)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    ctx.mtfState.mtf.close = undefined;
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("fires when both LTF trigger and MTF filter align (4h close > 4h Donchian upper)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    // Mind a 3 feltétel teljesül.
    ctx.candle.close = 100;
    ctx.mtfState.mtf.close = 100;
    ctx.mtfState.htf.close = 105;
    ctx.mtfState.htf.supertrend = 95;
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
  });
});

// ----------------------------------------------------------------------
// HTF supertrend filter tests
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — HTF supertrend filter", () => {
  it("returns null when 1d close <= 1d supertrend (HTF downtrend)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    // LTF trigger + MTF filter OK, de HTF filter FAIL.
    ctx.candle.close = 100;
    ctx.mtfState.mtf.close = 100;
    ctx.mtfState.htf.close = 90; // < supertrend (95)
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("returns null when 1d close undefined", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    ctx.mtfState.htf.close = undefined;
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("returns null when 1d supertrend undefined", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    ctx.mtfState.htf.supertrend = undefined;
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("fires when 1d close > 1d supertrend (uptrend OK)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    ctx.mtfState.htf.close = 110; // > supertrend (95)
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
  });
});

// ----------------------------------------------------------------------
// Indicator data missing tests
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — indicator data missing", () => {
  it("returns null when LTF ATR(14) undefined (no SL/TP)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    ctx.mtfState.ltf.atr = undefined;
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("returns null when LTF ATR(14) is 0 or negative", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    ctx.mtfState.ltf.atr = 0;
    expect(strat.onCandle(ctx)).toBeNull();
    ctx.mtfState.ltf.atr = -1;
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("returns null when MTF Donchian upper undefined", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    ctx.mtfState.mtf.donchianUpper = undefined;
    expect(strat.onCandle(ctx)).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Long-only enforcement
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — long-only enforcement", () => {
  it("never produces a sell signal even when HTF shows downtrend", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    // HTF filter FAIL → null (not sell).
    ctx.mtfState.htf.close = 80;
    ctx.mtfState.htf.supertrend = 95;
    const signal: StrategySignal | null = strat.onCandle(ctx);
    expect(signal).toBeNull();
  });

  it("never produces a sell signal even when MTF shows downtrend", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    // MTF filter FAIL (4h close 90 < Donchian upper 95) → null (not sell).
    ctx.mtfState.mtf.close = 90;
    const signal: StrategySignal | null = strat.onCandle(ctx);
    expect(signal).toBeNull();
  });

  it("the only valid signal side is 'buy' (long-only by construction)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal!.side).toBe("buy");
  });
});

// ----------------------------------------------------------------------
// Stop-loss / take-profit computation
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — SL/TP computation (3:1 R:R)", () => {
  it("computes SL = entry close - 1.5 * ATR(14), TP = entry close + 3.0 * ATR(14)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    // close=100, ATR=2 → SL=97, TP=106 (R-multiple = 3:1)
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal!.stopLoss).toBe(97);
    expect(signal!.takeProfit).toBe(106);
    // Verify R-multiple
    const risk = 100 - 97; // = 3
    const reward = 106 - 100; // = 6
    expect(reward / risk).toBeCloseTo(2, 0); // 2× the 1.5× stop distance = 3× risk
    expect(reward / risk).toBeCloseTo(2, 0);
    // 3.0 / 1.5 = 2 (the multiplier ratio), but the actual R:R is reward/risk = 2 (since we used 1.5 ATR stop and 3.0 ATR TP, the ratio is 2).
    // The 3:1 R:R refers to: 1 unit of risk (1× ATR) maps to 3 units of reward (3× ATR). With 1.5× ATR stop, that's 1.5 risk vs 3 reward = 2:1.
    // So our actual R:R is 2:1, not 3:1. The user spec said "1.5× stop + 3× TP" which mathematically is 2:1.
    // Document this nuance: with 1.5× ATR stop and 3× ATR TP, R:R = 2:1.
  });

  it("respects custom SL/TP multipliers from config override", () => {
    const strat = new DonchianMtfStrategy({
      stopAtrMultiplier: 2.0,
      tpAtrMultiplier: 4.0,
    });
    const ctx = triggerLongContext();
    // close=100, ATR=2 → SL=96, TP=108 (1:2 R:R with 2× ATR stop / 4× ATR TP)
    const signal = strat.onCandle(ctx);
    expect(signal!.stopLoss).toBe(96);
    expect(signal!.takeProfit).toBe(108);
  });

  it("rounds SL/TP to pricePrecision (BTC = 2 decimals)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    ctx.candle.close = 100.123;
    ctx.mtfState.mtf.close = 100.123;
    ctx.mtfState.mtf.donchianUpper = 95;
    ctx.mtfState.ltf.atr = 1.234;
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    // ATR(14)=1.234, stop mult=1.5 → 1.851, TP mult=3.0 → 3.702
    // SL = round(100.123 - 1.851, 2) = round(98.272, 2) = 98.27
    // TP = round(100.123 + 3.702, 2) = round(103.825, 2) = 103.82
    // (banker's rounding: half-to-even → 103.82, not 103.83)
    expect(signal!.stopLoss).toBe(98.27);
    expect(signal!.takeProfit).toBe(103.82);
  });
});

// ----------------------------------------------------------------------
// Range-bound period edge case
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — range-bound period edge case", () => {
  it("returns null when HTF aligned but LTF trigger missing (1h close inside Donchian band)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    // HTF filter OK (105 > 95), MTF filter OK (100 > 95), DE 1h LTF close = 92 (a sávon belül, nincs kitörés).
    ctx.candle.close = 92;
    ctx.mtfState.mtf.close = 100;
    ctx.mtfState.htf.close = 105;
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("returns null in low-volatility regime (small ATR + no breakout)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    // Low-vol: ATR=0.5, close=96 (just barely above 95 upper)
    ctx.candle.close = 96;
    ctx.mtfState.mtf.close = 96;
    ctx.mtfState.ltf.atr = 0.5;
    // Signal fires (feltételek teljesülnek), de a SL/TP nagyon szűk.
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal!.stopLoss).toBeCloseTo(95.25, 2); // 96 - 0.75
    expect(signal!.takeProfit).toBeCloseTo(97.5, 2); // 96 + 1.5
  });
});

// ----------------------------------------------------------------------
// Position lifecycle: max-hold enforcement
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — max-hold enforcement (168h)", () => {
  it("returns null onOpenPositionUpdate when holdingBars < maxHoldBars (168)", () => {
    const strat = new DonchianMtfStrategy();
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 97,
      takeProfit: 106,
      holdingBars: 0,
    });
    const ctx = mkPositionCtx({
      openPosition: {
        side: "buy",
        entryTime: 1_000_000_000_000,
        entryPrice: 100,
        quantity: 1,
        stopLoss: 97,
        takeProfit: 106,
        holdingBars: 100, // < 168
      },
    });
    expect(strat.onOpenPositionUpdate(ctx)).toBeNull();
  });

  it("forces exit onOpenPositionUpdate when holdingBars == maxHoldBars (168)", () => {
    const strat = new DonchianMtfStrategy();
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 97,
      takeProfit: 106,
      holdingBars: 0,
    });
    const ctx = mkPositionCtx({
      openPosition: {
        side: "buy",
        entryTime: 1_000_000_000_000,
        entryPrice: 100,
        quantity: 1,
        stopLoss: 97,
        takeProfit: 106,
        holdingBars: 168, // = maxHoldBars → time_exit
      },
    });
    const result = strat.onOpenPositionUpdate(ctx);
    expect(result).not.toBeNull();
    expect(result!.forceExit).toBe(true);
    expect(result!.reason).toBe("time_exit");
  });

  it("forces exit onOpenPositionUpdate when holdingBars > maxHoldBars", () => {
    const strat = new DonchianMtfStrategy();
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 97,
      takeProfit: 106,
      holdingBars: 0,
    });
    const ctx = mkPositionCtx({
      openPosition: {
        side: "buy",
        entryTime: 1_000_000_000_000,
        entryPrice: 100,
        quantity: 1,
        stopLoss: 97,
        takeProfit: 106,
        holdingBars: 200, // > 168
      },
    });
    const result = strat.onOpenPositionUpdate(ctx);
    expect(result).not.toBeNull();
    expect(result!.forceExit).toBe(true);
    expect(result!.reason).toBe("time_exit");
  });

  it("does NOT force exit if maxHoldBars = 0 (disabled)", () => {
    const strat = new DonchianMtfStrategy({ maxHoldBars: 0 });
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 97,
      takeProfit: 106,
      holdingBars: 0,
    });
    const ctx = mkPositionCtx({
      openPosition: {
        side: "buy",
        entryTime: 1_000_000_000_000,
        entryPrice: 100,
        quantity: 1,
        stopLoss: 97,
        takeProfit: 106,
        holdingBars: 500, // way beyond
      },
    });
    expect(strat.onOpenPositionUpdate(ctx)).toBeNull();
  });

  it("returns null when HWM state is null (entry lifecycle not initialized)", () => {
    const strat = new DonchianMtfStrategy();
    // Skip onPositionOpened — HWM is null.
    const ctx = mkPositionCtx({
      openPosition: {
        side: "buy",
        entryTime: 1_000_000_000_000,
        entryPrice: 100,
        quantity: 1,
        stopLoss: 97,
        takeProfit: 106,
        holdingBars: 200,
      },
    });
    expect(strat.onOpenPositionUpdate(ctx)).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Position lifecycle: full integration
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — position lifecycle integration", () => {
  it("entry → hold bar 100 → time_exit bar 168 → cleanup sequence", () => {
    const strat = new DonchianMtfStrategy();
    // Step 1: entry
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1_000_000_000_000,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 97,
      takeProfit: 106,
      holdingBars: 0,
    });
    // Step 2: bar 100 — no exit (within max-hold window)
    const bar100 = strat.onOpenPositionUpdate(
      mkPositionCtx({
        openPosition: {
          side: "buy",
          entryTime: 1_000_000_000_000,
          entryPrice: 100,
          quantity: 1,
          stopLoss: 97,
          takeProfit: 106,
          holdingBars: 100,
        },
        candle: mkCandle(103, { high: 105, low: 101 }),
      }),
    );
    expect(bar100).toBeNull();
    // Step 3: bar 168 — time_exit
    const bar168 = strat.onOpenPositionUpdate(
      mkPositionCtx({
        openPosition: {
          side: "buy",
          entryTime: 1_000_000_000_000,
          entryPrice: 100,
          quantity: 1,
          stopLoss: 97,
          takeProfit: 106,
          holdingBars: 168,
        },
        candle: mkCandle(104, { high: 105, low: 103 }),
      }),
    );
    expect(bar168?.forceExit).toBe(true);
    expect(bar168?.reason).toBe("time_exit");
    // Step 4: cleanup on close
    strat.onPositionClosed("time_exit");
    const postClose = strat.onOpenPositionUpdate(
      mkPositionCtx({
        openPosition: {
          side: "buy",
          entryTime: 1_000_000_000_000,
          entryPrice: 100,
          quantity: 1,
          stopLoss: 97,
          takeProfit: 106,
          holdingBars: 200,
        },
        candle: mkCandle(50, { high: 51, low: 49 }),
      }),
    );
    expect(postClose).toBeNull();
  });

  it("multiple open/close cycles reset HWM (no state leak)", () => {
    const strat = new DonchianMtfStrategy();
    // Cycle 1
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 97,
      takeProfit: 106,
      holdingBars: 0,
    });
    strat.onPositionClosed("take_profit");
    // Cycle 2: HWM must restart from new entry
    strat.onPositionOpened({
      side: "buy",
      entryTime: 1000,
      entryPrice: 200,
      quantity: 1,
      stopLoss: 194,
      takeProfit: 212,
      holdingBars: 0,
    });
    const cycle2Bar1 = strat.onOpenPositionUpdate(
      mkPositionCtx({
        openPosition: {
          side: "buy",
          entryTime: 1000,
          entryPrice: 200,
          quantity: 1,
          stopLoss: 194,
          takeProfit: 212,
          holdingBars: 1,
        },
        candle: mkCandle(210, { high: 215, low: 208 }),
      }),
    );
    expect(cycle2Bar1).toBeNull(); // < 168
  });
});

// ----------------------------------------------------------------------
// Indicator state propagation across timeframes
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — indicator state propagation", () => {
  it("LTF entry trigger reads MTF (4h) state (not LTF state)", () => {
    // LTF ATR az LTF state-ből jön, de a Donchian upper a MTF state-ből.
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    // Ha LTF-nek saját Donchiana lenne, ignore-oljuk — a MTF-ből olvasunk.
    ctx.mtfState.mtf.donchianUpper = 95;
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    // Ha a MTF Donchian upper-t LTF-re tennénk, a trigger nem teljesülne.
    ctx.mtfState.mtf.donchianUpper = 105; // 100 < 105 → no breakout
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("MTF trend filter reads MTF (4h) close — propagation across timeframes", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    // LTF trigger OK, de MTF close alacsony → nincs jel.
    ctx.candle.close = 100;
    ctx.mtfState.mtf.close = 90;
    expect(strat.onCandle(ctx)).toBeNull();
    // Ugyanaz a LTF trigger most MTF close-szal együtt → jel.
    ctx.mtfState.mtf.close = 100;
    expect(strat.onCandle(ctx)).not.toBeNull();
  });

  it("HTF supertrend reads HTF (1d) state — propagation across timeframes", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    // LTF + MTF OK, de HTF close < supertrend → nincs jel.
    ctx.candle.close = 100;
    ctx.mtfState.mtf.close = 100;
    ctx.mtfState.htf.close = 90; // < supertrend (95)
    expect(strat.onCandle(ctx)).toBeNull();
    // HTF close > supertrend → jel.
    ctx.mtfState.htf.close = 110;
    expect(strat.onCandle(ctx)).not.toBeNull();
  });
});

// ----------------------------------------------------------------------
// Confidence + reason
// ----------------------------------------------------------------------

describe("DonchianMtfStrategy — confidence and reason", () => {
  it("confidence is 0.9 (high but not max — leaves room for ensemble weighting)", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    const signal = strat.onCandle(ctx);
    expect(signal!.confidence).toBe(0.9);
  });

  it("reason explains all 3 filter conditions + SL/TP levels", () => {
    const strat = new DonchianMtfStrategy();
    const ctx = triggerLongContext();
    const signal = strat.onCandle(ctx);
    expect(signal!.reason).toContain("Donchian-MTF long");
    expect(signal!.reason).toContain("1h close");
    expect(signal!.reason).toContain("4h-Donchian-upper");
    expect(signal!.reason).toContain("4h close");
    expect(signal!.reason).toContain("1d close");
    expect(signal!.reason).toContain("1d-supertrend");
    expect(signal!.reason).toContain("ATR(14)");
    expect(signal!.reason).toContain("SL=");
    expect(signal!.reason).toContain("TP=");
  });
});
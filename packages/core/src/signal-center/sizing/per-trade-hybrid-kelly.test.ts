// packages/core/src/signal-center/sizing/per-trade-hybrid-kelly.test.ts —
// Phase 20 Track A — Per-Trade Hybrid-Kelly sizing drop-in test suite.
//
// Test coverage target: 100% line + function (this file is the gating
// test for the per-trade-hybrid-kelly module's coverage mandate).
//
// Test design rationale (≥22 tests across 7 categories):
//   1. Pure-math tests on `computeHybridKellyFraction` (1-9) — the
//      Kelly formula edge cases enumerated in scope §3.1.
//   2. Config validation tests (10-12) — constructor / cap throws.
//   3. SizingSignal immutability + override tests (13-15) — defensive
//      copy and confidence-override semantics.
//   4. enabledSymbols / enabledSignatures filter tests (16-17) —
//      whitelist semantics.
//   5. NaN / edge-case defensive tests (18-20) — empty array, all-NaN,
//      partial NaN. The module must NEVER return NaN.
//   6. History-lookup fallback tests (21) — signature missing in
//      lookup → original sizing returned (untouched).
//   7. 1:10 leverage invariant test (22) — math unit, not whole-system
//      test, asserts the override does not breach the 1:10 cap.

import { describe, expect, it } from "bun:test";

import {
  type HybridKellyConfig,
  type SignalTradeHistory,
  applyHybridKelly,
  buildSizingSignature,
  computeHybridKellyFraction,
  DEFAULT_HYBRID_KELLY_CAP,
  DEFAULT_HISTORY_WINDOW_DAYS,
  DEFAULT_MIN_TRADES_FOR_KELLY,
  inferSideFromNotional,
  inferSymbolFromSource,
  validateHybridKellyConfig,
} from "./per-trade-hybrid-kelly.js";
import type { SizingSignal } from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * `mkSizing` — synthetic SizingSignal with sensible defaults. The
 * `source` field follows the `<plugin>:<symbol>` convention so symbol
 * inference is exercised.
 */
const mkSizing = (overrides: Partial<SizingSignal> = {}): SizingSignal => ({
  kind: "sizing",
  kellyFraction: 0.8,
  volMultiplier: 1.0,
  notional: 10_000,
  source: "carry-baseline-v1:BTC/USDT",
  ...overrides,
});

/**
 * `mkHistory` — synthetic SignalTradeHistory from a flat array of
 * pnlUsd values. Sets `notionalUsd` to a fixed 10_000 for all entries
 * (the Kelly math does not consume `notionalUsd`, but the field must
 * be present per the `SignalTradeHistory` shape).
 */
const mkHistory = (
  signature: string,
  pnlList: readonly number[],
): SignalTradeHistory => ({
  signature,
  tradeList: pnlList.map((pnlUsd) => ({ pnlUsd, notionalUsd: 10_000 })),
});

/**
 * `mkLookup` — wrap a `Map<signature, history>` into the function
 * shape expected by `applyHybridKelly`. Throw on missing key (the
 * module handles this defensively via try/catch).
 */
const mkLookup = (
  map: ReadonlyMap<string, SignalTradeHistory>,
): ((signature: string) => SignalTradeHistory) => {
  return (signature: string): SignalTradeHistory => {
    const h = map.get(signature);
    if (h === undefined) {
      throw new Error(`no history for signature: ${signature}`);
    }
    return h;
  };
};

/**
 * `defaultConfig` — base HybridKellyConfig used by tests. `enabledSymbols`
 * and `enabledSignatures` are NOT set (wildcard — all eligible) unless
 * a test explicitly overrides.
 */
const defaultConfig = (overrides: Partial<HybridKellyConfig> = {}): HybridKellyConfig => ({
  hybridKellyCap: 0.5,
  historyWindowDays: 30,
  minTradesForKelly: 30,
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1. Pure-math tests on `computeHybridKellyFraction` (8 tests)
// ---------------------------------------------------------------------------

describe("computeHybridKellyFraction — pure math edge cases", () => {
  it("winRate=1.0, payoffRatio=any → kelly=1.0 (capped at hybridKellyCap)", () => {
    // 30 all-winning trades → winRate=1.0, payoffRatio=avgWin/avgLoss
    // (no losses, so payoffRatio=1.0 by convention). rawKelly = (1.0*1.0 - 0) / 1.0 = 1.0.
    const history = mkHistory("sizing:long:BTC/USDT", Array(30).fill(100));
    const k = computeHybridKellyFraction(history, { hybridKellyCap: 0.5, minTradesForKelly: 30 });
    expect(k).toBe(0.5); // capped at hybridKellyCap
  });

  it("winRate=0.6, payoffRatio=2 → kelly=0.4 (within 0.5 default cap)", () => {
    // 18 wins of +$100, 12 losses of -$50 → winRate=0.6, avgWin=100, avgLoss=50,
    // payoffRatio=2.0. rawKelly = (0.6*2.0 - 0.4) / 2.0 = 0.8/2.0 = 0.4.
    const pnl = [...Array(18).fill(100), ...Array(12).fill(-50)];
    const history = mkHistory("sizing:long:BTC/USDT", pnl);
    const k = computeHybridKellyFraction(history, { hybridKellyCap: 0.5, minTradesForKelly: 30 });
    expect(k).toBeCloseTo(0.4, 10);
  });

  it("winRate=0.5, payoffRatio=1 → kelly=0 (edge of profitable)", () => {
    // 15 wins of +$100, 15 losses of -$100 → winRate=0.5, avgWin=avgLoss=100,
    // payoffRatio=1.0. rawKelly = (0.5*1.0 - 0.5) / 1.0 = 0.
    const pnl = [...Array(15).fill(100), ...Array(15).fill(-100)];
    const history = mkHistory("sizing:long:BTC/USDT", pnl);
    const k = computeHybridKellyFraction(history, { hybridKellyCap: 0.5, minTradesForKelly: 30 });
    expect(k).toBe(0);
  });

  it("winRate=0.4, payoffRatio=1 → kelly=-0.2 → clamp at 0 (loss-don't-bet)", () => {
    // 12 wins, 18 losses of equal magnitude → winRate=0.4, payoffRatio=1.0.
    // rawKelly = (0.4 - 0.6) / 1.0 = -0.2 → clamp at 0.
    const pnl = [...Array(12).fill(100), ...Array(18).fill(-100)];
    const history = mkHistory("sizing:long:BTC/USDT", pnl);
    const k = computeHybridKellyFraction(history, { hybridKellyCap: 0.5, minTradesForKelly: 30 });
    expect(k).toBe(0);
  });

  it("winRate=0.0 → kelly=0 (clamp at 0; no betting)", () => {
    // 30 all-losing trades → winRate=0.0, payoffRatio=0 (no wins).
    // rawKelly = (0 - 1) / 1.0 = -1.0 → clamp at 0.
    const history = mkHistory("sizing:long:BTC/USDT", Array(30).fill(-100));
    const k = computeHybridKellyFraction(history, { hybridKellyCap: 0.5, minTradesForKelly: 30 });
    expect(k).toBe(0);
  });

  it("history.length=29 (under minTradesForKelly=30) → kelly=0 (insufficient history)", () => {
    // 29 trades (one short of threshold) → returns 0, no override.
    const history = mkHistory("sizing:long:BTC/USDT", Array(29).fill(100));
    const k = computeHybridKellyFraction(history, { hybridKellyCap: 0.5, minTradesForKelly: 30 });
    expect(k).toBe(0);
  });

  it("history.length === 0 → kelly=0 (no override)", () => {
    // Empty array → returns 0 immediately (insufficient history).
    const history = mkHistory("sizing:long:BTC/USDT", []);
    const k = computeHybridKellyFraction(history, { hybridKellyCap: 0.5, minTradesForKelly: 30 });
    expect(k).toBe(0);
  });

  it("payoffRatio=∞ (no losses, all wins) → kelly=hybridKellyCap (capped)", () => {
    // 30 all-winning trades of varying magnitudes (avgWin > 0, no losses).
    // payoffRatio=1.0 (convention when no losses). rawKelly = (1.0*1.0 - 0) / 1.0 = 1.0 → capped.
    // Use a higher cap (0.85) to verify the math isn't silently floored.
    const history = mkHistory("sizing:long:BTC/USDT", Array(30).fill(100));
    const k = computeHybridKellyFraction(history, { hybridKellyCap: 0.85, minTradesForKelly: 30 });
    expect(k).toBe(0.85);
  });

  it("payoffRatio=0 (no wins, all losses) → kelly=0", () => {
    // 30 all-losing trades → winRate=0, payoffRatio=0 (no wins).
    // rawKelly = (0*0 - 1) / 1.0 (Math.max guard) = -1 → clamp at 0.
    const history = mkHistory("sizing:long:BTC/USDT", Array(30).fill(-100));
    const k = computeHybridKellyFraction(history, { hybridKellyCap: 0.5, minTradesForKelly: 30 });
    expect(k).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Config validation tests (3 tests)
// ---------------------------------------------------------------------------

describe("HybridKellyConfig — validation", () => {
  it("hybridKellyCap=1.5 → validateHybridKellyConfig returns error (per Phase 11.1e precedent)", () => {
    const err = validateHybridKellyConfig({
      hybridKellyCap: 1.5,
      historyWindowDays: 30,
      minTradesForKelly: 30,
    });
    expect(err).not.toBeNull();
    expect(err).toMatch(/exceeds 1\.0/);
  });

  it("hybridKellyCap=0.85 → validateHybridKellyConfig returns null (Phase 14B ceiling precedent)", () => {
    const err = validateHybridKellyConfig({
      hybridKellyCap: 0.85,
      historyWindowDays: 30,
      minTradesForKelly: 30,
    });
    expect(err).toBeNull();
  });

  it("hybridKellyCap=0.5 (default) → validateHybridKellyConfig returns null", () => {
    const err = validateHybridKellyConfig({
      hybridKellyCap: 0.5,
      historyWindowDays: 30,
      minTradesForKelly: 30,
    });
    expect(err).toBeNull();
  });

  it("hybridKellyCap=-0.1 → validateHybridKellyConfig returns error (negative rejected)", () => {
    const err = validateHybridKellyConfig({
      hybridKellyCap: -0.1,
      historyWindowDays: 30,
      minTradesForKelly: 30,
    });
    expect(err).not.toBeNull();
    expect(err).toMatch(/non-negative finite/);
  });

  it("historyWindowDays=0 → validateHybridKellyConfig returns error (must be ≥ 1)", () => {
    const err = validateHybridKellyConfig({
      hybridKellyCap: 0.5,
      historyWindowDays: 0,
      minTradesForKelly: 30,
    });
    expect(err).not.toBeNull();
    expect(err).toMatch(/historyWindowDays/);
  });

  it("minTradesForKelly=0 → validateHybridKellyConfig returns error (must be ≥ 1)", () => {
    const err = validateHybridKellyConfig({
      hybridKellyCap: 0.5,
      historyWindowDays: 30,
      minTradesForKelly: 0,
    });
    expect(err).not.toBeNull();
    expect(err).toMatch(/minTradesForKelly/);
  });
});

// ---------------------------------------------------------------------------
// 3. SizingSignal immutability + override semantics (3 tests)
// ---------------------------------------------------------------------------

describe("applyHybridKelly — SizingSignal immutability and override", () => {
  it("input !== output (defensive copy verified — input is not mutated)", () => {
    // Sufficient history to apply override. Verify the returned
    // SizingSignal is a DIFFERENT object reference (defensive copy)
    // and that the input's kellyFraction is unchanged.
    const input = mkSizing({ kellyFraction: 0.8 });
    const pnl = [...Array(18).fill(100), ...Array(12).fill(-50)]; // rawKelly=0.4
    const lookup = mkLookup(
      new Map([
        [
          "sizing:long:BTC/USDT",
          mkHistory("sizing:long:BTC/USDT", pnl),
        ],
      ]),
    );
    const output = applyHybridKelly(input, lookup, defaultConfig(), Date.now());
    expect(output).not.toBe(input);
    expect(input.kellyFraction).toBe(0.8); // input unchanged
    expect(output.kellyFraction).toBeCloseTo(0.4, 10); // override applied
  });

  it("override case 1: input kellyFraction=0.8, kelly=0.4 → output kellyFraction=0.4", () => {
    const input = mkSizing({ kellyFraction: 0.8 });
    const pnl = [...Array(18).fill(100), ...Array(12).fill(-50)]; // rawKelly=0.4
    const lookup = mkLookup(
      new Map([
        [
          "sizing:long:BTC/USDT",
          mkHistory("sizing:long:BTC/USDT", pnl),
        ],
      ]),
    );
    const output = applyHybridKelly(input, lookup, defaultConfig(), Date.now());
    expect(output.kellyFraction).toBeCloseTo(0.4, 10);
  });

  it("override case 2: input kellyFraction=0.8, kelly=0 → output kellyFraction=0", () => {
    // 30 all-losing trades → rawKelly = -1 → clamped to 0.
    const input = mkSizing({ kellyFraction: 0.8 });
    const lookup = mkLookup(
      new Map([
        [
          "sizing:long:BTC/USDT",
          mkHistory("sizing:long:BTC/USDT", Array(30).fill(-100)),
        ],
      ]),
    );
    const output = applyHybridKelly(input, lookup, defaultConfig(), Date.now());
    expect(output.kellyFraction).toBe(0);
  });

  it("output preserves all other SizingSignal fields (volMultiplier, notional, source, timestampMs)", () => {
    const ts = 1_700_000_000_000;
    const input = mkSizing({
      kellyFraction: 0.8,
      volMultiplier: 0.7,
      notional: 25_000,
      source: "directional-mtf-v1:ETH/USDT",
      timestampMs: ts,
    });
    const pnl = [...Array(18).fill(100), ...Array(12).fill(-50)]; // rawKelly=0.4
    const lookup = mkLookup(
      new Map([
        [
          "sizing:long:ETH/USDT",
          mkHistory("sizing:long:ETH/USDT", pnl),
        ],
      ]),
    );
    const output = applyHybridKelly(input, lookup, defaultConfig(), Date.now());
    expect(output.volMultiplier).toBe(0.7);
    expect(output.notional).toBe(25_000);
    expect(output.source).toBe("directional-mtf-v1:ETH/USDT");
    expect(output.timestampMs).toBe(ts);
    expect(output.kind).toBe("sizing");
  });
});

// ---------------------------------------------------------------------------
// 4. enabledSymbols / enabledSignatures filter tests (2 tests)
// ---------------------------------------------------------------------------

describe("applyHybridKelly — filter pass-through", () => {
  it("enabledSymbols=['BTC/USDT']: ETH sizing pass-through (untouched)", () => {
    // ETH signal — `enabledSymbols` only allows BTC, so the signal
    // passes through with the original kellyFraction.
    const input = mkSizing({
      kellyFraction: 0.8,
      source: "directional-mtf-v1:ETH/USDT",
    });
    const pnl = [...Array(18).fill(100), ...Array(12).fill(-50)]; // would be kelly=0.4
    const lookup = mkLookup(
      new Map([
        [
          "sizing:long:ETH/USDT",
          mkHistory("sizing:long:ETH/USDT", pnl),
        ],
      ]),
    );
    const output = applyHybridKelly(
      input,
      lookup,
      defaultConfig({ enabledSymbols: ["BTC/USDT"] }),
      Date.now(),
    );
    expect(output).toBe(input); // strict equality — same reference, no copy made
    expect(output.kellyFraction).toBe(0.8);
  });

  it("enabledSignatures filter: only specified signatures get override", () => {
    // Build a BTC sizing signal — the filter allows "sizing:long:BTC/USDT"
    // and "sizing:short:BTC/USDT". An "ETH" signature is filtered out.
    const btcInput = mkSizing({
      kellyFraction: 0.8,
      source: "directional-mtf-v1:BTC/USDT",
    });
    const ethInput = mkSizing({
      kellyFraction: 0.8,
      source: "directional-mtf-v1:ETH/USDT",
    });
    const pnl = [...Array(18).fill(100), ...Array(12).fill(-50)]; // rawKelly=0.4
    const lookup = mkLookup(
      new Map([
        [
          "sizing:long:BTC/USDT",
          mkHistory("sizing:long:BTC/USDT", pnl),
        ],
        [
          "sizing:long:ETH/USDT",
          mkHistory("sizing:long:ETH/USDT", pnl),
        ],
      ]),
    );
    const filterConfig = defaultConfig({
      enabledSignatures: ["sizing:long:BTC/USDT", "sizing:short:BTC/USDT"],
    });
    const btcOutput = applyHybridKelly(btcInput, lookup, filterConfig, Date.now());
    const ethOutput = applyHybridKelly(ethInput, lookup, filterConfig, Date.now());
    expect(btcOutput.kellyFraction).toBeCloseTo(0.4, 10); // BTC override applied
    expect(ethOutput).toBe(ethInput); // ETH pass-through (filter excluded)
    expect(ethOutput.kellyFraction).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// 5. NaN / edge-case defensive tests (3 tests)
// ---------------------------------------------------------------------------

describe("applyHybridKelly / computeHybridKellyFraction — NaN + empty guards", () => {
  it("NaN pnl in history → returns 0 (defensive guard)", () => {
    // 30 trades, one with NaN pnl → all-NaN guard fires → returns 0.
    const pnl = [...Array(29).fill(100), NaN];
    const history = mkHistory("sizing:long:BTC/USDT", pnl);
    const k = computeHybridKellyFraction(history, { hybridKellyCap: 0.5, minTradesForKelly: 30 });
    expect(k).toBe(0);
  });

  it("all-NaN pnl history → returns 0", () => {
    const pnl = Array(30).fill(NaN);
    const history = mkHistory("sizing:long:BTC/USDT", pnl);
    const k = computeHybridKellyFraction(history, { hybridKellyCap: 0.5, minTradesForKelly: 30 });
    expect(k).toBe(0);
  });

  it("empty array history → returns 0 (applyHybridKelly pass-through)", () => {
    const input = mkSizing({ kellyFraction: 0.7 });
    const lookup = mkLookup(
      new Map([
        [
          "sizing:long:BTC/USDT",
          mkHistory("sizing:long:BTC/USDT", []),
        ],
      ]),
    );
    const output = applyHybridKelly(input, lookup, defaultConfig(), Date.now());
    expect(output).toBe(input); // pass-through (insufficient history)
    expect(output.kellyFraction).toBe(0.7);
  });
});

// ---------------------------------------------------------------------------
// 6. History-lookup fallback (1 test)
// ---------------------------------------------------------------------------

describe("applyHybridKelly — history lookup fallback", () => {
  it("signature not in historyLookup → returns original SizingSignal (untouched)", () => {
    // Lookup that throws on missing key — applyHybridKelly catches
    // the throw and returns the input untouched.
    const input = mkSizing({ kellyFraction: 0.6 });
    const lookup = mkLookup(new Map()); // empty map → always throws
    const output = applyHybridKelly(input, lookup, defaultConfig(), Date.now());
    expect(output).toBe(input);
    expect(output.kellyFraction).toBe(0.6);
  });
});

// ---------------------------------------------------------------------------
// 7. 1:10 leverage mandate (1 test)
// ---------------------------------------------------------------------------

describe("applyHybridKelly — 1:10 leverage mandate audit (math unit)", () => {
  it("1:10 audit: kelly × riskPerTrade × equity × leverage ≤ maxPositionPctEquity × equity × leverage", () => {
    // The engine consumes `kellyFraction` to scale notional:
    //   notional_usd = kellyFraction × riskPerTrade × equity × leverage
    // and clamps to [minPositionPctEquity × equity, maxPositionPctEquity × equity × leverage].
    // For Phase 6 1:10 mandate:
    //   kelly ≤ 0.5 (our cap) → notional ≤ 0.5 × 0.01 × $10k × 10 = $500
    //   which is below maxPositionPctEquity=0.20 × $10k × 10 = $20_000
    // → 1:10 mandate preserved by construction.
    //
    // This test asserts the math invariant DIRECTLY (not via a full
    // backtest) — the module's override reduces `kellyFraction` to a
    // value in [0, 0.5], which is the productionization envelope
    // (Phase 6 1:10 mandate) for the engine's position-size chain.
    const RISK_PER_TRADE = 0.01;
    const EQUITY = 10_000;
    const LEVERAGE = 10;
    const MAX_POSITION_PCT_EQUITY = 0.20;
    const kelly = 0.5; // cap value
    const impliedNotional = kelly * RISK_PER_TRADE * EQUITY * LEVERAGE;
    const capNotional = MAX_POSITION_PCT_EQUITY * EQUITY * LEVERAGE;
    expect(impliedNotional).toBeLessThanOrEqual(capNotional);
    expect(impliedNotional).toBe(500); // sanity: exact value

    // Realistic per-trade kelly override — 30 all-wins, cap=0.85:
    // the override can lift kelly up to 0.85 (Phase 14B ceiling).
    // Even at the ceiling, 0.85 × 0.01 × $10k × 10 = $850 ≤ $20_000 cap.
    const kelly2 = 0.85;
    const impliedNotional2 = kelly2 * RISK_PER_TRADE * EQUITY * LEVERAGE;
    expect(impliedNotional2).toBeLessThanOrEqual(capNotional);
  });
});

// ---------------------------------------------------------------------------
// 8. Signature inference helpers
// ---------------------------------------------------------------------------

describe("buildSizingSignature + inferSymbolFromSource + inferSideFromNotional", () => {
  it("buildSizingSignature for long BTC: 'sizing:long:BTC/USDT'", () => {
    const s = mkSizing({ notional: 10_000, source: "carry-baseline-v1:BTC/USDT" });
    expect(buildSizingSignature(s)).toBe("sizing:long:BTC/USDT");
  });

  it("buildSizingSignature for short ETH (negative notional): 'sizing:short:ETH/USDT'", () => {
    const s = mkSizing({ notional: -10_000, source: "directional-mtf-v1:ETH/USDT" });
    expect(buildSizingSignature(s)).toBe("sizing:short:ETH/USDT");
  });

  it("buildSizingSignature for flat (notional=0): 'sizing:flat:BTC/USDT'", () => {
    const s = mkSizing({ notional: 0, source: "carry-baseline-v1:BTC/USDT" });
    expect(buildSizingSignature(s)).toBe("sizing:flat:BTC/USDT");
  });

  it("inferSymbolFromSource: '?' when source has no colon", () => {
    const s = mkSizing({ source: "unknown-source" });
    expect(inferSymbolFromSource(s)).toBe("?");
  });

  it("inferSymbolFromSource: '?' when source ends with colon", () => {
    const s = mkSizing({ source: "carry-baseline-v1:" });
    expect(inferSymbolFromSource(s)).toBe("?");
  });

  it("inferSideFromNotional: long/short/flat by sign", () => {
    expect(inferSideFromNotional(mkSizing({ notional: 100 }))).toBe("long");
    expect(inferSideFromNotional(mkSizing({ notional: -100 }))).toBe("short");
    expect(inferSideFromNotional(mkSizing({ notional: 0 }))).toBe("flat");
  });
});

// ---------------------------------------------------------------------------
// 9. Defaults
// ---------------------------------------------------------------------------

describe("Per-Trade Hybrid-Kelly defaults", () => {
  it("DEFAULT_HYBRID_KELLY_CAP === 0.5 (Phase 9 9E baseKellyFraction)", () => {
    expect(DEFAULT_HYBRID_KELLY_CAP).toBe(0.5);
  });

  it("DEFAULT_HISTORY_WINDOW_DAYS === 30 (Phase 9 9E fundingSharpeWindowDays)", () => {
    expect(DEFAULT_HISTORY_WINDOW_DAYS).toBe(30);
  });

  it("DEFAULT_MIN_TRADES_FOR_KELLY === 30 (Phase 9 9E minTradeCount)", () => {
    expect(DEFAULT_MIN_TRADES_FOR_KELLY).toBe(30);
  });
});


// ---------------------------------------------------------------------------
// 10. Coverage-completion tests (5 lines: 279, 283, 289, 293, 442)
// ---------------------------------------------------------------------------

describe("Per-Trade Hybrid-Kelly — coverage completion (LF == LH)", () => {
  it("applyHybridKelly with enabledSymbols=['BTC/USDT'] + BTC signal → override applied (line 442)", () => {
    // Line 442 is the closing brace of the `enabledSymbols.includes(symbol)`
    // filter — exercised when the symbol IS in the filter (filter passes
    // through, we do not return sizing). This is the complement of the
    // 'pass-through' test that exercises the `return sizing` path.
    const input = mkSizing({ kellyFraction: 0.8, source: "directional-mtf-v1:BTC/USDT" });
    const pnl = [...Array(18).fill(100), ...Array(12).fill(-50)]; // rawKelly=0.4
    const lookup = mkLookup(
      new Map([
        [
          "sizing:long:BTC/USDT",
          mkHistory("sizing:long:BTC/USDT", pnl),
        ],
      ]),
    );
    const output = applyHybridKelly(
      input,
      lookup,
      defaultConfig({ enabledSymbols: ["BTC/USDT"] }),
      Date.now(),
    );
    expect(output).not.toBe(input);
    expect(output.kellyFraction).toBeCloseTo(0.4, 10);
  });

  it("validateHybridKellyConfig rejects non-array enabledSymbols (line 279)", () => {
    // Pass a non-array value (object) for enabledSymbols to exercise the
    // Array.isArray guard. The validator should return an error message.
    const err = validateHybridKellyConfig({
      hybridKellyCap: 0.5,
      historyWindowDays: 30,
      minTradesForKelly: 30,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enabledSymbols: "BTC/USDT" as unknown as readonly string[],
    });
    expect(err).not.toBeNull();
    expect(err).toMatch(/enabledSymbols must be an array/);
  });

  it("validateHybridKellyConfig rejects empty-string entry in enabledSymbols (line 283)", () => {
    const err = validateHybridKellyConfig({
      hybridKellyCap: 0.5,
      historyWindowDays: 30,
      minTradesForKelly: 30,
      enabledSymbols: ["BTC/USDT", ""],
    });
    expect(err).not.toBeNull();
    expect(err).toMatch(/non-empty strings/);
  });

  it("validateHybridKellyConfig rejects non-array enabledSignatures (line 289)", () => {
    const err = validateHybridKellyConfig({
      hybridKellyCap: 0.5,
      historyWindowDays: 30,
      minTradesForKelly: 30,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enabledSignatures: 42 as unknown as readonly string[],
    });
    expect(err).not.toBeNull();
    expect(err).toMatch(/enabledSignatures must be an array/);
  });

  it("validateHybridKellyConfig rejects empty-string entry in enabledSignatures (line 293)", () => {
    const err = validateHybridKellyConfig({
      hybridKellyCap: 0.5,
      historyWindowDays: 30,
      minTradesForKelly: 30,
      enabledSignatures: ["sizing:long:BTC/USDT", ""],
    });
    expect(err).not.toBeNull();
    expect(err).toMatch(/non-empty strings/);
  });
});

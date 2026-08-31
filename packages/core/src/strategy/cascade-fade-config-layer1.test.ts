// packages/core/src/strategy/cascade-fade.test.ts
//
// Phase 25 #2 Track D — Cascade fade detector + paper-trade simulator tests.
//
// Coverage (≥20 tests, all assertions on `bun:test`):
// ============================================================================
// CONFIG-INVARIANT (constructor hard guardrails)
//   1.  Default config matches Track D §6.1 baseline
//   2.  Empty allowedSymbols throws
//   3.  Invalid layer3 distance range throws
//   4.  layer3 exit max < min throws
//   5.  Per-symbol cap > per-event cap throws
// ============================================================================
// LAYER 1 — REAL-TIME DETECTOR
//   6.  No trigger when 1-min USD below threshold
//   7.  No trigger when OI drop below threshold
//   8.  No trigger when cross-confirmations < 2
//   9.  Layer 1 fires with all 3 conditions met
// ============================================================================
// LAYER 2 — STATE MACHINE
//   10. New event starts in IN_PROGRESS
//   11. Event transitions IN_PROGRESS → STABILIZING after OI stabilization
//   12. Event transitions STABILIZING → POST_CASCADE after Axel Adler rule
//       (OI drop > 15% in 48h AND ELR < 0.40)
//   13. POST_CASCADE reverts to STABILIZING when ELR climbs above 0.45
// ============================================================================
// LAYER 3 — EXECUTION (only POST_CASCADE allows entry)
//   14. No entry in IN_PROGRESS
//   15. No entry in STABILIZING
//   16. Entry fires on POST_CASCADE
//   17. Entry has correct fields (price, notional, exitWindow)
//   18. NO naked short (entry.side === "buy" always)
//   19. Entry notional ≤ capacityMaxPerSymbolEventUsd
// ============================================================================
// RISK GOVERNOR
//   20. Portfolio DD > 12% halts new entries (kill-switch fires on open pos)
//   21. BTC cooldown enforced (24h gap between consecutive BTC entries)
//   22. ETH cooldown NOT enforced (BTC only)
//   23. Hard stop on rolling 7d DD breach → 30 days halt
// ============================================================================
// CAPACITY + PAPER-TRADE + REPLAY
//   24. capacityMaxConcurrentSymbols enforced (no third symbol entry)
//   25. capacityMaxPerEventUsd enforced on entry notional
//   26. simulateBybitEuPaperFill: net pnlBps reflects slippage
//   27. syntheticBybitEuSlippageBps: scales with notional × cascade period
//   28. replayCascadeEvent: timeline reconstructed from observations
//   29. CascadeFadeStrategy.warmup returns 0 (event-driven, not candle-driven)
//   30. CascadeFadeStrategy.onCandle is NO-OP (wire-up integrity)
//   31. Determinism: same inputs produce same event timeline
// ============================================================================
// HISTORICAL REPLAY (2025-10-10 calibration event)
//   32. Detector enters POST_CASCADE within 30 min of synthetic peak
//   33. Paper-trade P&L on synthetic 2025-10-10 sequence is positive

import { describe, expect, it } from "bun:test";

import { CascadeFadeDetector, DEFAULT_CASCADE_FADE_CONFIG } from "./cascade-fade.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const T0 = Date.UTC(2025, 9, 10, 20, 50, 0); // 20:50 UTC, the "Trump 100% tariff" trigger.

/**
Build a synthetic 1-min cascade window. Defaults to $60M aggregate (above $50M threshold).
*/
const cascadeWindow = (
  startMs: number,
  symbol = "BTC",
  overrides: Partial<{
    totalUsd: number;
    midPriceUsd: number;
    longUsd: number;
    shortUsd: number;
    exchangeCount: number;
  }> = {},
) => ({
  windowStartMs: startMs,
  symbol,
  totalUsd: overrides.totalUsd ?? 60_000_000,
  midPriceUsd: overrides.midPriceUsd ?? (symbol === "BTC" ? 60_000 : 3000),
  longUsd: overrides.longUsd ?? 60_000_000,
  shortUsd: overrides.shortUsd ?? 0,
  distinctExchangeCount: overrides.exchangeCount ?? 3,
});

/**
Synthetic OI sample (USD).
*/
const oi = (tsMs: number, symbol = "BTC", oiUsd = 10_000_000_000) => ({
  timestampMs: tsMs,
  symbol,
  oiUsd,
});

/**
 * Cross-confirmation helper — produces a `CrossConfirmationInput` that
 * satisfies the new strict predicate (verifier Check 2 attempt 1 fix):
 *   - same symbol across all sources (uses the `symbol` arg consistently)
 *   - windowStartMs within ±60s of the trigger observation (we pass
 *     `startMs` AS-IS since the trigger `nowMs` will equal `startMs`)
 *   - `count` distinct providers across the PROVIDER_DIVERSITY_GROUPS
 *     space — we cycle through coinglass_v4 + perp venues.
 */
const xconf = (startMs: number, symbol = "BTC", count = 2) => {
  const providers: readonly ("coinglass_v4" | "bitquery_hl" | "binance_perp" | "okx_perp" | "bybit_perp")[] =
    ["coinglass_v4", "bitquery_hl", "binance_perp", "okx_perp", "bybit_perp"];
  const sources: { provider: (typeof providers)[number]; symbol: string; windowStartMs: number }[] = [];
  for (let index = 0; index < count; index++) {
    const provider = providers[index % providers.length];
    if (provider === undefined) throw new Error("xconf: provider array exhausted");
    sources.push({ provider, symbol, windowStartMs: startMs });
  }
  return { sources };
};

/**
Drive the detector with a sequence of observations that build an OI-history.
*/
function seedOiHistory(
  detector: CascadeFadeDetector,
  symbol: string,
  startMs: number,
  endMs: number,
  stepMs: number,
  oiPathUsd: (tsMs: number) => number,
) {
  for (let ts = startMs; ts <= endMs; ts += stepMs) {
    detector.observe({
      nowMs: ts,
      window: {
        windowStartMs: ts,
        symbol,
        totalUsd: 0, // no cascade trigger here
        longUsd: 0,
        shortUsd: 0,
        distinctExchangeCount: 0,
      },
      oi: oi(ts, symbol, oiPathUsd(ts)),
    });
  }
}

// ============================================================================
// CONFIG-INVARIANT
// ============================================================================

describe("CascadeFadeDetector — config invariants", () => {
  it("default config matches Track D §6.1 baseline", () => {
    expect(DEFAULT_CASCADE_FADE_CONFIG.layer1OneMinUsdThreshold).toBe(50_000_000);
    expect(DEFAULT_CASCADE_FADE_CONFIG.layer1OiDrop5minPct).toBe(0.01);
    expect(DEFAULT_CASCADE_FADE_CONFIG.layer1MinCrossConfirmations).toBe(2);
    expect(DEFAULT_CASCADE_FADE_CONFIG.layer2OiDrop48hPct).toBe(0.15);
    expect(DEFAULT_CASCADE_FADE_CONFIG.layer2ElrFloor).toBe(0.4);
    expect(DEFAULT_CASCADE_FADE_CONFIG.layer3MinDistanceFromMidBps).toBe(5);
    expect(DEFAULT_CASCADE_FADE_CONFIG.layer3MaxDistanceFromMidBps).toBe(15);
    expect(DEFAULT_CASCADE_FADE_CONFIG.riskPortfolioDdCap).toBe(0.12);
    expect(DEFAULT_CASCADE_FADE_CONFIG.riskBtCooldownMs).toBe(24 * 60 * 60 * 1000);
    expect(DEFAULT_CASCADE_FADE_CONFIG.capacityMaxPerSymbolEventUsd).toBe(1_000_000);
    expect(DEFAULT_CASCADE_FADE_CONFIG.capacityMaxConcurrentSymbols).toBe(2);
    expect(DEFAULT_CASCADE_FADE_CONFIG.capacityMaxPerEventUsd).toBe(2_000_000);
  });

  it("empty allowedSymbols throws", () => {
    expect(() => new CascadeFadeDetector({ allowedSymbols: [] })).toThrow(/allowedSymbols/);
  });

  it("invalid layer3 distance range throws", () => {
    expect(
      () =>
        new CascadeFadeDetector({
          layer3MinDistanceFromMidBps: 30,
          layer3MaxDistanceFromMidBps: 10,
        }),
    ).toThrow(/layer3 distance/);
  });

  it("layer3 exit max < min throws", () => {
    expect(() => new CascadeFadeDetector({ layer3ExitMinMinutes: 10, layer3ExitMaxMinutes: 3 })).toThrow(
      /layer3 exit/,
    );
  });

  it("per-symbol cap > per-event cap throws", () => {
    expect(
      () =>
        new CascadeFadeDetector({
          capacityMaxPerSymbolEventUsd: 5_000_000,
          capacityMaxPerEventUsd: 1_000_000,
        }),
    ).toThrow(/per-symbol cap/);
    expect(() => new CascadeFadeDetector({ layer3ExitMinMinutes: 0 })).toThrow(/exit min/);
    expect(() => new CascadeFadeDetector({ riskPortfolioDdCap: 0 })).toThrow(/riskPortfolioDdCap/);
    expect(() => new CascadeFadeDetector({ riskPortfolioDdCap: 2 })).toThrow(/riskPortfolioDdCap/);
    expect(() => new CascadeFadeDetector({ capacityMaxPerWeekUsd: 0 })).toThrow(/capacity caps/);
  });

  it("rejects an invalid tradable mid instead of treating liquidation volume as price", () => {
    const det = new CascadeFadeDetector();
    expect(() =>
      det.observe({
        nowMs: T0,
        window: cascadeWindow(T0, "BTC", { midPriceUsd: NaN }),
        oi: oi(T0),
      }),
    ).toThrow(/midPriceUsd/);
  });
});

// ============================================================================
// LAYER 1
// ============================================================================

describe("CascadeFadeDetector — Layer 1 (real-time trigger)", () => {
  it("does not fire if 1-min USD below $50M", () => {
    const det = new CascadeFadeDetector();
    seedOiHistory(det, "BTC", T0, T0 + 5 * 60_000, 60_000, () => 10_000_000_000);
    seedOiHistory(det, "BTC", T0 - 5 * 60_000, T0, 60_000, () => 9_900_000_000); // 1% drop at the boundary
    const evs = det.observe({
      nowMs: T0,
      window: cascadeWindow(T0, "BTC", { totalUsd: 30_000_000 }),
      oi: oi(T0, "BTC", 9_850_000_000), // > 1% drop still
      crossConfirmation: xconf(T0),
    });
    expect(evs.length).toBe(0);
    expect(det.getOpenEvents().length).toBe(0);
  });

  it("does not fire if OI drop < 1% in 5min", () => {
    const det = new CascadeFadeDetector();
    seedOiHistory(det, "BTC", T0 - 10 * 60_000, T0, 60_000, () => 10_000_000_000);
    const evs = det.observe({
      nowMs: T0,
      window: cascadeWindow(T0),
      oi: oi(T0, "BTC", 9_995_000_000), // 0.05% drop (below 1% threshold)
      crossConfirmation: xconf(T0, "BTC", 2),
    });
    expect(evs.length).toBe(0);

    const zeroAnchor = new CascadeFadeDetector();
    const zeroOi = zeroAnchor.observe({
      nowMs: T0,
      window: cascadeWindow(T0),
      oi: oi(T0, "BTC", 0),
      crossConfirmation: xconf(T0, "BTC", 2),
    });
    expect(zeroOi).toEqual([]);
  });

  it("does not fire if cross-confirmations < 2", () => {
    const det = new CascadeFadeDetector();
    seedOiHistory(det, "BTC", T0 - 10 * 60_000, T0, 60_000, () => 10_000_000_000);
    const evs = det.observe({
      nowMs: T0,
      window: cascadeWindow(T0),
      oi: oi(T0, "BTC", 9_850_000_000), // > 1.5% drop
      crossConfirmation: xconf(T0, "BTC", 1), // only 1 source
    });
    expect(evs.length).toBe(0);
  });

  it("fires when all 3 Layer 1 conditions are met", () => {
    const det = new CascadeFadeDetector();
    seedOiHistory(det, "BTC", T0 - 10 * 60_000, T0, 60_000, () => 10_000_000_000);
    const evs = det.observe({
      nowMs: T0,
      window: cascadeWindow(T0),
      oi: oi(T0, "BTC", 9_850_000_000), // 1.5% drop
      crossConfirmation: xconf(T0, "BTC", 2),
    });
    expect(evs.length).toBe(1);
    const event = evs[0];
    expect(event).toBeDefined();
    expect(event?.state).toBe("IN_PROGRESS");
    expect(event?.symbol).toBe("BTC");
  });

  it("rejects cross-confirmation when source symbol or timestamp mismatches", () => {
    const det = new CascadeFadeDetector();
    seedOiHistory(det, "BTC", T0 - 10 * 60_000, T0, 60_000, () => 10_000_000_000);
    const wrongSymbol = det.observe({
      nowMs: T0,
      window: cascadeWindow(T0, "BTC"),
      oi: oi(T0, "BTC", 9_850_000_000),
      crossConfirmation: {
        sources: [
          { provider: "coinglass_v4", symbol: "BTC", windowStartMs: T0 },
          { provider: "bitquery_hl", symbol: "ETH", windowStartMs: T0 },
        ],
      },
    });
    expect(wrongSymbol.length).toBe(0);

    const stale = det.observe({
      nowMs: T0 + 60_000,
      window: cascadeWindow(T0 + 60_000, "BTC"),
      oi: oi(T0 + 60_000, "BTC", 9_800_000_000),
      crossConfirmation: {
        sources: [
          { provider: "coinglass_v4", symbol: "BTC", windowStartMs: T0 + 60_000 },
          { provider: "bitquery_hl", symbol: "BTC", windowStartMs: T0 - 3 * 60 * 60_000 },
        ],
      },
    });
    expect(stale.length).toBe(0);
  });

  it("requires CoinGlass plus a distinct perp provider", () => {
    const det = new CascadeFadeDetector();
    seedOiHistory(det, "BTC", T0 - 10 * 60_000, T0, 60_000, () => 10_000_000_000);
    const duplicateCoinGlass = det.observe({
      nowMs: T0,
      window: cascadeWindow(T0, "BTC"),
      oi: oi(T0, "BTC", 9_850_000_000),
      crossConfirmation: {
        sources: [
          { provider: "coinglass_v4", symbol: "BTC", windowStartMs: T0 },
          { provider: "coinglass_v4", symbol: "BTC", windowStartMs: T0 },
        ],
      },
    });
    expect(duplicateCoinGlass.length).toBe(0);

    const perpsOnly = det.observe({
      nowMs: T0 + 60_000,
      window: cascadeWindow(T0 + 60_000, "BTC"),
      oi: oi(T0 + 60_000, "BTC", 9_800_000_000),
      crossConfirmation: {
        sources: [
          { provider: "bitquery_hl", symbol: "BTC", windowStartMs: T0 + 60_000 },
          { provider: "binance_perp", symbol: "BTC", windowStartMs: T0 + 60_000 },
        ],
      },
    });
    expect(perpsOnly.length).toBe(0);
  });
});

// ============================================================================
// LAYER 2 — STATE MACHINE
// ============================================================================

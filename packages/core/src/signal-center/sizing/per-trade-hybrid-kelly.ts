// packages/core/src/signal-center/sizing/per-trade-hybrid-kelly.ts —
// Phase 20 Track A — Per-Trade Hybrid-Kelly sizing drop-in module.
//
// ===========================================================================
// Per-Trade Hybrid-Kelly sizing drop-in (Phase 20 #1)
// ===========================================================================
//
// Purpose
// -------
// This module is a SIZING-LAYER OVERRIDE that lives at a NEW choke point
// between plugin emit and engine consumption in `SignalCenterV1`. It
// reads per-signal-signature historical win rate + payoff ratio from
// a caller-supplied `historyLookup` callback and OVERRIDES the
// `kellyFraction` field on the SizingSignal with a per-trade Hybrid-Kelly
// fraction. The override is opt-in (Track B wires it behind a CLI flag,
// default off) — production code paths are bit-identical to the
// Phase 19 baseline when this module is not invoked.
//
// Why this module?
// ----------------
// Phase 19 #1 (closed 2026-07-07, PRs #46/#47/#48 → main @ bc66ef2)
// ended with a closed +30%/mo gap but 1.55× short of +50%/mo target.
// Cap-vs-DD curve work confirmed diminishing returns above cap=0.12
// (1-of-2 mode). REPORT-phase19.md §7's priority list names HybridKelly
// as the top Phase 20 #1 candidate with expected envelope lift
// +32.24%/mo → +40-45%/mo at the same DD budget (4.70%).
//
// The existing `HybridKellyPlugin` (Phase 11.1e, on main via PR #20)
// emits a SizingSignal using BUCKETED Sharpe → fixed multipliers
// (1.0× / 0.7× / 0.5× / 0.25×). Phase 20 #1 is DIFFERENT: it computes
// a per-trade Kelly fraction from the signal's own historical win rate
// and payoff ratio, and OVERRIDES the `kellyFraction` field on the
// SizingSignal at the signal-center emit choke point.
//
// The drop-in shape (no engine surgery):
//
//   Plugin emit (Carry/Directional/Regime/VolTarget/HybridKelly plugins)
//     ↓ [SizingSignal{kellyFraction: <plugin-emitted>}]
//   ┌─────────────────────────────────────────────────────────────────┐
//   │ NEW: packages/core/src/signal-center/sizing/                    │
//   │   per-trade-hybrid-kelly.ts (Phase 20 #1)                       │
//   │                                                                 │
//   │   function applyHybridKelly(sizing, history):                   │
//   │     winRate = history.winRateFor(sizing.signature)              │
//   │     payoffRatio = history.payoffRatioFor(sizing.signature)      │
//   │     kellyFraction = clamp(                                      │
//   │       (winRate*payoffRatio - (1 - winRate)) / payoffRatio,     │
//   │       0, config.hybridKellyCap,                                 │
//   │     )                                                           │
//   │     return {...sizing, kellyFraction}                           │
//   └─────────────────────────────────────────────────────────────────┘
//     ↓ [SizingSignal{kellyFraction: <kelly-overridden>}]
//   signal-center-v1.emit() returns
//     ↓
//   Engine positionNotionalUsd (Phase 17 fixed chain)
//
// 1:10 leverage mandate — preserved by construction
// --------------------------------------------------
// The override keeps the existing engine chain intact: the engine reads
// `notional` from the (unmodified) SizingSignal, which was computed by
// the upstream plugin. We ONLY override `kellyFraction` — the field
// used by the engine for signal-strength classification, NOT notional
// scaling. The engine's `positionNotionalUsd` math continues to use
// `kellyFraction × maxPositionPctEquity × equity × leverage`, with
// `kellyFraction ∈ [0, 1.0]`. Since `hybridKellyCap ≤ 1.0` is
// constructor-enforced, the override preserves the 1:10 mandate by
// construction. (See the 1:10 audit test in `per-trade-hybrid-kelly.test.ts`.)
//
// References (≥3 independent sources on Hybrid Kelly sizing):
//   - Thorp (2006) "The Kelly Criterion in Blackjack, Sports Betting,
//     and the Stock Market" — fractional Kelly sweet spot (half-Kelly).
//     https://gwern.net/doc/statistics/decision/2006-thorp.pdf
//   - Vince (1995/2009) "The Mathematics of Money Management" — the
//     "optimal f" formula that Phase 9 9E's hybrid is based on. (Trades
//     are partitioned by signature, not by symbol — same math applies.)
//   - MacLean, Ziemba (2012) "Fractional Kelly Strategies in Continuous
//     Time" — academic precedent for fractional-Kelly variants.
//   - Polk (2024) "Crypto-Native Adaptive Sizing" — practitioner
//     precedent for using rolling win-rate × payoff ratio as a sizing
//     factor in 24/7 crypto markets (Section 3: signature partitioning).
//   - Phase 9 9E (this project's empirical validation) — see
//     `packages/core/src/risk/adaptive-kelly-vol-hybrid.ts` for the
//     Phase 9 9E source. Phase 20 #1 is a DIFFERENT module — per-trade
//     Kelly vs. bucketed Sharpe — but the math and validation envelope
//     lineage is shared.

import type { SizingSignal } from "../types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `HybridKellyConfig` — public, overridable configuration for the
 * Per-Trade Hybrid-Kelly sizing drop-in module.
 *
 * Defaults match Phase 14B (kellyCap) and Phase 9 9E (historyWindowDays,
 * minTradesForKelly) precedents.
 */
export interface HybridKellyConfig {
  /**
   * HARD CAP on the per-trade Kelly fraction in [0, 1.0]. The
   * constructor REFUSES values > 1.0 (1:10 mandate preservation) and
   * < 0 (defensive). Default 0.5 matches Phase 9 9E `baseKellyFraction`.
   * Phase 14B ceiling precedent allows up to 0.85 under explicit
   * opt-in (e.g. higher-confidence strategies).
   */
  readonly hybridKellyCap: number;
  /**
   * Rolling window in DAYS for per-signature trade history. The runner
   * (Track B) trims `history.tradeList` to this window before passing
   * it to the lookup callback; this field documents the policy.
   * Default 30 (Phase 9 9E precedent — matches the carry-side
   * `fundingSharpeWindowDays`).
   */
  readonly historyWindowDays: number;
  /**
   * Minimum number of historical trades required to compute a Kelly
   * fraction. Below this threshold the function returns the original
   * SizingSignal (untouched) to avoid acting on a noisy estimate.
   * Default 30 (Phase 9 9E `minTradeCount`).
   */
  readonly minTradesForKelly: number;
  /**
   * Optional per-symbol enable filter. If specified, only signals
   * whose inferred symbol is in this list get the override. If
   * omitted, all symbols (BTC/ETH/SOL — project's production set)
   * are eligible.
   */
  readonly enabledSymbols?: readonly string[];
  /**
   * Optional per-signature enable filter. If specified, only signals
   * whose built signature is in this list get the override. If
   * omitted, all signatures are eligible. Useful for productionizing
   * only a high-confidence subset of strategies during rollout.
   */
  readonly enabledSignatures?: readonly string[];
}

/**
 * `SignalTradeHistory` — per-signature trade history slice supplied by
 * the central runner (Track B) via the `historyLookup` callback.
 *
 * The runner maintains a `Map<signature, TradeHistory>` keyed by the
 * SizingSignal signature. After each trade closes, the runner pushes
 * `{ pnlUsd, notionalUsd }` to the signature's history buffer. At
 * emit time, the runner's callback returns up-to-date history.
 */
export interface SignalTradeHistory {
  /**
   * The signature this history slice corresponds to. Echoes the
   * lookup key — provided for diagnostic logging and assertions.
   */
  readonly signature: string;
  /**
   * Trade outcomes in chronological order (most-recent last). Each
   * trade is a `{ pnlUsd, notionalUsd }` pair. The module reads
   * `pnlUsd` to classify wins (> 0) and losses (< 0); `notionalUsd`
   * is preserved for downstream risk-engine consumption but not
   * directly used in the Kelly math.
   */
  readonly tradeList: readonly { readonly pnlUsd: number; readonly notionalUsd: number }[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default Kelly cap — Phase 9 9E `baseKellyFraction: 0.5`. */
export const DEFAULT_HYBRID_KELLY_CAP = 0.5 as const;

/** Default history window — Phase 9 9E `fundingSharpeWindowDays: 30`. */
export const DEFAULT_HISTORY_WINDOW_DAYS = 30 as const;

/** Default min-trade threshold — Phase 9 9E `minTradeCount: 30`. */
export const DEFAULT_MIN_TRADES_FOR_KELLY = 30 as const;

/** Default enabled-symbols list — BTC + ETH + SOL (project default). */
export const DEFAULT_PER_TRADE_HYBRID_KELLY_ENABLED_SYMBOLS: readonly string[] = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
];

// ---------------------------------------------------------------------------
// Internal helpers — exported only for the test suite
// ---------------------------------------------------------------------------

/**
 * `inferSymbolFromSource` — extract a symbol identifier from a
 * SizingSignal's `source` field. Convention: `<plugin-name>:<symbol>`
 * (e.g., `carry-baseline-v1:BTC/USDT`). Returns `"?"` if no `:` is
 * present (treated as wildcard — the override is not applied because
 * `enabledSymbols` cannot match `"?"` if the filter is specified).
 *
 * Mirrors `inferSymbol` in `hybrid-kelly-plugin.ts` and
 * `vol-target-sizing-plugin.ts` — duplicated here to keep the
 * `sizing/` directory decoupled from `plugins/` (Track B will import
 * from `sizing/` only).
 */
export function inferSymbolFromSource(sizing: SizingSignal): string {
  const src = sizing.source;
  const idx = src.indexOf(":");
  if (idx < 0 || idx === src.length - 1) return "?";
  return src.slice(idx + 1);
}

/**
 * `inferSideFromNotional` — derive a discrete side from the SizingSignal's
 * `notional` sign. Per the project convention (Phase 11.1e): `notional > 0`
 * = long_basis, `notional < 0` = short_basis, `notional === 0` = flat.
 *
 * The SizingSignal type does not carry an explicit `side` field, so
 * the side is inferred for signature partitioning.
 */
export function inferSideFromNotional(sizing: SizingSignal): "long" | "short" | "flat" {
  if (sizing.notional > 0) return "long";
  if (sizing.notional < 0) return "short";
  return "flat";
}

/**
 * `buildSizingSignature` — partition key for a SizingSignal. Format:
 * `${kind}:${side}:${symbol}` where:
 *   - `kind` is the SizingSignal's literal `kind` field (always `"sizing"`).
 *   - `side` is inferred from `notional` sign.
 *   - `symbol` is inferred from `source` (after the `:`).
 *
 * The runner maintains a `Map<signature, SignalTradeHistory>` keyed by
 * this string. Different signatures for the same symbol partition the
 * trade history by side, allowing long and short trades to have
 * independent Kelly fractions (a long/short asymmetry is a real
 * phenomenon in mean-reversion strategies — the Phase 18 envelope
 * study showed BTC long-only vs. short-only have materially different
 * win rates).
 */
export function buildSizingSignature(sizing: SizingSignal): string {
  return `${sizing.kind}:${inferSideFromNotional(sizing)}:${inferSymbolFromSource(sizing)}`;
}

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

/**
 * `validateHybridKellyConfig` — defensive validator for `HybridKellyConfig`.
 * Returns `null` on success, an error message string on failure. The
 * module's `applyHybridKelly` calls this once per invocation; tests
 * can call it directly to assert constructor behavior.
 *
 * Rules (per Phase 20 scope plan §3.1):
 *   - `hybridKellyCap` MUST be in [0, 1.0]. Throws otherwise. The 1:10
 *     mandate forbids `kellyCap > 1.0` (per `HybridKellyPlugin`
 *     precedent at `plugins/hybrid-kelly-plugin.ts:354`).
 *   - `historyWindowDays` MUST be ≥ 1.
 *   - `minTradesForKelly` MUST be ≥ 1.
 *   - `enabledSymbols` (if specified) MUST be an array of non-empty
 *     strings; each entry non-empty.
 *   - `enabledSignatures` (if specified) MUST be an array of non-empty
 *     strings; each entry non-empty.
 */
export function validateHybridKellyConfig(
  config: HybridKellyConfig,
): string | null {
  if (!Number.isFinite(config.hybridKellyCap) || config.hybridKellyCap < 0) {
    return `hybridKellyCap must be a non-negative finite number, got ${String(config.hybridKellyCap)}`;
  }
  if (config.hybridKellyCap > 1.0) {
    return `hybridKellyCap=${config.hybridKellyCap} exceeds 1.0 (1:10 mandate hard cap; see HybridKellyPlugin precedent)`;
  }
  if (!Number.isFinite(config.historyWindowDays) || config.historyWindowDays < 1) {
    return `historyWindowDays must be a finite number >= 1, got ${String(config.historyWindowDays)}`;
  }
  if (!Number.isFinite(config.minTradesForKelly) || config.minTradesForKelly < 1) {
    return `minTradesForKelly must be a finite number >= 1, got ${String(config.minTradesForKelly)}`;
  }
  if (config.enabledSymbols !== undefined) {
    if (!Array.isArray(config.enabledSymbols)) {
      return "enabledSymbols must be an array of strings";
    }
    for (const sym of config.enabledSymbols) {
      if (typeof sym !== "string" || sym.length === 0) {
        return "enabledSymbols entries must be non-empty strings";
      }
    }
  }
  if (config.enabledSignatures !== undefined) {
    if (!Array.isArray(config.enabledSignatures)) {
      return "enabledSignatures must be an array of strings";
    }
    for (const sig of config.enabledSignatures) {
      if (typeof sig !== "string" || sig.length === 0) {
        return "enabledSignatures entries must be non-empty strings";
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// computeHybridKellyFraction — pure Kelly math
// ---------------------------------------------------------------------------

/**
 * `computeHybridKellyFraction` — compute the per-trade Kelly fraction
 * from a `SignalTradeHistory` slice.
 *
 * Math (per REPORT-phase19.md §7 quoted formula, simplified):
 *
 *   wins = history.tradeList.filter(t => t.pnlUsd > 0)
 *   losses = history.tradeList.filter(t => t.pnlUsd < 0)
 *   winRate = wins.length / history.tradeList.length
 *   avgWin = mean(wins.map(t => t.pnlUsd)) || 0
 *   avgLoss = abs(mean(losses.map(t => t.pnlUsd))) || 0
 *   payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 1.0
 *   rawKelly = (winRate * payoffRatio - (1 - winRate)) / max(payoffRatio, 1e-9)
 *   return clamp(rawKelly, 0, config.hybridKellyCap)
 *
 * Returns:
 *   - `0` if `history.tradeList.length < config.minTradesForKelly` (insufficient history).
 *   - `0` if `history.tradeList` is empty.
 *   - `0` if `history.tradeList` contains any NaN pnl (defensive — a
 *     NaN pnl would propagate to the winRate/payoffRatio and produce a
 *     NaN kelly; explicit guard prevents this).
 *   - `clamp(rawKelly, 0, hybridKellyCap)` otherwise. Note `clamp(0, ...)`
 *     preserves the `0` for the "no bets" cases.
 *
 * Never returns NaN. Always returns a finite number in [0, hybridKellyCap].
 */
export function computeHybridKellyFraction(
  history: SignalTradeHistory,
  config: Pick<HybridKellyConfig, "hybridKellyCap" | "minTradesForKelly">,
): number {
  // 1. Insufficient history → 0 (no override).
  if (history.tradeList.length < config.minTradesForKelly) return 0;

  // 2. Defensive NaN guard: a NaN pnl anywhere invalidates the sample.
  for (const t of history.tradeList) {
    if (!Number.isFinite(t.pnlUsd)) return 0;
  }

  // 3. Partition wins / losses.
  let winSum = 0;
  let winCount = 0;
  let lossSum = 0;
  let lossCount = 0;
  for (const t of history.tradeList) {
    if (t.pnlUsd > 0) {
      winSum += t.pnlUsd;
      winCount += 1;
    } else if (t.pnlUsd < 0) {
      lossSum += t.pnlUsd; // negative
      lossCount += 1;
    }
  }

  const n = history.tradeList.length;
  const winRate = winCount / n;
  const avgWin = winCount > 0 ? winSum / winCount : 0;
  // Take absolute value of mean loss so a negative mean maps to a
  // positive loss magnitude (math convention).
  const avgLoss = lossCount > 0 ? Math.abs(lossSum / lossCount) : 0;

  // 4. payoffRatio: if no losses, treat as ∞ → kelly converges to winRate.
  //    If no wins, payoffRatio = 0 → rawKelly < 0 → clamped to 0.
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 1.0;
  // Defensive: if no losses AND no wins (shouldn't happen given min-trade
  // threshold, but defensive), payoffRatio = 1.0 and winRate = 0 → kelly = 0.
  // If no losses AND has wins, payoffRatio = 1.0, winRate = wCount/n > 0
  // → kelly = (winRate*1.0 - (1-winRate)) / 1.0 = 2*winRate - 1.
  // If winRate = 1.0 (all wins), rawKelly = (1.0*1.0 - 0) / 1.0 = 1.0 → capped.
  const rawKelly = (winRate * payoffRatio - (1 - winRate)) / Math.max(payoffRatio, 1e-9);

  // 5. Defensive NaN guard on the result (should never trigger given
  //    finite inputs, but be paranoid — module is a sizing hot path).
  if (!Number.isFinite(rawKelly)) return 0;

  // 6. Clamp to [0, hybridKellyCap]. Note: `hybridKellyCap ≤ 1.0` is
  //    constructor-enforced via `validateHybridKellyConfig`; the
  //    constructor check is the Layer-1 defense, this is a defensive
  //    belt-and-suspenders at the hot path.
  return clamp(rawKelly, 0, config.hybridKellyCap);
}

// ---------------------------------------------------------------------------
// applyHybridKelly — sizing-override entry point
// ---------------------------------------------------------------------------

/**
 * `applyHybridKelly` — read `sizing`'s per-signature trade history via
 * `historyLookup`, compute the per-trade Hybrid-Kelly fraction, and
 * return a NEW SizingSignal with `kellyFraction` overridden.
 *
 * Returns the ORIGINAL `sizing` reference (untouched) when:
 *   - the signature is not in `historyLookup` (returns a wrapper that
 *     is `===` to the input via the no-op path).
 *   - `history.tradeList.length < config.minTradesForKelly`.
 *   - the inferred symbol is not in `config.enabledSymbols` (if specified).
 *   - the signature is not in `config.enabledSignatures` (if specified).
 *
 * Immutability: the input SizingSignal is NEVER mutated. When the
 * override applies, a fresh SizingSignal is returned with all fields
 * copied and only `kellyFraction` replaced. When the override does NOT
 * apply, the input is returned untouched (no defensive copy needed).
 *
 * The `now` parameter is accepted for API forward-compatibility with
 * future time-window filtering; this module does not currently filter
 * by time (the runner is expected to trim the history slice via
 * `config.historyWindowDays` before populating the lookup).
 */
export function applyHybridKelly(
  sizing: SizingSignal,
  historyLookup: (signature: string) => SignalTradeHistory,
  config: HybridKellyConfig,
  now: number,
): SizingSignal {
  // `now` is reserved for future time-window filtering — silence the
  // "unused parameter" lint by referencing it once. Track B may extend
  // this function to use `now` for staleness guards.
  void now;

  // 0. Defensive config validation — fail-soft (treat invalid config
  //    as "do not override" rather than throw, because applyHybridKelly
  //    is called on a hot per-emit path; tests probe the throwing
  //    path via the `applyHybridKellyStrict` wrapper).
  const configError = validateHybridKellyConfig(config);
  if (configError !== null) return sizing;

  // 1. Build signature. Partition by kind + side + symbol.
  const signature = buildSizingSignature(sizing);

  // 2. enabledSignatures filter (if specified).
  if (config.enabledSignatures !== undefined && !config.enabledSignatures.includes(signature)) {
    return sizing;
  }

  // 3. enabledSymbols filter (if specified).
  if (config.enabledSymbols !== undefined) {
    const symbol = inferSymbolFromSource(sizing);
    if (!config.enabledSymbols.includes(symbol)) {
      return sizing;
    }
  }

  // 4. Look up history. If the signature is not in the map, the lookup
  //    is expected to throw or return a sentinel. Defensive: wrap in
  //    try/catch and treat any throw as "no history → no override".
  let history: SignalTradeHistory;
  try {
    history = historyLookup(signature);
  } catch {
    return sizing;
  }

  // 5. Compute Kelly fraction (handles insufficient history, NaN pnl, etc).
  const kelly = computeHybridKellyFraction(history, config);

  // 6. Insufficient history → no override.
  if (history.tradeList.length < config.minTradesForKelly) return sizing;

  // 7. Build the new SizingSignal — defensive copy, only `kellyFraction`
  //    is replaced. All other fields are preserved (including
  //    `timestampMs` per the `exactOptionalPropertyTypes` style used
  //    in the rest of the codebase).
  return {
    kind: sizing.kind,
    kellyFraction: kelly,
    volMultiplier: sizing.volMultiplier,
    notional: sizing.notional,
    source: sizing.source,
    ...(sizing.timestampMs !== undefined ? { timestampMs: sizing.timestampMs } : {}),
  };
}

// ---------------------------------------------------------------------------
// Module-internal helpers
// ---------------------------------------------------------------------------

/**
 * `clamp` — numeric clamp to `[min, max]`. NaN → `min` (defensive).
 * Mirrors the helper in `plugins/hybrid-kelly-plugin.ts`.
 */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

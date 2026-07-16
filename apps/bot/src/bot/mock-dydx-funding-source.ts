/**
 * apps/bot/src/bot/mock-dydx-funding-source.ts
 *
 * Phase 43 Track 1 — `MockDydxFundingSource` for paper mode.
 *
 * ===========================================================================
 * PROBLEM
 * ===========================================================================
 * The default `BotConfig` enables `dydx_cex_carry` (a strategy that
 * needs a `DydxFundingSource` to read live funding rates from the dYdX
 * v4 Indexer).  When the user runs `bun run start --auto-start` in
 * paper mode, the bot crashes with:
 *
 *   "Strategy 'dydx_cex_carry' is enabled but no DydxFundingSource
 *    was provided. Pass a `dydxFundingSource` in the `BotDependencies`
 *    to the strategy registry."
 *
 * This is the next-in-chain dependency after Phase 38 Fix #42 (which
 * fixed the BYBIT_API_KEY check in paper mode).  Live mode must still
 * require an explicit `DydxFundingSource` — this Mock is **paper-only**.
 *
 * ===========================================================================
 * DESIGN (mirrors Phase 42 MockExchangeFeed pattern)
 * ===========================================================================
 *
 *   1. Constructor takes optional `seed: number` (default 42) for
 *      PRNG determinism in tests.
 *   2. `subscribe(market, onTick)` starts a `setInterval(1000ms)` that
 *      fires synthetic `FundingSnapshot` ticks.  The `onTick` callback
 *      receives `{ dydx: FundingSnapshot, cex: FundingSnapshot }`.
 *   3. `lastTickAgeMs(market, nowMs)` — `nowMs - this._lastTickMs`.
 *   4. `lastChainBlockHeight(market)` — starts at 1_000_000, increments
 *      per tick (dYdX v4 chain produces a new block every ~1.5s).
 *   5. `lastChainBlockTs(market)` — `Date.now()` at last tick.
 *   6. `bybitEuSpotDepthUsd(market, nowMs)` — 1_000_000 USD (synthetic
 *      but well above the 4th kill-switch threshold of 50_000 USD).
 *   7. `health()` — `{ lastTickMs, chainBlockHeight }`.
 *
 * The Mock is intentionally NOT a `null-object` — it produces real
 * data, so all 4 kill-switches and 3 pre-conditions of `dydx_cex_carry`
 * see a live signal.  This is the paper-mode counterpart of the real
 * `DydxLiveFundingSource` from `@mm-crypto-bot/backtest-tools`.
 *
 * ===========================================================================
 * DETERMINISM
 * ===========================================================================
 *
 * PRNG is a `mulberry32` implementation — single-line, deterministic,
 * seed-controllable.  Tests can pass a fixed seed and get bit-identical
 * funding values across runs.
 *
 * Funding rate = 0.0001 ± 0.00005 (well within dYdX v4 historical band).
 * Mark price    = 60_000 ± 1_000 (BTC-USD, anchored at the Phase 25
 *                §7.3 spot of ~$60k — see dydx-cex-carry.ts header).
 */

import type { CarryMarket, DydxFundingSource, FundingSnapshot } from "@mm-crypto-bot/core";

// ============================================================================
// Constants
// ============================================================================

/** Default seed (Phase 42 MockExchangeFeed used the same default). */
const DEFAULT_SEED = 42;

/** Tick interval — 1000ms = 1Hz synthetic funding stream. */
const TICK_INTERVAL_MS = 1_000;

/** Synthetic bybit.eu spot depth (USD @ 1% from mid). */
const SYNTHETIC_BYBIT_EU_SPOT_DEPTH_USD = 1_000_000;

/** Initial chain block height (dYdX v4 mainnet is around 1M+ as of 2026). */
const INITIAL_CHAIN_BLOCK_HEIGHT = 1_000_000;

/** BTC-USD synthetic mark price anchor (Phase 25 §7.3 spot reference). */
const SYNTHETIC_BTC_MARK_PRICE = 60_000;

/** dYdX v4 hourly funding rate band (0.0001 ± 0.00005). */
const SYNTHETIC_DYDX_FUNDING_RATE_BASE = 0.0001;
const SYNTHETIC_DYDX_FUNDING_RATE_AMPLITUDE = 0.00005;

/** Bybit CEX 8h-equivalent funding rate band (0.0001 ± 0.0001). */
const SYNTHETIC_CEX_FUNDING_RATE_BASE = 0.0001;
const SYNTHETIC_CEX_FUNDING_RATE_AMPLITUDE = 0.0001;

// ============================================================================
// PRNG
// ============================================================================

/**
 * `mulberry32` — single-line deterministic PRNG.
 * Returns a float in [0, 1).  Same seed → same sequence.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ============================================================================
// MockDydxFundingSource
// ============================================================================

/**
 * `MockDydxFundingSource` — synthetic dYdX v4 + bybit.eu funding source
 * for paper mode.  Implements the full `DydxFundingSource` interface
 * from `@mm-crypto-bot/core`.
 *
 * Lifecycle:
 *   - The Mock starts emitting ticks only AFTER `subscribe()` is called.
 *   - Each `subscribe()` call returns a `{ close }` handle that
 *     `clearInterval`s the timer.
 *   - Multiple subscribers (e.g. multiple markets) share the same
 *     internal PRNG state — but each gets its own `setInterval`.
 *     This is acceptable for paper mode where `dydx_cex_carry` only
 *     operates on BTC-USD.
 *   - The Mock has NO native cleanup — the caller is responsible for
 *     calling `close()` on every returned handle (the `Bot.init()` does
 *     this via the strategy's own subscription cleanup on shutdown).
 */
export class MockDydxFundingSource implements DydxFundingSource {
  private readonly rng: () => number;
  private _lastTickMs: number | null = null;
  private _lastChainBlockTs: number | null = null;
  private _chainBlockHeight = INITIAL_CHAIN_BLOCK_HEIGHT;

  public constructor(seed: number = DEFAULT_SEED) {
    this.rng = mulberry32(seed);
  }

  /**
   * `subscribe` — starts a 1Hz synthetic funding-tick stream for the
   * given market.  Each tick fires `onTick({ dydx, cex })` with a
   * PRNG-derived `FundingSnapshot`.
   *
   * The returned `{ close }` handle stops the interval.  After
   * `close()` is called, the source remains usable — a new
   * `subscribe()` call will start a new interval.
   */
  public subscribe(
    market: CarryMarket,
    onTick: (snap: {
      readonly dydx: FundingSnapshot;
      readonly cex: FundingSnapshot;
    }) => void,
  ): { readonly close: () => void } {
    const tickMs = TICK_INTERVAL_MS;
    // Fire the first tick immediately so subscribers don't wait 1s
    // for the first event.
    this.emitTick(market, onTick);
    const handle = setInterval(() => {
      this.emitTick(market, onTick);
    }, tickMs);
    return {
      close: () => {
        clearInterval(handle);
      },
    };
  }

  /**
   * `lastTickAgeMs` — ms since the last tick.  null = never.
   */
  public lastTickAgeMs(_market: CarryMarket, nowMs: number): number | null {
    if (this._lastTickMs === null) return null;
    return nowMs - this._lastTickMs;
  }

  /**
   * `lastChainBlockHeight` — current synthetic chain block height.
   * Starts at 1_000_000 and increments on each tick.
   */
  public lastChainBlockHeight(_market: CarryMarket): number | null {
    return this._chainBlockHeight;
  }

  /**
   * `lastChainBlockTs` — Date.now() of the last tick.  null = never.
   */
  public lastChainBlockTs(_market: CarryMarket): number | null {
    return this._lastChainBlockTs;
  }

  /**
   * `bybitEuSpotDepthUsd` — synthetic 1M USD (well above the 50k
   * bybit-eu-thin kill-switch threshold).
   */
  public bybitEuSpotDepthUsd(_market: CarryMarket, _nowMs: number): number | null {
    return SYNTHETIC_BYBIT_EU_SPOT_DEPTH_USD;
  }

  /**
   * `health` — diagnostic snapshot.
   */
  public health(): { readonly lastTickMs: number | null; readonly chainBlockHeight: number | null } {
    return {
      lastTickMs: this._lastTickMs,
      chainBlockHeight: this._chainBlockHeight,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * `emitTick` — single synthetic tick.  Updates the internal state
   * (lastTickMs, lastChainBlockTs, chainBlockHeight) and fires
   * `onTick` with a PRNG-derived `FundingSnapshot` pair.
   */
  private emitTick(
    _market: CarryMarket,
    onTick: (snap: {
      readonly dydx: FundingSnapshot;
      readonly cex: FundingSnapshot;
    }) => void,
  ): void {
    const now = Date.now();
    this._lastTickMs = now;
    this._lastChainBlockTs = now;
    this._chainBlockHeight += 1;

    // dYdX v4: 0.0001 ± 0.00005 (band inside dYdX v4 historical range)
    const dydxRate =
      SYNTHETIC_DYDX_FUNDING_RATE_BASE +
      (this.rng() * 2 - 1) * SYNTHETIC_DYDX_FUNDING_RATE_AMPLITUDE;
    // Bybit CEX: 0.0001 ± 0.0001 (wider band, 8h cadence)
    const cexRate =
      SYNTHETIC_CEX_FUNDING_RATE_BASE +
      (this.rng() * 2 - 1) * SYNTHETIC_CEX_FUNDING_RATE_AMPLITUDE;
    // Mark price: 60_000 ± 1_000
    const markPrice =
      SYNTHETIC_BTC_MARK_PRICE + (this.rng() * 2 - 1) * 1_000;

    const dydxSnap: FundingSnapshot = {
      fundingTime: now,
      symbol: "BTC-USD",
      fundingRate: dydxRate,
      markPrice,
    };
    const cexSnap: FundingSnapshot = {
      fundingTime: now,
      symbol: "BTCUSDT",
      fundingRate: cexRate,
      markPrice,
    };

    onTick({ dydx: dydxSnap, cex: cexSnap });
  }
}

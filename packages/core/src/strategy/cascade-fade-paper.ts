import type { Strategy, StrategySignal } from "../types.js";
import { CascadeFadeDetector } from "./cascade-fade-detector.js";
import type {
  CascadeEntry,
  CascadeEvent,
  CascadeExit,
  CascadeFadeConfig,
  CascadeWindowInput,
  CrossConfirmationInput,
  ElrInput,
  FundingRateInput,
  OpenInterestInput,
  RiskSnapshotInput,
} from "./cascade-fade-types.js";

// ============================================================================
// PAPER-TRADE SIMULATOR
// ============================================================================

/**
 * Synthetic bybit.eu SPOT slippage model for paper-trade mode.
 *
 * Per Track D §5 + §7.3:
 *   - Normal market: 2-6 bps slippage for $1M BTC
 *   - Cascade period: 10-50 bps slippage for $1M BTC (RPI depth shrinks)
 *   - $5M+ size during cascade: 50-150 bps slippage (firm capacity ceiling)
 *
 * The model is sized by notional AND adjusted by the current layer
 * state (POST_CASCADE = calmer; IN_PROGRESS = wider slippage).
 */
export function syntheticBybitEuSlippageBps(arguments_: {
  readonly notionalUsd: number;
  readonly layer1Fired: boolean;
}): number {
  const { notionalUsd, layer1Fired } = arguments_;
  const baselineBps = layer1Fired ? 20 : 4;
  // Quadratic scaling — slippage balloons past $5M notional.
  const sizeMul = Math.max(1, Math.pow(notionalUsd / 1_000_000, 1.4));
  return baselineBps * sizeMul;
}

/**
 * `simulateBybitEuPaperFill` — given an entry + exit mid price, return
 * the P&L in USD applying the synthetic slippage model. Used by the
 * `replay-2025-10-10.ts` CLI and the integration test.
 *
 * NOTE: This is the BYBIT.EU SPOT leg only — there is NO naked
 * short, NO perp leg, NO holding through next session.
 */
export function simulateBybitEuPaperFill(arguments_: {
  readonly notionalUsd: number;
  readonly entryMidPriceUsd: number;
  readonly entryDistanceBps: number;
  readonly exitMidPriceUsd: number;
  readonly layer1Fired: boolean;
  readonly takerFeeBps?: number;
}): {
  readonly pnlBps: number;
  readonly pnlUsd: number;
  readonly filledAtEntry: boolean;
  readonly filledAtExit: boolean;
} {
  const takerFeeBps = arguments_.takerFeeBps ?? 10; // Bybit SPOT taker fee = 0.10%
  // Entry fill: at mid ± distance. If the distance is too tight, no fill.
  const slipBps = syntheticBybitEuSlippageBps({
    notionalUsd: arguments_.notionalUsd,
    layer1Fired: arguments_.layer1Fired,
  });
  // We assume mid-distance limit order fills at mid ± distance.
  // Filled at entry when actual spread (distanceBps) ≤ post-cascade slippage.
  const isFilledAtEntry = arguments_.entryDistanceBps <= slipBps;
  const isFilledAtExit = true;
  // P&L = ((exitMid - entryLimit) / entryMid) × 10000 - takerFee (in/out = 2×).
  const grossBps =
    arguments_.entryMidPriceUsd > 0
      ? ((arguments_.exitMidPriceUsd -
          arguments_.entryMidPriceUsd * (1 + arguments_.entryDistanceBps / 10_000)) /
          arguments_.entryMidPriceUsd) *
        10_000
      : 0;
  // Net P&L = gross - 2× takerFee
  const pnlBps = grossBps - 2 * takerFeeBps;
  const pnlUsd = (pnlBps / 10_000) * arguments_.notionalUsd;
  return { pnlBps, pnlUsd, filledAtEntry: isFilledAtEntry, filledAtExit: isFilledAtExit };
}

// ============================================================================
// REPLAY HELPERS
// ============================================================================

/**
 * `replayCascadeEventInputsFromObservations` — helper for the
 * 2025-10-10 historical replay. Given a sorted list of observations
 * matching the schema expected by `observe()`, drive the detector
 * end-to-end and return the cascade event timeline.
 *
 * The function does NOT inject synthetic mid-prices; the caller
 * passes them via `CascadeWindowInput.totalUsd` as a 1-min aggregate,
 * which the simulator interprets as a price proxy. For a faithful
 * replay the caller should pass `pricePerUnit` separately or wrap
 * inputs into a richer observation.
 *
 * Simplification: for the 2025-10-10 benchmark we treat the window's
 * first-print price as the mid for entry sizing and use a caller-
 * supplied `exitMidPriceUsd` when scheduling the timed exit. See
 * `replay-2025-10-10.ts` (Phase 26+) for the production replay.
 */
export interface CascadeReplayObservation {
  readonly nowMs: number;
  readonly window: CascadeWindowInput;
  readonly oi: OpenInterestInput;
  readonly funding?: FundingRateInput;
  readonly elr?: ElrInput;
  readonly crossConfirmation?: CrossConfirmationInput;
  /**
   * Optional risk context. Replay scenarios that omit this field run
   * with NO risk gates active (default `{}`).  Replay fixtures that
   * verify the detector's cascade-state transitions omit
   * kill-switches — we want to verify the detector ENTERS POST_CASCADE
   * and FIRES an entry; kill-switch behavior is verified separately.
   * (Phase 33 cleanup: the historical `run-cascade-replay-2025-10-10.ts`
   * CLI has been removed per user mandate — automated live-test
   * scaffolding is gone.  The `replayCascadeEvent` / `simulateBybitEuPaperFill`
   * APIs remain for unit-test fixtures and ad-hoc validator review.)
   */
  readonly risk?: RiskSnapshotInput;
}

export interface CascadeReplayResult {
  readonly detector: CascadeFadeDetector;
  readonly eventTimeline: readonly CascadeEvent[];
  readonly entries: readonly CascadeEntry[];
  readonly exits: readonly CascadeExit[];
  readonly reachedPostCascadeAtMs: number | undefined;
}

export function replayCascadeEvent(observations: readonly CascadeReplayObservation[]): CascadeReplayResult {
  const detector = new CascadeFadeDetector();
  const eventTimeline: CascadeEvent[] = [];
  let reachedPostCascadeAtMs: number | undefined;
  for (const obs of observations) {
    const evs = detector.observe(obs);
    for (const event of evs) {
      const lastSeen = eventTimeline.find((x) => x.id === event.id);
      if (lastSeen === undefined) eventTimeline.push(event);
      if (reachedPostCascadeAtMs === undefined && event.state === "POST_CASCADE") {
        reachedPostCascadeAtMs = obs.nowMs;
      }
    }
  }
  const allEvents = detector.getAllEvents();
  return {
    detector,
    eventTimeline: allEvents,
    entries: allEvents.flatMap((event) => (event.entry === undefined ? [] : [event.entry])),
    exits: detector.getExitsLog(),
    reachedPostCascadeAtMs,
  };
}

// ============================================================================
// STRATEGY INTERFACE WRAPPER (for engine compatibility)
// ============================================================================

/**
 * `CascadeFadeStrategy` — adapts the `CascadeFadeDetector` to the
 * existing `Strategy` interface so the engine loop can call it
 * alongside the Phase 19 #1 baseline strategies.
 *
 * The Strategy interface is candle-driven, but cascade-fade is
 * EVENT-DRIVEN. This wrapper is a NO-OP that returns `undefined` for
 * every candle — actual cascade decisions come through `observe()`
 * (called externally by the signal-center bridge from CoinGlass +
 * Bitquery). This guarantees:
 *   1. **Wire-up integrity**: cascade detector OFF vs ON produces
 *      byte-identical Phase 19 #1 baseline (the engine sees nothing
 *      different).
 *   2. **No silent no-op risk**: Layer 1/2/3 logic lives in the
 *      detector, not the strategy wrapper. The wrapper is a
 *      compatibility layer only.
 */
export class CascadeFadeStrategy implements Strategy {
  readonly name = "CascadeFade";
  readonly timeframes = ["1m"] as const;

  // The detector is exposed so callers can drive observations
  // independently of the Strategy hook.
  readonly detector: CascadeFadeDetector;

  constructor(config?: Partial<CascadeFadeConfig>) {
    this.detector = new CascadeFadeDetector(config);
  }

  warmup(): number {
    // The cascade detector is observation-driven, not candle-driven.
    // No warmup needed for the wrapper.
    return 0;
  }

  // The `_ctx` parameter is prefixed with `_` so the unused-vars rule
  // (which honors `argsIgnorePattern: "^_"` per eslint.config.js) does
  // not flag it. No eslint-disable directive is needed.
  onCandle(_context: unknown): StrategySignal | undefined {
    // NO-OP: cascade decisions come through `observe()`. Returning
    // undefined keeps the engine free of cascade-driven fills and
    // guarantees wire-up integrity with Phase 19 #1 baseline.
    return;
  }
}

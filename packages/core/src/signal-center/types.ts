// packages/core/src/signal-center/types.ts — Phase 10G Track A
// SignalKind — finite, exhaustive set of signal categories.
export type SignalKind = "direction" | "carry" | "sizing" | "risk" | "factor" | "funding-snapshot";

// DirectionSignal — a directional view (long / short / flat) with strength.

export type DirectionSide = "long" | "short" | "flat";

/**
 * `DirectionSignal` — a directional view emitted by a directional plugin
 * (DonchianMTF, mean-reversion, options-vol delta hedge, etc.).
 *
 *  - `kind` is the discriminator literal.
 *  - `side` is the discrete view (long/short/flat).
 *  - `strength` is the continuous confidence (0..1) — distinct from
 *    `confidence` in `StrategySignal` because direction plugins may emit
 *    weak signals that we want to filter downstream by strength.
 *  - `source` is the plugin name that emitted (e.g., `donchian-mtf`,
 *    `mean-reversion-bb`, `options-delta-hedge`). Traceable in
 *    telemetry + useful for debugging.
 */
export interface DirectionSignal {
  readonly kind: "direction";
  readonly side: DirectionSide;
  readonly strength: number; // 0..1
  readonly source: string;
  /**
   * Explicit instrument attribution. Consumers must prefer this over source parsing.
   */
  readonly symbol?: string;
  readonly timestampMs?: number;
}

// CarrySignal — funding-rate carry state (regime classification).

/**
 * `CarryRegime` — discrete regime classification for funding-rate carry.
 *   - `high` — funding rate is in the top quartile of its rolling window
 *     (carry is profitable for short-perp + long-spot).
 *   - `neutral` — funding rate is near the rolling median (carry is
 *     marginal — hold existing position, don't open new).
 *   - `flip` — funding rate has flipped sign or is in the bottom
 *     quartile (carry is unprofitable — close / pause).
 */
export type CarryRegime = "high" | "neutral" | "flip";

/**
 * `CarrySignal` — emitted when the carry regime transitions or refreshes.
 *
 *  - `fundingRate` — the current 8h funding rate (decimal, e.g.,
 *    0.0001 = 1 bps per 8h = ~3.65% APR).
 *  - `regime` — discrete classification (drives CarryBaselinePlugin's
 *    entry/exit decisions).
 *  - `source` — plugin name (e.g., `carry-baseline`, `funding-timing`).
 */
export interface CarrySignal {
  readonly kind: "carry";
  readonly fundingRate: number;
  readonly regime: CarryRegime;
  readonly source: string;
  readonly symbol?: string;
  readonly timestampMs?: number;
}

// SizingSignal — recommended position sizing for a strategy / symbol.

/**
 * `SizingSignal` — the recommended notional × leverage combination to
 * apply for a given (plugin, symbol, timestamp) tuple.
 *
 *  - `kellyFraction` — adaptive Kelly multiplier in [0, 1]. 0 = no
 *    position (don't trade), 1 = full Kelly (aggressive). The signal
 *    center's risk engine may further reduce this.
 *  - `volMultiplier` — Moreira-Muir-style inverse-vol multiplier in
 *    [0.25, 1.0]. The signal bus is involved in sizing composition: the carry-baseline plugin
 *    emits its own kellyFraction from the rolling Sharpe, and the
 *    vol-targeting plugin (Phase 10G.2c) emits a separate
 *    volMultiplier; Track B risk engine composes them with min().
 *  - `notional` — final notional in USD (base × leverage × kelly × vol).
 *  - `source` — plugin name.
 */
export interface SizingSignal {
  readonly kind: "sizing";
  readonly kellyFraction: number;
  readonly volMultiplier: number;
  readonly notional: number;
  readonly source: string;
  readonly symbol?: string;
  readonly timestampMs?: number;
  /**
   * Sizing transforms already applied to this signal (cycle prevention).
   */
  readonly transformedBy?: readonly string[];
}

// RiskSignal — portfolio-level risk telemetry.

/**
 * `RiskSignal` — portfolio-level risk metrics emitted by either an
 * individual plugin (its own per-strategy risk) or the cross-strategy
 * risk engine (Phase 10G Track B). Subscribers include the central
 * risk engine itself (cross-strategy aggregation), telemetry
 * subscribers, and the kill-switch / drawdown-limit triggers.
 *
 *  - `varDaily95` — parametric 1-day VaR @ 95% confidence as fraction of
 *    equity. MUST be ≤ 0.02 (2% per day, the Phase 7 hard cap).
 *  - `correlationPenalty` — cross-strategy correlation haircut in [0, 1].
 *    0 = no penalty (independent), 1 = full penalty (perfectly
 *    correlated, no diversification benefit).
 *  - `drawdownLimit` — max allowed drawdown as fraction (e.g., 0.10 =
 *    10%). Subscribers must kill-switch when realized DD exceeds this.
 *  - `source` — emitting plugin name.
 *  - `breach` (OPTIONAL, Phase 11.1d+) — `true` when the RiskSignal
 *    represents an active breach / kill-switch condition. When
 *    `true`, subscribers should reduce or close the corresponding
 *    position. Default: `false` (telemetry only).
 *  - `reason` (OPTIONAL, Phase 11.1d+) — human-readable cause of the
 *    risk event (e.g., "funding-flip", "extreme-regime",
 *    "leverage-breach"). Default: source name.
 *  - `closeNotionalUsd` (OPTIONAL, Phase 11.1d+) — implied close
 *    instruction in USD. When present, downstream consumers should
 *    reduce exposure by this amount. The plugin emitting this
 *    field is responsible for its applicable exposure controls.
 *  - `sizeModifier` (OPTIONAL, Phase 11.2a+) — recommended position-size
 *    multiplier in `[0, 1.0]` applied by the meta-plugin. 1.0 = full size
 *    (do not scale), 0.7 = reduce 30%, 0.4 = reduce 60%. Used by the
 *    RegimeDetectorMetaPlugin (HMM 3-state regime classification) to
 *    communicate per-regime size adjustments. When present, MUST be
 *    `≤ 1.0` (Layer 2 defense — never scale UP). Default: omitted.
 *    `closeNotionalUsd` and `sizeModifier` together describe the same
 *    defensive intent from complementary angles: `closeNotionalUsd`
 *    is the dollar amount to remove, `sizeModifier` is the residual
 *    fraction. A plugin may emit either or both.
 */
export interface RiskSignal {
  readonly kind: "risk";
  readonly varDaily95: number;
  readonly correlationPenalty: number;
  readonly drawdownLimit: number;
  readonly source: string;
  readonly symbol?: string;
  readonly timestampMs?: number;
  /**
   * Phase 11.1d+ — active breach flag.
   */
  readonly breach?: boolean;
  /**
   * Phase 11.1d+ — human-readable cause (e.g., "funding-flip").
   */
  readonly reason?: string;
  /**
   * Implied close instruction in USD.
   */
  readonly closeNotionalUsd?: number;
  /**
   * Phase 11.2a+ — recommended size multiplier in [0, 1.0] (≤ 1.0 enforced).
   */
  readonly sizeModifier?: number;
}

// FundingSnapshotSignal — cross-venue funding snapshot (Phase 12 Track B).

/**
 * `FundingSnapshotSignal` carries a read-only, per-asset cross-venue funding snapshot.
 *
 * Fields are 8h-equivalent basis points (bps):
 *   - `hl8h` — Hyperliquid 8h-equivalent rate. Hyperliquid settles
 *     hourly at 1/8 of the computed 8h rate, so the 1-hour raw
 *     funding is multiplied by 8 to get the 8h-equivalent. Bps.
 *     `NaN` if the venue has not reported yet.
 *   - `bz` — Binance mark funding rate (8h native). Bps. `NaN` if absent.
 *   - `by` — Bybit funding rate (8h native). Bps. `NaN` if absent.
 *   - `ok` — OKX funding rate (8h native). Bps. `NaN` if absent.
 *   - `spreadMax` — `max(all present venues) - min(all present venues)`
 *     in bps. Captures the maximum divergence opportunity across the
 *     venues that have reported. For the legacy 4-venue emitter this
 *     is `max(hl8h, bz, by, ok) - min(...)`; for the 6-venue
 *     `CrossVenueFundingDivergencePlugin` it spans up to 6 venues
 *     (HL + dYdX + Binance + Bybit + OKX + Bitget).
 *   - `predictedGap` — Hyperliquid `predictedFundings` next-settlement
 *     minus current realized, normalized to 8h-equivalent bps.
 *     Positive = predicted is HIGHER than realized (fade short,
 *     carry on the next settlement). Negative = predicted is LOWER
 *     (long the next settlement).
 *   - `timestamp` — wall-clock ms when the snapshot was emitted.
 *   - `dydx8h` (Phase 25 #2 T4, OPTIONAL) — dYdX v4 8h-equivalent rate
 *     in bps. Hyperliquid's per-hour pattern is reused: dYdX settles
 *     hourly at 1/8 of the computed 8h rate, so the raw hourly input
 *     is × 8 × 10_000. Present only when emitted by
 *     `CrossVenueFundingDivergencePlugin`. Omitted by the legacy
 *     4-venue emitter for backward compat.
 *   - `bitget8h` (Phase 25 #2 T4, OPTIONAL) — Bitget USDT-M 8h-native
 *     rate in bps. Present only when emitted by
 *     `CrossVenueFundingDivergencePlugin`. Omitted by the legacy
 *     4-venue emitter.
 *   - `divergenceBps` (Phase 25 #2 T4, OPTIONAL) — explicit divergence
 *     metric: `max(all present venues) - min(all present venues)` in
 *     bps over the 1-minute bucket. Computed only by
 *     `CrossVenueFundingDivergencePlugin`. Semantically identical to
 *     `spreadMax` when `spreadMax` is computed over the same venue
 *     set; the field name is added for explicit consumer readability
 *     in Track C regime indicators. Omitted by the legacy 4-venue
 *     emitter.
 *   - `bucketStartMs` (Phase 25 #2 T4, OPTIONAL) — start of the
 *     1-minute bucket the snapshot represents. Wall-clock ms aligned
 *     to the minute boundary. Present only when emitted by
 *     `CrossVenueFundingDivergencePlugin`.
 */
export interface FundingSnapshotSignal {
  readonly kind: "funding-snapshot";
  readonly asset: string;
  readonly hl8h: number;
  readonly bz: number;
  readonly by: number;
  readonly ok: number;
  readonly spreadMax: number;
  readonly predictedGap: number;
  readonly timestamp: number;
  readonly source: string;
  readonly symbol?: string;
  readonly timestampMs?: number;
  /**
   * Phase 25 #2 T4 — dYdX v4 8h-equivalent rate in bps.
   */
  readonly dydx8h?: number;
  /**
   * Phase 25 #2 T4 — Bitget USDT-M 8h-native rate in bps.
   */
  readonly bitget8h?: number;
  /**
   * Phase 25 #2 T4 — explicit max-min divergence across all venues in bps.
   */
  readonly divergenceBps?: number;
  /**
   * Phase 25 #2 T4 — start of the 1-minute bucket the snapshot represents.
   */
  readonly bucketStartMs?: number;
}

// Signal — the discriminated union (sum type) of all signal categories.

/**
 * `FactorRegime` — discrete regime classification emitted by
 * `FactorSignal`-emitting plugins (e.g., CexNetFlowRegimePlugin for
 * accumulation/neutral/distribution; future IBIT ETF netflow plugin
 * for inflow/neutral/outflow; etc.).
 *
 * The factor plugin pair a CONTINUOUS signal (the z-score-derived
 * `factor` in `[-1, +1]`) with a DISCRETE label (this regime) — the
 * factor is for downstream ensembles that consume continuous signals
 * (Phase 9M2 SCv1 already accepts arbitrary factor inputs); the regime
 * is for downstream filters / kill-switches / risk engines that want
 * a discrete trigger.
 *
 *   - `accumulation` — net flow OUT of exchanges (coins going to
 *     cold storage / accumulation). Conventionally bullish.
 *   - `neutral` — net flow within noise band.
 *   - `distribution` — net flow INTO exchanges (coins going to
 *     hot wallets / sell-side preparation). Conventionally bearish.
 */
export type FactorRegime = "accumulation" | "neutral" | "distribution";

/**
 * `FactorSignal` — Phase 12+ continuous factor-layer signal emitted
 * by read-only factor plugins (e.g., CexNetFlowRegimePlugin).
 *
 * Read-only — does NOT carry notional, leverage, or position-size
 * information. The factor plugin's role is to PUBLISH a continuous
 * view; any sizing derived from the factor is the responsibility of
 * downstream SizingSignal plugins (Phase 11.1c VolTarget / Phase 11.1e
 * HybridKelly).
 *
 *  - `kind` — discriminator literal.
 *  - `factor` — continuous value in `[-1, +1]`. The convention:
 *    `+1` = strongly bullish (accumulation), `-1` = strongly bearish
 *    (distribution), `0` = neutral. Emitted as a `tanh`-clipped
 *    z-score by CexNetFlowRegimePlugin (so the bound is strict even
 *    on extreme 5σ+ moves).
 *  - `regime` — discrete classification. The plugin chooses the
 *    regime label based on the same z-score as the factor (z > 1.5 →
 *    accumulation; z ∈ [-1.5, 1.5] → neutral; z < -1.5 →
 *    distribution, per Phase 11.5 Track D §P1).
 *  - `zScore` — RAW rolling z-score on the underlying input series
 *    (e.g., CEX netflow z-score over 90d window). Not clipped —
 *    can be ±3σ+ for downstream forensic / debugging consumers.
 *  - `source` — emitting plugin name (e.g., `cex-netflow-regime-v1`).
 *  - `confidence` (Phase 12 P1 OPTIONAL) — observation-quality
 *    weight in `[0, 1]`. Defaults to 1.0 once the rolling window is
 *    sufficiently populated; lower values signal "fewer than X
 *    observations — use with caution". Default: 1.0.
 *  - `staleMs` (Phase 12 P1 OPTIONAL) — wall-clock-staleness
 *    budget in ms. If the plugin's last fetch is older than
 *    `staleMs`, downstream consumers should treat the factor as
 *    telemetry-only (not actionable). Default: 0 (fresh).
 */
export interface FactorSignal {
  readonly kind: "factor";
  readonly factor: number;
  readonly regime: FactorRegime;
  readonly zScore: number;
  readonly source: string;
  readonly symbol?: string;
  readonly timestampMs?: number;
  /**
   * Observation-quality weight in [0, 1]. Default: 1.0.
   */
  readonly confidence?: number;
  /**
   * Staleness budget in ms — if last fetch is older, factor is informational only. Default: 0.
   */
  readonly staleMs?: number;
}

/**
 * `Signal` — discriminated union over `kind`. Use the `is*` guards below
 * for safe narrowing in subscribers.
 *
 * Example subscriber pattern:
 * ```ts
 * bus.subscribe("direction", (s) => {
 *   if (isDirection(s)) {
 *     // s is narrowed to DirectionSignal — full TS autocomplete.
 *     if (s.side === "long" && s.strength > 0.6) { ... }
 *   }
 * });
 * ```
 */
export type Signal =
  DirectionSignal | CarrySignal | SizingSignal | RiskSignal | FactorSignal | FundingSnapshotSignal;

// Type guards — runtime narrowing for type-safe consumption.

/**
 * `isDirection` — narrow `Signal` to `DirectionSignal`.
 * Returns `true` iff `s.kind === "direction"`.
 */
export function isDirection(s: Signal): s is DirectionSignal {
  return s.kind === "direction";
}

/**
 * `isCarry` — narrow `Signal` to `CarrySignal`.
 */
export function isCarry(s: Signal): s is CarrySignal {
  return s.kind === "carry";
}

/**
 * `isSizing` — narrow `Signal` to `SizingSignal`.
 */
export function isSizing(s: Signal): s is SizingSignal {
  return s.kind === "sizing";
}

/**
 * `isRisk` — narrow `Signal` to `RiskSignal`.
 */
export function isRisk(s: Signal): s is RiskSignal {
  return s.kind === "risk";
}

/**
 * `isFactor` — narrow `Signal` to `FactorSignal`.
 * Returns `true` iff `s.kind === "factor"`.
 */
export function isFactor(s: Signal): s is FactorSignal {
  return s.kind === "factor";
}

/**
 * `isFundingSnapshot` — narrow `Signal` to `FundingSnapshotSignal`.
 * Returns `true` iff `s.kind === "funding-snapshot"`. Added in
 * Phase 12 Track B for the `CrossDexFundingWatcherPlugin` (Phase 11.5
 * Track E §H1 read-only signal stream).
 */
export function isFundingSnapshot(s: Signal): s is FundingSnapshotSignal {
  return s.kind === "funding-snapshot";
}

/**
 * `assertSignalKind` — compile-time exhaustiveness helper. Throw at
 * runtime if a Signal has an unknown `kind`. Use in subscribers to
 * catch API drift early.
 *
 * ```ts
 * switch (s.kind) {
 *   case "direction": ...
 *   case "carry": ...
 *   case "sizing": ...
 *   case "risk": ...
 *   default: assertExhaustiveSignal(s); // throws if a kind is missed
 * }
 * ```
 */
export function assertExhaustiveSignal(s: never): never {
  throw new Error(`Unknown Signal kind: ${JSON.stringify(s)}`);
}

// Result<T, E> — minimal Result type for plugin config validation.

/**
 * `Ok<T>` — successful Result variant.
 */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/**
 * `Err<E>` — failure Result variant.
 */
interface ResultError<E> {
  readonly ok: false;
  readonly error: E;
}

export type { ResultError as Err };

/**
 * `Result<T, E>` — minimal Result type for plugin config validation
 * (`StrategyPlugin.validateConfig`) and registry boot-time checks.
 *
 * We don't use a third-party Result library — this is 12 lines and the
 * existing code base has no Result type elsewhere. Adding a dependency
 * for this would be over-engineering.
 */
export type Result<T, E> = Ok<T> | ResultError<E>;

/**
 * `ok` — Result constructor for the success variant.
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * `err` — Result constructor for the failure variant.
 */
function error<E>(error: E): ResultError<E> {
  return { ok: false, error };
}

export { error as err };

/**
 * `ConfigError` — a single config-validation error. Multiple errors
 * are aggregated into `AggregatedConfigError` for boot-time reporting.
 */
export interface ConfigError {
  readonly pluginName: string;
  readonly field: string;
  readonly message: string;
  readonly value?: unknown;
}

/**
 * `AggregatedConfigError` — collection of config errors. The registry
 * collects ALL errors (not first-fail) so the user sees every problem
 * in a single boot-time report.
 */
export interface AggregatedConfigError {
  readonly errors: readonly ConfigError[];
  readonly summary: string;
}

// ---------------------------------------------------------------------------
// Bar — minimal OHLCV-like record used by `StrategyPlugin.onBar`.
// ---------------------------------------------------------------------------

/**
 * `Bar` — minimal candle-shape used by `StrategyPlugin.onBar`. Mirrors
 * the engine's `Candle` shape but with looser typing so plugins can
 * work without pulling in `@mm-crypto-bot/shared/types` (cross-package
 * dependency minimization for the signal center).
 */
export interface Bar {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

// ---------------------------------------------------------------------------
// PluginState — per-plugin mutable state container.
// ---------------------------------------------------------------------------

/**
 * `PluginState` — typed mutable state container for a strategy plugin.
 * The plugin declares its own concrete state shape and casts through
 * `unknown` at the plugin boundary (the bus doesn't know the plugin's
 * internal state).
 *
 * Why `unknown` and not `never`? Because plugins DO need to mutate
 * state across bars (e.g., carry plugin tracks funding history).
 * `unknown` says "I trust you" while still being type-safe at the bus
 * boundary (no `any` leak).
 */
export type PluginState = unknown;

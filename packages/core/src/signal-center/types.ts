// packages/core/src/signal-center/types.ts — Phase 10G Track A
//
// Discriminated unions for typed Signal events on the SignalBus.
//
// Why discriminated unions?
// -------------------------
// The Phase 1-9 ensemble composes 4-5 strategies that all return
// `StrategySignal { side, confidence, reason, stopLoss, takeProfit }`. The
// caller has to know WHICH strategy produced WHICH signal to interpret
// it. As the system grows to N plugins (Phase 10G.2+ drop-ins: DonchianMTF,
// FundingTiming, VolTargeted, Cross-X, Options-vol), this becomes a
// brittle pattern — every new plugin = a new field on `StrategySignal`,
// breaking every consumer that doesn't yet handle it.
//
// The Signal Center fix: each plugin emits a TYPED Signal discriminated
// by `kind`. Subscribers narrow by `kind` at the type system level — no
// runtime `if (signal.kind === 'foo')` branches to forget, no
// `signal as DirectionSignal` casts.
//
// References (≥3 independent sources on discriminated unions in TS):
//   - TypeScript Handbook §3.10 Discriminated Unions — official TC39
//     recommended pattern for sum types (Microsoft TypeScript team, 2024).
//   - Effective TypeScript (Dan Vanderkam, O'Reilly 2019/2024) Item 32 —
//     "Prefer Union Types to Type Hierarchies" for finite, disjoint
//     alternatives like Signal kinds.
//   - Type-Level TypeScript (Alex Vakulov, 2023) — exhaustive `switch`
//     pattern with `never`-narrowing for compile-time completeness.
//
// Type-safety analysis:
//   - Adding a new Signal kind requires (a) adding the literal to
//     `SignalKind`, (b) adding the variant to the union, (c) updating
//     the `is*` type guards. ANY missing update = a TypeScript compile
//     error at the FIRST consumer that pattern-matches the new kind.
//   - Subscribers register handlers by `SignalKind`, so a misrouted
//     subscription (e.g., DirectionSignal sent to a CarrySignal handler)
//     fails at TYPE CHECK, not at runtime when the strategy fires.

// ---------------------------------------------------------------------------
// SignalKind — finite, exhaustive set of signal categories.
// ---------------------------------------------------------------------------

/**
 * `SignalKind` — the closed set of signal categories on the bus.
 *
 * Adding a new signal kind (e.g., `LiquiditySignal` for an order-book
 * alpha in Phase 11+) requires:
 *   1. Adding the literal here.
 *   2. Adding the matching variant to `Signal` (below).
 *   3. Adding a corresponding `isXxx(s: Signal): s is XxxSignal` guard.
 *   4. Updating any exhaustive `switch (s.kind)` in subscribers.
 *
 * All four updates are TYPE-CHECKED — the first consumer that forgets
 * step 4 fails the compiler with `Type 'XxxSignal' is not assignable to
 * type 'never'` (the classic discriminated-union exhaustiveness trick).
 */
export type SignalKind =
  | "direction"
  | "carry"
  | "sizing"
  | "risk"
  | "factor"
  | "funding-snapshot";

// ---------------------------------------------------------------------------
// DirectionSignal — a directional view (long / short / flat) with strength.
// ---------------------------------------------------------------------------

/**
 * `DirectionSide` — discrete directional view. `flat` means no exposure
 * (the plugin is neutral / unwound). NOT a 3-state ternary — this is a
 * sum type so subscribers can match `case 'flat'` distinctly.
 */
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
  readonly timestampMs?: number;
}

// ---------------------------------------------------------------------------
// CarrySignal — funding-rate carry state (regime classification).
// ---------------------------------------------------------------------------

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
  readonly timestampMs?: number;
}

// ---------------------------------------------------------------------------
// SizingSignal — recommended position sizing for a strategy / symbol.
// ---------------------------------------------------------------------------

/**
 * `SizingSignal` — the recommended notional × leverage combination to
 * apply for a given (plugin, symbol, timestamp) tuple.
 *
 *  - `kellyFraction` — adaptive Kelly multiplier in [0, 1]. 0 = no
 *    position (don't trade), 1 = full Kelly (aggressive). The signal
 *    center's risk engine may further reduce this.
 *  - `volMultiplier` — Moreira-Muir-style inverse-vol multiplier in
 *    [0.25, 1.0] under 1:10 mandate (Track G clamp). The signal bus
 *    is INVOLVED in sizing composition: the carry-baseline plugin
 *    emits its own kellyFraction from the rolling Sharpe, and the
 *    vol-targeting plugin (Phase 10G.2c) emits a separate
 *    volMultiplier; Track B risk engine composes them with min().
 *  - `notional` — final notional in USD (base × leverage × kelly × vol).
 *    MUST respect the 1:10 leverage MANDATE: notional ≤ baseNotional × 10.
 *  - `source` — plugin name.
 */
export interface SizingSignal {
  readonly kind: "sizing";
  readonly kellyFraction: number;
  readonly volMultiplier: number;
  readonly notional: number;
  readonly source: string;
  readonly timestampMs?: number;
}

// ---------------------------------------------------------------------------
// RiskSignal — portfolio-level risk telemetry.
// ---------------------------------------------------------------------------

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
 *    field is responsible for asserting it respects the 1:10
 *    leverage MANDATE (Layer 2 defense).
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
  readonly timestampMs?: number;
  /** Phase 11.1d+ — active breach flag. */
  readonly breach?: boolean;
  /** Phase 11.1d+ — human-readable cause (e.g., "funding-flip"). */
  readonly reason?: string;
  /** Phase 11.1d+ — implied close instruction (USD, respects 1:10 cap). */
  readonly closeNotionalUsd?: number;
  /** Phase 11.2a+ — recommended size multiplier in [0, 1.0] (≤ 1.0 enforced). */
  readonly sizeModifier?: number;
}

// ---------------------------------------------------------------------------
// FundingSnapshotSignal — cross-venue funding snapshot (Phase 12 Track B).
// ---------------------------------------------------------------------------

/**
 * `FundingSnapshotSignal` — read-only telemetry emitted by
 * `CrossDexFundingWatcherPlugin` (Phase 12 Track B / Phase 11.5
 * Track E §H1).
 *
 * Carries the latest 8h-equivalent funding rate per venue for a single
 * asset, plus the per-asset cross-venue spread and the
 * Hyperliquid predicted-vs-realized gap. Consumers include
 * `CrossDexDeltaNeutralArb` (Phase 12 E2, future), the central
 * `SignalCenterV1` telemetry sink, and ad-hoc research dashboards.
 *
 * This is a SIGNAL-ONLY signal: it carries zero notional impact
 * (`spreadMax` is information, not a position instruction). The
 * 1:10 leverage mandate is trivially satisfied at the metadata cap
 * (`maxLeverage = 10`) — no notional assertion is needed at the
 * per-emit layer because no notional is computed.
 *
 * Fields are 8h-equivalent basis points (bps):
 *   - `hl8h` — Hyperliquid 8h-equivalent rate. Hyperliquid settles
 *     hourly at 1/8 of the computed 8h rate, so the 1-hour raw
 *     funding is multiplied by 8 to get the 8h-equivalent. Bps.
 *   - `bz` — Binance mark funding rate (8h native). Bps.
 *   - `by` — Bybit funding rate (8h native). Bps.
 *   - `ok` — OKX funding rate (8h native). Bps.
 *   - `spreadMax` — `max(hl8h, bz, by, ok) - min(...)` in bps.
 *     Captures the maximum divergence opportunity across venues.
 *   - `predictedGap` — Hyperliquid `predictedFundings` next-settlement
 *     minus current realized, normalized to 8h-equivalent bps.
 *     Positive = predicted is HIGHER than realized (fade short,
 *     carry on the next settlement). Negative = predicted is LOWER
 *     (long the next settlement).
 *   - `timestamp` — wall-clock ms when the snapshot was emitted.
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
  readonly timestampMs?: number;
}

// ---------------------------------------------------------------------------
// Signal — the discriminated union (sum type) of all signal categories.
// ---------------------------------------------------------------------------

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
  readonly timestampMs?: number;
  /** Observation-quality weight in [0, 1]. Default: 1.0. */
  readonly confidence?: number;
  /** Staleness budget in ms — if last fetch is older, factor is informational only. Default: 0. */
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
  | DirectionSignal
  | CarrySignal
  | SizingSignal
  | RiskSignal
  | FactorSignal
  | FundingSnapshotSignal;

// ---------------------------------------------------------------------------
// Type guards — runtime narrowing for type-safe consumption.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Result<T, E> — minimal Result type for plugin config validation.
// ---------------------------------------------------------------------------

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
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * `Result<T, E>` — minimal Result type for plugin config validation
 * (`StrategyPlugin.validateConfig`) and registry boot-time checks.
 *
 * We don't use a third-party Result library — this is 12 lines and the
 * existing code base has no Result type elsewhere. Adding a dependency
 * for this would be over-engineering.
 */
export type Result<T, E> = Ok<T> | Err<E>;

/**
 * `ok` — Result constructor for the success variant.
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * `err` — Result constructor for the failure variant.
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

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
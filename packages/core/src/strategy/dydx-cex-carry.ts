import type {
  OpenPositionSnapshot,
  PositionManagementContext,
  PositionUpdate,
  Strategy,
  StrategyContext,
  StrategySignal,
} from "../types.js";
import type { FundingSnapshot } from "./funding-snapshot.js";
import { ExactRational, type ExactRationalSnapshot } from "@mm-crypto-bot/numeric";
import {
  allPreconditionsSatisfied,
  evaluatePrecondition,
  newPreconditionsState,
} from "./dydx-cex-carry-admission-policy.js";
import {
  DEFAULT_CARRY_DIRECTION as defaultCarryDirection,
  DEFAULT_CARRY_MARKET as defaultCarryMarket,
  DEFAULT_PRECONDITION_CONFIG as defaultPreconditionConfig,
  createDydxCexCarryConfig,
  type CarryMarket,
  type DydxCexCarryConfig,
  type PreconditionEntry,
  type PreconditionId,
  type PreconditionsState,
  type TickDensityState,
} from "./dydx-cex-carry-config.js";
import {
  DEFAULT_KILL_SWITCH_CONFIG as defaultKillSwitchConfig,
  evaluateKillSwitches,
  type KillSwitchVerdicts,
} from "./dydx-cex-carry-kill-switches.js";
import { calculateFundingPayment, isHaltEngaged, recordTickDensity } from "./dydx-cex-carry-paper-trader.js";
import {
  failedLatencyGate,
  frozenStateSnapshot,
  nextCompressedDivergenceState,
  restoreSnapshot,
  serializeCarryState,
  validateLatencySnapshot,
} from "./dydx-cex-carry-persistence.js";
import { createLatencyGate, type LatencyGate } from "./multi-class-ensemble.js";

export type {
  CarryDirection,
  CarryMarket,
  DydxCexCarryConfig,
  DydxFundingSource,
  LatencySource,
  PreconditionConfig,
  PreconditionEntry,
  PreconditionId,
  PreconditionsState,
  TickDensityEntry,
  TickDensityState,
} from "./dydx-cex-carry-config.js";
export type {
  KillSwitchConfig,
  KillSwitchId,
  KillSwitchInputs,
  KillSwitchVerdict,
  KillSwitchVerdicts,
} from "./dydx-cex-carry-kill-switches.js";
export {
  allPreconditionsSatisfied,
  evaluatePrecondition,
  newPreconditionsState,
} from "./dydx-cex-carry-admission-policy.js";
export {
  DEFAULT_CARRY_DIRECTION,
  DEFAULT_CARRY_MARKET,
  DEFAULT_PRECONDITION_CONFIG,
} from "./dydx-cex-carry-config.js";
export {
  ALL_KILL_SWITCHES,
  DEFAULT_KILL_SWITCH_CONFIG,
  evaluateKillSwitches,
} from "./dydx-cex-carry-kill-switches.js";

export const DEFAULT_DYDX_CEX_CARRY_CONFIG: Omit<DydxCexCarryConfig, "fundingSource"> = Object.freeze({
  market: defaultCarryMarket,
  direction: defaultCarryDirection,
  notionalPerLegUsd: ExactRational.from("10000"),
  capFraction: 0.025,
  killSwitch: defaultKillSwitchConfig,
  precondition: defaultPreconditionConfig,
  latencyArbThresholdMs: 500,
  latencySource: undefined,
});

export interface DydxCexCarryState {
  fundingCollectedUsd: ExactRational;
  rebalanceCount: number;
  rebalanceCostUsd: ExactRational;
  fundingPeriods: number;
  lastMarkPrice: ExactRational | undefined;
  hasEntered: boolean;
  killSwitchVerdicts: KillSwitchVerdicts;
  preconditions: PreconditionsState;
  tickDensity: TickDensityState;
  compressedDayStreak: number;
  firstTickMs: number | undefined;
  firstChainBlockMs: number | undefined;
  lastDivergenceDay: string | undefined;
  currentDayCompressed: boolean;
  latency: LatencyState;
  bybitDepth: BybitDepthState;
}

export type LatencyState =
  | { readonly status: "unobserved" }
  | { readonly status: "valid"; readonly roundTripMs: number; readonly observedAtMs: number }
  | { readonly status: "invalid"; readonly observedAtMs: number };

export type BybitDepthState =
  | { readonly status: "unobserved" }
  | { readonly status: "valid"; readonly depthUsd: number; readonly observedAtMs: number }
  | { readonly status: "invalid"; readonly observedAtMs: number };

export type DydxCexCarrySnapshot = Readonly<
  Omit<DydxCexCarryState, "fundingCollectedUsd" | "rebalanceCostUsd" | "lastMarkPrice"> & {
    readonly version: 1;
    readonly fundingCollectedUsd: ExactRationalSnapshot;
    readonly rebalanceCostUsd: ExactRationalSnapshot;
    readonly lastMarkPrice: ExactRationalSnapshot | undefined;
  }
>;

export function newTickDensityState(): TickDensityState {
  return { days: [], totalTicksLast7d: 0 };
}

export function newKillSwitchVerdicts(): KillSwitchVerdicts {
  return {
    "indexer-stale": { engaged: false, reason: "init" },
    "chain-non-finalized": { engaged: false, reason: "init" },
    "divergence-7d-compression": { engaged: false, reason: "init" },
    "bybit-eu-spot-thin": { engaged: false, reason: "init" },
  };
}

export class DydxCexCarryStrategy implements Strategy {
  static fromSnapshot(config: unknown, snapshot: unknown): DydxCexCarryStrategy {
    const strategy = new DydxCexCarryStrategy(config);
    strategy.mutableState = restoreSnapshot(snapshot);
    strategy.latencyGate = strategy.createLatencyGateFromState();
    return strategy;
  }

  private mutableState: DydxCexCarryState;
  private latencyGate: LatencyGate;

  readonly name = "dYdX-vs-CEX Cross-Venue Funding Carry";
  readonly timeframes = ["1h", "4h", "1d"] as const;
  readonly config: DydxCexCarryConfig;
  constructor(config: unknown) {
    this.config = createDydxCexCarryConfig(config, DEFAULT_DYDX_CEX_CARRY_CONFIG);
    this.mutableState = this.createInitialState();
    this.latencyGate = this.createLatencyGateFromState();
  }

  private createInitialState(): DydxCexCarryState {
    return {
      fundingCollectedUsd: ExactRational.from("0"),
      rebalanceCount: 0,
      rebalanceCostUsd: ExactRational.from("0"),
      fundingPeriods: 0,
      lastMarkPrice: undefined,
      hasEntered: false,
      killSwitchVerdicts: newKillSwitchVerdicts(),
      preconditions: newPreconditionsState(),
      tickDensity: newTickDensityState(),
      compressedDayStreak: 0,
      firstTickMs: undefined,
      firstChainBlockMs: undefined,
      lastDivergenceDay: undefined,
      currentDayCompressed: false,
      latency: { status: "unobserved" },
      bybitDepth: { status: "unobserved" },
    };
  }

  private createLatencyGateFromState(): LatencyGate {
    return failedLatencyGate();
  }

  private preconditionFor(id: PreconditionId): PreconditionEntry {
    switch (id) {
      case "live-divergence": {
        return this.mutableState.preconditions["live-divergence"];
      }
      case "chain-incident-clear": {
        return this.mutableState.preconditions["chain-incident-clear"];
      }
      case "no-recent-governance": {
        return this.mutableState.preconditions["no-recent-governance"];
      }
    }
  }

  private withPrecondition(id: PreconditionId, entry: PreconditionEntry): PreconditionsState {
    switch (id) {
      case "live-divergence": {
        return { ...this.mutableState.preconditions, "live-divergence": entry };
      }
      case "chain-incident-clear": {
        return { ...this.mutableState.preconditions, "chain-incident-clear": entry };
      }
      case "no-recent-governance": {
        return { ...this.mutableState.preconditions, "no-recent-governance": entry };
      }
    }
  }

  private reEvaluateKillSwitches(nowMs: number): void {
    const source = this.config.fundingSource;
    const chainTimestamp = source.lastChainBlockTs(this.config.market);
    this.mutableState.killSwitchVerdicts = evaluateKillSwitches(
      {
        indexerStaleMs: source.lastTickAgeMs(this.config.market, nowMs),
        chainNonFinalizedMs: chainTimestamp === undefined ? undefined : nowMs - chainTimestamp,
        compressedDivergenceDayStreak: this.mutableState.compressedDayStreak,
        tickDensityLast7d: this.mutableState.tickDensity.totalTicksLast7d,
        bybitEuSpotDepthUsd:
          this.mutableState.bybitDepth.status === "valid" ? this.mutableState.bybitDepth.depthUsd : undefined,
      },
      this.config.killSwitch,
    );
  }

  private isDepthBlocked(): boolean {
    const depth = this.mutableState.bybitDepth;
    return depth.status !== "valid" || depth.depthUsd < this.config.killSwitch.bybitEuMinDepthUsd;
  }

  private validateFundingTick(
    dydxInput: unknown,
    cexInput: unknown,
    nowInput: unknown,
  ): {
    readonly dydxSnapshot: FundingSnapshot;
    readonly cexSnapshot: FundingSnapshot;
    readonly nowMs: number;
  } {
    try {
      if (typeof nowInput !== "number" || !Number.isSafeInteger(nowInput) || nowInput < 0)
        throw new Error("nowMs must be a non-negative safe integer.");
      const dydxSnapshot = fundingSnapshotForMarket(dydxInput, this.config.market);
      const cexSnapshot = fundingSnapshotForMarket(cexInput, this.config.market);
      if (dydxSnapshot === undefined || cexSnapshot === undefined)
        throw new Error("funding snapshots must be exact valid observations for the configured market.");
      return { dydxSnapshot, cexSnapshot, nowMs: nowInput };
    } catch (error: unknown) {
      throw new DydxCexCarryDomainError("INVALID_FUNDING_TICK", { cause: error });
    }
  }

  get state(): Readonly<DydxCexCarryState> {
    return frozenStateSnapshot(this.mutableState);
  }

  warmup(): number {
    return 24;
  }

  serializeState(): DydxCexCarrySnapshot {
    return serializeCarryState(this.mutableState);
  }

  onCandle(context: StrategyContext): StrategySignal | undefined {
    if (context.candleIndex < this.warmup()) return undefined;
    this.pollLatencySource(context.candle.timestamp);
    if (this.mutableState.hasEntered || this.isLatencyPaused() || this.isDepthBlocked() || this.isHalted())
      return undefined;
    if (
      !allPreconditionsSatisfied(
        this.mutableState.preconditions,
        context.candle.timestamp,
        this.config.precondition,
      ).ok
    )
      return undefined;
    return {
      side: "buy",
      confidence: 1,
      reason: `[DydxCexCarry] entry: dydx-long-cex-short, notional ${exactLabel(this.config.notionalPerLegUsd)}/leg, cap=${String(this.config.capFraction)}`,
      stopLoss: context.candle.close * 0.99,
      takeProfit: context.candle.close * 100,
    };
  }

  onCandleObserved(_context: StrategyContext): void {
    void _context;
  }

  onOpenPositionUpdate(context: PositionManagementContext): PositionUpdate | undefined {
    return this.isHalted()
      ? { forceExit: true, exitPrice: context.candle.close, reason: "kill_switch" }
      : undefined;
  }

  onPositionOpened(_snapshot: OpenPositionSnapshot): void {
    this.mutableState.hasEntered = true;
  }

  onPositionClosed(_reason: string): void {
    this.mutableState.hasEntered = false;
  }

  recordFundingTick(dydxInput: unknown, cexInput: unknown, nowInput: unknown): ExactRational {
    const input = this.validateFundingTick(dydxInput, cexInput, nowInput);
    const { dydxSnapshot, cexSnapshot, nowMs } = input;
    this.pollLatencySource(nowMs);
    if (this.isLatencyPaused() || this.isDepthBlocked()) return ExactRational.from("0");
    this.mutableState.firstTickMs ??= nowMs;
    this.mutableState.lastMarkPrice =
      dydxSnapshot.markPrice ?? cexSnapshot.markPrice ?? this.mutableState.lastMarkPrice;
    const day = new Date(nowMs).toISOString().slice(0, 10);
    this.mutableState.tickDensity = recordTickDensity(this.mutableState.tickDensity, day);
    const divergence = dydxSnapshot.fundingRate
      .multiply(ExactRational.from("8"))
      .subtract(cexSnapshot.fundingRate);
    const persisted = nextCompressedDivergenceState(
      this.mutableState.lastDivergenceDay,
      this.mutableState.currentDayCompressed,
      this.mutableState.compressedDayStreak,
      day,
      divergence.abs().compare(this.config.killSwitch.compressionThreshold) < 0,
    );
    this.mutableState.lastDivergenceDay = persisted.day;
    this.mutableState.currentDayCompressed = persisted.currentDayCompressed;
    this.mutableState.compressedDayStreak = persisted.streak;
    this.reEvaluateKillSwitches(nowMs);
    if (this.isHalted()) return ExactRational.from("0");
    const paymentUsd = calculateFundingPayment(
      this.effectiveNotionalUsd(),
      dydxSnapshot.fundingRate,
      cexSnapshot.fundingRate,
    );
    this.mutableState.fundingCollectedUsd = this.mutableState.fundingCollectedUsd.add(paymentUsd);
    this.mutableState.fundingPeriods += 1;
    return paymentUsd;
  }

  recordChainHeartbeat(
    _market: CarryMarket,
    _blockHeight: number,
    _blockTimestampMs: number,
    nowMs: number,
  ): void {
    this.mutableState.firstChainBlockMs ??= nowMs;
    this.reEvaluateKillSwitches(nowMs);
  }

  recordBybitEuLiquidity(_market: CarryMarket, depthInput: unknown, nowMs: number): void {
    const depthUsd = validDepth(depthInput);
    this.mutableState.bybitDepth =
      depthUsd === undefined
        ? { status: "invalid", observedAtMs: nowMs }
        : { status: "valid", depthUsd, observedAtMs: nowMs };
    this.reEvaluateKillSwitches(nowMs);
  }

  recordLatencySnapshot(
    snapshot: unknown,
    nowMs: number,
  ): { readonly carryAllowed: boolean; readonly reason: string } {
    const validatedSnapshot = validateLatencySnapshot(snapshot);
    if (validatedSnapshot === undefined) {
      this.latencyGate = failedLatencyGate();
      this.mutableState.latency = { status: "invalid", observedAtMs: nowMs };
      throw new DydxCexCarryDomainError("INVALID_LATENCY_SNAPSHOT", { cause: snapshot });
    }
    this.latencyGate = createLatencyGate(validatedSnapshot, this.config.latencyArbThresholdMs);
    this.mutableState.latency = {
      status: "valid",
      roundTripMs: validatedSnapshot.roundTripMsMax,
      observedAtMs: nowMs,
    };
    const isCarryAllowed = this.latencyGate.isCarryAllowed();
    const relation = isCarryAllowed ? "<=" : ">";
    const outcome = isCarryAllowed ? "allowed" : "paused";
    return {
      carryAllowed: isCarryAllowed,
      reason: `latency ${String(validatedSnapshot.roundTripMsMax)}ms ${relation} ${String(this.config.latencyArbThresholdMs)}ms — carry ${outcome}`,
    };
  }

  pollLatencySource(nowMs: number): { readonly carryAllowed: boolean; readonly reason: string } | undefined {
    const source = this.config.latencySource;
    if (source === undefined) return undefined;
    const observedMs = source.observeRoundTripMs(nowMs);
    if (typeof observedMs !== "number") return this.recordLatencySnapshot(undefined, nowMs);
    return this.recordLatencySnapshot(
      { pair: source.pair, roundTripMsMax: observedMs, sourceJsonPath: "live-latency-source" },
      nowMs,
    );
  }

  isLatencyPaused(): boolean {
    return !this.latencyGate.isCarryAllowed();
  }

  recordPreconditionReverify(id: PreconditionId, isSatisfied: boolean, nowMs: number): PreconditionEntry {
    const previous = this.preconditionFor(id);
    const next = evaluatePrecondition(id, previous, nowMs, { kind: id, satisfied: isSatisfied });
    this.mutableState.preconditions = this.withPrecondition(id, next);
    return next;
  }

  isHalted(): boolean {
    return isHaltEngaged(this.mutableState.killSwitchVerdicts);
  }

  effectiveNotionalUsd(): ExactRational {
    return this.config.notionalPerLegUsd;
  }

  totalFundingUsd(): ExactRational {
    return this.mutableState.fundingCollectedUsd.subtract(this.mutableState.rebalanceCostUsd);
  }

  reset(): void {
    this.mutableState = this.createInitialState();
    this.latencyGate = this.createLatencyGateFromState();
  }

  resetPreconditions(): void {
    this.mutableState.preconditions = newPreconditionsState();
  }
}

function fundingSnapshotForMarket(value: unknown, market: CarryMarket): FundingSnapshot | undefined {
  if (!isUnknownRecord(value)) return undefined;
  const symbol = value["symbol"];
  if (symbol !== market) return undefined;
  const fundingTime = value["fundingTime"];
  if (!isSafeTimestamp(fundingTime)) return undefined;
  const fundingRate = value["fundingRate"];
  if (!isExactRational(fundingRate)) return undefined;
  const markPrice = value["markPrice"];
  if (markPrice !== undefined && !isExactRational(markPrice)) return undefined;
  return markPrice === undefined
    ? { fundingTime, symbol, fundingRate }
    : { fundingTime, symbol, fundingRate, markPrice };
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isExactRational(value: unknown): value is ExactRational {
  try {
    if (!(value instanceof ExactRational)) return false;
    value.toSnapshot();
    return true;
  } catch {
    return false;
  }
}

function validDepth(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function exactLabel(value: ExactRational): string {
  const snapshot = value.toSnapshot();
  return `${snapshot.numerator}/${snapshot.denominator}`;
}

export class DydxCexCarryDomainError extends Error {
  readonly code: "INVALID_FUNDING_TICK" | "INVALID_LATENCY_SNAPSHOT";
  constructor(
    code: "INVALID_FUNDING_TICK" | "INVALID_LATENCY_SNAPSHOT",
    options?: { readonly cause?: unknown },
  ) {
    super(`[DydxCexCarryStrategy] ${code}`, options);
    this.name = "DydxCexCarryDomainError";
    this.code = code;
  }
}

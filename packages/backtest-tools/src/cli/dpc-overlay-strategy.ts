import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  computeMetrics,
  runBacktest,
  type BacktestResult,
  type CostModel,
  type ExchangeFeed,
  type HistoricalPositionSizingEvent,
  type PositionSizeConfig,
} from "@mm-crypto-bot/backtest";
import {
  DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
  DonchianPivotComposition,
  RegimeDetectorMetaPlugin,
  SignalBus,
  SOLFlipKillSwitchPlugin,
  type DirectionSignal,
  type PositionManagementContext,
  type PositionUpdate,
  type RegimeDetectorConfig,
  type RegimeLabel,
  type RiskSignal,
  type SizingSignal,
  type SOLFlipKillSwitchPluginConfig,
  type Strategy,
  type StrategyContext,
  type StrategySignal,
} from "@mm-crypto-bot/core";
import { makeSymbol, TIMEFRAME_MS, type Timeframe } from "@mm-crypto-bot/shared/types";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import type { OverlayCliArgs as OverlayCliArguments } from "./dpc-overlay-command.js";
import { maskUsesRegime, maskUsesSolFlip } from "./dpc-overlay-command.js";
import { parseFundingCsv, type FundingRow } from "./run-sol-flip-funding-replay.js";

const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
export const DPC_OVERLAY_LTF: Timeframe = "15m";

export interface DueFundingBatch {
  readonly rows: readonly FundingRow[];
  readonly nextCursor: number;
}

export interface OverlayAuditEvent {
  readonly decisionTime: number;
  readonly action: "entry_blocked" | "position_closed";
  readonly lastFundingTimeConsumed: number | null;
}

export interface OverlayStrategyMetrics {
  dpcSignals: number;
  dpcDirectionSignalsEmitted: number;
  dpcSizingSignalsEmitted: number;
  regimeDirectionSignalsReceived: number;
  regimeSizingSignalsReceived: number;
  fundingRowsProcessed: number;
  solFlipEngagedCandleCount: number;
  solFlipEntryBlocks: number;
  solFlipForcedCloses: number;
  regimeClosesProcessed: number;
  regimeRiskSignals: number;
  regimeModifiedEntries: number;
  regimeMultiplierSum: number;
  regimeMultiplierMin: number | null;
  regimeMultiplierMax: number | null;
  lookaheadViolations: number;
}

export function takeDueFundingRows(
  rows: readonly FundingRow[],
  cursor: number,
  decisionTime: number,
): DueFundingBatch {
  let nextCursor = cursor;
  while (nextCursor < rows.length && rows[nextCursor]!.fundingTime <= decisionTime) nextCursor += 1;
  return { rows: rows.slice(cursor, nextCursor), nextCursor };
}

export class DpcOverlayStrategy implements Strategy {
  readonly name = "DPC production overlay historical composition";
  readonly timeframes = ["1d", "4h", "15m"] as const;
  readonly bus = new SignalBus({ mode: "backtest" });
  readonly dpc: DonchianPivotComposition;
  readonly solFlip: SOLFlipKillSwitchPlugin | null;
  readonly regime: RegimeDetectorMetaPlugin | null;
  readonly metrics: OverlayStrategyMetrics = {
    dpcSignals: 0,
    dpcDirectionSignalsEmitted: 0,
    dpcSizingSignalsEmitted: 0,
    regimeDirectionSignalsReceived: 0,
    regimeSizingSignalsReceived: 0,
    fundingRowsProcessed: 0,
    solFlipEngagedCandleCount: 0,
    solFlipEntryBlocks: 0,
    solFlipForcedCloses: 0,
    regimeClosesProcessed: 0,
    regimeRiskSignals: 0,
    regimeModifiedEntries: 0,
    regimeMultiplierSum: 0,
    regimeMultiplierMin: null,
    regimeMultiplierMax: null,
    lookaheadViolations: 0,
  };
  readonly audit: OverlayAuditEvent[] = [];
  private fundingCursor = 0;
  private lastFundingTimeConsumed: number | null = null;
  private lastCandleDecisionTime: number | null = null;
  private lastDpcObservedDecisionTime: number | null = null;
  private readonly regimeInputUnsubscribers: (() => void)[] = [];

  public constructor(
    readonly symbol: string,
    readonly fundingRows: readonly FundingRow[],
    readonly positionSize: PositionSizeConfig,
    options: {
      readonly useSolFlip: boolean;
      readonly useRegime: boolean;
      readonly minConsensus: number;
      readonly baseNotionalUsd: number;
      readonly solFlipConfig: Partial<SOLFlipKillSwitchPluginConfig>;
      readonly regimeConfig: Partial<RegimeDetectorConfig>;
    },
  ) {
    this.dpc = new DonchianPivotComposition(
      { ...DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG, minConsensus: options.minConsensus },
      DPC_OVERLAY_LTF,
    );
    this.solFlip = options.useSolFlip
      ? new SOLFlipKillSwitchPlugin({ ...options.solFlipConfig, enabledSymbols: ["SOL/USDT"] })
      : null;
    this.regime = options.useRegime
      ? new RegimeDetectorMetaPlugin({
          ...options.regimeConfig,
          enabledSymbols: [symbol],
          baseNotionalUsd: options.baseNotionalUsd,
        })
      : null;
    this.solFlip?.subscribe(this.bus);
    this.regime?.subscribe(this.bus);
    if (this.regime !== null) {
      this.regimeInputUnsubscribers.push(
        this.bus.subscribe("direction", () => {
          this.metrics.regimeDirectionSignalsReceived += 1;
        }),
        this.bus.subscribe("sizing", () => {
          this.metrics.regimeSizingSignalsReceived += 1;
        }),
      );
    }
  }

  public warmup(): number {
    return this.dpc.warmup();
  }

  private decisionTime(context: StrategyContext | PositionManagementContext): number {
    return context.candle.timestamp + TIMEFRAME_MS[DPC_OVERLAY_LTF];
  }

  private advanceOverlays(context: StrategyContext | PositionManagementContext): number {
    const decisionTime = this.decisionTime(context);
    if (this.lastCandleDecisionTime === decisionTime) return decisionTime;
    if (this.lastCandleDecisionTime !== null && decisionTime < this.lastCandleDecisionTime)
      throw new Error(`Non-monotonic candle decision time: ${decisionTime} < ${this.lastCandleDecisionTime}`);
    this.lastCandleDecisionTime = decisionTime;
    if (this.solFlip !== null) {
      const due = takeDueFundingRows(this.fundingRows, this.fundingCursor, decisionTime);
      for (const row of due.rows) {
        if (row.fundingTime > decisionTime) {
          this.metrics.lookaheadViolations += 1;
          throw new Error(`Funding look-ahead: ${row.fundingTime} > ${decisionTime}`);
        }
        this.solFlip.recordFundingSample("SOL/USDT", row.fundingRate, row.fundingTime);
        this.lastFundingTimeConsumed = row.fundingTime;
        this.metrics.fundingRowsProcessed += 1;
      }
      this.fundingCursor = due.nextCursor;
      if (this.solFlip.isKillSwitchEngaged(decisionTime)) this.metrics.solFlipEngagedCandleCount += 1;
    }
    if (this.regime !== null) {
      const before = this.regime.state.riskSignalsEmitted;
      this.regime.recordClose(this.symbol, context.candle.close, decisionTime);
      this.metrics.regimeClosesProcessed += 1;
      this.metrics.regimeRiskSignals += this.regime.state.riskSignalsEmitted - before;
    }
    return decisionTime;
  }

  public onCandleObserved(context: StrategyContext): void {
    this.lastDpcObservedDecisionTime = this.advanceOverlays(context);
    this.dpc.onCandleObserved(context);
  }

  public onCandle(context: StrategyContext): StrategySignal | undefined {
    const decisionTime = this.advanceOverlays(context);
    if (
      this.lastDpcObservedDecisionTime === decisionTime &&
      this.solFlip?.isKillSwitchEngaged(decisionTime) === true
    )
      return undefined;
    const rawSignal = this.dpc.onCandle(context);
    if (rawSignal === undefined) return undefined;
    this.metrics.dpcSignals += 1;
    const direction: DirectionSignal = {
      kind: "direction",
      side: rawSignal.side === "buy" ? "long" : "short",
      strength: rawSignal.confidence,
      source: "donchian-pivot-composition",
      timestampMs: decisionTime,
    };
    this.bus.emit(direction);
    this.metrics.dpcDirectionSignalsEmitted += 1;
    if (this.solFlip?.isKillSwitchEngaged(decisionTime) === true) {
      this.metrics.solFlipEntryBlocks += 1;
      this.audit.push({
        decisionTime,
        action: "entry_blocked",
        lastFundingTimeConsumed: this.lastFundingTimeConsumed,
      });
      return undefined;
    }
    const multiplier = this.regime?.currentSizeMultiplierForSymbol(this.symbol) ?? 1;
    if (this.regime !== null) {
      this.metrics.regimeMultiplierSum += multiplier;
      this.metrics.regimeMultiplierMin = Math.min(this.metrics.regimeMultiplierMin ?? multiplier, multiplier);
      this.metrics.regimeMultiplierMax = Math.max(this.metrics.regimeMultiplierMax ?? multiplier, multiplier);
      if (multiplier !== 1) this.metrics.regimeModifiedEntries += 1;
    }
    return {
      ...rawSignal,
      confidence: rawSignal.confidence * multiplier,
      reason: `${rawSignal.reason} | regime-size=${multiplier.toFixed(4)}`,
    };
  }

  public onOpenPositionUpdate(context: PositionManagementContext): PositionUpdate | undefined {
    const decisionTime = this.advanceOverlays(context);
    if (this.solFlip?.isKillSwitchEngaged(decisionTime) === true) {
      this.metrics.solFlipForcedCloses += 1;
      this.audit.push({
        decisionTime,
        action: "position_closed",
        lastFundingTimeConsumed: this.lastFundingTimeConsumed,
      });
      return { forceExit: true, exitPrice: context.candle.close, reason: "kill_switch" };
    }
    return undefined;
  }

  public recordPositionSized(event: HistoricalPositionSizingEvent): void {
    const sizing: SizingSignal = {
      kind: "sizing",
      kellyFraction: this.positionSize.kellyFraction,
      volMultiplier: 1,
      notional: event.notionalUsd,
      source: "donchian-pivot-composition:engine-executed-notional",
      timestampMs: event.timestamp,
    };
    this.bus.emit(sizing);
    this.metrics.dpcSizingSignalsEmitted += 1;
  }

  public snapshotSignals(): readonly (DirectionSignal | SizingSignal | RiskSignal)[] {
    return this.bus
      .snapshot()
      .filter(
        (signal): signal is DirectionSignal | SizingSignal | RiskSignal =>
          signal.kind === "direction" || signal.kind === "sizing" || signal.kind === "risk",
      );
  }

  public currentRegime(): RegimeLabel | null {
    return this.regime?.currentRegime(this.symbol) ?? null;
  }

  public dispose(): void {
    for (const unsubscribe of this.regimeInputUnsubscribers) unsubscribe();
    this.regimeInputUnsubscribers.length = 0;
    this.solFlip?.dispose();
    this.regime?.dispose();
  }
}

export function dpcOverlayOptions(arguments_: OverlayCliArguments): {
  readonly useSolFlip: boolean;
  readonly useRegime: boolean;
} {
  return { useSolFlip: maskUsesSolFlip(arguments_.mask), useRegime: maskUsesRegime(arguments_.mask) };
}

const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0,
};

function fileBaseSymbol(symbol: string): string {
  return symbol.split("/", 1)[0]?.toLowerCase() ?? "";
}

function monthlyGeometricReturn(totalReturn: number, months: number): number {
  const growth = 1 + totalReturn;
  return growth <= 0 ? -1 : Math.pow(growth, 1 / months) - 1;
}

export async function runCombination(arguments_: OverlayCliArguments): Promise<Record<string, unknown>> {
  const { useSolFlip, useRegime } = dpcOverlayOptions(arguments_);
  const feed: ExchangeFeed = new CsvExchangeFeed(arguments_.dataDir);
  const allLtf = await feed.fetchOHLCV(arguments_.symbol, DPC_OVERLAY_LTF, {
    since: arguments_.startTime.getTime(),
    limit: Number.MAX_SAFE_INTEGER,
  });
  const ltfMs = TIMEFRAME_MS[DPC_OVERLAY_LTF];
  const windowCandles = allLtf.filter(
    (candle) =>
      candle.timestamp >= arguments_.startTime.getTime() &&
      candle.timestamp + ltfMs <= arguments_.endTime.getTime(),
  );
  if (windowCandles.length === 0)
    throw new Error(`No real OHLCV rows in requested interval: ${arguments_.dataDir}`);
  let fundingRows: readonly FundingRow[] = [];
  if (useSolFlip) {
    fundingRows = parseFundingCsv(await readFile(arguments_.fundingPath, "utf8"));
    if (fundingRows.length === 0) throw new Error(`No real SOLUSDT funding rows: ${arguments_.fundingPath}`);
  }
  const positionSize: PositionSizeConfig = {
    riskPerTrade: arguments_.riskPerTrade,
    kellyFraction: 0.25,
    maxDrawdown: 0.5,
    maxPositionPctEquity: arguments_.maxPositionPctEquity,
    minPositionPctEquity: 0.01,
  };
  const strategy = new DpcOverlayStrategy(arguments_.symbol, fundingRows, positionSize, {
    useSolFlip,
    useRegime,
    minConsensus: arguments_.minConsensus,
    baseNotionalUsd: arguments_.initialEquityUsd,
    solFlipConfig: arguments_.solFlipConfig,
    regimeConfig: arguments_.regimeConfig,
  });
  let result: BacktestResult;
  try {
    result = await runBacktest({
      symbol: makeSymbol(arguments_.symbol),
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: DPC_OVERLAY_LTF,
      startTime: arguments_.startTime,
      endTime: arguments_.endTime,
      initialEquityUsd: arguments_.initialEquityUsd,
      feed,
      costModel: COST_MODEL,
      positionSize,
      strategy,
      onPositionSized: (event) => {
        strategy.recordPositionSized(event);
      },
    });
  } finally {
    strategy.dispose();
  }
  const durationMs = arguments_.endTime.getTime() - arguments_.startTime.getTime();
  const totalMonths = durationMs / (30.44 * 24 * 60 * 60 * 1000);
  const expectedCandleSlots = Math.floor(durationMs / ltfMs);
  const decisionWindowFunding = fundingRows.filter(
    (row) =>
      row.fundingTime >= arguments_.startTime.getTime() && row.fundingTime <= arguments_.endTime.getTime(),
  );
  const expectedFundingSlots = useSolFlip ? Math.floor(durationMs / FUNDING_INTERVAL_MS) + 1 : null;
  const signals = strategy.snapshotSignals();
  const sizingSignals = signals.filter((signal): signal is SizingSignal => signal.kind === "sizing");
  const riskSignals = signals.filter((signal): signal is RiskSignal => signal.kind === "risk");
  const multiplierSamples =
    strategy.regime === null ? 0 : strategy.metrics.dpcSignals - strategy.metrics.solFlipEntryBlocks;
  const completeMetrics = computeMetrics(
    result.trades,
    result.equityCurve,
    result.startTime,
    result.endTime,
    (365 * 24 * 60 * 60 * 1000) / ltfMs,
  );
  const totalFeesUsd = result.trades.reduce((sum, trade) => sum + trade.feesUsd, 0);
  const grossProfitUsd = result.trades.reduce((sum, trade) => sum + Math.max(0, trade.pnlUsd), 0);
  const grossLossUsd = result.trades.reduce((sum, trade) => sum + Math.min(0, trade.pnlUsd), 0);
  const totalHoldingHours = result.trades.reduce(
    (sum, trade) => sum + (trade.exitTime - trade.entryTime) / (60 * 60 * 1000),
    0,
  );
  return {
    status: "valid",
    window: arguments_.window,
    mask: arguments_.mask,
    components: {
      alpha: "DonchianPivotComposition",
      solFlip: useSolFlip ? "SOLFlipKillSwitchPlugin" : null,
      regime: useRegime ? "RegimeDetectorMetaPlugin" : null,
    },
    args: arguments_,
    timeframes: { htf: "1d", mtf: "4h", ltf: DPC_OVERLAY_LTF },
    costModel: COST_MODEL,
    positionSize,
    inputProvenance: {
      ohlcv: {
        sourceKind: "downloaded_binance_ohlcv_csv",
        synthetic: false,
        path: path.resolve(arguments_.dataDir, `binance_${fileBaseSymbol(arguments_.symbol)}_15m.csv`),
        requestedStart: arguments_.startTime.toISOString(),
        requestedEndExclusive: arguments_.endTime.toISOString(),
        sampleCount: windowCandles.length,
        expectedSlots: expectedCandleSlots,
        coverageRatio: expectedCandleSlots > 0 ? windowCandles.length / expectedCandleSlots : 0,
        firstCandleOpen: windowCandles.at(0)?.timestamp ?? null,
        lastCandleClose:
          windowCandles.at(-1)?.timestamp === undefined ? null : windowCandles.at(-1)!.timestamp + ltfMs,
      },
      funding: useSolFlip
        ? {
            sourceKind: "downloaded_binance_funding_csv",
            synthetic: false,
            path: arguments_.fundingPath,
            requestedDecisionWindowSampleCount: decisionWindowFunding.length,
            expectedSlots: expectedFundingSlots,
            coverageRatio:
              expectedFundingSlots === null || expectedFundingSlots === 0
                ? null
                : decisionWindowFunding.length / expectedFundingSlots,
            warmupSamplesBeforeWindow: fundingRows.filter(
              (row) => row.fundingTime < arguments_.startTime.getTime(),
            ).length,
            firstFundingTime: decisionWindowFunding.at(0)?.fundingTime ?? null,
            lastFundingTime: decisionWindowFunding.at(-1)?.fundingTime ?? null,
          }
        : { applicable: false, reason: "SOLFlip overlay disabled by mask" },
    },
    causality: {
      candleDecisionBasis: "closed 15m candle; decisionTime=candleOpen+15m",
      fundingAvailabilityRule: "fundingTime <= decisionTime",
      lookaheadViolations: strategy.metrics.lookaheadViolations,
      audit: strategy.audit,
    },
    overlayMetrics: {
      ...strategy.metrics,
      finalSolFlipEngaged: strategy.solFlip?.isKillSwitchEngaged(arguments_.endTime.getTime()) ?? null,
      solFlipActivations: strategy.solFlip?.state.regimeActivationCount ?? null,
      solFlipDeactivations: strategy.solFlip?.state.regimeDeactivationCount ?? null,
      finalRegime: strategy.currentRegime(),
      regimeDirectionSignalsReceived: useRegime ? strategy.metrics.regimeDirectionSignalsReceived : null,
      regimeSizingSignalsReceived: useRegime ? strategy.metrics.regimeSizingSignalsReceived : null,
      averageAppliedRegimeMultiplier:
        multiplierSamples > 0 ? strategy.metrics.regimeMultiplierSum / multiplierSamples : null,
      sizingNotionalMin:
        sizingSignals.length > 0 ? Math.min(...sizingSignals.map((signal) => signal.notional)) : null,
      sizingNotionalMax:
        sizingSignals.length > 0 ? Math.max(...sizingSignals.map((signal) => signal.notional)) : null,
      riskSignalCount: riskSignals.length,
    },
    derivedMetrics: {
      ...completeMetrics,
      totalMonths,
      monthlyReturn: monthlyGeometricReturn(result.totalReturn, totalMonths),
      endingEquityUsd: result.equityCurve.at(-1)?.equity ?? arguments_.initialEquityUsd,
      netPnlUsd:
        (result.equityCurve.at(-1)?.equity ?? arguments_.initialEquityUsd) - arguments_.initialEquityUsd,
      grossProfitUsd,
      grossLossUsd,
      totalFeesUsd,
      averageHoldingHours: result.totalTrades > 0 ? totalHoldingHours / result.totalTrades : 0,
    },
    result,
    sizingSignals,
    riskSignalTransitions: riskSignals.filter((signal) => signal.breach),
    generatedAt: new Date().toISOString(),
  };
}

export { FUNDING_INTERVAL_MS };

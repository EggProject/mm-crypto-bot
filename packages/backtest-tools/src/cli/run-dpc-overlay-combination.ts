#!/usr/bin/env bun

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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
  DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG,
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
import { TIMEFRAME_MS, makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { parseFundingCsv, type FundingRow } from "./run-sol-flip-funding-replay.js";

const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
const LTF: Timeframe = "15m";
const ALLOWED_SYMBOLS = new Set(["BTC/USDT", "ETH/USDT", "SOL/USDT"]);

export const OVERLAY_MASKS = [
  "dpc",
  "dpc-solflip",
  "dpc-regime",
  "dpc-solflip-regime",
] as const;
export type OverlayMask = (typeof OVERLAY_MASKS)[number];

export interface OverlayCliArgs {
  readonly mask: OverlayMask;
  readonly symbol: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly window: "IS";
  readonly outputPath: string;
  readonly dataDir: string;
  readonly fundingPath: string;
  readonly initialEquityUsd: number;
  readonly minConsensus: number;
  readonly riskPerTrade: number;
  readonly maxPositionPctEquity: number;
  readonly regimeConfig: Partial<RegimeDetectorConfig>;
  readonly solFlipConfig: Partial<SOLFlipKillSwitchPluginConfig>;
  readonly smoke: boolean;
}

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

const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0,
};

function finiteInRange(flag: string, raw: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${flag} must be in [${min}, ${max}], got: ${raw}`);
  }
  return value;
}

function integerInRange(flag: string, raw: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${flag} must be an integer in [${min}, ${max}], got: ${raw}`);
  }
  return value;
}

export function parseOverlayMask(raw: string): OverlayMask {
  if ((OVERLAY_MASKS as readonly string[]).includes(raw)) return raw as OverlayMask;
  throw new Error(`--mask must be one of: ${OVERLAY_MASKS.join(", ")}; got: ${raw}`);
}

export function maskUsesSolFlip(mask: OverlayMask): boolean {
  return mask === "dpc-solflip" || mask === "dpc-solflip-regime";
}

export function maskUsesRegime(mask: OverlayMask): boolean {
  return mask === "dpc-regime" || mask === "dpc-solflip-regime";
}

export function parseArgs(argv: readonly string[] = process.argv.slice(2)): OverlayCliArgs {
  let mask: OverlayMask = "dpc";
  let symbol = "BTC/USDT";
  let startTime = new Date(Date.UTC(2024, 0, 1));
  let endTime = new Date();
  const window = "IS" as const;
  let outputPath = "backtest-results/dpc-overlay-combination.json";
  let dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  let fundingPath = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding", "binance_solusdt_funding_8h.csv");
  let initialEquityUsd = 10_000;
  let minConsensus = 1;
  let riskPerTrade = 0.01;
  let maxPositionPctEquity = 0.2;
  let regimeConfig: Partial<RegimeDetectorConfig> = {};
  let solFlipConfig: Partial<SOLFlipKillSwitchPluginConfig> = {
    ...DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG,
    enabledSymbols: ["SOL/USDT"],
  };
  let smoke = false;

  for (const arg of argv) {
    const [flag, raw = ""] = arg.split("=", 2);
    switch (flag) {
      case "--mask": mask = parseOverlayMask(raw); break;
      case "--smoke": smoke = true; break;
      case "--symbol": symbol = raw; break;
      case "--start":
      case "--is-start": startTime = new Date(raw); break;
      case "--end":
      case "--is-end": endTime = new Date(raw); break;
      case "--window":
        if (raw.toUpperCase() !== "IS") throw new Error(`--window supports IS only, got: ${raw}`);
        break;
      case "--output": outputPath = raw; break;
      case "--data-dir": dataDir = resolve(raw); break;
      case "--funding-input": fundingPath = resolve(raw); break;
      case "--equity": initialEquityUsd = finiteInRange(flag, raw, 1, Number.MAX_SAFE_INTEGER); break;
      case "--min-consensus": minConsensus = integerInRange(flag, raw, 1, 2); break;
      case "--risk-per-trade": riskPerTrade = finiteInRange(flag, raw, 0.000001, 0.1); break;
      case "--max-position-pct-equity": maxPositionPctEquity = finiteInRange(flag, raw, 0.01, 0.5); break;
      case "--regime-min-observations": regimeConfig = { ...regimeConfig, minObservations: integerInRange(flag, raw, 5, 365) }; break;
      case "--regime-learning-days": regimeConfig = { ...regimeConfig, transitionLearningDays: integerInRange(flag, raw, 30, 730) }; break;
      case "--regime-trending-multiplier": {
        const multiplier = finiteInRange(flag, raw, 0, 1);
        const current = regimeConfig.perRegimeSizeMultiplier ?? [1, 0.7, 0.4];
        regimeConfig = { ...regimeConfig, perRegimeSizeMultiplier: [multiplier, current[1], current[2]] };
        break;
      }
      case "--regime-ranging-multiplier": {
        const multiplier = finiteInRange(flag, raw, 0, 1);
        const current = regimeConfig.perRegimeSizeMultiplier ?? [1, 0.7, 0.4];
        regimeConfig = { ...regimeConfig, perRegimeSizeMultiplier: [current[0], multiplier, current[2]] };
        break;
      }
      case "--regime-volatile-multiplier": {
        const multiplier = finiteInRange(flag, raw, 0, 1);
        const current = regimeConfig.perRegimeSizeMultiplier ?? [1, 0.7, 0.4];
        regimeConfig = { ...regimeConfig, perRegimeSizeMultiplier: [current[0], current[1], multiplier] };
        break;
      }
      case "--sol-sign-flip-window-days": solFlipConfig = { ...solFlipConfig, signFlipWindowDays: finiteInRange(flag, raw, 1, 365) }; break;
      case "--sol-extreme-sigma": solFlipConfig = { ...solFlipConfig, extremeSigmaThreshold: finiteInRange(flag, raw, 0, 20) }; break;
      case "--sol-persistence-days": solFlipConfig = { ...solFlipConfig, persistenceDays: finiteInRange(flag, raw, 0, 365) }; break;
      case "--sol-vol-window-days": solFlipConfig = { ...solFlipConfig, volWindowDays: integerInRange(flag, raw, 1, 365) }; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!ALLOWED_SYMBOLS.has(symbol)) {
    throw new Error(`--symbol must be BTC/USDT, ETH/USDT, or SOL/USDT; got: ${symbol}`);
  }
  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || startTime >= endTime) {
    throw new Error("--start/--is-start and --end/--is-end must define a valid increasing interval");
  }
  if (maskUsesSolFlip(mask) && symbol !== "SOL/USDT") {
    throw new Error(`INVALID_MASK: ${mask} requires --symbol=SOL/USDT; SOLFlip is not a BTC/ETH no-op`);
  }

  return {
    mask,
    symbol,
    startTime,
    endTime,
    window,
    outputPath,
    dataDir,
    fundingPath,
    initialEquityUsd,
    minConsensus,
    riskPerTrade,
    maxPositionPctEquity,
    regimeConfig,
    solFlipConfig,
    smoke,
  };
}

export function helpText(): string {
  return [
    "Production DPC overlay-combination historical runner",
    "",
    "Usage:",
    "  bun run packages/backtest-tools/src/cli/run-dpc-overlay-combination.ts [options]",
    "",
    "Required execution contract:",
    `  --mask=${OVERLAY_MASKS.join("|")}`,
    "  --symbol=BTC/USDT|ETH/USDT|SOL/USDT",
    "  --start=YYYY-MM-DD (alias: --is-start)",
    "  --end=YYYY-MM-DD (alias: --is-end)",
    "  --output=path/to/result.json",
    "",
    "Adapter gate:",
    "  --help   Print this contract without loading market data",
    "  --smoke  Validate the selected mask and real input files, write a small JSON result, and skip the backtest",
    "",
    "Common tuning flags:",
    "  --min-consensus=1|2 --risk-per-trade=0.01 --max-position-pct-equity=0.2",
    "  --data-dir=data/ohlcv --funding-input=data/funding/binance_solusdt_funding_8h.csv",
  ].join("\n");
}

export async function runSmoke(args: OverlayCliArgs): Promise<Record<string, unknown>> {
  const ohlcvPath = resolve(args.dataDir, `binance_${args.symbol.split("/")[0]!.toLowerCase()}_15m.csv`);
  const ohlcvStat = await stat(ohlcvPath);
  if (!ohlcvStat.isFile() || ohlcvStat.size <= 0) throw new Error(`Smoke: missing/empty OHLCV input: ${ohlcvPath}`);
  let funding: Record<string, unknown> | null = null;
  if (maskUsesSolFlip(args.mask)) {
    const fundingStat = await stat(args.fundingPath);
    if (!fundingStat.isFile() || fundingStat.size <= 0) throw new Error(`Smoke: missing/empty funding input: ${args.fundingPath}`);
    funding = { path: args.fundingPath, bytes: fundingStat.size, synthetic: false };
  }
  return {
    status: "SMOKE_OK",
    runner: "dpc-overlay-combination",
    mask: args.mask,
    symbol: args.symbol,
    supportedMasks: OVERLAY_MASKS,
    executionSkipped: true,
    inputChecks: {
      ohlcv: { path: ohlcvPath, bytes: ohlcvStat.size, synthetic: false },
      funding,
    },
  };
}

/** Return only funding observations known by decisionTime. */
export function takeDueFundingRows(
  rows: readonly FundingRow[],
  cursor: number,
  decisionTime: number,
): DueFundingBatch {
  let nextCursor = cursor;
  while (nextCursor < rows.length && rows[nextCursor]!.fundingTime <= decisionTime) {
    nextCursor += 1;
  }
  return { rows: rows.slice(cursor, nextCursor), nextCursor };
}

function monthlyGeometricReturn(totalReturn: number, months: number): number {
  const growth = 1 + totalReturn;
  if (growth <= 0) return -1;
  return Math.pow(growth, 1 / months) - 1;
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

  constructor(
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
    this.dpc = new DonchianPivotComposition({
      ...DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
      minConsensus: options.minConsensus,
    }, LTF);
    this.solFlip = options.useSolFlip
      ? new SOLFlipKillSwitchPlugin({ ...options.solFlipConfig, enabledSymbols: ["SOL/USDT"] })
      : null;
    this.regime = options.useRegime
      ? new RegimeDetectorMetaPlugin({ ...options.regimeConfig, enabledSymbols: [symbol], baseNotionalUsd: options.baseNotionalUsd })
      : null;
    this.solFlip?.subscribe(this.bus);
    this.regime?.subscribe(this.bus);
    if (this.regime !== null) {
      // The HMM itself is deliberately close-driven. These synchronous
      // subscribers audit the genuine upstream stream associated with the
      // Regime overlay: DPC direction decisions and the exact notional the
      // engine sized for execution. No synthetic sizing proxy is introduced.
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

  warmup(): number {
    return this.dpc.warmup();
  }

  private decisionTime(ctx: StrategyContext | PositionManagementContext): number {
    return ctx.candle.timestamp + TIMEFRAME_MS[LTF];
  }

  private advanceOverlays(ctx: StrategyContext | PositionManagementContext): number {
    const decisionTime = this.decisionTime(ctx);
    if (this.lastCandleDecisionTime === decisionTime) return decisionTime;
    if (this.lastCandleDecisionTime !== null && decisionTime < this.lastCandleDecisionTime) {
      throw new Error(`Non-monotonic candle decision time: ${decisionTime} < ${this.lastCandleDecisionTime}`);
    }
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
      this.regime.recordClose(this.symbol, ctx.candle.close, decisionTime);
      this.metrics.regimeClosesProcessed += 1;
      this.metrics.regimeRiskSignals += this.regime.state.riskSignalsEmitted - before;
    }
    return decisionTime;
  }

  onCandleObserved(ctx: StrategyContext): void {
    this.lastDpcObservedDecisionTime = this.advanceOverlays(ctx);
    this.dpc.onCandleObserved(ctx);
  }

  onCandle(ctx: StrategyContext): StrategySignal | null {
    const decisionTime = this.advanceOverlays(ctx);
    // A force-close makes the engine ask for a fresh entry on the same closed
    // candle. DPC has already observed that candle while the position was
    // open, so do not feed its stateful Pivot component twice. SOLFlip remains
    // engaged here, therefore the only valid execution decision is flat.
    if (
      this.lastDpcObservedDecisionTime === decisionTime &&
      this.solFlip?.isKillSwitchEngaged(decisionTime) === true
    ) {
      return null;
    }
    const rawSignal = this.dpc.onCandle(ctx);
    if (rawSignal === null) return null;
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
      this.audit.push({ decisionTime, action: "entry_blocked", lastFundingTimeConsumed: this.lastFundingTimeConsumed });
      return null;
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

  onOpenPositionUpdate(ctx: PositionManagementContext): PositionUpdate | null {
    const decisionTime = this.advanceOverlays(ctx);
    if (this.solFlip?.isKillSwitchEngaged(decisionTime) === true) {
      this.metrics.solFlipForcedCloses += 1;
      this.audit.push({ decisionTime, action: "position_closed", lastFundingTimeConsumed: this.lastFundingTimeConsumed });
      return { forceExit: true, exitPrice: ctx.candle.close, reason: "kill_switch" };
    }
    return null;
  }

  recordPositionSized(event: HistoricalPositionSizingEvent): void {
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

  snapshotSignals(): readonly (DirectionSignal | SizingSignal | RiskSignal)[] {
    return this.bus.snapshot().filter((signal): signal is DirectionSignal | SizingSignal | RiskSignal =>
      signal.kind === "direction" || signal.kind === "sizing" || signal.kind === "risk");
  }

  currentRegime(): RegimeLabel | null {
    return this.regime?.currentRegime(this.symbol) ?? null;
  }

  dispose(): void {
    for (const unsubscribe of this.regimeInputUnsubscribers) unsubscribe();
    this.regimeInputUnsubscribers.length = 0;
    this.solFlip?.dispose();
    this.regime?.dispose();
  }
}

function fileBaseSymbol(symbol: string): string {
  return symbol.split("/")[0]!.toLowerCase();
}

export async function runCombination(args: OverlayCliArgs): Promise<Record<string, unknown>> {
  const useSolFlip = maskUsesSolFlip(args.mask);
  const useRegime = maskUsesRegime(args.mask);
  const feed = new CsvExchangeFeed(args.dataDir) as unknown as ExchangeFeed;
  const allLtf = await feed.fetchOHLCV(args.symbol, LTF, { since: args.startTime.getTime(), limit: Number.MAX_SAFE_INTEGER });
  const ltfMs = TIMEFRAME_MS[LTF];
  const windowCandles = allLtf.filter((candle) =>
    candle.timestamp >= args.startTime.getTime() && candle.timestamp + ltfMs <= args.endTime.getTime());
  if (windowCandles.length === 0) throw new Error(`No real OHLCV rows in requested interval: ${args.dataDir}`);

  let fundingRows: readonly FundingRow[] = [];
  if (useSolFlip) {
    fundingRows = parseFundingCsv(await readFile(args.fundingPath, "utf8"));
    if (fundingRows.length === 0) throw new Error(`No real SOLUSDT funding rows: ${args.fundingPath}`);
  }

  const positionSize: PositionSizeConfig = {
    riskPerTrade: args.riskPerTrade,
    kellyFraction: 0.25,
    maxDrawdown: 0.5,
    maxPositionPctEquity: args.maxPositionPctEquity,
    minPositionPctEquity: 0.01,
  };
  const strategy = new DpcOverlayStrategy(args.symbol, fundingRows, positionSize, {
    useSolFlip,
    useRegime,
    minConsensus: args.minConsensus,
    baseNotionalUsd: args.initialEquityUsd,
    solFlipConfig: args.solFlipConfig,
    regimeConfig: args.regimeConfig,
  });

  let result: BacktestResult;
  try {
    result = await runBacktest({
      symbol: makeSymbol(args.symbol),
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: LTF,
      startTime: args.startTime,
      endTime: args.endTime,
      initialEquityUsd: args.initialEquityUsd,
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

  const durationMs = args.endTime.getTime() - args.startTime.getTime();
  const totalMonths = durationMs / (30.44 * 24 * 60 * 60 * 1000);
  const expectedCandleSlots = Math.floor(durationMs / ltfMs);
  // An observation stamped exactly at the final candle's decisionTime is
  // already public and therefore usable. Funding coverage follows the same
  // closed-bar boundary instead of incorrectly treating endTime as unseen.
  const decisionWindowFunding = fundingRows.filter((row) =>
    row.fundingTime >= args.startTime.getTime() && row.fundingTime <= args.endTime.getTime());
  const expectedFundingSlots = useSolFlip ? Math.floor(durationMs / FUNDING_INTERVAL_MS) + 1 : null;
  const signals = strategy.snapshotSignals();
  const sizingSignals = signals.filter((signal): signal is SizingSignal => signal.kind === "sizing");
  const riskSignals = signals.filter((signal): signal is RiskSignal => signal.kind === "risk");
  const multiplierSamples = strategy.regime === null
    ? 0
    : strategy.metrics.dpcSignals - strategy.metrics.solFlipEntryBlocks;
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
  const totalHoldingHours = result.trades.reduce((sum, trade) =>
    sum + (trade.exitTime - trade.entryTime) / (60 * 60 * 1000), 0);

  return {
    status: "valid",
    window: args.window,
    mask: args.mask,
    components: {
      alpha: "DonchianPivotComposition",
      solFlip: useSolFlip ? "SOLFlipKillSwitchPlugin" : null,
      regime: useRegime ? "RegimeDetectorMetaPlugin" : null,
    },
    args,
    timeframes: { htf: "1d", mtf: "4h", ltf: LTF },
    costModel: COST_MODEL,
    positionSize,
    inputProvenance: {
      ohlcv: {
        sourceKind: "downloaded_binance_ohlcv_csv",
        synthetic: false,
        path: resolve(args.dataDir, `binance_${fileBaseSymbol(args.symbol)}_15m.csv`),
        requestedStart: args.startTime.toISOString(),
        requestedEndExclusive: args.endTime.toISOString(),
        sampleCount: windowCandles.length,
        expectedSlots: expectedCandleSlots,
        coverageRatio: expectedCandleSlots > 0 ? windowCandles.length / expectedCandleSlots : 0,
        firstCandleOpen: windowCandles[0]?.timestamp ?? null,
        lastCandleClose: windowCandles.length > 0 ? windowCandles[windowCandles.length - 1]!.timestamp + ltfMs : null,
      },
      funding: useSolFlip ? {
        sourceKind: "downloaded_binance_funding_csv",
        synthetic: false,
        path: args.fundingPath,
        requestedDecisionWindowSampleCount: decisionWindowFunding.length,
        expectedSlots: expectedFundingSlots,
        coverageRatio: expectedFundingSlots !== null && expectedFundingSlots > 0 ? decisionWindowFunding.length / expectedFundingSlots : 0,
        warmupSamplesBeforeWindow: fundingRows.filter((row) => row.fundingTime < args.startTime.getTime()).length,
        firstFundingTime: decisionWindowFunding[0]?.fundingTime ?? null,
        lastFundingTime: decisionWindowFunding[decisionWindowFunding.length - 1]?.fundingTime ?? null,
      } : {
        applicable: false,
        reason: "SOLFlip overlay disabled by mask",
      },
    },
    causality: {
      candleDecisionBasis: "closed 15m candle; decisionTime=candleOpen+15m",
      fundingAvailabilityRule: "fundingTime <= decisionTime",
      lookaheadViolations: strategy.metrics.lookaheadViolations,
      audit: strategy.audit,
    },
    overlayMetrics: {
      ...strategy.metrics,
      finalSolFlipEngaged: strategy.solFlip?.isKillSwitchEngaged(args.endTime.getTime()) ?? null,
      solFlipActivations: strategy.solFlip?.state.regimeActivationCount ?? null,
      solFlipDeactivations: strategy.solFlip?.state.regimeDeactivationCount ?? null,
      finalRegime: strategy.currentRegime(),
      regimeDirectionSignalsReceived: useRegime ? strategy.metrics.regimeDirectionSignalsReceived : null,
      regimeSizingSignalsReceived: useRegime ? strategy.metrics.regimeSizingSignalsReceived : null,
      averageAppliedRegimeMultiplier: multiplierSamples > 0 ? strategy.metrics.regimeMultiplierSum / multiplierSamples : null,
      sizingNotionalMin: sizingSignals.length > 0 ? Math.min(...sizingSignals.map((signal) => signal.notional)) : null,
      sizingNotionalMax: sizingSignals.length > 0 ? Math.max(...sizingSignals.map((signal) => signal.notional)) : null,
      riskSignalCount: riskSignals.length,
    },
    derivedMetrics: {
      ...completeMetrics,
      totalMonths,
      monthlyReturn: monthlyGeometricReturn(result.totalReturn, totalMonths),
      endingEquityUsd: result.equityCurve[result.equityCurve.length - 1]?.equity ?? args.initialEquityUsd,
      netPnlUsd: (result.equityCurve[result.equityCurve.length - 1]?.equity ?? args.initialEquityUsd) - args.initialEquityUsd,
      grossProfitUsd,
      grossLossUsd,
      totalFeesUsd,
      averageHoldingHours: result.totalTrades > 0 ? totalHoldingHours / result.totalTrades : 0,
    },
    result,
    sizingSignals,
    riskSignalTransitions: riskSignals.filter((signal) => signal.breach === true),
    generatedAt: new Date().toISOString(),
  };
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(helpText());
    return;
  }
  const args = parseArgs(argv);
  if (args.smoke) {
    const smokeOutput = await runSmoke(args);
    const smokePath = resolve(process.cwd(), args.outputPath);
    await mkdir(resolve(smokePath, ".."), { recursive: true });
    await writeFile(smokePath, JSON.stringify(smokeOutput, null, 2), "utf8");
    console.log(`[dpc-overlay] SMOKE_OK mask=${args.mask} symbol=${args.symbol} output=${smokePath}`);
    return;
  }
  const output = await runCombination(args);
  const absOutput = resolve(process.cwd(), args.outputPath);
  await mkdir(resolve(absOutput, ".."), { recursive: true });
  await writeFile(absOutput, JSON.stringify(output, null, 2), "utf8");
  const result = output["result"] as BacktestResult;
  console.log(`[dpc-overlay] mask=${args.mask} symbol=${args.symbol} trades=${result.totalTrades}`);
  console.log(`[dpc-overlay] return=${(result.totalReturn * 100).toFixed(2)}% maxDD=${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`[dpc-overlay] Saved: ${absOutput}`);
}

export function handleFatal(error: unknown): void {
  console.error("[dpc-overlay] FATAL:", error);
  process.exitCode = 1;
}

if (import.meta.main) {
  main().catch(handleFatal);
}

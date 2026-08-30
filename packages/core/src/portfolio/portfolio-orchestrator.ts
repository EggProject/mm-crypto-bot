import type { SignalBus } from "../signal-center/signal-bus.js";
import { SignalCenterV1 } from "../signal-center/signal-center-v1.js";
import type { Bar } from "../signal-center/types.js";
import { DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG, PortfolioRiskEngine } from "../risk/portfolio-risk-engine.js";
import { DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT } from "../risk/leverage-invariant.js";
import {
  buildPortfolioMetrics,
  calculateAggregateBar,
  copyImmutableSnapshots,
  currentPortfolioRisk,
  immutableRiskEngineConfig,
  immutableSymbols,
  recordPortfolioEquityAndReturns,
  validatePortfolioOrchestratorConfig,
} from "./portfolio-orchestrator-analytics.js";
import {
  commonBarTimestamps,
  copyImmutableDecisions,
  formatPortfolioDecisionLogJsonl,
  findDecisionAtTimestamp,
  immutableDecisionEngineConfig,
  invokeDecisionSynthesizer,
  marketDataFileStem,
  parseFundingCsv,
  parseOhlcvCsv,
  requirePortfolioInvariant,
  readDecisionSynthesizer,
  validateDecisionEngineResult,
} from "./portfolio-orchestrator-market-data.js";
import {
  DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG,
  type PortfolioEnvelope,
  type PortfolioFundingSnapshot,
  type PortfolioOrchestratorConfig,
  type PortfolioSnapshot,
} from "./portfolio-orchestrator-contracts.js";
import {
  DEFAULT_DECISION_ENGINE_CONFIG,
  DecisionEngine,
  type DecisionEngineConfig,
  type DecisionEngineLike,
  type PositionDecision,
} from "./portfolio-decision.js";
export type { PortfolioOrchestratorConfig } from "./portfolio-orchestrator-contracts.js";
type PortfolioLifecycleResource = Readonly<{
  readonly decisionEngine: DecisionEngineLike;
  readonly signalCenter: SignalCenterV1;
}> & { dispose(): void };
export class PortfolioOrchestrator {
  private readonly lifecycleResources = new Map<string, PortfolioLifecycleResource>();
  private readonly portfolioRisk: PortfolioRiskEngine;
  private readonly perSymbolEquityCurves = new Map<string, number[]>();
  private readonly perSymbolDailyReturns = new Map<string, number[]>();
  private readonly perSymbolDecisionCount = new Map<string, number>();
  private readonly barsBySymbolCache = new Map<string, Bar[]>();
  private readonly perSymbolOpenCount = new Map<string, number>();
  private readonly decisionLog: PositionDecision[] = [];
  private readonly snapshots: PortfolioSnapshot[] = [];
  private leverageBreaches = 0;
  private liquidations = 0;
  private initializedState = false;
  readonly config: PortfolioOrchestratorConfig & { readonly symbols: ReturnType<typeof immutableSymbols> };
  constructor(config: Partial<PortfolioOrchestratorConfig> = {}) {
    if (config.dataDir === undefined)
      throw new Error("[PortfolioOrchestrator] dataDir is required (path to OHLCV CSV directory).");
    if (config.fundingDir === undefined)
      throw new Error("[PortfolioOrchestrator] fundingDir is required (path to funding CSV directory).");
    if (typeof config.dataDir !== "string" || config.dataDir.trim().length === 0)
      throw new Error("[PortfolioOrchestrator] dataDir must be a non-empty path.");
    if (typeof config.fundingDir !== "string" || config.fundingDir.trim().length === 0)
      throw new Error("[PortfolioOrchestrator] fundingDir must be a non-empty path.");
    if (typeof config.readTextFile !== "function")
      throw new Error("[PortfolioOrchestrator] readTextFile is required and must be a function.");
    const readTextFile = config.readTextFile;
    const merged: PortfolioOrchestratorConfig = {
      ...DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG,
      ...config,
      dataDir: config.dataDir,
      fundingDir: config.fundingDir,
      readTextFile,
    };
    validatePortfolioOrchestratorConfig(merged);
    const { decisionEngine, riskEngine, ...configWithoutNestedObjects } = merged;
    const normalizedRiskEngine = immutableRiskEngineConfig(
      riskEngine ?? {
        ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
        concentrationThresholdPct: merged.perSymbolConcentrationPct,
        correlationWindowDays: merged.approximateCorrelationWindowDays,
        leverageInvariant: {
          ...DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
          maxAggregateEffectiveLeverage: merged.maxAggregateEffectiveLeverage,
        },
      },
    );
    this.config = Object.freeze({
      ...configWithoutNestedObjects,
      ...(decisionEngine !== undefined && { decisionEngine: immutableDecisionEngineConfig(decisionEngine) }),
      riskEngine: normalizedRiskEngine,
      symbols: immutableSymbols(merged.symbols),
    });
    this.portfolioRisk = new PortfolioRiskEngine(this.config.riskEngine);
  }
  private emitFunding(
    timestampMs: number,
    fundingBySymbol: ReadonlyMap<string, readonly PortfolioFundingSnapshot[]>,
    lastFunding: Map<string, number>,
  ): void {
    for (const symbol of this.config.symbols) {
      const funding = requirePortfolioInvariant(
        fundingBySymbol.get(symbol),
        `missing funding for ${symbol}`,
      ).filter(
        ({ fundingTime }) =>
          fundingTime >
            requirePortfolioInvariant(lastFunding.get(symbol), `missing funding cursor for ${symbol}`) &&
          fundingTime <= timestampMs,
      );
      const signalCenter = requirePortfolioInvariant(
        this.lifecycleResources.get(symbol),
        `missing signal center for ${symbol}`,
      ).signalCenter;
      for (const snapshot of funding) {
        signalCenter.bus.emit({
          fundingRate: snapshot.fundingRate,
          kind: "carry",
          regime: "neutral",
          source: `funding-feed-${symbol}`,
          symbol,
          timestampMs: snapshot.fundingTime,
        });
        this.config.crossSymbolRecordFundingRate?.(symbol, snapshot.fundingRate, snapshot.fundingTime);
      }
      const latest = funding.at(-1);
      if (latest !== undefined) lastFunding.set(symbol, latest.fundingTime);
    }
  }
  private async drive(
    timestampMs: number,
    barsBySymbol: ReadonlyMap<string, readonly Bar[]>,
    fundingBySymbol: ReadonlyMap<string, readonly PortfolioFundingSnapshot[]>,
    previousBar: Map<string, number>,
  ): Promise<{
    readonly barBySymbol: ReadonlyMap<string, Bar>;
    readonly decisionsBySymbol: ReadonlyMap<string, PositionDecision | undefined>;
  }> {
    const barBySymbol = new Map<string, Bar>();
    const decisionsBySymbol = new Map<string, PositionDecision | undefined>();
    for (const symbol of this.config.symbols) {
      const bar = requirePortfolioInvariant(
        requirePortfolioInvariant(barsBySymbol.get(symbol), `missing bars for ${symbol}`).find(
          ({ timestamp }) => timestamp === timestampMs,
        ),
        `missing common bar for ${symbol}`,
      );
      barBySymbol.set(symbol, bar);
      const signalCenter = requirePortfolioInvariant(
        this.lifecycleResources.get(symbol),
        `missing signal center for ${symbol}`,
      ).signalCenter;
      const funding = requirePortfolioInvariant(
        fundingBySymbol.get(symbol),
        `missing funding for ${symbol}`,
      ).filter(
        ({ fundingTime }) =>
          fundingTime >
            requirePortfolioInvariant(previousBar.get(symbol), `missing bar cursor for ${symbol}`) &&
          fundingTime <= timestampMs,
      );
      previousBar.set(symbol, timestampMs);
      this.config.feedPlugins?.(symbol, signalCenter, bar, funding);
      await signalCenter.onBarAsync(bar);
      this.config.crossSymbolRecordClose?.(symbol, bar.close, bar.timestamp);
      const engine = requirePortfolioInvariant(
        this.lifecycleResources.get(symbol),
        `missing decision engine for ${symbol}`,
      ).decisionEngine;
      const synthesize = readDecisionSynthesizer(engine);
      const candidate =
        synthesize === undefined
          ? findDecisionAtTimestamp(engine, timestampMs)
          : invokeDecisionSynthesizer(engine, synthesize, symbol, timestampMs);
      const decision =
        candidate === undefined ? undefined : validateDecisionEngineResult(candidate, symbol, timestampMs);
      decisionsBySymbol.set(symbol, decision);
      if (decision !== undefined) {
        this.decisionLog.push(decision);
        this.perSymbolDecisionCount.set(
          symbol,
          requirePortfolioInvariant(
            this.perSymbolDecisionCount.get(symbol),
            `missing decision count for ${symbol}`,
          ) + 1,
        );
      }
    }
    return { barBySymbol, decisionsBySymbol };
  }
  private aggregateBar(
    timestampMs: number,
    decisionsBySymbol: ReadonlyMap<string, PositionDecision | undefined>,
    portfolioEquity: number,
  ): PortfolioSnapshot {
    const result = calculateAggregateBar({
      correlationThreshold: this.config.approximateCorrelationThreshold,
      decisionsBySymbol,
      decisionsForTimestamp: this.decisionLog.filter((decision) => decision.timestampMs === timestampMs),
      maxAggregateEffectiveLeverage: this.config.maxAggregateEffectiveLeverage,
      maxPositions: this.config.maxPositions,
      perSymbolConcentrationPct: this.config.perSymbolConcentrationPct,
      portfolioEquity,
      returnsBySymbol: this.perSymbolDailyReturns,
      symbols: this.config.symbols,
      timestampMs,
    });
    if (result.isLeverageBreached) this.leverageBreaches += 1;
    if (result.isLiquidationObserved) this.liquidations += 1;
    return result.snapshot;
  }
  private async loadOhlcvForSymbol(symbol: string, startMs: number, endMs: number): Promise<Bar[]> {
    const base = marketDataFileStem(symbol);
    const fileName = `binance_${base}_1d.csv`;
    return parseOhlcvCsv(await this.readTextFile(this.config.dataDir, fileName), startMs, endMs, fileName);
  }
  private async loadFundingForSymbol(
    symbol: string,
    startMs: number,
    endMs: number,
  ): Promise<PortfolioFundingSnapshot[]> {
    const base = marketDataFileStem(symbol);
    const fileName = `binance_${base}usdt_funding_8h.csv`;
    return parseFundingCsv(
      await this.readTextFile(this.config.fundingDir, fileName),
      symbol,
      startMs,
      endMs,
      fileName,
    );
  }
  private buildEnvelope(): PortfolioEnvelope {
    return buildPortfolioMetrics({
      decisionCountBySymbol: this.perSymbolDecisionCount,
      decisionLog: this.decisionLog,
      equityCurves: this.perSymbolEquityCurves,
      initialEquityUsd: this.config.initialEquityUsd,
      leverageBreaches: this.leverageBreaches,
      liquidations: this.liquidations,
      maxPositions: this.config.maxPositions,
      openCountBySymbol: this.perSymbolOpenCount,
      returnsBySymbol: this.perSymbolDailyReturns,
      snapshots: this.snapshots,
      symbols: this.config.symbols,
    });
  }
  private async readTextFile(dataDirectory: string, fileName: string): Promise<string> {
    try {
      const raw: unknown = await this.config.readTextFile(dataDirectory, fileName);
      if (typeof raw !== "string") throw new Error("the injected reader returned non-text data.");
      return raw;
    } catch (error: unknown) {
      throw new Error(`[PortfolioOrchestrator] Failed to read ${fileName} from ${dataDirectory}.`, {
        cause: error,
      });
    }
  }
  private async runInitialized(startMs: number, endMs: number): Promise<PortfolioEnvelope> {
    const barsBySymbol = new Map<string, Bar[]>();
    const fundingBySymbol = new Map<string, PortfolioFundingSnapshot[]>();
    for (const symbol of this.config.symbols) {
      const bars = await this.loadOhlcvForSymbol(symbol, startMs, endMs);
      if (bars.length === 0) {
        throw new Error(
          `[PortfolioOrchestrator] No OHLCV bars found for ${symbol} in [${String(startMs)}, ${String(endMs)}].`,
        );
      }
      barsBySymbol.set(symbol, bars);
      this.barsBySymbolCache.set(symbol, bars);
      fundingBySymbol.set(symbol, await this.loadFundingForSymbol(symbol, startMs, endMs));
    }
    const timestamps = commonBarTimestamps(this.config.symbols, barsBySymbol);
    if (timestamps.length === 0) {
      throw new Error(
        `[PortfolioOrchestrator] No common bar timestamps across symbols in [${String(startMs)}, ${String(endMs)}].`,
      );
    }
    const lastFunding = new Map(this.config.symbols.map((symbol) => [symbol, 0]));
    const previousBar = new Map(this.config.symbols.map((symbol) => [symbol, 0]));
    let equity = this.config.initialEquityUsd;
    for (const symbol of this.config.symbols) {
      this.perSymbolEquityCurves.set(symbol, [equity]);
      this.perSymbolDailyReturns.set(symbol, []);
      this.perSymbolDecisionCount.set(symbol, 0);
      this.perSymbolOpenCount.set(symbol, 0);
    }
    for (const timestampMs of timestamps) {
      this.emitFunding(timestampMs, fundingBySymbol, lastFunding);
      const driven = await this.drive(timestampMs, barsBySymbol, fundingBySymbol, previousBar);
      const snapshot = this.aggregateBar(timestampMs, driven.decisionsBySymbol, equity);
      this.snapshots.push(snapshot);
      equity = snapshot.equityUsd;
      recordPortfolioEquityAndReturns(
        this.config.symbols,
        this.config.initialEquityUsd,
        this.config.approximateCorrelationWindowDays,
        snapshot,
        timestampMs,
        driven.barBySymbol,
        this.barsBySymbolCache,
        this.perSymbolEquityCurves,
        this.perSymbolDailyReturns,
      );
      this.portfolioRisk.recordEquitySnapshot(timestampMs, equity);
      for (const symbol of this.config.symbols) {
        const returns = requirePortfolioInvariant(
          this.perSymbolDailyReturns.get(symbol),
          `missing returns for ${symbol}`,
        );
        const latestReturn = requirePortfolioInvariant(returns.at(-1), `missing latest return for ${symbol}`);
        this.portfolioRisk.recordSourceReturn(symbol, timestampMs, latestReturn);
      }
    }
    return this.buildEnvelope();
  }
  async run(startMs: number, endMs: number): Promise<PortfolioEnvelope> {
    if (this.initializedState) this.reset();
    this.init();
    try {
      return await this.runInitialized(startMs, endMs);
    } catch (error: unknown) {
      try {
        this.reset();
      } catch (cleanupError: unknown) {
        throw new AggregateError(
          [error, cleanupError],
          "[PortfolioOrchestrator] run and cleanup both failed.",
          { cause: cleanupError },
        );
      }
      throw error;
    }
  }
  init(): void {
    if (this.initializedState) return;
    try {
      for (const symbol of this.config.symbols) {
        const signalCenter = new SignalCenterV1({
          initialEquity: this.config.initialEquityUsd,
          maxAggregateEffectiveLeverage: this.config.maxAggregateEffectiveLeverage,
          symbol,
          riskEngine: {
            ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
            concentrationThresholdPct: this.config.perSymbolConcentrationPct,
            leverageInvariant: {
              ...DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
              maxAggregateEffectiveLeverage: this.config.maxAggregateEffectiveLeverage,
            },
          },
        });
        let engine: DecisionEngineLike | undefined;
        let unsubscribe: (() => void) | undefined;
        try {
          const plugins = this.config.pluginsBySymbol?.(symbol, signalCenter);
          if (plugins === undefined)
            throw new Error(`[PortfolioOrchestrator] No pluginsBySymbol provided for ${symbol}.`);
          if (plugins.length === 0)
            throw new Error(
              `[PortfolioOrchestrator] pluginsBySymbol returned 0 plugins for ${symbol}; SCv1 requires at least one plugin at boot.`,
            );
          for (const plugin of plugins) signalCenter.registerPlugin(plugin);
          signalCenter.start();
          const config: DecisionEngineConfig & { readonly symbol: string } = {
            ...DEFAULT_DECISION_ENGINE_CONFIG,
            ...this.config.decisionEngine,
            maxNotionalPerSymbolUsd: this.config.initialEquityUsd * this.config.maxAggregateEffectiveLeverage,
            symbol,
          };
          const factory = this.config.decisionEngineFactory ?? ((config) => new DecisionEngine(config));
          engine = factory(config);
          unsubscribe = engine.subscribe(signalCenter.bus);
          let isDisposed = false;
          const activeEngine = engine;
          const activeUnsubscribe = unsubscribe;
          this.lifecycleResources.set(symbol, {
            decisionEngine: activeEngine,
            dispose(): void {
              if (isDisposed) return;
              isDisposed = true;
              activeUnsubscribe();
              activeEngine.reset();
              signalCenter.reset();
            },
            signalCenter,
          });
        } catch (error: unknown) {
          try {
            unsubscribe?.();
            engine?.reset();
            signalCenter.reset();
          } catch {
            // Best-effort rollback preserves the primary initialization error.
          }
          throw error;
        }
      }
      this.initializedState = true;
    } catch (error: unknown) {
      try {
        this.reset();
      } catch {
        // Best-effort rollback preserves the primary initialization error.
      }
      throw error;
    }
  }
  getBusesBySymbol(): ReadonlyMap<string, SignalBus> {
    return new Map(
      [...this.lifecycleResources].map(([symbol, resource]) => [symbol, resource.signalCenter.bus]),
    );
  }
  getDecisionLog(): readonly PositionDecision[] {
    return copyImmutableDecisions(this.decisionLog);
  }
  formatDecisionLogJsonl(): string {
    return formatPortfolioDecisionLogJsonl(this.decisionLog);
  }
  getSnapshots(): readonly PortfolioSnapshot[] {
    return copyImmutableSnapshots(this.snapshots);
  }
  getPortfolioRisk() {
    return currentPortfolioRisk(this.portfolioRisk, this.config.initialEquityUsd);
  }
  reset(): void {
    let lifecycleFailure: unknown;
    for (const resource of this.lifecycleResources.values()) {
      try {
        resource.dispose();
      } catch (error: unknown) {
        lifecycleFailure ??= error;
      }
    }
    this.lifecycleResources.clear();
    this.portfolioRisk.clear();
    this.perSymbolEquityCurves.clear();
    this.perSymbolDailyReturns.clear();
    this.perSymbolDecisionCount.clear();
    this.perSymbolOpenCount.clear();
    this.decisionLog.length = 0;
    this.snapshots.length = 0;
    this.leverageBreaches = 0;
    this.liquidations = 0;
    this.initializedState = false;
    if (lifecycleFailure instanceof Error) throw lifecycleFailure;
    if (lifecycleFailure !== undefined)
      throw new Error("[PortfolioOrchestrator] Lifecycle disposal failed with a non-error value.", {
        cause: lifecycleFailure,
      });
  }
  get initialized(): boolean {
    return this.initializedState;
  }
}
export {
  DEFAULT_DECISION_ENGINE_CONFIG,
  DecisionEngine,
  DEFENSIVE_PLUGIN_NAMES,
  type DecisionEngineConfig,
  type DecisionEngineLike,
  type PositionDecision,
} from "./portfolio-decision.js";
export { DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG } from "./portfolio-orchestrator-contracts.js";
export type { Bar } from "../signal-center/types.js";
export type {
  CapReason,
  PerSymbolEnvelope,
  PortfolioEnvelope,
  PortfolioPosition,
  PortfolioSnapshot,
} from "./portfolio-orchestrator-contracts.js";
export function createPortfolioOrchestrator(
  config?: Partial<PortfolioOrchestratorConfig>,
): PortfolioOrchestrator {
  return new PortfolioOrchestrator(config);
}

import type { Symbol } from "@mm-crypto-bot/exchange";
import {
  assertAggregateEffectiveExposureLimit,
  DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
  type AggregateEffectiveExposureLimit,
} from "@mm-crypto-bot/core";
import { requireLogger, type Logger } from "@mm-crypto-bot/logging";

import type { RiskManager } from "../risk/index.js";
import {
  calculateAggregateNotional,
  calculatePnl,
  calculateUnrealizedPnl,
  calculateUnrealizedPnlTotal,
  createLeveragePositions,
  createPositionId,
} from "./position-manager.calculations.js";
import { PositionRiskMonitor } from "./position-manager.risk-monitor.js";
import { createRestoredPosition, retainLatestClosedTrades } from "./position-manager.restoration.js";
import {
  PositionManagerError,
  type ClosedTradeSnapshot,
  type FillEvent,
  type PositionContext,
  type PositionManagerOptions,
  type PositionRecord,
  type PositionSide,
  type PositionSnapshot,
  type RestoredPositionSnapshot,
} from "./position-manager.types.js";

export { PositionManagerError } from "./position-manager.types.js";
export type {
  FillEvent,
  PositionContext,
  PositionManagerOptions,
  PositionSide,
  PositionSnapshot,
} from "./position-manager.types.js";

const POSITION_SIDES: readonly PositionSide[] = ["long", "short"];

export class PositionManager {
  private readonly positions = new Map<string, PositionRecord>();
  private readonly initialEquityUsd: number;
  private readonly maxPositions: number;
  private readonly maxLeverage: number;
  private readonly aggregateExposureLimit: AggregateEffectiveExposureLimit;
  private readonly logger: Logger;
  private readonly riskMonitor = new PositionRiskMonitor();
  private riskManager: RiskManager | undefined;
  private realizedPnlTotal = 0;
  private closedTrades: readonly ClosedTradeSnapshot[] = [];

  public constructor(options: PositionManagerOptions) {
    if (options.initialEquityUsd <= 0) {
      throw new PositionManagerError(
        `[position-manager] initialEquityUsd must be positive, got ${String(options.initialEquityUsd)}`,
      );
    }
    if (options.maxPositions < 1) {
      throw new PositionManagerError(
        `[position-manager] maxPositions must be >= 1, got ${String(options.maxPositions)}`,
      );
    }
    if (options.maxLeverage < 1 || options.maxLeverage > 10) {
      throw new PositionManagerError(
        `[position-manager] maxLeverage must be 1..10 (1:10 MANDATE), got ${String(options.maxLeverage)}`,
      );
    }
    this.initialEquityUsd = options.initialEquityUsd;
    this.maxPositions = options.maxPositions;
    this.maxLeverage = options.maxLeverage;
    this.aggregateExposureLimit =
      options.aggregateExposureLimit ?? DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT;
    this.logger = requireLogger(options.logger, "position-manager");
  }

  private appendClosedTrade(
    record: PositionRecord,
    quantity: number,
    exitPrice: number,
    pnl: number,
    closedAt: number,
  ): void {
    this.closedTrades = [
      ...this.closedTrades,
      {
        strategy: record.strategy,
        symbol: record.symbol,
        side: record.side,
        quantity,
        entryPrice: record.entryPrice,
        exitPrice,
        pnl,
        pnlPct: (pnl / (record.entryPrice * quantity)) * 100,
        closedAt,
      },
    ];
  }

  private assertAggregateLeverage(reason: string): void {
    const totalNotional = calculateAggregateNotional(this.positions.values());
    const equity = this.getEquity();
    if (equity <= 0) {
      throw new PositionManagerError(
        `[position-manager] L3 leverage check failed (equity=${String(equity)}) — reason: ${reason}`,
      );
    }
    try {
      assertAggregateEffectiveExposureLimit(totalNotional, equity, this.aggregateExposureLimit);
    } catch (error) {
      this.logger.error("position.leverage.aggregate.breached", {
        reason,
        totalNotional,
        equity,
        computedLeverage: totalNotional / equity,
        maxAggregateEffectiveLeverage: this.aggregateExposureLimit.maxAggregateEffectiveLeverage,
      });
      throw new PositionManagerError(
        `[position-manager] L3 leverage breach (${reason}): ${String(error)}`,
        error,
      );
    }
  }

  public openPosition(
    strategy: string,
    symbol: Symbol,
    side: PositionSide,
    quantity: number,
    entryPrice: number,
    leverage: number,
    timestamp: number = Date.now(),
  ): PositionSnapshot {
    if (this.positions.size >= this.maxPositions) {
      const existing = Array.from(
        this.positions.values(),
        (position) => `${position.strategy}:${position.symbol}:${position.side}`,
      );
      throw new PositionManagerError(
        `[position-manager] maxPositions cap (${String(this.maxPositions)}) reached — current positions: ${existing.join(", ")}`,
      );
    }
    if (leverage < 1 || leverage > 10) {
      throw new PositionManagerError(
        `[position-manager] leverage=${String(leverage)} violates 1:10 MANDATE (must be 1..10)`,
      );
    }
    if (quantity <= 0) {
      throw new PositionManagerError(`[position-manager] quantity must be positive, got ${String(quantity)}`);
    }
    if (entryPrice <= 0) {
      throw new PositionManagerError(
        `[position-manager] entryPrice must be positive, got ${String(entryPrice)}`,
      );
    }

    const id = createPositionId(strategy, symbol, side);
    if (this.positions.has(id)) {
      return this.recordFill({ strategy, symbol, side, quantity, price: entryPrice, leverage, timestamp });
    }

    const notionalUsd = quantity * entryPrice;
    const record: PositionRecord = {
      id,
      strategy,
      symbol,
      side,
      quantity,
      entryPrice,
      currentPrice: entryPrice,
      leverage,
      unrealizedPnl: 0,
      realizedPnl: 0,
      openedAt: timestamp,
      notionalUsd,
    };
    const candidateRecords = [...this.positions.values(), record];
    const totalNotional = calculateAggregateNotional(candidateRecords);
    const equity = this.getEquity();
    try {
      assertAggregateEffectiveExposureLimit(totalNotional, equity, this.aggregateExposureLimit);
    } catch (error) {
      this.logger.error("position.leverage.open.rejected", {
        strategy,
        symbol,
        side,
        quantity,
        entryPrice,
        notionalUsd,
        totalNotional,
        equity,
        computedLeverage: totalNotional / equity,
        maxAggregateEffectiveLeverage: this.aggregateExposureLimit.maxAggregateEffectiveLeverage,
      });
      throw new PositionManagerError(
        `[position-manager] L3 leverage breach opening ${strategy}:${symbol}:${side}: ${String(error)}`,
        error,
      );
    }

    this.positions.set(id, record);
    this.riskMonitor.armTrailingStop(record);
    this.logger.info("position.opened", {
      strategy,
      symbol,
      side,
      quantity,
      entryPrice,
      notionalUsd,
      leverage,
    });
    return { ...record };
  }

  public recordFill(fill: FillEvent): PositionSnapshot {
    const id = createPositionId(fill.strategy, fill.symbol, fill.side);
    const existing = this.positions.get(id);
    const oppositeId = createPositionId(fill.strategy, fill.symbol, fill.side === "long" ? "short" : "long");
    const opposite = this.positions.get(oppositeId);

    if (opposite !== undefined && existing === undefined) {
      const newQuantity = opposite.quantity - fill.quantity;
      if (newQuantity < 0) {
        throw new PositionManagerError(
          `[position-manager] fill quantity ${String(fill.quantity)} exceeds opposite position ${String(opposite.quantity)}`,
        );
      }
      const closedQuantity = Math.min(opposite.quantity, fill.quantity);
      const pnl = calculatePnl(opposite.side, opposite.entryPrice, fill.price, closedQuantity);
      opposite.realizedPnl += pnl;
      this.realizedPnlTotal += pnl;
      if (newQuantity === 0) {
        this.appendClosedTrade(opposite, closedQuantity, fill.price, pnl, fill.timestamp);
        this.positions.delete(oppositeId);
        this.logger.info("position.closed.oppositefill", {
          strategy: opposite.strategy,
          symbol: opposite.symbol,
          side: opposite.side,
          pnl,
        });
        this.riskMonitor.recordClosed(oppositeId, pnl, fill.timestamp);
      } else {
        opposite.quantity = newQuantity;
        opposite.notionalUsd = newQuantity * opposite.entryPrice;
        opposite.currentPrice = fill.price;
        opposite.unrealizedPnl = calculateUnrealizedPnl(opposite);
      }
      return { ...(this.positions.get(oppositeId) ?? opposite) };
    }

    if (existing !== undefined) {
      const totalQuantity = existing.quantity + fill.quantity;
      const nextEntryPrice =
        (existing.quantity * existing.entryPrice + fill.quantity * fill.price) / totalQuantity;
      existing.entryPrice = nextEntryPrice;
      existing.quantity = totalQuantity;
      existing.currentPrice = fill.price;
      existing.notionalUsd = totalQuantity * nextEntryPrice;
      existing.unrealizedPnl = calculateUnrealizedPnl(existing);
      this.assertAggregateLeverage(`recordFill same-side ${fill.strategy}:${fill.symbol}:${fill.side}`);
      return { ...existing };
    }

    return this.openPosition(
      fill.strategy,
      fill.symbol,
      fill.side,
      fill.quantity,
      fill.price,
      fill.leverage,
      fill.timestamp,
    );
  }

  public closePosition(
    strategy: string,
    symbol: Symbol,
    exitPrice: number,
    timestamp: number = Date.now(),
  ): number {
    for (const side of POSITION_SIDES) {
      const id = createPositionId(strategy, symbol, side);
      const existing = this.positions.get(id);
      if (existing === undefined) continue;
      const pnl = calculatePnl(side, existing.entryPrice, exitPrice, existing.quantity);
      this.realizedPnlTotal += pnl;
      this.appendClosedTrade(existing, existing.quantity, exitPrice, pnl, timestamp);
      this.positions.delete(id);
      this.logger.info("position.closed", { strategy, symbol, side, pnl });
      this.riskMonitor.recordClosed(id, pnl, timestamp);
      return pnl;
    }
    throw new PositionManagerError(
      `[position-manager] cannot close — no open position for ${strategy}:${symbol}`,
    );
  }

  public setRiskManager(riskManager: RiskManager | null | undefined): void {
    this.riskManager = riskManager ?? undefined;
    this.riskMonitor.setRiskManager(this.riskManager);
  }

  public restorePosition(snapshot: RestoredPositionSnapshot): PositionSnapshot {
    const record = createRestoredPosition(snapshot);
    this.positions.set(record.id, record);
    this.logger.info("position.state.restored", {
      strategy: record.strategy,
      symbol: record.symbol,
      side: record.side,
      quantity: record.quantity,
      entryPrice: record.entryPrice,
      currentPrice: record.currentPrice,
      leverage: record.leverage,
      notionalUsd: record.notionalUsd,
    });
    return { ...record };
  }

  public restoreRealizedPnl(realizedPnlUsd: number): void {
    if (this.realizedPnlTotal !== 0) {
      this.logger.warn("position.realizedpnl.overwritten", {
        existing: this.realizedPnlTotal,
        new: realizedPnlUsd,
      });
    }
    this.realizedPnlTotal = realizedPnlUsd;
  }

  public restoreClosedTrades(trades: readonly ClosedTradeSnapshot[]): void {
    this.closedTrades = retainLatestClosedTrades(trades);
    this.logger.info("position.closedtrades.restored", {
      count: this.closedTrades.length,
      droppedIfAny: trades.length - this.closedTrades.length,
    });
  }

  public updateMarketPrice(symbol: Symbol, price: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    for (const record of this.positions.values()) {
      if (record.symbol !== symbol) continue;
      record.currentPrice = price;
      record.unrealizedPnl = calculateUnrealizedPnl(record);
      this.riskMonitor.observePrice(record, price);
    }
    this.riskMonitor.updateEquity(this.getEquity());
  }

  public getPositions(): readonly PositionSnapshot[] {
    return Array.from(this.positions.values(), (record) => ({ ...record }));
  }

  public getPosition(strategy: string, symbol: Symbol, side: PositionSide): PositionSnapshot | undefined {
    const record = this.positions.get(createPositionId(strategy, symbol, side));
    return record === undefined ? undefined : { ...record };
  }

  public reconcileVenueAbsent(id: string): boolean {
    const position = this.positions.get(id);
    if (position === undefined) return false;
    this.positions.delete(id);
    this.logger.error("position.venue.absent.quarantined", {
      strategy: position.strategy,
      symbol: position.symbol,
      side: position.side,
      quantity: position.quantity,
    });
    return true;
  }

  public getPositionContext(): PositionContext {
    return {
      equityUsd: this.getEquity(),
      positions: createLeveragePositions(this.positions.values()),
    };
  }

  public getEquity(): number {
    return (
      this.initialEquityUsd + this.realizedPnlTotal + calculateUnrealizedPnlTotal(this.positions.values())
    );
  }

  public getRealizedPnl(): number {
    return this.realizedPnlTotal;
  }

  public getClosedTrades(): readonly ClosedTradeSnapshot[] {
    return this.closedTrades;
  }

  public getMaxPositions(): number {
    return this.maxPositions;
  }

  public getMaxLeverage(): number {
    return this.maxLeverage;
  }

  public getPositionCount(): number {
    return this.positions.size;
  }
}

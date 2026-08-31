import type { RiskManager } from "../risk/index.js";
import type { PositionRecord } from "./position-manager.types.js";

export class PositionRiskMonitor {
  private riskManager: RiskManager | undefined;

  private getAtrProxy(quantity: number, notionalUsd: number): number {
    return (notionalUsd / quantity) * 0.01;
  }

  public setRiskManager(riskManager: RiskManager | null | undefined): void {
    this.riskManager = riskManager ?? undefined;
  }

  public armTrailingStop(record: PositionRecord): void {
    const riskManager = this.riskManager;
    if (riskManager === undefined) return;
    riskManager.armTrailingStop(
      record.id,
      record.side,
      record.entryPrice,
      this.getAtrProxy(record.quantity, record.notionalUsd),
    );
  }

  public observePrice(record: PositionRecord, price: number): void {
    const riskManager = this.riskManager;
    if (riskManager === undefined) return;
    riskManager.onTick({
      positionId: record.id,
      side: record.side,
      currentPrice: price,
      atr: this.getAtrProxy(record.quantity, record.notionalUsd),
    });
  }

  public recordClosed(positionId: string, pnl: number, timestamp: number): void {
    const riskManager = this.riskManager;
    if (riskManager === undefined) return;
    riskManager.onTradeClosed(pnl, timestamp);
    riskManager.disarmTrailingStop(positionId);
  }

  public updateEquity(equity: number): void {
    this.riskManager?.onEquityUpdate(equity);
  }
}

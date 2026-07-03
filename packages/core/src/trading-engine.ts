/**
 * packages/core/src/trading-engine.ts
 *
 * Trading engine core - a strategy altal generalt TradingSignal-okat
 * fogadja, es az aktualis driver-en (paper | live | backtest) vegrehajtja.
 *
 * TODO implementacio:
 * - Strategy indiktorok (Donchian, Supertrend, BB, RSI) - a kivalasztott
 *   MTF-Trend-Konfluencia Kompozit v1.0 strategia szerint
 * - Portfolio allokacio (BTC 50% / ETH 30% / SOL 20%)
 * - Risk management (1% risk/trade, 1/4-Kelly, 15% DD kill-switch)
 * - Multi-symbol signal pipeline
 */

import type {
  TradingSignal,
  RiskConfig,
  PortfolioConfig,
  FillRecord,
} from "@mm-crypto-bot/shared";

export interface TradingEngineOptions {
  readonly risk: RiskConfig;
  readonly portfolio: PortfolioConfig;
}

/**
 * Driver interface - a trading engine csak ezen a kontraktuson dolgozik,
 * igy a paper/live/backtest driver-ek drop-in cserelhetoek.
 */
export interface SignalDriver {
  executeSignal(signal: TradingSignal): Promise<FillRecord | null>;
}

export class TradingEngine {
  // opts eltarolasa a kesobbi indiktor implementaciohoz (jelenleg csak constructor hasznalja)
  private readonly opts: TradingEngineOptions;
  private driver: SignalDriver | null = null;
  // running flag a start/stop ciklushoz, kesobbi state machine-hez
  private running = false;

  constructor(opts: TradingEngineOptions) {
    this.opts = opts;
  }

  setDriver(driver: SignalDriver): void {
    this.driver = driver;
  }

  // Promise<void> API a kesobbi async state machine miatt
  start(): Promise<void> {
    if (this.driver === null) {
      return Promise.reject(
        new Error("Driver nincs beallitva - hívd setDriver()-t elotte."),
      );
    }
    this.running = true;
    // TODO: indiktor pipeline inditasa, strategy ciklus
    return Promise.resolve();
  }

  stop(): void {
    this.running = false;
  }
}
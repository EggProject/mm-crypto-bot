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
  // @ts-expect-error: opts eltarolasa a kesobbi indiktor implementaciohoz
  // eslint-disable-next-line @typescript-eslint/no-unused-private-class-member
  private readonly opts: TradingEngineOptions;
  private driver: SignalDriver | null = null;
  // @ts-expect-error: running flag a start/stop ciklushoz
  // eslint-disable-next-line @typescript-eslint/no-unused-private-class-member
  private running = false;

  constructor(opts: TradingEngineOptions) {
    this.opts = opts;
  }

  setDriver(driver: SignalDriver): void {
    this.driver = driver;
  }

  async start(): Promise<void> {
    if (this.driver === null) {
      throw new Error("Driver nincs beallitva - hívd setDriver()-t elotte.");
    }
    this.running = true;
    // TODO: indiktor pipeline inditasa, strategy ciklus
  }

  stop(): void {
    this.running = false;
  }
}
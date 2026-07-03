/**
 * packages/backtest/src/backtest-engine.ts
 *
 * Backtest engine skeleton - historikus OHLCV adatokon futtatja a
 * strategy-t es kalkulalja a PnL-t, sharpe-ot, drawdown-t.
 *
 * A fee koltsegek a fee-model.ts-bol jonnek, a borrow rate PARAMETRIZALVA
 * van (nem a kodba egetve) - a research-strategy verifier 2. caveat-janak
 * megoldasa.
 */

import type {
  ExchangeFeed,
  ExchangeFeeConfig,
  RiskConfig,
  TradingSignal,
  FillRecord,
} from "@mm-crypto-bot/shared";
import { calcBacktestCost } from "./fee-model.js";

export interface BacktestConfig {
  readonly startTs: number;
  readonly endTs: number;
  readonly initialEquity: number;
  readonly fee: ExchangeFeeConfig;
  readonly risk: RiskConfig;
}

export interface BacktestResult {
  readonly trades: readonly FillRecord[];
  readonly equity: number;
  readonly maxDrawdownPct: number;
  readonly sharpe: number;
  readonly winRate: number;
}

/**
 * Backtest engine skeleton.
 *
 * TODO implementacio:
 * 1. OHLCV adatok betoltese a feed.fetchOHLCV-n keresztul (historical bars)
 * 2. Strategy indiktorok szamitasa (Donchian, Supertrend, BB, RSI)
 * 3. Signal generalas minden bar-hoz
 * 4. Trade szimulacio a fee-modellel
 * 5. Metrikak kalkulacioja (Sharpe, max DD, win rate)
 */
export class BacktestEngine {
  // @ts-expect-error: feed eltarolasa a kesobbi implementaciohoz (OHLCV historikus betoltes)
  // eslint-disable-next-line @typescript-eslint/no-unused-private-class-member
  private readonly feed: ExchangeFeed;
  private readonly config: BacktestConfig;

  constructor(feed: ExchangeFeed, config: BacktestConfig) {
    this.feed = feed;
    this.config = config;
  }

  /**
   * Egy trade koltsegének kiszamitasa a fee-modell alapjan.
   * Publikus, hogy a strategy engine is hasznalhassa.
   */
  computeTradeCost(
    notional: number,
    isMargin: boolean,
    holdHours: number,
    wasLiquidated: boolean = false,
  ): number {
    return calcBacktestCost(notional, this.config.fee, isMargin, holdHours, wasLiquidated).total;
  }

  /**
   * Backtest futtatas. Jelenleg skeleton - a tenyleges implementacio
   * a strategy engine integracio utan keszul el.
   */
  async run(signalGenerator: (bars: unknown) => Promise<readonly TradingSignal[]>): Promise<BacktestResult> {
    // TODO: implementacio
    void signalGenerator;
    return {
      trades: [],
      equity: this.config.initialEquity,
      maxDrawdownPct: 0,
      sharpe: 0,
      winRate: 0,
    };
  }
}
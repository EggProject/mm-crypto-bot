// packages/backtest/src/types.ts — a `@mm-crypto-bot/backtest` domain típusai
//
// A backtest motor és a riport-generator közös típusai. A CCXT fetch
// mockolható (`ExchangeFeed` interfész), a költség-modell konfigurálható,
// és a position-sizing a `docs/research/selected-strategy.md` §5 szerint
// 1/4-Kelly + 1% risk / trade.

import type { Strategy } from "@mm-crypto-bot/core";
import type { Candle, Timeframe, Trade } from "@mm-crypto-bot/shared/types";

/**
 `ExchangeFeed` — absztrakt interfész a historikus OHLCV adatok
 betöltéséhez. A CCXT-t implementáló adapter ezt az interfészt
 valósítja meg, de a backtest motor csak az interfészen keresztül
 beszél — így a tesztekben egy mock implementáció is használható.

 A `symbol` formátuma a CCXT-t követi ("BTC/USDC"), a `timeframe`
 pedig a Timeframe típus egyik eleme.
*/
export interface ExchangeFeed {
  /** Adott szimbólum és timeframe OHLCV adatainak letöltése. */
  fetchOHLCV(
    symbol: string,
    timeframe: Timeframe,
    options: { readonly since?: number; readonly limit?: number },
  ): Promise<readonly Candle[]>;
}

/**
 `CostModel` — a backtest költség-modellje. A `selected-strategy.md` §9
 alapján a taker fee 0.1%/side, a margin borrow 0.01%/óra, a spread
 és slippage eszköz-függő.
*/
export interface CostModel {
  /** Taker fee oldalanként (pl. 0.001 = 0.1%). */
  readonly takerFeeRate: number;
  /** Slippage oldalanként (pl. 0.0005 = 0.05%). */
  readonly slippageRate: number;
  /** Spread oldalanként (pl. 0.0002 = 2 bps BTC/USDC-hez). */
  readonly spreadRate: number;
  /** Margin-kamat (pl. 0.0001 = 0.01%/óra, USDT/USDC-re). */
  readonly borrowRatePerHour: number;
  /** Funding rate (8h periódus, perpetual kontraktusokhoz, opcionális). */
  readonly fundingRatePer8h?: number;
}

/**
 `PositionSizeConfig` — a Kelly-frakció és a kockázati limitek.
 A `docs/research/selected-strategy.md` §5.2 szerint 1/4-Kelly-t
 alkalmazunk, 1% risk / trade és 15% DD kill-switch.
*/
export interface PositionSizeConfig {
  /** Kockázat / trade az equity százalékában (alap: 0.01 = 1%). */
  readonly riskPerTrade: number;
  /** Kelly-frakció (alap: 0.25 = 1/4-Kelly). */
  readonly kellyFraction: number;
  /** Maximális drawdown, ami felett a kill-switch leáll (alap: 0.15). */
  readonly maxDrawdown: number;
  /** Position notional max az equity %-ában (alap: 0.20). */
  readonly maxPositionPctEquity: number;
  /** Position notional min az equity %-ában (alap: 0.01). */
  readonly minPositionPctEquity: number;
}

export const DEFAULT_POSITION_SIZE: PositionSizeConfig = {
  riskPerTrade: 0.01,
  kellyFraction: 0.25,
  maxDrawdown: 0.15,
  maxPositionPctEquity: 0.2,
  minPositionPctEquity: 0.01,
};

/**
 `BacktestOptions` — a `runBacktest` fő konfigurációja.
 Minden adat-pontot tartalmaz, ami a futtatáshoz kell: a feed típusa,
 a költség-modell, a position-sizing konfig, és a walk-forward OOS
 opciók.
*/
export interface BacktestOptions {
  readonly symbol: string;
  readonly htfTimeframe: Timeframe;
  readonly mtfTimeframe: Timeframe;
  readonly ltfTimeframe: Timeframe;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly initialEquityUsd: number;
  readonly feed: ExchangeFeed;
  readonly costModel: CostModel;
  readonly positionSize: PositionSizeConfig;
  /** Determinisztikus seed (az opcionális Kelly frakció szamolasahoz). */
  readonly seed?: number;
  /** Walk-forward OOS konfiguráció (opcionális). */
  readonly walkForward?: WalkForwardConfig;
  /** Egyedi stratégia (alapértelmezetten a kiválasztott MTF-TKC). */
  readonly strategy?: Strategy;
}

export interface WalkForwardConfig {
  /** In-sample ablak hossza (napokban). */
  readonly inSampleDays: number;
  /** Out-of-sample ablak hossza (napokban). */
  readonly outOfSampleDays: number;
  /** Görgetés lépésköze (napokban). */
  readonly stepDays: number;
}

/**
 `EquityPoint` — az equity-görbe egy pontja. A backtest motor minden
 LTF candle-re rögzíti az aktuális equity-t.
*/
export interface EquityPoint {
  readonly timestamp: number;
  readonly equity: number;
}

/**
 `BacktestResult` — a `runBacktest` kimenete. A `selected-strategy.md` §8.2
 minimum-mutatókat és a trade-listát is tartalmazza.
*/
export interface BacktestResult {
  readonly totalReturn: number;
  readonly annualizedReturn: number;
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly maxDrawdown: number;
  readonly profitFactor: number;
  readonly winRate: number;
  readonly totalTrades: number;
  readonly trades: readonly Trade[];
  readonly equityCurve: readonly EquityPoint[];
  readonly killSwitchTriggered: boolean;
  readonly startTime: number;
  readonly endTime: number;
}

/**
 `BacktestReport` — az emberi olvasásra szánt riport. A `BacktestResult`
 mezőit strukturáltan jeleníti meg + egy összefoglaló szöveget.
*/
export interface BacktestReport {
  readonly summary: string;
  readonly result: BacktestResult;
  readonly metrics: BacktestMetrics;
}

export interface BacktestMetrics {
  readonly totalReturnPct: number;
  readonly annualizedReturnPct: number;
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly maxDrawdownPct: number;
  readonly profitFactor: number;
  readonly winRatePct: number;
  readonly totalTrades: number;
  readonly avgWin: number;
  readonly avgLoss: number;
  readonly avgWinPct: number;
  readonly avgLossPct: number;
  readonly bestTrade: number;
  readonly worstTrade: number;
  readonly maxConsecutiveWins: number;
  readonly maxConsecutiveLosses: number;
  readonly exposureTime: number;
}

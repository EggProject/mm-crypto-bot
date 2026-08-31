// packages/core/src/types.ts — the `@mm-crypto-bot/core` domain types
//
// A kiválasztott stratégia (MTF-Trend-Konfluencia Kompozit v1.0)
// belső típusai. Ezek a típusok a stratégia-motor és a backtest
// motor közös "nyelvtanát" adják.
//
// Specifikáció: docs/research/selected-strategy.md

import type { Candle, Side, Symbol, Timeframe } from "@mm-crypto-bot/shared/types";

/**
 `IndicatorState` — a multi-timeframe indikátor-állapot. A stratégia-motor
 minden timeframe-re nyilvántartja az aktuális indikátor-értékeket, és
 a HTF/MTF/LTF rétegek az `mtfState` aggregate-en keresztül kommunikálnak.

 - `close` — a forrás-gyertya záróára (a Donchian/BB összehasonlításokhoz).
 - `candleIndex` — a forrás-gyertya sorszáma a feed-en belül.
 - `donchianUpper` / `donchianLower` — Donchian(20) csatorna (HTF).
 - `supertrend` — Supertrend(10, 3.0) vonal (HTF).
 - `supertrendDir` — `+1` up, `-1` down (HTF).
 - `ema50` / `ema200` — EMA 50 és 200 periódussal (HTF).
 - `bbUpper` / `bbLower` / `bbMiddle` — Bollinger Bands(20, 2σ) (MTF).
 - `adx` — ADX(14) (HTF + MTF).
 - `rsi` — RSI(14) (MTF + LTF).
 - `atr` — ATR(14) (LTF, a stop-loss távolsághoz).
 - `volumeMa` — Volume MA(20) (LTF, trigger-konfirmáció).

 Bármelyik mező `undefined`, ha a számításhoz nincs elég korábbi gyertya
 (az indikátor "bemelegedési" periódusában vagyunk).
*/
export interface IndicatorState {
  readonly close?: number;
  readonly candleIndex?: number;
  readonly donchianUpper?: number;
  readonly donchianLower?: number;
  readonly supertrend?: number;
  readonly supertrendDir?: 1 | -1;
  readonly ema50?: number;
  readonly ema200?: number;
  readonly bbUpper?: number;
  readonly bbLower?: number;
  readonly bbMiddle?: number;
  readonly adx?: number;
  readonly rsi?: number;
  readonly atr?: number;
  readonly volumeMa?: number;
}

/**
 `MtfState` — a három időkeret-állapot összessége. A stratégia-motor a
 `Strategy.onCandle` hívásakor kapja meg (az LTF-en),
 és ezen keresztül éri el a HTF és MTF indikátor-értékeket is.
*/
export interface MtfState {
  readonly htf: IndicatorState;
  readonly mtf: IndicatorState;
  readonly ltf: IndicatorState;
}

/**
 `StrategyContext` — a `Strategy.onCandle` callback bemenete.
 Az LTF-en hívódik meg, de a `mtfState` tartalmazza a HTF és MTF
 indikátor-értékeket is.

 - `symbol` — a kereskedett eszköz (BTC/USDC, ETH/USDC, SOL/USDC).
 - `timeframe` — mindig az LTF (a stratégia a LTF-en triggerel).
 - `candleIndex` — az aktuális LTF gyertya sorszáma a feed-en belül.
 - `candle` — az aktuális LTF gyertya OHLCV adata.
 - `mtfState` — a HTF + MTF + LTF indikátor-állapot.
 - `pricePrecision` — a `roundTo` tizedesjegye az árakhoz (BTC=2, ETH=2, SOL=3).
*/
export interface StrategyContext {
  readonly symbol: Symbol;
  readonly timeframe: Timeframe;
  readonly candleIndex: number;
  readonly candle: Candle;
  readonly mtfState: MtfState;
  readonly pricePrecision: number;
}

/**
 `StrategySignal` — the `Strategy.onCandle` result. The strategy returns this
 type when it produces a long/short signal; when there is no signal, it returns
 `undefined`.

 - `side` — `buy` (long) vagy `sell` (short).
 - `confidence` — 0..1 közötti érték, a jel erőssége. A backtest a
   position-size-ot nem skálázza ezzel, de a riportban rögzíti.
 - `reason` — magyar/angol szöveges indoklás a debug-hoz és a trade-listához.
 - `stopLoss` — javasolt stop-loss ár (LTF ATR(14) alapján).
 - `takeProfit` — javasolt take-profit ár (R:R = 1:2.5 a stop-távolsággal).
*/
export interface StrategySignal {
  readonly side: Side;
  readonly confidence: number;
  readonly reason: string;
  readonly stopLoss: number;
  readonly takeProfit: number;
}

/**
 * `OpenPositionSnapshot` is the open-position view passed to
 * `Strategy.onOpenPositionUpdate`. The backtest engine supplies the position
 * fields needed to update stop-loss/take-profit levels or request an immediate
 * close, such as after a trailing-stop trigger.

  - `side` — `buy` (long) vagy `sell` (short).
  - `entryTime` — az entry timestamp-je (ms).
  - `entryPrice` — a kitöltési entry-ár (slippage+spread alkalmazva).
  - `quantity` — a pozíció mennyisége (instrument unit, pl. BTC).
  - `stopLoss` — az aktuális stop-loss szint (frissíthető).
  - `takeProfit` — az aktuális take-profit szint (frissíthető).
  - `holdingBars` — az LTF gyertyák száma az entry óta (frissített minden
    bar-on). A time-based exit és a HWM-tracking szempontjából is hasznos.
*/
export interface OpenPositionSnapshot {
  readonly side: Side;
  readonly entryTime: number;
  readonly entryPrice: number;
  readonly quantity: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly holdingBars: number;
}

/**
 `PositionManagementContext` — a `Strategy.onOpenPositionUpdate` callback
 bemenete. Minden LTF gyertyán hívódik, amikor van nyitott pozíció (a
 `onCandle` csak akkor hívódik, amikor nincs nyitott pozíció).

  - `openPosition` — az aktuális nyitott pozíció nézete.
  - `candle` — az aktuális LTF gyertya OHLCV adata.
  - `candleIndex` — az aktuális LTF gyertya indexe.
  - `mtfState` — a HTF + MTF + LTF indikátor-állapot (a trailing-ATR
    az `ltf.atr`-ből jön).
  - `pricePrecision` — a `roundTo` tizedesjegye az árakhoz.
*/
export interface PositionManagementContext {
  readonly openPosition: OpenPositionSnapshot;
  readonly candle: Candle;
  readonly candleIndex: number;
  readonly mtfState: MtfState;
  readonly pricePrecision: number;
}

/**
 `PositionUpdate` — a `Strategy.onOpenPositionUpdate` visszatérési értéke.
 A stratégia itt jelezheti, hogy a stop-loss / take-profit szintet frissíti,
 vagy hogy azonnali zárást kér (pl. trailing-stop trigger).

  - `newStopLoss` — opcionálisan új stop-loss szint (csak "monotonic tighten"
    ajánlott, de az engine nem tiltja a lazítást).
  - `newTakeProfit` — opcionálisan új take-profit szint (a pozíció profit
    lock-in céljából csökkenthető).
  - `forceExit` — ha `true`, a pozíció a `closePrice`-en (vagy a candle
    close-on, ha nincs megadva) azonnal záródik, kilépési oka: `trailing_stop`
    (alapértelmezetten — felülírható az `exitReason` mezővel, ha a motor
    támogatja).
  - `exitPrice` — opcionális, egyedi exit-ár a `forceExit` kéréshez
    (alapértelmezetten a candle close-a).
  - `reason` — opcionális kilépési ok (alapértelmezetten `"trailing_stop"`).
*/
export interface PositionUpdate {
  readonly newStopLoss?: number;
  readonly newTakeProfit?: number;
  readonly forceExit?: boolean;
  readonly exitPrice?: number;
  readonly reason?:
    "trailing_stop" | "trend_reversal" | "stop_loss" | "take_profit" | "time_exit" | "kill_switch";
}

/**
 `Strategy` — egy kereskedési stratégia absztrakciója. A backtest
 motor ezen az interfészen keresztül kommunikál a konkrét stratégiával.
*/
export interface Strategy {
  readonly name: string;
  readonly timeframes: readonly Timeframe[];
  /**
    Called for a new LTF candle when there is NO open position.
    `undefined` means there is no signal. The engine pre-populates `mtfState`
    with the latest HTF/MTF/LTF indicator values; the strategy does not
    calculate them itself.
  */
  onCandle(context: StrategyContext): StrategySignal | undefined;
  /**
    Side-effect-only closed-bar observer. Engines call this while a position
    is open so rolling state stays current without requesting a fresh entry.
    Stateful `onCandle` implementations should invoke it themselves while
    flat before evaluating an entry.
  */
  onCandleObserved?(context: StrategyContext): void;
  /**
    `warmup` — visszaadja, hogy hány LTF gyertyára van szükség a HTF
    indikátorok (EMA 200) bemelegedéséhez. A backtest az első
    `warmup` gyertyán még nem adhat ki jelet.
  */
  warmup(): number;
  /**
   * Optional per-bar position-management hook. It is called on every LTF
   * candle with an open position after `checkExit` declines to exit. The
   * trailing-stop engine uses it; strategies without trailing stops leave
   * their fixed SL/TP in the signal returned by `onCandle`.

   * Return `undefined` for no update or a `PositionUpdate` to modify the
   * stop-loss/take-profit levels or request an immediate close.
   *
   * The high-water mark and holding-bar counter are strategy-owned state
   * because the backtest engine's open-position view is readonly.
  */
  onOpenPositionUpdate?(context: PositionManagementContext): PositionUpdate | undefined;
  /**
   * Optional callback after a strategy-requested position entry. A strategy
   * can initialize trailing-stop state such as the high-water mark or holding
   * bar counter.
   */
  onPositionOpened?(snapshot: OpenPositionSnapshot): void;
  /**
   * Optional callback after a position closes for any reason, including SL,
   * TP, time exit, trailing stop, or kill switch. The trailing-stop engine
   * uses it to reset the high-water mark and holding-bar counter.
   */
  onPositionClosed?(reason: string): void;
}

// The MtfTrendConfluenceStrategy is not part of the active strategy surface.

// packages/backtest/src/engine.ts — a backtest motor
//
// A kiválasztott stratégia historikus OHLCV adatokon való futtatása.
// A motor felelőssége:
//   1. HTF/MTF/LTF candle-ek betöltése az ExchangeFeed-en keresztül
//   2. A multi-timeframe indikátor-számítás (computeIndicators)
//   3. A stratégia jeleinek fogadása
//   4. A position management (entry, stop-loss, take-profit, time-exit)
//   5. A költség-modell alkalmazása (fee, slippage, spread, margin)
//   6. Az equity-görbe és a trade-lista építése
//   7. A kill-switch figyelése
//
// Anti-look-ahead: minden döntés a candle zárásakor születik, nincs
// jövőbeli adat. A backtest motor az LTF candle-enként léptet, és a
// HTF/MTF indikátorokat az LTF candle timestamp-jéhez "ragasztja"
// (az utolsó lezárt HTF/MTF candle értékeit használja).

import { TIMEFRAME_MS, type Candle, type ExitReason, type Symbol, type Trade } from "@mm-crypto-bot/shared/types";
import { computeIndicators, createStrategy } from "@mm-crypto-bot/core";
import type { Strategy, StrategySignal } from "@mm-crypto-bot/core";

import {
  applySlippage,
  applySpread,
  entryCost,
  exitCost,
  fundingCost,
  marginBorrowCost,
} from "./cost-model.js";
import { computeMetrics } from "./metrics.js";
import { positionNotionalUsd } from "./position-size.js";
import { roundTo } from "@mm-crypto-bot/shared/utils";

import type {
  BacktestOptions,
  BacktestResult,
  CostModel,
  EquityPoint,
} from "./types.js";

/**
 `aggregateToTimeframe` — a candle-listát egy lassabb timeframe-re aggregálja.
 Ha az LTF candle-eket akarjuk HTF/MTF szinten látni, a HTF candle
 az LTF candle-ek összevonásából keletkezik (open = első LTF open,
 high = max(LTF high), low = min(LTF low), close = utolsó LTF close,
 volume = összeg).
*/
export function aggregateToTimeframe(
  ltfCandles: readonly Candle[],
  targetMs: number,
): readonly Candle[] {
  if (ltfCandles.length === 0 || targetMs <= 0) {
    return [];
  }
  const out: Candle[] = [];
  let bucket: Candle | null = null;
  // Az első candle timestamp-jéhez igazítjuk a bucket-határt, hogy a valós
  // (nem-grid-aligned) induló timestamp-eknél is helyes legyen az
  // aggregáció. A `bucketStart` a cél-timeframe grid-re van lefelé kerekítve.
  let bucketStart = ltfCandles[0]!.timestamp - (ltfCandles[0]!.timestamp % targetMs);
  for (const c of ltfCandles) {
    const bucketEnd = bucketStart + targetMs;
    if (c.timestamp >= bucketEnd) {
      // Új bucket indítása.
      if (bucket !== null) {
        out.push(bucket);
      }
      // A bucket-határt a candle timestamp-jéhez igazítjuk (grid-align).
      bucketStart = c.timestamp - (c.timestamp % targetMs);
      bucket = {
        timestamp: bucketStart,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      };
    } else {
      if (bucket === null) {
        bucketStart = c.timestamp - (c.timestamp % targetMs);
        bucket = {
          timestamp: bucketStart,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        };
      } else {
        bucket = {
          timestamp: bucket.timestamp,
          open: bucket.open,
          high: Math.max(bucket.high, c.high),
          low: Math.min(bucket.low, c.low),
          close: c.close,
          volume: bucket.volume + c.volume,
        };
      }
    }
  }
  // Az utolsó bucketöt mindig push-oljuk — a `bucket` csak akkor null,
  // ha a candles üres (amit a függvény elején ellenőriztünk).
  out.push(bucket!);
  return out;
}

/**
 `runBacktest` — a fő backtest futtató függvény.
*/
export async function runBacktest(opts: BacktestOptions): Promise<BacktestResult> {
  if (opts.startTime.getTime() >= opts.endTime.getTime()) {
    throw new Error("startTime must be before endTime");
  }
  if (opts.initialEquityUsd <= 0) {
    throw new Error("initialEquityUsd must be positive");
  }
  // 1) LTF candle-ek betöltése a feed-ből.
  const ltfCandles = await opts.feed.fetchOHLCV(opts.symbol, opts.ltfTimeframe, {
    since: opts.startTime.getTime(),
    limit: Number.MAX_SAFE_INTEGER,
  });
  // 2) HTF és MTF candle-ek aggregálása a LTF candle-ekből.
  const htfMs = TIMEFRAME_MS[opts.htfTimeframe];
  const mtfMs = TIMEFRAME_MS[opts.mtfTimeframe];
  const htfCandles = aggregateToTimeframe(ltfCandles, htfMs);
  const mtfCandles = aggregateToTimeframe(ltfCandles, mtfMs);
  if (htfCandles.length === 0 || mtfCandles.length === 0 || ltfCandles.length === 0) {
    throw new Error("No candles in the requested period");
  }
  // 3) Equity + trade-lista inicializálása.
  let equity = opts.initialEquityUsd;
  const equityCurve: EquityPoint[] = [];
  const trades: Trade[] = [];
  let killSwitchTriggered = false;
  // A nyitott pozíció nyilvántartása.
  let openPosition: OpenPosition | null = null;
  const strategy: Strategy = opts.strategy ?? createStrategy();
  // A trade-ek entry/exit timestampjei ms-ben.
  let peakEquity = equity;
  // Phase 7 Track A — az aktuális nyitott pozíció entry-bar-indexe (a
  // holdingBars számláláshoz a PositionManagementContext-ben).
  let entryBarIndex = -1;
  // 4) LTF candle-enkénti iteráció.
  for (let i = 0; i < ltfCandles.length; i++) {
    const ltfCandle = ltfCandles[i]!;
    // 4.1) A HTF/MTF "ablak" — az LTF candle timestamp-jéig lezárt HTF/MTF candle-ek.
    const htfSlice = htfCandles.filter((c) => c.timestamp <= ltfCandle.timestamp);
    const mtfSlice = mtfCandles.filter((c) => c.timestamp <= ltfCandle.timestamp);
    // 4.2) Indikátorok számítása + a stratégia jeleinek fogadása.
    const indicators = computeIndicators(htfSlice, mtfSlice, ltfCandles.slice(0, i + 1), {
      htfDonchianPeriod: 20,
      // Phase 5 — MTF Donchian az 5.C DonchianBreakoutStrategy számára.
      mtfDonchianPeriod: 20,
      htfSupertrendPeriod: 10,
      htfSupertrendMultiplier: 3,
      htfEmaFast: 50,
      htfEmaSlow: 200,
      htfAdxPeriod: 14,
      mtfBbPeriod: 20,
      mtfBbStddev: 2,
      mtfAdxPeriod: 14,
      mtfRsiPeriod: 14,
      ltfRsiPeriod: 14,
      ltfVolumeMaPeriod: 20,
      ltfAtrPeriod: 14,
    });
    // 4.3) Ha van nyitott pozíció, ellenőrizzük a kilépési feltételeket.
    if (openPosition !== null) {
      const exit = checkExit(openPosition, ltfCandle, opts.costModel);
      if (exit !== null) {
        const trade = closePosition(openPosition, ltfCandle, exit, opts.costModel);
        trades.push(trade);
        equity += trade.pnlUsd;
        openPosition = null;
        // Phase 7 Track A — notify the strategy of close for state cleanup
        // (HWM-reset, holdingBars-reset, stb.). Best-effort: a hook opcionális.
        if (typeof (strategy as { onPositionClosed?: unknown }).onPositionClosed === "function") {
          (strategy as { onPositionClosed: (reason: string) => void }).onPositionClosed(exit.reason);
        }
      } else if (typeof (strategy as { onOpenPositionUpdate?: unknown }).onOpenPositionUpdate === "function") {
        // Phase 7 Track A — per-bar position management hook (HWM-based trailing-stop).
        // A `checkExit` nem triggerelt kilépést, így van lehetőség a trailing-stop
        // logika futtatására. A hook visszatérési értéke (`PositionUpdate`)
        // alapján módosítjuk a nyitott pozíció SL/TP szintjét, vagy `forceExit`
        // esetén azonnal zárjuk azt.
        const holdingBars = i - entryBarIndex;
        const update = (strategy as {
          onOpenPositionUpdate: (ctx: {
            openPosition: { side: "buy" | "sell"; entryTime: number; entryPrice: number; quantity: number; stopLoss: number; takeProfit: number; holdingBars: number };
            candle: typeof ltfCandle;
            candleIndex: number;
            mtfState: typeof indicators;
            pricePrecision: number;
          }) => { newStopLoss?: number; newTakeProfit?: number; forceExit?: boolean; exitPrice?: number; reason?: "trailing_stop" | "trend_reversal" | "stop_loss" | "take_profit" | "time_exit" } | null;
        }).onOpenPositionUpdate({
          openPosition: {
            side: openPosition.side,
            entryTime: openPosition.entryTime,
            entryPrice: openPosition.entryPrice,
            quantity: openPosition.quantity,
            stopLoss: openPosition.stopLoss,
            takeProfit: openPosition.takeProfit,
            holdingBars,
          },
          candle: ltfCandle,
          candleIndex: i,
          mtfState: indicators,
          pricePrecision: 2,
        });
        if (update !== null) {
          const currentPos: OpenPosition = openPosition;
          if (update.newStopLoss !== undefined) {
            openPosition = { ...currentPos, stopLoss: update.newStopLoss };
          }
          if (update.newTakeProfit !== undefined) {
            openPosition = { ...currentPos, takeProfit: update.newTakeProfit };
          }
          if (update.forceExit === true) {
            const exitReason = (update.reason ?? "trailing_stop") as "stop_loss" | "take_profit" | "trailing_stop" | "trend_reversal" | "time_exit" | "kill_switch" | "end_of_data";
            const trade = closePosition(
              openPosition,
              ltfCandle,
              { reason: exitReason, exitPrice: update.exitPrice ?? ltfCandle.close },
              opts.costModel,
            );
            trades.push(trade);
            equity += trade.pnlUsd;
            if (typeof (strategy as { onPositionClosed?: unknown }).onPositionClosed === "function") {
              (strategy as { onPositionClosed: (reason: string) => void }).onPositionClosed(exitReason);
            }
            openPosition = null;
          }
        }
      }
    }
    // 4.4) Ha nincs nyitott pozíció és van jelzés, nyitunk.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- killSwitchTriggered a ciklusban módosul (246. sor)
    if (openPosition === null && !killSwitchTriggered) {
      // A warmup ellenőrzése a stratégia oldaláról.
      const signal: StrategySignal | null = strategy.onCandle({
        symbol: opts.symbol as never,
        timeframe: opts.ltfTimeframe,
        candleIndex: i,
        candle: ltfCandle,
        mtfState: indicators,
        pricePrecision: 2,
      });
      if (signal !== null) {
        // Phase 17 Track A: scale riskPerTrade by signal.confidence so the
        // strategy-side confidence actually affects position sizing. This
        // fixes the Phase 16 finding where `applyCap()` scaled emitted
        // confidence to 0.20 but the engine ignored `signal.confidence`
        // entirely — making the 4% notional cap a complete no-op
        // (REPORT-phase16.md §1).
        //
        // Defensive clamp: strategies MUST emit `confidence ∈ [0, 1]` per
        // the StrategySignal contract, but the engine clamps defensively to
        // prevent runaway sizing if a strategy ever emits out-of-range
        // values. The 1:10 leverage cap is applied separately and is
        // independent of this pre-leverage risk scalar.
        let clampedConfidence: number;
        if (signal.confidence < 0) {
          clampedConfidence = 0;
        } else if (signal.confidence > 1) {
          clampedConfidence = 1;
        } else {
          clampedConfidence = signal.confidence;
        }
        const confidenceScaledRisk = opts.positionSize.riskPerTrade * clampedConfidence;
        const notional = positionNotionalUsd(
          equity,
          ltfCandle.close,
          signal.stopLoss,
          { ...opts.positionSize, riskPerTrade: confidenceScaledRisk },
        );
        // A fill-ár a slippage+spread alkalmazásával.
        const entryPrice = applySlippage(
          applySpread(ltfCandle.close, signal.side, opts.costModel.spreadRate),
          signal.side,
          opts.costModel.slippageRate,
        );
        const quantity = notional / entryPrice;
        // A margin notional a notional / leverage. A backtest 1:1
        // margin-t feltételez (a teljes notional a saját tőkénk).
        const marginNotional = notional;
        const fee = entryCost(notional, opts.costModel);
        openPosition = {
          symbol: opts.symbol as never,
          side: signal.side,
          entryTime: ltfCandle.timestamp,
          entryPrice,
          quantity,
          notionalUsd: notional,
          marginNotional,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          entryFee: fee,
          entryReason: signal.reason,
        };
        // Phase 7 Track A — notify the strategy of the new position.
        // A trailing-stop engine itt reset-eli a HWM-jét és a holdingBars
        // counter-ét az entry-bar-index rögzítésével. Best-effort hook:
        // a Phase 5-6 stratégiák (DonchianBreakout, MtfTrendConfluence,
        // stb.) ezt NEM implementálják.
        entryBarIndex = i;
        if (typeof (strategy as { onPositionOpened?: unknown }).onPositionOpened === "function") {
          (strategy as { onPositionOpened: (snapshot: { side: "buy" | "sell"; entryTime: number; entryPrice: number; quantity: number; stopLoss: number; takeProfit: number; holdingBars: number }) => void }).onPositionOpened({
            side: openPosition.side,
            entryTime: openPosition.entryTime,
            entryPrice: openPosition.entryPrice,
            quantity: openPosition.quantity,
            stopLoss: openPosition.stopLoss,
            takeProfit: openPosition.takeProfit,
            holdingBars: 0,
          });
        }
      }
    }
    // 4.5) Equity-görbe frissítése a candle végén.
    // Ha van nyitott pozíció, az unrealized PnL a candle close-ra.
    let unrealizedPnl = 0;
    if (openPosition !== null) {
      const exitPrice = applySlippage(
        applySpread(ltfCandle.close, openPosition.side === "buy" ? "sell" : "buy", opts.costModel.spreadRate),
        openPosition.side === "buy" ? "sell" : "buy",
        opts.costModel.slippageRate,
      );
      if (openPosition.side === "buy") {
        unrealizedPnl = (exitPrice - openPosition.entryPrice) * openPosition.quantity;
      } else {
        unrealizedPnl = (openPosition.entryPrice - exitPrice) * openPosition.quantity;
      }
      // A margin-kamat és funding is beleszamítódik.
      const holdingHours = (ltfCandle.timestamp - openPosition.entryTime) / (60 * 60 * 1000);
      unrealizedPnl -= marginBorrowCost(openPosition.marginNotional, holdingHours, opts.costModel);
      unrealizedPnl -= fundingCost(openPosition.notionalUsd, holdingHours, opts.costModel);
    }
    const currentEquity = equity + unrealizedPnl;
    equityCurve.push({ timestamp: ltfCandle.timestamp, equity: currentEquity });
    if (currentEquity > peakEquity) {
      peakEquity = currentEquity;
    }
    // 4.6) Kill-switch: ha a drawdown eléri a maxDrawdown-t, leállunk.
    // A peakEquity mindig pozitív (az initial equity pozitív), így a
    // guard-ág nem szükséges. A kill-switch mindig nyitott pozícióval
    // triggerelődik (mert nélküle nincs unrealized PnL, ami a drawdown-t
    // okozná), így a position-close ág mindig lefut.
    const dd = (peakEquity - currentEquity) / peakEquity;
    if (dd >= opts.positionSize.maxDrawdown) {
      killSwitchTriggered = true;
      // Zárjuk a nyitott pozíciót a kill-switch exit reason-nel.
      const trade = closePosition(
        openPosition!,
        ltfCandle,
        { reason: "kill_switch", exitPrice: ltfCandle.close },
        opts.costModel,
      );
      trades.push(trade);
      // Phase 7 Track A — notify strategy of kill-switch close
      if (typeof (strategy as { onPositionClosed?: unknown }).onPositionClosed === "function") {
        (strategy as { onPositionClosed: (reason: string) => void }).onPositionClosed("kill_switch");
      }
      // A kill-switch close PnL-je a `trades` tömbben és a metrics.totalReturnPct-ben
      // jelenik meg; az `equity` lokális változót a függvény nem olvassa a
      // return előtt, ezért itt szándékosan nem frissítjük.
      openPosition = null;
      break;
    }
  }
  // 5) A hátralévő nyitott pozíció zárása a backtest végén.
  if (openPosition !== null) {
    const lastCandle = ltfCandles[ltfCandles.length - 1]!;
    const trade = closePosition(
      openPosition,
      lastCandle,
      { reason: "end_of_data", exitPrice: lastCandle.close },
      opts.costModel,
    );
    trades.push(trade);
    // Phase 7 Track A — notify strategy of end-of-data close
    if (typeof (strategy as { onPositionClosed?: unknown }).onPositionClosed === "function") {
      (strategy as { onPositionClosed: (reason: string) => void }).onPositionClosed("end_of_data");
    }
    // A végső `equity` frissítés és az `openPosition = null` itt szándékosan
    // kimaradnak — a függvény a return előtt már nem olvassa ezeket, és a
    // `equityCurve` az utolsó LTF candle-en már rögzítette az aktuális
    // állapotot. Az end-of-data trade PnL-je a `trades` tömbben és a
    // `metrics.totalReturnPct`-ben jelenik meg (computeMetrics a trades-ből
    // számolja a teljes hozamot).
  }
  // 6) Metrikák számítása + a BacktestResult összeállítása.
  const periodsPerYear = (365 * 24 * 60 * 60 * 1000) / TIMEFRAME_MS[opts.ltfTimeframe];
  const metrics = computeMetrics(
    trades,
    equityCurve,
    opts.startTime.getTime(),
    opts.endTime.getTime(),
    periodsPerYear,
  );
  return {
    totalReturn: metrics.totalReturnPct,
    annualizedReturn: metrics.annualizedReturnPct,
    sharpeRatio: metrics.sharpeRatio,
    sortinoRatio: metrics.sortinoRatio,
    maxDrawdown: metrics.maxDrawdownPct,
    profitFactor: metrics.profitFactor,
    winRate: metrics.winRatePct,
    totalTrades: metrics.totalTrades,
    trades,
    equityCurve,
    killSwitchTriggered,
    startTime: opts.startTime.getTime(),
    endTime: opts.endTime.getTime(),
  };
}

/**
 `OpenPosition` — a backtest motor belső típusa a nyitott pozícióhoz.
*/
export interface OpenPosition {
  readonly symbol: Symbol;
  readonly side: "buy" | "sell";
  readonly entryTime: number;
  readonly entryPrice: number;
  readonly quantity: number;
  readonly notionalUsd: number;
  readonly marginNotional: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly entryFee: number;
  readonly entryReason: string;
}

/**
 `checkExit` — a kilépési feltételek ellenőrzése egy LTF candle-re.
 Visszaadja a kilépés okát és árát, vagy null-t ha nincs kilépés.
*/
export function checkExit(
  pos: OpenPosition,
  candle: Candle,
  _model: CostModel,
): { readonly reason: ExitReason; readonly exitPrice: number } | null {
  // A kilépési ár a candle low (long) vagy high (short) — a backtest
  // a candle-en belüli legjobb fill-árral számol (konzervatív).
  if (pos.side === "buy") {
    if (candle.low <= pos.stopLoss) {
      return { reason: "stop_loss", exitPrice: pos.stopLoss };
    }
    if (candle.high >= pos.takeProfit) {
      return { reason: "take_profit", exitPrice: pos.takeProfit };
    }
  } else {
    if (candle.high >= pos.stopLoss) {
      return { reason: "stop_loss", exitPrice: pos.stopLoss };
    }
    if (candle.low <= pos.takeProfit) {
      return { reason: "take_profit", exitPrice: pos.takeProfit };
    }
  }
  // Time-exit: ha a pozíció 72 óránál régebbi és még nyereséges, kilépünk.
  const holdingHours = (candle.timestamp - pos.entryTime) / (60 * 60 * 1000);
  if (holdingHours >= 72) {
    // Csak akkor lépünk ki, ha a pozíció nyereséges (legalább 1:1 R:R).
    // Egyébként várunk a stop-ra.
    const profit = pos.side === "buy"
      ? (candle.close - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - candle.close) * pos.quantity;
    if (profit > 0) {
      return { reason: "time_exit", exitPrice: candle.close };
    }
  }
  return null;
}

/**
 `closePosition` — a pozíció lezárása és a Trade objektum visszaadása.
 A PnL, a fee és a margin-kamat kiszámítódik.
*/
export function closePosition(
  pos: OpenPosition,
  candle: Candle,
  exit: { readonly reason: ExitReason; readonly exitPrice: number },
  model: CostModel,
): Trade {
  const exitSide = pos.side === "buy" ? "sell" : "buy";
  // A exit-áron alkalmazzuk a slippage-et és spread-et.
  const filledExitPrice = applySlippage(
    applySpread(exit.exitPrice, exitSide, model.spreadRate),
    exitSide,
    model.slippageRate,
  );
  // Brutto PnL.
  const grossPnl = pos.side === "buy"
    ? (filledExitPrice - pos.entryPrice) * pos.quantity
    : (pos.entryPrice - filledExitPrice) * pos.quantity;
  // Margin-kamat és funding a holding időre.
  const holdingHours = (candle.timestamp - pos.entryTime) / (60 * 60 * 1000);
  const borrowCost = marginBorrowCost(pos.marginNotional, holdingHours, model);
  const fundCost = fundingCost(pos.notionalUsd, holdingHours, model);
  // A fee a notional-on, ketszer (entry + exit).
  const fee = entryCost(pos.notionalUsd, model) + exitCost(pos.notionalUsd, model);
  const totalFees = fee + borrowCost + fundCost;
  // A netto PnL a brutto PnL minus a teljes koltseg.
  const netPnl = grossPnl - totalFees;
  // A PnL% a notional %-ában. A notional mindig pozitív (a pozíció
  // sizing biztosítja), így a guard-ág nem szükséges.
  const pnlPct = netPnl / pos.notionalUsd;
  // A quantity kerekitett elmentese a Trade objektumba.
  return {
    symbol: pos.symbol,
    side: pos.side,
    entryTime: pos.entryTime,
    entryPrice: roundTo(pos.entryPrice, 8),
    exitTime: candle.timestamp,
    exitPrice: roundTo(filledExitPrice, 8),
    quantity: pos.quantity,
    notionalUsd: pos.notionalUsd,
    pnlUsd: netPnl,
    pnlPct,
    feesUsd: totalFees,
    exitReason: exit.reason,
  };
}

// packages/core/src/strategy/donchian-trailing.ts — Donchian breakout with trailing-stop
//
// Phase 7 Track A — a Phase 5 Donchian 1d edge PnL-jének 30-80%-os amplifikációja
// trailing-stoppal. A trailing-stop a high-water-mark (HWM) nyomon követésén
// alapul, és három fajta konfigurálható kilépési logikát támogat:
//
//   1. Fix százalékos trailing: close < HWM × (1 - trailPct)
//   2. ATR-alapú trailing: close < HWM - trailAtrMultiplier × ATR(14)
//   3. Time-based exit: maxHoldBars elteltével (opcionális)
//
// Az entry logikát a Phase 5 `DonchianBreakoutStrategy` adja (delegálva), az
// ATR-based stop-loss és take-profit megmarad a Phase 5 specifikáció
// szerint (stopAtrMultiplier=1.5, tpAtrMultiplier=4.5 a 3:1 R:R arány).
//
// A trailing-stop a Strategy interface-en keresztül:
//   - `onCandle` — Phase 5 Donchian entry signal (delegálva)
//   - `onPositionOpened` — HWM reset az entryBar-on
//   - `onOpenPositionUpdate` — HWM update + trail-trigger check minden bar-on
//   - `onPositionClosed` — HWM és holding state cleanup
//
// References (≥2 independent / claim):
//   - QuantPedia: ATR(10) trailing stop on US stocks trend system —
//     19.3% CAGR (24,000 securities, 22 years). A trailing-stop
//     az U.S. equities-en bizonyítottan működik, de a crypto-on
//     magasabb ATR miatt agresszívebb multiplier kell.
//     https://quantpedia.com/strategies/trend-following-effect-in-stocks
//   - Stratbase: BTC 2019-2025 D1 trailing-stop backtest —
//     ATR 2.5× adta a legjobb Sharpe-ot, 15-20%-kal jobb mint a
//     fix%-os. Fixed-% 10% vs ATR 2.5×: 285% vs 320% return, -22%
//     vs -25% DD, 45% vs 42% WR, +8.2% vs +10.5% avg trade.
//     https://stratbase.ai/en/blog/trailing-stop-strategies-compared
//   - FMZ Strategy 445840: Donchian Channel breakout + ATRSL trailing
//     stop — Pine Script implementáció, 1 éves BTC backtest. A
//     trailing-stop kombináció a Phase 5 Donchian edge-re is alkalmazható.
//     https://www.fmz.com/lang/en/strategy/445840
//   - VolatilityBox (2025): 595+ symbol 2018-2025 — volatility-adjusted
//     stops 34%-kal csökkentik a premature stop-out-okat fixed-dollar
//     stop-okhoz képest, azonos downside protection mellett.
//     https://volatilitybox.com/research/volatility-adjusted-stop-losses/
//   - Clare, Seaton, Sotiropoulos, Wood (2016) "Breaking into the
//     blackbox: Trend following, stop losses and the frequency of trading
//     — S&P500" — trailing stops effective at stopping losses in declining
//     markets; popular stop-loss rules do NOT add value to simple MA
//     trend-following on monthly data (sample-specific caveat).
//     https://openaccess.city.ac.uk/id/eprint/17842/8/BLACKBOX%20%20%20SSRN-id2126476.pdf
//   - QuantPedia: MTF D1-H1 BTC trailing-stop implementation —
//     "close on first negative bar" exit on H1 candle data, az
//     intraday time-series-momentum stop-minimalista alkalmazása.
//     https://quantpedia.com/how-to-design-a-simple-multi-timeframe-trend-strategy-on-bitcoin/
//   - arXiv 2412.14361 (2024) "Walk-Forward Analysis" — 5y IS / 1y OOS /
//     1y step rolling validation against overfitting. A Phase 7 trailing-stop
//     variánsokra alkalmazva, 180d IS / 30d OOS / 30d step skálán.
//     https://arxiv.org/pdf/2412.14361
//
// Specifikáció: docs/research/phase7-strategy-brief.md §1.2 M1.1.
//
// ----------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------

import { roundTo } from "@mm-crypto-bot/shared/utils";

import { DonchianBreakoutStrategy, DEFAULT_DONCHIAN_CONFIG, type DonchianBreakoutConfig } from "./donchian-breakout.js";
import type {
  OpenPositionSnapshot,
  PositionManagementContext,
  PositionUpdate,
  StrategyContext,
  StrategySignal,
} from "../types.js";

/**
 * A trailing-stop variáns típusa.
 *
 *   - `pct5` — 5% fix trailing distance (szűk, gyors reakció, sok trade)
 *   - `pct10` — 10% fix trailing distance (alapértelmezett swing-trade szint)
 *   - `pct15` — 15% fix trailing distance (széles, lassú reakció, ritka trade)
 *   - `atr2x` — ATR(14) × 2.0 (volatility-adaptive, Stratbase ajánlás)
 */
export type TrailVariant = "pct5" | "pct10" | "pct15" | "atr2x";

/**
 * `DonchianTrailingConfig` — a trailing-stop engine konfiguráció.
 *
 * A `trailVariant` factory-ként szolgál: a 4 előre definiált variáns a
 * trailPct vagy a trailAtrMultiplier mezőt tölti fel. Alternatívaként a
 * trailPct és trailAtrMultiplier manuálisan is megadható (a variant
 * figyelmen kívül hagyása mellett, ha a `useExplicitTrail = true`).
 */
export interface DonchianTrailingConfig extends DonchianBreakoutConfig {
  /** Előre definiált variáns (factory a trailPct / trailAtrMultiplier-re). */
  readonly trailVariant: TrailVariant;
  /** Explicit fix%-os trailing distance. Csak ha useExplicitTrail = true. */
  readonly trailPct: number;
  /** Explicit ATR-multiplier. Csak ha useExplicitTrail = true. */
  readonly trailAtrMultiplier: number;
  /** Ha true, a trailPct / trailAtrMultiplier explicit értéket használja a variant helyett. */
  readonly useExplicitTrail: boolean;
  /** Maximum holding idő (LTF bar). Ha eltelik, time_exit. 0 = kikapcsolva. */
  readonly maxHoldBars: number;
}

/**
 * A 4 trailing-stop variáns numerikus specifikációja. A `pct5`/`pct10`/`pct15`
 * fix%-os (close < HWM × (1 - pct)), az `atr2x` volatilitás-adaptive
 * (close < HWM - 2.0 × ATR(14)).
 *
 * A számok a Phase 7 brief §1.2 M1.1 specifikációjából jönnek (4 variáns:
 * 5%, 10%, 15%, ATR-2×).
 */
export const TRAIL_VARIANT_DEFAULTS: Record<TrailVariant, { trailPct: number; trailAtrMultiplier: number; description: string }> = {
  pct5: { trailPct: 0.05, trailAtrMultiplier: 0, description: "5% fixed trailing distance (tight, fast reaction)" },
  pct10: { trailPct: 0.10, trailAtrMultiplier: 0, description: "10% fixed trailing distance (swing-trade default)" },
  pct15: { trailPct: 0.15, trailAtrMultiplier: 0, description: "15% fixed trailing distance (loose, slow reaction)" },
  atr2x: { trailPct: 0, trailAtrMultiplier: 2.0, description: "ATR(14) × 2.0 trailing distance (volatility-adaptive)" },
};

/**
 * `DEFAULT_DONCHIAN_TRAILING_CONFIG` — alapértelmezett konfiguráció.
 * A `trailVariant = pct10` felel meg a Phase 7 brief ajánlásának és
 * a Stratbase 2019-2025 BTC 10% fixed-% kategóriájának.
 */
export const DEFAULT_DONCHIAN_TRAILING_CONFIG: DonchianTrailingConfig = {
  ...DEFAULT_DONCHIAN_CONFIG,
  trailVariant: "pct10",
  trailPct: TRAIL_VARIANT_DEFAULTS.pct10.trailPct,
  trailAtrMultiplier: TRAIL_VARIANT_DEFAULTS.pct10.trailAtrMultiplier,
  useExplicitTrail: false,
  maxHoldBars: 0,
};

/**
 * `resolveTrailConfig` — a 4 trail variáns + explicit override kombinációjának
 * feloldása. A factory visszaadja a ténylegesen használt trailPct és
 * trailAtrMultiplier értékeket (a Strategy belső state-jében tároljuk).
 */
export interface ResolvedTrailConfig {
  readonly trailPct: number;
  readonly trailAtrMultiplier: number;
  readonly isAtr: boolean;
  readonly description: string;
}

export function resolveTrailConfig(config: DonchianTrailingConfig): ResolvedTrailConfig {
  if (config.useExplicitTrail) {
    return {
      trailPct: config.trailPct,
      trailAtrMultiplier: config.trailAtrMultiplier,
      isAtr: config.trailAtrMultiplier > 0,
      description: `explicit ${config.trailPct > 0 ? `${(config.trailPct * 100).toFixed(1)}%` : ""}${config.trailAtrMultiplier > 0 ? `${config.trailAtrMultiplier > 0 && config.trailPct > 0 ? " + " : ""}${config.trailAtrMultiplier.toFixed(1)}×ATR` : ""}`,
    };
  }
  const def = TRAIL_VARIANT_DEFAULTS[config.trailVariant];
  return {
    trailPct: def.trailPct,
    trailAtrMultiplier: def.trailAtrMultiplier,
    isAtr: def.trailAtrMultiplier > 0,
    description: `${config.trailVariant}: ${def.description}`,
  };
}

/**
 * `DonchianTrailingStrategy` — a Phase 5 Donchian breakout stratégia
 * trailing-stop-pal kiterjesztett változata. A Strategy interface összes
 * újonnan bevezetett optional hook-ját implementálja:
 *
 *   - `onCandle`: delegate to Phase 5 DonchianBreakoutStrategy.onCandle.
 *   - `onPositionOpened`: HWM reset = entry price, holdingBars = 0.
 *   - `onOpenPositionUpdate`: HWM update → check trail trigger → return
 *     PositionUpdate (newStopLoss update + forceExit if trail triggered).
 *   - `onPositionClosed`: HWM reset → 0, holdingBars reset → 0.
 *
 * A bejövő Phase 5 signal.stopLoss / takeProfit változatlanul él — a
 * trailing-stop a Phase 5 ATR-based SL/TP FÖLÉ rakódik (override-ok
 * csak monoton tightening értelemben). Ha a trailing-trigger a Phase 5
 * SL fölé szigorít, a Phase 5 SL inaktívvá válik (az engine a strict
 * openPosition.stopLoss-t használja).
 *
 * A belső HWM state-et egy private field tartja (entry-kor resetelve,
 * minden bar-on max(HWM, candle.high/low)-al frissítve). A strategy
 * thread-safe nem kell (a backtest single-threaded), de a multi-call
 * védelem kedvéért minden hook-ban frissítjük.
 */
export class DonchianTrailingStrategy {
  readonly name: string;
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly config: DonchianTrailingConfig;

  /** A Phase 5 base strategy — delegate az entry signal-okhoz. */
  private readonly baseStrategy: DonchianBreakoutStrategy;

  /** A trailing-stop engine belső state — entry-kor null, minden máskor aktív. */
  private positionHwm: number | null = null;
  private positionEntryPrice: number | null = null;
  private resolvedTrail: ResolvedTrailConfig;

  constructor(config: Partial<DonchianTrailingConfig> = {}) {
    this.config = { ...DEFAULT_DONCHIAN_TRAILING_CONFIG, ...config };
    // A base strategy a Phase 5 Donchian config-ot kapja (volume / HTF / stb.),
    // mert a trailing-stop-pal csak a per-bar position management foglalkozik.
    const baseDonchianConfig: DonchianBreakoutConfig = {
      donchianPeriod: this.config.donchianPeriod,
      volumeConfirmMultiplier: this.config.volumeConfirmMultiplier,
      stopAtrMultiplier: this.config.stopAtrMultiplier,
      tpAtrMultiplier: this.config.tpAtrMultiplier,
      useHtfTrendFilter: this.config.useHtfTrendFilter,
    };
    this.baseStrategy = new DonchianBreakoutStrategy(baseDonchianConfig);
    this.resolvedTrail = resolveTrailConfig(this.config);
    this.name = `Donchian Trailing (${this.resolvedTrail.description})`;
  }

  warmup(): number {
    return this.baseStrategy.warmup();
  }

  /**
   * Entry signal — delegate a Phase 5 Donchian strategy-hoz.
   * Az entry signal.stopLoss / takeProfit a Phase 5 specifikáció szerint
   * marad (1.5× ATR stop, 4.5× ATR TP), a trailing-stop csak ezután aktív.
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    return this.baseStrategy.onCandle(ctx);
  }

  /**
   * Hook: új pozíció nyílt. A HWM és a holding state reset-elődik.
   * A trailing-stop engine mostantól minden bar-on figyeli a pozíciót.
   */
  onPositionOpened(snapshot: OpenPositionSnapshot): void {
    this.positionHwm = snapshot.entryPrice;
    this.positionEntryPrice = snapshot.entryPrice;
  }

  /**
   * Hook: pozíció zárult. A trailing-stop state cleanup.
   */
  onPositionClosed(_reason: string): void {
    this.positionHwm = null;
    this.positionEntryPrice = null;
  }

  /**
   * Per-bar position management — a TRAILING-STOP LOGIKA.
   *
   * 1) HWM frissítés: long esetén max(HWM, candle.high), short esetén
   *    min(HWM, candle.low). Ezzel a HWM mindig a trade irányában
   *    "kedvező" szélsőértéket tartalmazza.
   *
   * 2) Trailing-stop trigger check:
   *    - LONG: close < HWM × (1 - trailPct) [fix%] VAGY
   *            close < HWM - trailAtrMult × ATR [ATR]
   *    - SHORT: close > HWM × (1 + trailPct) [fix%] VAGY
   *             close > HWM + trailAtrMult × ATR [ATR]
   *
   *    Ha trigger → `forceExit = true`. A kilépési ok default
   *    `trailing_stop` (a Phase 6 multi-class-ensemble-ben is használt
   *    ExitReason típusból).
   *
   * 3) TIGHTEN-ONLY SL update: a SL-t a Phase 5 ATR-stop fölé állítjuk,
   *    ha a trailing-szint agresszívebb (long: HWM × (1 - pct) > SL;
   *    short: HWM × (1 + pct) < SL). Ezzel a Phase 5 SL csak akkor
   *    él, ha a trailing-szint lazább.
   *
   * 4) Time-based exit: ha a `maxHoldBars > 0` és a holdingBars elérte a
   *    limitet, `forceExit = true` (reason = "time_exit").
   *
   * A visszatérési `PositionUpdate` opcionálisan tartalmazza az új
   * SL/TP szintet és/vagy a forceExit flag-et.
   */
  onOpenPositionUpdate(ctx: PositionManagementContext): PositionUpdate | null {
    const { openPosition, candle, mtfState } = ctx;

    // Ha nincs HWM (a strategy nem kapott `onPositionOpened` hívást,
    // vagy a state elromlott), akkor a Phase 5 SL/TP-t hagyjuk futni.
    if (this.positionHwm === null || this.positionEntryPrice === null) {
      return null;
    }

    const atr = mtfState.ltf.atr;
    if (atr === undefined || atr <= 0) {
      // Nincs elég LTF history az ATR(14)-hez — a trailing-stop nem fut.
      return null;
    }

    const isLong = openPosition.side === "buy";
    const close = candle.close;
    const high = candle.high;
    const low = candle.low;

    // 1) HWM frissítés — a trade irányában kedvező szélsőérték.
    if (isLong) {
      this.positionHwm = Math.max(this.positionHwm, high);
    } else {
      this.positionHwm = Math.min(this.positionHwm, low);
    }
    const hwm = this.positionHwm;

    // 2) Trailing-stop trigger check.
    let trailTriggered = false;
    if (this.resolvedTrail.isAtr) {
      // ATR-alapú: close < HWM - mult × ATR [long] / close > HWM + mult × ATR [short]
      if (isLong) {
        if (close < hwm - this.resolvedTrail.trailAtrMultiplier * atr) trailTriggered = true;
      } else {
        if (close > hwm + this.resolvedTrail.trailAtrMultiplier * atr) trailTriggered = true;
      }
    } else {
      // Fix%-os: close < HWM × (1 - pct) [long] / close > HWM × (1 + pct) [short]
      if (isLong) {
        if (close < hwm * (1 - this.resolvedTrail.trailPct)) trailTriggered = true;
      } else {
        if (close > hwm * (1 + this.resolvedTrail.trailPct)) trailTriggered = true;
      }
    }

    // 3) Tightened SL update — csak ha a trailing-szint a Phase 5 SL-nél
    //    szigorúbb (long: trailing > SL, short: trailing < SL).
    let newStopLoss: number | undefined;
    if (this.resolvedTrail.isAtr) {
      if (isLong) {
        newStopLoss = roundTo(hwm - this.resolvedTrail.trailAtrMultiplier * atr, ctx.pricePrecision);
        if (newStopLoss <= openPosition.stopLoss) newStopLoss = undefined;
      } else {
        newStopLoss = roundTo(hwm + this.resolvedTrail.trailAtrMultiplier * atr, ctx.pricePrecision);
        if (newStopLoss >= openPosition.stopLoss) newStopLoss = undefined;
      }
    } else {
      if (isLong) {
        newStopLoss = roundTo(hwm * (1 - this.resolvedTrail.trailPct), ctx.pricePrecision);
        if (newStopLoss <= openPosition.stopLoss) newStopLoss = undefined;
      } else {
        newStopLoss = roundTo(hwm * (1 + this.resolvedTrail.trailPct), ctx.pricePrecision);
        if (newStopLoss >= openPosition.stopLoss) newStopLoss = undefined;
      }
    }

    // 4) Time-based exit check.
    const holdingBars = openPosition.holdingBars;
    const timeExitTriggered = this.config.maxHoldBars > 0 && holdingBars >= this.config.maxHoldBars;

    if (trailTriggered) {
      return newStopLoss !== undefined
        ? { newStopLoss, forceExit: true, reason: "trailing_stop" as const }
        : { forceExit: true, reason: "trailing_stop" as const };
    }
    if (timeExitTriggered) {
      return newStopLoss !== undefined
        ? { newStopLoss, forceExit: true, reason: "time_exit" as const }
        : { forceExit: true, reason: "time_exit" as const };
    }
    if (newStopLoss !== undefined) {
      return { newStopLoss };
    }
    return null;
  }
}

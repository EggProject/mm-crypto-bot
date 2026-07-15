/**
 * apps/bot/src/portfolio/portfolio-stop.ts
 *
 * Phase 37 Track 4 — `PortfolioStop` — a SAFETY-CRITICAL portfolió
 * szintű circuit breaker.
 *
 * ===========================================================================
 * CÉL
 * ===========================================================================
 * A Phase 6 multi-class ensemble strategy-k esetén a portfólió
 * aggregált drawdown-ja meghaladhatja bármelyik egyedi stratégia
 * `max_drawdown_pct` küszöbét — különösen, ha a stratégiák korrelálnak
 * (pl. carry + carry). Az egyedi kill-switch-ek a `risk.max_drawdown_pct`
 * alapján tüzelnek, de az a `RiskManager` (Phase 37 Track 1) szintjén
 * a `PositionManager.getEquity()`-hez van kötve, nem a portfolió
 * teljes equity-jéhez.
 *
 * A `PortfolioStop` egy magasabb szintű, SAFETY-CRITICAL védelmi
 * vonal:
 *
 *   1) A `recordEquity(equityUsd)` minden tick-en frissíti a
 *      current equity-t és a high-water mark-ot.
 *   2) Az `evaluate()` kiszámítja a drawdown %-ot.
 *   3) Ha a drawdown >= `max_dd_pct`, a stop TRIPS:
 *        a) Tüzel a `trip` callback (a `PortfolioManager` ezen
 *           keresztül ZÁRJA AZ ÖSSZES NYITOTT POZÍCIÓT piaci
 *           order-ekkel — NEM limit).
 *        b) A `StrategyRunner` a `isTripped()` jelzésre leállítja
 *           a signal-loop-ot (új order-ek NEM kerülnek placement-re).
 *        c) A `Bot.run()` kilép, és a usernek manuálisan kell
 *           `mm-bot start`-ot kiadnia az újraindításhoz.
 *
 * ===========================================================================
 * PER-STRATEGY CONTRIBUTION
 * ===========================================================================
 * A `recordEquity(equityUsd, perStrategyContrib)` második argumentuma
 * a per-stratégia hozzájárulás a DD-hez. A CRITICAL log-ban ez
 * megjelenik, hogy a user/debug lássa, melyik stratégia dominálja
 * a veszteséget. A struktúra:
 *
 *   Map<strategyId, unrealizedPnlUsd>  (negatív = veszteség)
 *
 * ===========================================================================
 * LATCHING
 * ===========================================================================
 * A stop LATCHED — ha egyszer tüzel, onnan kezdve a `isTripped()`
 * mindig `true`-t ad vissza, amíg a `reset()` hívást nem kapja.
 * A `reset()` a user által kiadott `mm-bot reset-portfolio-stop`
 * parancshoz van kötve, ÉS a `Bot.start()`-hoz (újraindításkor a
 * latch törlődik).
 *
 * ===========================================================================
 * HARD CAP
 * ===========================================================================
 * A `max_dd_pct` MAX 0.30 (30%). Ennél nagyobb érték nem értelmes —
 * ha a felhasználó 30%+ drawdown-t tolerál, az már nem "stop", hanem
 * "give up" kategória. A user a Phase 6-ban explicit kimondta, hogy
 * a circuit breaker 10%-os DD-n tüzeljen (a Phase 31 audit envelope
 * 7.70% max DD, tehát a 10% buffer bőven elég).
 */

import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";

// ============================================================================
// Public types
// ============================================================================

/**
 * `PortfolioStopOptions` — a stop konfigurációja.
 *
 * - `maxDdPct`        — a drawdown küszöb (0..0.30). Default: 0.10.
 * - `logger`          — opcionális structured logger.
 * - `tripAction`      — opcionális callback, ami a trip pillanatában
 *                        hívódik. A `PortfolioManager` ezen keresztül
 *                        ZÁRJA AZ ÖSSZES NYITOTT POZÍCIÓT. A callback
 *                        async lehet (az order placement async).
 */
export interface PortfolioStopOptions {
  readonly maxDdPct?: number;
  readonly logger?: Logger;
  readonly tripAction?: () => void | Promise<void>;
}

/**
 * `Hard caps` — a `PortfolioStop` biztonsági határértékei.
 */
export const PORTFOLIO_STOP_HARD_CAPS = {
  /** A `max_dd_pct` minimuma — 1% alatt a stop túl érzékeny. */
  maxDdPctMin: 0.01,
  /** A `max_dd_pct` maximuma — 30% felett már nem "stop" kategória. */
  maxDdPctMax: 0.30,
  /** A `max_dd_pct` default értéke — a Phase 31 audit alapján. */
  maxDdPctDefault: 0.10,
} as const;

/**
 * `PortfolioStopState` — a stop pillanatképe.
 */
export interface PortfolioStopState {
  readonly currentEquityUsd: number;
  readonly peakEquityUsd: number;
  readonly drawdownPct: number;
  readonly maxDdPct: number;
  readonly tripped: boolean;
  readonly trippedAt: number | null;
  readonly perStrategyContrib: ReadonlyMap<string, number>;
}

/**
 * `PortfolioStopError` — a stop saját hibája (szerializálható).
 */
export class PortfolioStopError extends Error {
  public override readonly name = "PortfolioStopError";
  public override readonly cause: unknown;

  public constructor(message: string, cause: unknown = null) {
    super(message);
    this.cause = cause;
    Object.setPrototypeOf(this, PortfolioStopError.prototype);
  }
}

// ============================================================================
// PortfolioStop class
// ============================================================================

/**
 * `PortfolioStop` — a portfolió-szintű circuit breaker.
 *
 * LATCHED viselkedés: a `tripped` flag egyszer `true`-ra vált, és
 * onnan kezdve `isTripped()` mindig `true`-t ad. A `reset()` hívás
 * törli a flag-et (manuális újraindítás).
 */
export class PortfolioStop {
  private readonly maxDdPct: number;
  private readonly logger: Logger;
  private tripAction: (() => void | Promise<void>) | undefined;

  private currentEquityUsd = 0;
  private peakEquityUsd = 0;
  private tripped = false;
  private trippedAt: number | null = null;
  private perStrategyContrib: Map<string, number> = new Map<string, number>();
  private hasReceivedEquity = false;

  public constructor(opts: PortfolioStopOptions = {}) {
    const maxDdPct = opts.maxDdPct ?? PORTFOLIO_STOP_HARD_CAPS.maxDdPctDefault;
    if (
      !Number.isFinite(maxDdPct) ||
      maxDdPct < PORTFOLIO_STOP_HARD_CAPS.maxDdPctMin ||
      maxDdPct > PORTFOLIO_STOP_HARD_CAPS.maxDdPctMax
    ) {
      throw new PortfolioStopError(
        `[portfolio-stop] maxDdPct must be in [${String(PORTFOLIO_STOP_HARD_CAPS.maxDdPctMin)}..${String(PORTFOLIO_STOP_HARD_CAPS.maxDdPctMax)}], got ${String(maxDdPct)}`,
      );
    }
    this.maxDdPct = maxDdPct;
    this.logger = opts.logger ?? createLogger("info");
    this.tripAction = opts.tripAction;
  }

  /**
   * `setTripAction` — a trip callback utólagos beállítása / cseréje.
   * A `PortfolioManager` hívja a konstrukció után, amikor a
   * `PositionManager` és `OrderManager` referenciák elérhetők.
   * A `null` érték törli a callback-et (a stop így is tüzel, de
   * a side-effect nélkül).
   */
  public setTripAction(action: (() => void | Promise<void>) | null): void {
    this.tripAction = action ?? undefined;
  }

  /**
   * `getMaxDdPct` — a konfigurált küszöb.
   */
  public getMaxDdPct(): number {
    return this.maxDdPct;
  }

  /**
   * `isTripped` — LATCHED flag. Ha egyszer `true`, onnan kezdve
   * mindig `true` amíg `reset()` nem hívódik.
   */
  public isTripped(): boolean {
    return this.tripped;
  }

  /**
   * `getTrippedAt` — a trip timestamp-je (ms), vagy `null` ha még
   * nem tüzelt.
   */
  public getTrippedAt(): number | null {
    return this.trippedAt;
  }

  /**
   * `getDrawdownPct` — az aktuális drawdown (0..1). Ha a peak 0
   * (még nincs equity tick), 0-t ad.
   */
  public getDrawdownPct(): number {
    if (this.peakEquityUsd <= 0) {
      return 0;
    }
    return Math.max(0, (this.peakEquityUsd - this.currentEquityUsd) / this.peakEquityUsd);
  }

  /**
   * `getPeakEquity` — a high-water mark.
   */
  public getPeakEquity(): number {
    return this.peakEquityUsd;
  }

  /**
   * `getCurrentEquity` — az utolsó equity tick.
   */
  public getCurrentEquity(): number {
    return this.currentEquityUsd;
  }

  /**
   * `recordEquity` — frissíti a current equity-t és a high-water
   * markot, illetve a per-stratégia hozzájárulást.
   *
   * Ha a `currentEquityUsd` meghaladja a peak-et, a peak követi.
   * A `perStrategyContrib` a teljes Map-et lecseréli (a TUI / log
   * az aktuális állapotot mutatja).
   *
   * A metódus a trip-checket IS elvégzi — ha a drawdown átlépi a
   * küszöböt, a `tripped` flag `true`-ra vált és a `tripAction`
   * callback async hívódik.
   */
  public recordEquity(equityUsd: number, perStrategyContrib?: ReadonlyMap<string, number>): void {
    if (!Number.isFinite(equityUsd)) {
      this.logger.warn("[portfolio-stop] ignoring non-finite equity", { equityUsd });
      return;
    }
    this.currentEquityUsd = equityUsd;
    this.hasReceivedEquity = true;
    if (equityUsd > this.peakEquityUsd) {
      this.peakEquityUsd = equityUsd;
    }
    if (perStrategyContrib !== undefined) {
      this.perStrategyContrib = new Map(perStrategyContrib);
    }
    // Trip-check (latched: ha már tripped, nem csinál semmit).
    if (!this.tripped) {
      this.maybeTrip();
    }
  }

  /**
   * `evaluate` — kiszámítja a stop állapotát. Nem trips-el, csak
   * visszaadja, hogy a `recordEquity` után mi lenne a helyzet.
   *
   * A metódus a `Bot` heartbeat-ciklusában hívódik, hogy a TUI /
   * Telemetry mindig friss állapotot lásson.
   */
  public evaluate(): PortfolioStopState {
    return {
      currentEquityUsd: this.currentEquityUsd,
      peakEquityUsd: this.peakEquityUsd,
      drawdownPct: this.getDrawdownPct(),
      maxDdPct: this.maxDdPct,
      tripped: this.tripped,
      trippedAt: this.trippedAt,
      perStrategyContrib: this.perStrategyContrib,
    };
  }

  /**
   * `getState` — alias az `evaluate()`-hoz, a `PortfolioManager`
   * `getPortfolioState()` API-jához igazítva.
   */
  public getState(): PortfolioStopState {
    return this.evaluate();
  }

  /**
   * `reset` — törli a latch-et. CSAK a user által kiadott
   * `mm-bot reset-portfolio-stop` parancsra vagy a `Bot.start()`
   * újraindításra hívódik.
   *
   * A peak NEM nullázódik — a drawdown a peak óta számít. Ha a
   * user kéri a peak törlését is, a `reset({ clearPeak: true })`
   * formát használhatja.
   */
  public reset(opts: { readonly clearPeak?: boolean } = {}): void {
    this.tripped = false;
    this.trippedAt = null;
    if (opts.clearPeak === true) {
      this.peakEquityUsd = 0;
      this.currentEquityUsd = 0;
      this.perStrategyContrib = new Map();
      this.hasReceivedEquity = false;
    }
    this.logger.warn("[portfolio-stop] latch reset — portfolio may resume", {
      clearPeak: opts.clearPeak === true,
    });
  }

  /**
   * `forceTrip` — a stop KÉNYSZERÍTETT trip-je. Akkor hívandó,
   * ha a `PortfolioManager` egyéb okból (pl. risk_manager jelzés)
   * dönt a stop mellett. A `recordEquity`-vel ellentétben ez
   * MINDIG tüzel, függetlenül a DD-től.
   */
  public forceTrip(reason: string): void {
    if (this.tripped) return;
    this.tripped = true;
    this.trippedAt = Date.now();
    this.logger.error("[portfolio-stop] FORCE-TRIPPED", {
      reason,
      equityUsd: this.currentEquityUsd,
      drawdownPct: this.getDrawdownPct(),
      perStrategyContrib: Object.fromEntries(this.perStrategyContrib),
    });
    void this.fireTripAction();
  }

  /**
   * `hasReceivedEquity` — van-e már equity tick. A `Bot` startup
   * log-jában használjuk, hogy a "no equity yet" állapotot meg tudjuk
   * különböztetni a "0 equity" állapottól.
   */
  public hasReceivedAnyEquity(): boolean {
    return this.hasReceivedEquity;
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * `maybeTrip` — a drawdown check és a trip-trigger.
   *
   * A `tripped` flag-et CSAK egyszer állítja `true`-ra (latch).
   * A `tripAction` callback-et async hívja — a hibát elkapjuk és
   * logoljuk, hogy a bot ne haljon meg a callback failure-je miatt.
   */
  private maybeTrip(): void {
    if (this.peakEquityUsd <= 0) {
      return;
    }
    const dd = this.getDrawdownPct();
    if (dd < this.maxDdPct) {
      return;
    }
    this.tripped = true;
    this.trippedAt = Date.now();
    this.logger.error(
      "[portfolio-stop] CRITICAL — circuit breaker TRIPPED",
      {
        currentEquityUsd: this.currentEquityUsd,
        peakEquityUsd: this.peakEquityUsd,
        drawdownPct: dd,
        maxDdPct: this.maxDdPct,
        perStrategyContrib: Object.fromEntries(this.perStrategyContrib),
        timestamp: this.trippedAt,
      },
    );
    void this.fireTripAction();
  }

  /**
   * `fireTripAction` — a trip callback futtatása. A hibát elkapjuk
   * és logoljuk — a bot state-e nem függhet a callback sikerességétől.
   */
  private async fireTripAction(): Promise<void> {
    if (this.tripAction === undefined) return;
    try {
      await this.tripAction();
    } catch (err) {
      this.logger.error("[portfolio-stop] trip action threw — continuing", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

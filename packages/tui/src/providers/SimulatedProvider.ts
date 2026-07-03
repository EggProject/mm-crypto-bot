// packages/tui/src/providers/SimulatedProvider.ts — szimulált state provider
//
// Ez a provider a TUI-only üzemmódhoz (`bun run tui`) készült: a bot-motor
// NEM indul el, csak a TUI jön fel, és egy szintetikus adatforrásból
// generál realisztikusnak tűnő state-frissítéseket. Célja:
//   1. A TUI működésének demonstrálása a bot-motor elkészülte előtt
//   2. A fejlesztői élmény biztosítása (azonnal látható a UI)
//   3. A TUI layout / formázás / színek vizuális tesztelése
//
// A szimuláció determinisztikus seed-et használ a reprodukálhatósághoz,
// de a price-walk és a trade-nyitások véletlenszerűek. A frissítési
// frekvencia 1 Hz — ennyi elég a vizuális visszajelzéshez.

import type {
  BotState,
  KillSwitchState,
  Position,
  Side,
  Statistics,
  TickerPrice,
  Trade,
} from "../types.js";
import {
  emptyBotState,
  type BotStateProvider,
  type Listener,
} from "./BotStateProvider.js";

/** A szimulációban használt alapeszközök (USDT perp / spot margin a bybit.eu-n). */
const SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"] as const;

/** Alapárak USDT-ben — 2026 Q2-Q3 körüli nagyságrend. */
const BASE_PRICES: Readonly<Record<(typeof SYMBOLS)[number], number>> = {
  "BTC/USDT": 62_500,
  "ETH/USDT": 3_400,
  "SOL/USDT": 145,
};

/** A volatilitás éves szinten (σ). A kriptó-piacra jellemző értékek. */
const VOLATILITY: Readonly<Record<(typeof SYMBOLS)[number], number>> = {
  "BTC/USDT": 0.65,
  "ETH/USDT": 0.75,
  "SOL/USDT": 1.10,
};

/** Kezdő equity USDT-ben. A @mm/paper alapértékével egyezik. */
const INITIAL_EQUITY_USDT = 10_000;

/** Maximális egyidejűleg nyitott pozíciók száma (a stratégia-korláttal egyező). */
const MAX_OPEN_POSITIONS = 3;

/** Pozíció-méret az equity %-ában (1/4-Kelly alap, fix fractional). */
const POSITION_SIZE_EQUITY_PCT = 0.04; // 4% az equity-ből, 1:5-1:10 tőkeáttétellel

/** Ticker frissítés periódusa ms-ben. */
const TICK_INTERVAL_MS = 1_000;

/**
 `SimulatedProviderOptions` — a szimulált provider konfigurációja.
 A `seed` a reprodukálható tesztekhez kell; ha nincs megadva, az
 aktuális időbélyegből generálunk egyet.
*/
export interface SimulatedProviderOptions {
  readonly mode: "tui-only" | "with-bot";
  readonly seed?: number;
  readonly engineError?: string | null;
}

/**
 `PRNG` — egyszerű lineáris kongruencia-generátor (LCG). Determinisztikus,
 gyors, és elegendő a TUI-szimulációhoz (nem kell kriptográfiai erősség).
*/
class PRNG {
  private state: number;

  constructor(seed: number) {
    // A seed legalább 1 legyen — az LCG state = 0 degenerált.
    this.state = seed === 0 ? 1 : seed;
  }

  /** [0, 1) intervallumon egyenletes eloszlású véletlen szám. */
  next(): number {
    // A klasszikus Numerical Recipes LCG paraméterek.
    this.state = (this.state * 16_645 + 1_013_904_223) % 2_147_483_647;
    return this.state / 2_147_483_647;
  }

  /** [min, max) intervallumon egyenletes eloszlású egész szám. */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** Normális eloszlású véletlen szám (Box-Muller transzformáció). */
  nextNormal(mean: number, stddev: number): number {
    const u1 = Math.max(this.next(), Number.EPSILON);
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + stddev * z;
  }
}

/**
 `SimulatedProvider` — a TUI-only mód state-szolgáltatója.
 A konstruktor elindítja a tick-intervalt, ami 1 Hz-en frissíti
 az árakat, és esetenként új pozíciókat nyit / zár.
*/
export class SimulatedProvider implements BotStateProvider {
  private readonly listeners = new Set<Listener>();
  private readonly prng: PRNG;

  private state: BotState;
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  /** Az aktuális szimulált árak — kulcs a symbol, érték az USDT ár. */
  private readonly prices = new Map<string, number>();

  /** A 24h-s változás nyomkövetéséhez szükséges seed-ár. */
  private readonly seed24hPrices = new Map<string, number>();

  /** A history-t itt tároljuk; a TUI csak az utolsó N elemet mutatja. */
  // A típus annotáció szükséges a `consistent-generic-constructors` rule miatt.
  private readonly closedTrades: Trade[] = [];

  /** Trade-ID counter az egyedi azonosítókhoz. */
  private nextTradeId = 1;

  constructor(options: SimulatedProviderOptions) {
    const seed = options.seed ?? Date.now() & 0x7fffffff;
    this.prng = new PRNG(seed);

    // Kezdőárak inicializálása a base-price és a seed alapján.
    for (const symbol of SYMBOLS) {
      // A `BASE_PRICES` típusa `Readonly<Record<literal, number>>` — a kulcs
      // típus-rendszer által védett (a SYMBOLS literál-tömbből származik), nem
      // user input. A `security/detect-object-injection` false positive.
      // eslint-disable-next-line security/detect-object-injection -- typed Record key, no user input
      const basePrice = BASE_PRICES[symbol];
      // ±5% véletlen eltérés a base-price-tól, hogy ne legyen mindig ugyanaz a kép.
      const startPrice = basePrice * (1 + (this.prng.next() - 0.5) * 0.1);
      this.prices.set(symbol, startPrice);
      this.seed24hPrices.set(symbol, startPrice);
    }

    this.state = emptyBotState(
      options.mode,
      INITIAL_EQUITY_USDT,
      options.engineError ?? null,
    );

    // Azonnal kiírjuk a ticker-listát, hogy a TUI ne legyen üres.
    this.state = {
      ...this.state,
      tickers: this.buildTickers(),
    };
  }

  // === Public API (BotStateProvider) ====================================

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): BotState {
    return this.state;
  }

  // A `BotStateProvider` interfész `Promise<void>` visszatérési típust ír elő,
  // ezért a metódusok `async` kulcsszóval vannak jelölve — akkor is, ha a
  // jelenlegi implementációban nincs `await`. Az eslint figyelmeztetését a
  // `require-await` szabályra inline kapcsoljuk ki.
  // eslint-disable-next-line @typescript-eslint/require-await
  async start(): Promise<void> {
    if (this.state.running) return;
    this.state = { ...this.state, running: true };
    this.notify();
    // A tick-intervalt csak egyszer indítjuk; a `running` flag szabályozza, hogy
    // a bot "él-e" (új pozíciókat nyithat-e). Az árak mindig frissülnek.
    this.tickInterval ??= setInterval(() => {
      this.tick();
    }, TICK_INTERVAL_MS);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async stop(): Promise<void> {
    if (!this.state.running) return;
    this.state = { ...this.state, running: false };
    this.notify();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async killSwitch(): Promise<void> {
    // A kill-switch minden nyitott pozíciót azonnal zár, és a botot
    // leállítja. A "triggered" állapotot a setKillSwitchState hívással
    // együtt kezeljük — a TUI-ból érkező megerősítés után hívódik.
    const closingPositions = this.state.positions;
    const now = Date.now();

    const newTrades: Trade[] = [];
    for (const pos of closingPositions) {
      const currentPrice = this.prices.get(pos.symbol) ?? pos.currentPrice;
      const priceDiff = pos.side === "buy" ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
      const pnlUsdt = priceDiff * pos.quantity * pos.leverage;
      const notional = pos.entryPrice * pos.quantity * pos.leverage;
      const pnlPct = (pnlUsdt / notional) * 100;
      newTrades.push({
        id: `sim-${String(this.nextTradeId++)}`,
        symbol: pos.symbol,
        side: pos.side,
        entryPrice: pos.entryPrice,
        exitPrice: currentPrice,
        quantity: pos.quantity,
        leverage: pos.leverage,
        pnlUsdt,
        pnlPct,
        openedAt: pos.openedAt,
        closedAt: now,
        reason: "VÉSZLEÁLLÍTÁS",
      });
    }

    this.closedTrades.push(...newTrades);

    this.state = {
      ...this.state,
      running: false,
      killSwitch: "triggered",
      positions: [],
      statistics: this.recomputeStatistics(),
      history: this.closedTrades.slice(-100),
      tickers: this.buildTickers(),
      status: {
        ...this.state.status,
        lastUpdate: now,
      },
    };
    this.notify();
  }

  setKillSwitchState(killState: KillSwitchState): void {
    this.state = { ...this.state, killSwitch: killState };
    this.notify();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async dispose(): Promise<void> {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.listeners.clear();
  }

  // === Belső logika ======================================================

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   `tick` — egy szimulációs lépés (1 Hz). Frissíti az árakat, szükség
   esetén új pozíciót nyit vagy zár, és értesíti a listenereket.
  */
  private tick(): void {
    // 1) Ár-frissítés geometriai Brown-mozgással (GBM).
    for (const symbol of SYMBOLS) {
      const currentPrice = this.prices.get(symbol) ?? BASE_PRICES[symbol];
      // A `VOLATILITY` típusa `Readonly<Record<literal, number>>` — a kulcs
      // típus-rendszer által védett (a SYMBOLS literál-tömbből származik).
      // eslint-disable-next-line security/detect-object-injection -- typed Record key, no user input
      const annualVol = VOLATILITY[symbol];
      // 1 másodperc = 1/31_536_000 év — a dt itt az évesített volatilitásból indul.
      const dt = 1 / 31_536_000;
      const drift = -0.05 * dt; // enyhe drift lefelé (realisztikusabb hosszú távon)
      const shock = this.prng.nextNormal(0, 1) * annualVol * Math.sqrt(dt);
      const newPrice = Math.max(currentPrice * Math.exp(drift + shock), 0.01);
      this.prices.set(symbol, newPrice);
    }

    // 2) A nyitott pozíciók unrealized PnL-jének frissítése + stop/TP ellenőrzés.
    const now = Date.now();
    const updatedPositions: Position[] = [];
    const closedFromThisTick: Trade[] = [];

    for (const pos of this.state.positions) {
      const currentPrice = this.prices.get(pos.symbol) ?? pos.currentPrice;
      const priceDiff =
        pos.side === "buy" ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
      const unrealizedPnl = priceDiff * pos.quantity * pos.leverage;
      const notional = pos.entryPrice * pos.quantity * pos.leverage;
      const unrealizedPnlPct = (unrealizedPnl / notional) * 100;

      // Stop-loss vagy take-profit triggered?
      const stopHit = pos.stopLoss !== null &&
        (pos.side === "buy" ? currentPrice <= pos.stopLoss : currentPrice >= pos.stopLoss);
      const tpHit = pos.takeProfit !== null &&
        (pos.side === "buy" ? currentPrice >= pos.takeProfit : currentPrice <= pos.takeProfit);

      // 72 órás idő-limit (a stratégia specifikáció szerint).
      const ageHours = (now - pos.openedAt) / (1000 * 60 * 60);
      const timeLimitHit = ageHours > 72;

      if (stopHit || tpHit || timeLimitHit) {
        const reason = stopHit ? "STOP-LOSS" : tpHit ? "TAKE-PROFIT" : "IDŐLIMIT";
        const pnlPct = unrealizedPnlPct;
        closedFromThisTick.push({
          id: `sim-${String(this.nextTradeId++)}`,
          symbol: pos.symbol,
          side: pos.side,
          entryPrice: pos.entryPrice,
          exitPrice: currentPrice,
          quantity: pos.quantity,
          leverage: pos.leverage,
          pnlUsdt: unrealizedPnl,
          pnlPct,
          openedAt: pos.openedAt,
          closedAt: now,
          reason,
        });
      } else {
        updatedPositions.push({
          ...pos,
          currentPrice,
          unrealizedPnl,
          unrealizedPnlPct,
        });
      }
    }

    if (closedFromThisTick.length > 0) {
      this.closedTrades.push(...closedFromThisTick);
    }

    // 3) Új pozíció nyitása, ha a bot fut és van szabad slot.
    let newPositions = updatedPositions;
    if (this.state.running && this.state.killSwitch === "armed" && updatedPositions.length < MAX_OPEN_POSITIONS) {
      // Véletlenszerű új pozíció, de nem azonnal minden tick-en.
      if (this.prng.next() < 0.15) {
        const freeSymbol = SYMBOLS.find((s) => !updatedPositions.some((p) => p.symbol === s));
        if (freeSymbol !== undefined) {
          const newPos = this.openRandomPosition(freeSymbol, now);
          newPositions = [...updatedPositions, newPos];
        }
      }
    }

    this.state = {
      ...this.state,
      positions: newPositions,
      history: this.closedTrades.slice(-100),
      tickers: this.buildTickers(),
      statistics: this.recomputeStatistics(),
      status: { ...this.state.status, connected: true, lastUpdate: now },
    };
    this.notify();
  }

  /**
   `openRandomPosition` — véletlenszerű oldal (long/short), entry,
   stop és TP meghatározása. A méret az equity 4%-a, a leverage 1:5.
  */
  private openRandomPosition(symbol: string, now: number): Position {
    const side: Side = this.prng.next() < 0.5 ? "buy" : "sell";
    const entryPrice = this.prices.get(symbol) ?? 1;
    const atr = entryPrice * 0.015; // 1.5% ATR — a stratégia konzervatív alapbeállítása
    const stopLoss = side === "buy" ? entryPrice - atr : entryPrice + atr;
    const takeProfit = side === "buy" ? entryPrice + atr * 2.5 : entryPrice - atr * 2.5;

    const equity = this.state.statistics.equityUsdt;
    const notionalUsdt = equity * POSITION_SIZE_EQUITY_PCT;
    const leverage = 5;
    const quantity = notionalUsdt / entryPrice;

    return {
      id: `pos-${String(this.nextTradeId++)}`,
      symbol,
      side,
      entryPrice,
      currentPrice: entryPrice,
      quantity,
      leverage,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      openedAt: now,
      stopLoss,
      takeProfit,
    };
  }

  /**
   `buildTickers` — a TickerPrice lista összeállítása az aktuális árakból.
  */
  private buildTickers(): readonly TickerPrice[] {
    const tickers: TickerPrice[] = [];
    for (const symbol of SYMBOLS) {
      const price = this.prices.get(symbol) ?? BASE_PRICES[symbol];
      const seedPrice = this.seed24hPrices.get(symbol) ?? price;
      const change24hPct = ((price - seedPrice) / seedPrice) * 100;
      // A 24h volume-t konstansnak vesszük a szimulációban (BTC ~30B, ETH ~15B, SOL ~5B).
      const baseVolume: Readonly<Record<(typeof SYMBOLS)[number], number>> = {
        "BTC/USDT": 30_000_000_000,
        "ETH/USDT": 15_000_000_000,
        "SOL/USDT": 5_000_000_000,
      };
      tickers.push({
        symbol,
        price,
        change24hPct,
        volume24hUsdt: baseVolume[symbol],
      });
    }
    return tickers;
  }

  /**
   `recomputeStatistics` — a history-ból aggregált statisztikák újraszámolása.
  */
  private recomputeStatistics(): Statistics {
    const stats = this.state.statistics;
    const trades = this.closedTrades;

    if (trades.length === 0) {
      return {
        ...stats,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        avgWinPnl: 0,
        avgLossPnl: 0,
        bestTradePnl: 0,
        worstTradePnl: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        totalPnlUsdt: 0,
        totalPnlPct: 0,
        maxDrawdownPct: 0,
        currentDrawdownPct: 0,
      };
    }

    let totalPnlUsdt = 0;
    let winningPnl = 0;
    let losingPnl = 0;
    let winningCount = 0;
    let losingCount = 0;
    let best = Number.NEGATIVE_INFINITY;
    let worst = Number.POSITIVE_INFINITY;
    let peakEquity = stats.initialEquityUsdt;
    let maxDd = 0;

    // A history-t növekvő closedAt szerint iteráljuk, hogy az equity-görbe
    // és a drawdown pontos legyen.
    const sortedTrades = [...trades].sort((a, b) => a.closedAt - b.closedAt);
    let runningEquity = stats.initialEquityUsdt;
    const returns: number[] = [];

    for (const t of sortedTrades) {
      const pnl = t.pnlUsdt;
      totalPnlUsdt += pnl;
      if (pnl > 0) {
        winningCount++;
        winningPnl += pnl;
        best = Math.max(best, pnl);
      } else if (pnl < 0) {
        losingCount++;
        losingPnl += Math.abs(pnl);
        worst = Math.min(worst, pnl);
      }
      const equityBefore = runningEquity;
      runningEquity += pnl;
      if (equityBefore > 0) {
        returns.push(pnl / equityBefore);
      }
      peakEquity = Math.max(peakEquity, runningEquity);
      const ddPct = ((peakEquity - runningEquity) / peakEquity) * 100;
      maxDd = Math.max(maxDd, ddPct);
    }

    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (winningCount / totalTrades) * 100 : 0;
    const avgWin = winningCount > 0 ? winningPnl / winningCount : 0;
    const avgLoss = losingCount > 0 ? losingPnl / losingCount : 0;
    const profitFactor = losingPnl > 0 ? winningPnl / losingPnl : (winningPnl > 0 ? Number.POSITIVE_INFINITY : 0);

    // Sharpe ratio (egyszerűsített, nem évesített) — a return-ek átlaga / szórása.
    let sharpe = 0;
    if (returns.length > 1) {
      const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
      const stddev = Math.sqrt(variance);
      sharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(returns.length) : 0;
    }

    const totalPnlPct = (totalPnlUsdt / stats.initialEquityUsdt) * 100;
    const currentDrawdownPct = peakEquity > 0 ? ((peakEquity - runningEquity) / peakEquity) * 100 : 0;

    return {
      ...stats,
      totalPnlUsdt,
      totalPnlPct,
      winRate,
      totalTrades,
      winningTrades: winningCount,
      losingTrades: losingCount,
      maxDrawdownPct: maxDd,
      currentDrawdownPct,
      avgWinPnl: avgWin,
      avgLossPnl: -avgLoss,
      bestTradePnl: best === Number.NEGATIVE_INFINITY ? 0 : best,
      worstTradePnl: worst === Number.POSITIVE_INFINITY ? 0 : worst,
      profitFactor,
      sharpeRatio: sharpe,
      equityUsdt: runningEquity,
    };
  }
}

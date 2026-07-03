/**
 * packages/shared/src/config.ts
 *
 * Konfigurációs típusok és betöltő függvények a teljes monorepo-hoz.
 *
 * KÉT KÜLÖN KONFIG-CSALÁD:
 *   - Trading-réteg (paper / live) — main-ből örökölt, zod-validált:
 *       `AppConfig`, `RiskConfig`, `PortfolioConfig`, `ExchangeFeeConfig`,
 *       `loadAppConfig()` — ezt használja a bot, az exchange és a paper
 *       csomag.
 *   - Backtest-réteg — strategy-backtest-ből importálva:
 *       `BacktestAppConfig`, `BacktestRiskConfig`, `StrategyConfig`,
 *       `loadConfig()` — ezt használja a `@mm-crypto-bot/core`
 *       stratégia-motor és a `@mm-crypto-bot/backtest` engine.
 *
 * A két család azért él egy fájlban, mert együtt használjuk őket
 * (egy futó rendszerben mindkettőre szükség lehet); a nevek
 * (`AppConfig` vs `BacktestAppConfig`) szándékosan különböznek, hogy
 * a típus-rendszer megkülönböztesse a trading és a backtest kontextust.
 */

import type { Timeframe } from "./types.js";

// ============================================================================
// I) BACKTEST KONFIG (strategy-backtest branch-ről örökölve)
// ============================================================================

/**
 * `BacktestAppConfig` — a backtest engine futásidejű konfigurációja.
 *
 * Az átnevezés (`AppConfig` helyett `BacktestAppConfig`) azért kell,
 * mert a trading-réteg `AppConfig`-ja (alább) más struktúrájú:
 * trading-mód, exchange-id, fee-séma, portfólió-allokáció, stb.
 * A backtest-réteg saját konfigja a stratégia-időkereteket és a
 * kockázati limiteket tartalmazza — nincs benne exchange-specifikus
 * fee vagy portfólió, mert ezek a backtest `CostModel` bemenetei.
 */
export interface BacktestAppConfig {
  readonly env: "paper" | "live";
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly ccxtRateLimitMs: number;
  readonly strategy: StrategyConfig;
  readonly risk: BacktestRiskConfig;
}

export interface StrategyConfig {
  /** HTF (Higher Time Frame) — a trend-szűrő időkerete. */
  readonly htfTimeframe: Timeframe;
  /** MTF (Medium Time Frame) — a setup-kereső időkerete. */
  readonly mtfTimeframe: Timeframe;
  /** LTF (Lower Time Frame) — a trigger-időkeret. */
  readonly ltfTimeframe: Timeframe;
}

export interface BacktestRiskConfig {
  /** Kockázat / trade az equity %-ában (alap: 0.01 = 1%). */
  readonly riskPerTrade: number;
  /** Kelly-frakció (alap: 0.25 = 1/4-Kelly). */
  readonly kellyFraction: number;
  /** Maximális drawdown, ami felett a kill-switch leáll (alap: 0.15). */
  readonly maxDrawdown: number;
}

export function loadConfig(): BacktestAppConfig {
  // A későbbi fázisban: tényleges .env betöltés és zod-séma validáció.
  // Egyelőre biztonságos default-okat adunk vissza.
  return {
    env: process.env["BUN_ENV"] === "live" ? "live" : "paper",
    logLevel: (process.env["LOG_LEVEL"] ?? "info") as BacktestAppConfig["logLevel"],
    ccxtRateLimitMs: Number.parseInt(process.env["CCXT_RATE_LIMIT_MS"] ?? "100", 10),
    strategy: {
      htfTimeframe: (process.env["STRATEGY_HTF_TIMEFRAME"] ?? "1d") as Timeframe,
      mtfTimeframe: (process.env["STRATEGY_MTF_TIMEFRAME"] ?? "4h") as Timeframe,
      ltfTimeframe: (process.env["STRATEGY_LTF_TIMEFRAME"] ?? "1h") as Timeframe,
    },
    risk: {
      riskPerTrade: Number.parseFloat(process.env["STRATEGY_RISK_PER_TRADE"] ?? "0.01"),
      kellyFraction: Number.parseFloat(process.env["STRATEGY_KELLY_FRACTION"] ?? "0.25"),
      maxDrawdown: Number.parseFloat(process.env["STRATEGY_MAX_DRAWDOWN"] ?? "0.15"),
    },
  };
}

// ============================================================================
// II) TRADING KONFIG (main-ből örökölt, Zod-validált)
// ============================================================================

import { z } from "zod";

/**
 * Exchange-specifikus fee és borrow rate konfiguráció.
 * Alapértelmezetten a bybit.eu értékeit használjuk (0.1% spot fee,
 * 0.02%/nap borrow rate), de bármelyik exchange-re felülírható.
 */
export const ExchangeFeeConfigSchema = z.object({
  /** Spot taker fee, decimals (pl. 0.001 = 0.1%) */
  spotTakerFee: z.number().min(0).max(0.1).default(0.001),
  /** Spot maker fee */
  spotMakerFee: z.number().min(0).max(0.1).default(0.001),
  /** Margin borrow rate, per-day decimal (pl. 0.0002 = 0.02%/nap) */
  borrowRatePerDay: z.number().min(0).max(0.1).default(0.0002),
  /** Liquidation fee (fee pool), decimal */
  liquidationFee: z.number().min(0).max(0.1).default(0.02),
  /** Maintenance margin ratio (%), liquidation trigger */
  maintenanceMarginRatio: z.number().min(0.01).max(1).default(1.0),
});
export type ExchangeFeeConfig = z.infer<typeof ExchangeFeeConfigSchema>;

/**
 * Risk management konfiguráció — a kiválasztott stratégia alapján
 * (MTF-Trend-Konfluencia Kompozit v1.0):
 *   - 1% risk/trade
 *   - 1/4-Kelly position sizing
 *   - 15% DD kill-switch
 *   - max 10× spot margin (bybit.eu constraint)
 */
export const RiskConfigSchema = z.object({
  /** Risk per trade (% of equity) */
  riskPerTrade: z.number().min(0.001).max(0.05).default(0.01),
  /** Kelly fraction (1/4 = quarter-Kelly) */
  kellyFraction: z.number().min(0.05).max(1).default(0.25),
  /** Max drawdown % — kill-switch trigger */
  maxDrawdownPct: z.number().min(0.01).max(0.5).default(0.15),
  /** Max concurrent positions */
  maxPositions: z.number().int().min(1).max(20).default(3),
  /** Max leverage — bybit.eu constraint: max 10× */
  maxLeverage: z.number().int().min(1).max(10).default(3),
});
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

/**
 * Portfólió allokáció a 3 coin között (BTC, ETH, SOL).
 * Az alapértelmezett a research-strategy-ből jön: BTC 50% / ETH 30% / SOL 20%.
 */
export const PortfolioConfigSchema = z.object({
  allocations: z
    .object({
      BTC: z.number().min(0).max(1).default(0.5),
      ETH: z.number().min(0).max(1).default(0.3),
      SOL: z.number().min(0).max(1).default(0.2),
    })
    .default({ BTC: 0.5, ETH: 0.3, SOL: 0.2 }),
});
export type PortfolioConfig = z.infer<typeof PortfolioConfigSchema>;

/**
 * A teljes trading app konfiguráció — az env-ből + a config file-ból olvasandó.
 *
 * FIGYELEM: Ez a main-ből örökölt `AppConfig`. A strategy-backtest
 * fázisban bevezetett `BacktestAppConfig` egy másik típus (lásd fent).
 * A kettő NEM kompatibilis — a trading és a backtest kontextus
 * más-más adatokat igényel.
 */
export const AppConfigSchema = z.object({
  mode: z.enum(["live", "paper", "backtest"]).default("paper"),
  exchange: z.enum(["bybiteu", "binance", "okx"]).default("bybiteu"),
  fee: ExchangeFeeConfigSchema.default({}),
  risk: RiskConfigSchema.default({}),
  portfolio: PortfolioConfigSchema.default({}),

  /** Trading symbol-ok (CCXT unified formátumban) */
  symbols: z
    .array(z.string())
    .default(["BTC/USDC", "ETH/USDC", "SOL/USDC"]),

  /** Log szint */
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Default konfiguráció betöltése env-ből és/vagy config file-ból.
 * A teljes validáció a Zod-on fut — így a konfigurációs hibák
 * fordítási idő helyett induláskor jönnek elő, de erősen típusosak.
 */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return AppConfigSchema.parse({
    mode: env["MODE"] ?? "paper",
    exchange: env["EXCHANGE"] ?? "bybiteu",
    fee: {
      spotTakerFee: env["SPOT_TAKER_FEE"] ? Number(env["SPOT_TAKER_FEE"]) : undefined,
      spotMakerFee: env["SPOT_MAKER_FEE"] ? Number(env["SPOT_MAKER_FEE"]) : undefined,
      borrowRatePerDay: env["BORROW_RATE_PER_DAY"] ? Number(env["BORROW_RATE_PER_DAY"]) : undefined,
    },
    logLevel: env["LOG_LEVEL"] ?? "info",
  });
}
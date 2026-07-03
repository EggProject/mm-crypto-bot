/**
 * packages/shared/src/config.ts
 *
 * Trading konfigurációs sémák — Zod-alapú validáció runtime + típus-szinten.
 *
 * A borrow rate és fee paraméterek hangsúlyosan KONFIGURÁLÓDNAK, nem
 * égetettek — lásd a research-strategy verifier 2. caveat-ját:
 * "Margin borrow rate: a research 0,24%/nap-ot használ, a bybit.eu
 *  hivatalos példa 0,02%/nap (~12× alacsonyabb) → a költségmodell
 *  konzervatívan túlbecsül, ezt a backtest fee-paraméternél
 *  korrigálni/paraméterezni kell."
 *
 * A bybit.eu alapértelmezett érték a 0,02%/nap (0.0002/nap), ami
 * megfelel a bybit.eu hivatalos példájának USDT-re.
 */

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
 * A teljes app konfiguráció — az env-ből + a config file-ból olvasandó.
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
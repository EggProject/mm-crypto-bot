/**
 * packages/shared/src/index.ts
 *
 * A `@mm-crypto-bot/shared` package belépési pontja. Az alkalmazás és
 * más package-ek innen importálnak típusokat, utilokat, konfigurációt
 * és a structured logger-t.
 *
 * A Phase 3 (strategy + backtest implementáció) PR után a barrel négy
 * al-modult re-exportál:
 *   - `./types.ts`   — domain típusok (Candle, Symbol, Trade, Timeframe, ExitReason, Result, Brand) + ccxt trading típusok (ExchangeFeed, TradingSignal, stb.)
 *   - `./config.ts`  — backtest + trading konfiguráció (BacktestAppConfig, AppConfig, loadConfig, loadAppConfig)
 *   - `./utils.ts`   — közös util függvények (roundTo, clamp, mean, stddev, sum, unwrap)
 *   - `./logger.ts`  — structured JSON logger (createLogger)
 *
 * Subpath exportok a package.json-ban:
 *   `@mm-crypto-bot/shared/types`   -> `./src/types.ts`
 *   `@mm-crypto-bot/shared/config`  -> `./src/config.ts`
 *   `@mm-crypto-bot/shared/utils`   -> `./src/utils.ts`
 *   `@mm-crypto-bot/shared/logger`  -> `./src/logger.ts`
 */

export * from "./types.js";
export * from "./config.js";
export * from "./utils.js";
export * from "./logger.js";
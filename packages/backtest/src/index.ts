// packages/backtest/src/index.ts — `@mm-crypto-bot/backtest` belépési pont
//
// A `@mm-crypto-bot/backtest` csomag a kiválasztott stratégia historikus
// OHLCV adatokon történő visszatesztelő motorja.
//
// Specifikáció: docs/research/selected-strategy.md §8 (OOS validáció),
// §9 (költség-modell), §5 (position-sizing).

// Adatmodell és típusok.
export * from "./types.js";

// Költség-modell (fee, slippage, spread, margin, funding).
export * from "./cost-model.js";

// Position-sizing (Kelly + fix fractional risk).
export * from "./position-size.js";

// Metrikák (Sharpe, Sortino, max DD, profit factor, win rate, stb.).
export * from "./metrics.js";

// Fő backtest motor.
export { runBacktest, aggregateToTimeframe, checkExit, closePosition } from "./engine.js";
export type { OpenPosition } from "./engine.js";

// Walk-forward out-of-sample validáció.
export { runWalkForward, computeOosIsRatio } from "./oos.js";
export type { WalkForwardResult } from "./oos.js";

// Riport generator.
export { formatReport, formatJsonReport, formatTradeListCsv } from "./report.js";
export type { BacktestReport } from "./types.js";
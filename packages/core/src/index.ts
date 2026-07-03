// packages/core/src/index.ts — `@mm-crypto-bot/core` belépési pont
//
// A `@mm-crypto-bot/core` csomag a stratégia-motor. A kiválasztott stratégia
// (MTF-Trend-Konfluencia Kompozit v1.0) és az indikátor-számítási
// modul itt van implementálva.
//
// Specifikáció: docs/research/selected-strategy.md

// Indikátorok — az `index.ts` újra-exportja az összes indikátort,
// hogy a fogyasztók egyetlen `import { ... } from "@mm-crypto-bot/core"` sorral
// hozzáférjenek mindegyikhez.
export * from "./indicators/index.js";

// Stratégia — a `MtfTrendConfluenceStrategy` és a `Strategy` interfész.
export { MtfTrendConfluenceStrategy } from "./strategy/mtf-trend-confluence.js";
// Phase 4 — aggressive MTF-BB mean-reversion.
export { MeanReversionBbStrategy } from "./strategy/mean-reversion-bb.js";
export { DEFAULT_MR_CONFIG } from "./strategy/mean-reversion-bb.js";
export type { MeanReversionBbConfig } from "./strategy/mean-reversion-bb.js";
// Phase 5 — always-in trend-following (Strategy A).
export { AlwaysInTrendStrategy } from "./strategy/always-in-trend.js";
export { DEFAULT_ALWAYSIN_CONFIG } from "./strategy/always-in-trend.js";
export type { AlwaysInTrendConfig } from "./strategy/always-in-trend.js";
// Phase 5 — Donchian volatility breakout (Strategy C).
export { DonchianBreakoutStrategy } from "./strategy/donchian-breakout.js";
export { DEFAULT_DONCHIAN_CONFIG } from "./strategy/donchian-breakout.js";
export type { DonchianBreakoutConfig } from "./strategy/donchian-breakout.js";
// Phase 5 — Composite multi-strategy ensemble (Strategy B).
export { CompositeStrategy } from "./strategy/composite.js";
export { DEFAULT_COMPOSITE_CONFIG } from "./strategy/composite.js";
export type { CompositeStrategyConfig } from "./strategy/composite.js";

// Típusok — a `Strategy`, `StrategyContext`, `StrategySignal`,
// `MtfState`, `IndicatorState`, `MtfTrendConfluenceConfig`, `DEFAULT_MTF_CONFIG`.
export type {
  Strategy,
  StrategyContext,
  StrategySignal,
  MtfState,
  IndicatorState,
  MtfTrendConfluenceConfig,
} from "./types.js";
export { DEFAULT_MTF_CONFIG } from "./types.js";

import type { Strategy } from "./types.js";
import { MtfTrendConfluenceStrategy } from "./strategy/mtf-trend-confluence.js";

/**
 `createStrategy` — factory függvény a kiválasztott stratégia
 példányosításához. A backtest motor ezen keresztül kapja meg a
 stratégiát, hogy ne kelljen az implementációs részleteket ismernie.

 A factory a `DEFAULT_MTF_CONFIG` alapértékeit használja — a
 későbbi fázisokban a konfiguráció a `loadConfig()`-ból jöhet.
*/
export function createStrategy(): Strategy {
  return new MtfTrendConfluenceStrategy();
}
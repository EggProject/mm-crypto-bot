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
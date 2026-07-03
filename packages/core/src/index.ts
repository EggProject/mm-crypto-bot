// packages/core/src/index.ts — `@mm/core` belépési pont
//
// FELADAT: A `@mm/core` csomag a stratégia-motor váz. A kiválasztott
// stratégia (MTF-Trend-Konfluencia Kompozit v1.0) itt fog implementálódni.
// A scaffold fázisban csak a `Strategy` interfész és egy placeholder
// `MtfTrendConfluenceStrategy` váz van itt — a tényleges indikátor-számítás
// (Donchian, Supertrend, BB, RSI) a későbbi fázisokban kerül be.

import type { Side, Timeframe } from "@mm/shared/types";

/**
 `Strategy` — egy kereskedési stratégia absztrakciója.
 Egy konkrét stratégia köteles implementálni a `onCandle` callback-et,
 amely minden új gyertyánál jelzést generál (vagy épp nem).
*/
export interface Strategy {
  readonly name: string;
  /** Az alkalmazott időkeretek listája — az MTF kompozit 3 szintet vár (HTF/MTF/LTF). */
  readonly timeframes: readonly Timeframe[];
  /** Új gyertya esetén hívódik. `null` = nincs jelzés. */
  readonly onCandle: (ctx: StrategyContext) => StrategySignal | null;
}

export interface StrategyContext {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly candleIndex: number;
}

export interface StrategySignal {
  readonly side: Side;
  readonly confidence: number;
  readonly reason: string;
}

/**
 `MtfTrendConfluenceStrategy` — a kiválasztott stratégia placeholder osztálya.
 A teljes implementáció a későbbi fázisokban készül el. A részletes
 specifikáció: docs/research/selected-strategy.md §3.
*/
export class MtfTrendConfluenceStrategy implements Strategy {
  readonly name = "MTF-Trend-Konfluencia Kompozit v1.0";
  readonly timeframes = ["4h", "1h", "15m"] as const;

  onCandle(_ctx: StrategyContext): StrategySignal | null {
    // A későbbi fázisokban: HTF trend-szűrő (Donchian + Supertrend) +
    // MTF setup (BB + RSI) + LTF trigger (RSI cross-back).
    return null;
  }
}

export function createStrategy(): Strategy {
  return new MtfTrendConfluenceStrategy();
}

// packages/tui/src/charts/bar-chart.tsx — stratégia-breakdown BarChart
//
// A Phase 36 Track B2 user mandate: a TUI jelenítsen meg
// "stratégia-breakdown" BarChart-ot a dashboard oldalán. A
// `@pppp606/ink-chart` BarChart komponensét használjuk, ami:
//   - React/Ink kompatibilis (JSX)
//   - Beépített szín-támogatás (color prop per bar)
//   - Automatikus szélesség-illesztés a terminálhoz
//
// A wrapper tiszta React-komponens: átveszi a stratégia-listát
// (név + cap érték + ON/OFF), és átalakítja a BarChart
// által elvárt `BarChartData[]` formátumra.

import type { ReactElement } from "react";
import { Text } from "ink";
import { BarChart } from "@pppp606/ink-chart";
import type { BarChartData } from "@pppp606/ink-chart";

/**
 * `StrategyBar` — egy stratégia adata a BarChart-hoz.
 *   - `name`: a stratégia neve (pl. "donchian_pivot_composition")
 *   - `cap`: a cap érték %-ban (0-100)
 *   - `enabled`: true, ha a stratégia aktív
 */
export interface StrategyBar {
  readonly name: string;
  readonly cap: number;
  readonly enabled: boolean;
}

/**
 * `colorForStrategy` — a stratégia állapota alapján választ színt.
 *   - enabled = true  → zöld (aktív, fut)
 *   - enabled = false → szürke (inaktív, OFF)
 */
function colorForStrategy(enabled: boolean): string {
  return enabled ? "green" : "gray";
}

/**
 * `StrategyBarChart` — React-komponens, ami a stratégia-listát
 * BarChart formátumban jeleníti meg.
 *
 * A komponens közvetlenül renderelhető a ChartsPanel-ből. A
 * `@pppp606/ink-chart` BarChart a `data` prop-pal veszi át a
 * BarChartData[] tömböt (label + value + color).
 *
 * Phase 36 user mandate: a user a TUI-n látja, hogy mely stratégiák
 * aktívak, és mekkora a cap-jük. A vizuális visszajelzés a cap%
 * arányában megjelenő sáv (zöld = aktív, szürke = OFF).
 */
export function StrategyBarChart({
  strategies,
}: {
  readonly strategies: readonly StrategyBar[];
}): ReactElement {
  if (strategies.length === 0) {
    // A BarChart 0 értékkel nem renderel semmit — az empty-state
    // jobban néz ki plain text-ként.
    return <Text dimColor italic>(no strategies configured)</Text>;
  }

  const data: BarChartData[] = strategies.map((s) => ({
    label: s.name,
    value: s.cap,
    color: colorForStrategy(s.enabled),
  }));

  return <BarChart data={data} />;
}

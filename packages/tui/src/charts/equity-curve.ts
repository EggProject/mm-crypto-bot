// packages/tui/src/charts/equity-curve.ts — equity görbe ASCII chart
//
// A Phase 36 Track B2 user mandate: a TUI legyen "richer visuals",
// jelenítsen meg equity görbét a history-ból. A wrapper a `asciichart`
// library-t használja, ami:
//
//   - Többsoros ASCII chart-ot ad vissza string-ként (╭┈╯)
//   - Az ANSI escape-szekvenciákkal színez (alap: zöld)
//   - Nincs React / Ink függőség — a kapott string mehet `<Text>`-be
//
// A wrapper tiszta függvény: equityValues[] → string. NEM renderel
// React/Box-ot — a ChartsPanel komponens felelőssége a Box-ba helyezés.

import asciichart from "asciichart";

/**
 * `EquityCurveOptions` — az equity-görbe megjelenítési beállításai.
 */
export interface EquityCurveOptions {
  /** A chart magassága (sorok száma). Default: 6. */
  readonly height?: number;
  /** A chart szélessége (karakterek száma). Default: 60. */
  readonly width?: number;
  /** Minimum érték (ha a felhasználó explicit beállítja). */
  readonly min?: number;
  /** Maximum érték (ha a felhasználó explicit beállítja). */
  readonly max?: number;
}

/**
 * `renderEquityCurve` — equity görbe ASCII-chart formátumban.
 *
 * Bemenet: a history zárt trade-jeiből számított equity-sorozat
 * (az első az induló equity, az utolsó a jelenlegi). A függvény
 * az `asciichart.plot()` wrapper-je, ami:
 *
 *   1. A height/width paramétereket átadja
 *   2. A `colors: [2]` opcióval kényszeríti a zöld színt
 *      (a 2 = ANSI zöld; asciichart a 0/1/2/3/4/5 színeket támogatja)
 *   3. A min/max tartományt a useLatestRange opcióval hagyja az
 *      asciichart-ra (a chart maga skáláz a data alapján)
 *
 * A függvény visszatérési értéke egy string, ami `<Text>`-be
 * tehető. Ha az equityValues üres, egy "Még nincs adat" placeholder-t
 * adunk vissza.
 *
 * Phase 36 user mandate: "ASCII chartok (candlestick, equity curve,
 * P&L sparkline)" — az equity görbe a legfontosabb vizuális elem a
 * dashboardon, mert a user azonnal látja, hogy a bot pénzt keres
 * vagy veszít.
 */
export function renderEquityCurve(
  equityValues: readonly number[],
  options: EquityCurveOptions = {},
): string {
  const { height = 6, width = 60 } = options;

  if (equityValues.length === 0) {
    return "Még nincs equity-adat. A görbe a pozíciók zárásakor fog feltöltődni.";
  }

  if (equityValues.length === 1) {
    return `[1 trade] equity: ${equityValues[0]?.toFixed(2) ?? "0.00"} USDT`;
  }

  // Az asciichart.plot a number[] tömböt várja. A readonly tömb
  // kompatibilis a mutable number[]-gel (a `asciichart` típusai
  // lazák a `any` irányába).
  const data = [...equityValues];
  const chart = asciichart.plot(data, {
    height,
    width,
    colors: [asciichart.green],
  });
  return chart;
}

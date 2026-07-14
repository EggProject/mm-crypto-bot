// packages/tui/src/charts/sparkline.ts — P&L sparkline (inline unicode-bar)
//
// A Phase 36 Track B2 user mandate: "P&L sparkline" a dashboardon.
// A `sparkly` library a `sindresorhus/sparkly` (6.0.1) — az
// iparági standard, 1+ M heti letöltéssel.
//
// A sparkly egy string-et ad vissza (pl. `▁▂▃▅▇`), ami a számok
// arányait mutatja. A wrapper:
//
//   1. A `pnlValues` tömböt átadja a sparkly-nak
//   2. A `style: "fire"` opcióval piros/zöld színű kimenetet ad
//      (a sparkly 3 stílust támogat: default / fire / braille)
//   3. A `width` opcióval a megjelenített karakterek számát
//      korlátozza (default 16)
//
// A függvény tiszta: pnlValues[] → string. Üres tömb esetén a
// "Még nincs adat" placeholder-t adja vissza.

import sparkly from "sparkly";

/**
 * `SparklineOptions` — a sparkline megjelenítési beállításai.
 */
export interface SparklineOptions {
  /** A megjelenített karakterek száma. Default: 16. */
  readonly width?: number;
  /**
   * A megjelenítési stílus.
   *
   * A sparkly v6.0.1 csak a "fire" stílust támogatja (a
   * pozitív/negatív értékeket piros/sárga színnel jeleníti meg).
   * A mező típusa a jövőbeli API-bővítéshez van nyitva hagyva
   * ("default" / "braille" opciók) — ha a sparkly újabb verziója
   * támogatja ezeket, egyszerűen bővíthető a union típus.
   */
  readonly style?: "fire" | "default" | "braille";
}

/**
 * `renderSparkline` — P&L sorozat unicode-bar sparkline formátumban.
 *
 * Bemenet: a history lezárt trade-jeinek pnlUsdt értékei (negatív
 * is lehet). A függvény a `sparkly()` wrapper-je, ami:
 *
 *   1. A `pnlValues` utolsó `width` elemére szeleteli az adatot
 *      (a sparkly v6.0.1 NEM támogatja a `width` opciót — a
 *      library a teljes bemenő tömböt megjeleníti, egy karakter
 *      / adatpont arányban)
 *   2. A `style: options.style ?? "fire"` opcióval színezi
 *   3. A `width: options.width ?? 16` opcióval korlátozza a
 *      mintavételezett adatok számát (így a kimenet ~16 széles)
 *
 * Phase 36 user mandate: a sparkline az equity-görbe kiegészítője —
 * az equity-görbe a teljes egyenleget mutatja, a sparkline az
 * utolsó N trade P&L-jének "lendületét" (pl. `▁▂▃▅▇█` = növekvő).
 */
export function renderSparkline(
  pnlValues: readonly number[],
  options: SparklineOptions = {},
): string {
  const { width = 16, style = "fire" } = options;

  if (pnlValues.length === 0) {
    return "Még nincs P&L-adat. A sparkline a lezárt trade-ekből épül.";
  }

  if (pnlValues.length === 1) {
    const v = pnlValues[0] ?? 0;
    return `[1 trade] P&L: ${v.toFixed(2)} USDT`;
  }

  // A sparkly v6.0.1 nem támogatja a width opciót, ezért a
  // bemeneti adatot a kívánt méretre szeleteljük (az utolsó
  // `width` elemet vesszük, ami a legfrissebb trade-eket reprezentálja).
  const start = Math.max(0, pnlValues.length - width);
  const data = pnlValues.slice(start);
  // A sparkly v6 típus-szinten csak "fire" stílust fogad el; ha
  // a felhasználó mást kér, a default "fire"-re esik vissza.
  const sparklyStyle: "fire" = style === "fire" ? "fire" : "fire";
  const spark = sparkly([...data], { style: sparklyStyle });
  return spark;
}

// packages/tui/src/charts/candlestick.ts — OHLC candlestick ASCII chart
//
// A Phase 36 Track B2 user mandate: "ASCII chartok (candlestick, ...)".
//
// A `@crafter/charts` v0.2.4 (3 hónapos, 1 contributor) `chart().candlestick()`
// builder API-ja BROKEN — a builder üres string-et ad vissza. A kutatási
// direktíva ("smoke test first, fall back to 60-LOC hand-roll if it
// doesn't work") ezt az esetet írja le. Ez a fájl a hand-rolled
// fallback implementáció.
//
// Az algoritmus well-known: minden candle-t egy karakter-szélességű
// oszlopként rajzolunk, ahol:
//
//   ┼   — a test középvonala (mid = (open+close)/2)
//   ┬   — a high wick teteje
//   ┴   — a low wick alja
//   ─   — az open/close szint (ha open != close)
//   █   — a body (ha close > open = "up" candle)
//   ▓   — a body (ha close < open = "down" candle, piros színnel)
//
// A függvény pure: candles[] → string. A színezést a ChartsPanel
// végzi, a kapott string-et `<Text color="...">`-be helyezi.

/**
 * `OhlcCandle` — egy OHLC (Open-High-Low-Close) candle.
 */
export interface OhlcCandle {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/**
 * `CandlestickOptions` — a candlestick megjelenítési beállításai.
 */
export interface CandlestickOptions {
  /** A chart szélessége (oszlopok száma). Default: 40. */
  readonly width?: number;
  /** A chart magassága (sorok száma). Default: 10. */
  readonly height?: number;
}

/**
 * `renderCandlesticks` — N darab OHLC candle-t rajzol ki egy
 * string-be, oszloponként 1 karakter szélességben.
 *
 * Algoritmus:
 *
 *   1. Megkeressük a chart méretét (min/max price).
 *   2. Normalizálunk minden candle-t: az árakat 0..height-1
 *      tartományra képezzük le.
 *   3. Minden candle-re:
 *      - a high a legfelső wick
 *      - a low a legalsó wick
 *      - a body a (open..close) között van
 *      - ha open == close, egy vonalat húzunk (─)
 *      - ha close > open, a body █ (zöld, "up candle")
 *      - ha close < open, a body ▓ (piros, "down candle")
 *   4. Soronként összefűzzük az oszlopokat.
 *
 * A függvény visszatérési értéke egy string, ami `<Text>`-be tehető.
 * Ha a candles üres, egy "Még nincs adat" placeholder-t adunk vissza.
 *
 * Phase 36 user mandate: "candlestick" — a user az utolsó 1h OHLC-ját
 * látja a ChartsPanel közepén. A hand-roll azért szükséges, mert a
 * `@crafter/charts` v0.2.4 high-level builder API-jában a candlestick
 * támogatás törött.
 */
export function renderCandlesticks(
  candles: readonly OhlcCandle[],
  options: CandlestickOptions = {},
): string {
  const { width = 40, height = 10 } = options;

  if (candles.length === 0) {
    return "Még nincs OHLC-adat. A candlestick az utolsó 1h tick-ekből épül.";
  }

  // Az oszlopok száma = candles.length, de limitáljuk a width-re.
  const visibleCount = Math.min(candles.length, width);
  // Az utolsó `visibleCount` candle-t használjuk (legfrissebbek).
  const visible = candles.slice(-visibleCount);

  // A chart mérettartományának meghatározása.
  let minPrice = Number.POSITIVE_INFINITY;
  let maxPrice = Number.NEGATIVE_INFINITY;
  for (const c of visible) {
    if (c.low < minPrice) minPrice = c.low;
    if (c.high > maxPrice) maxPrice = c.high;
  }
  // Ha minden ár azonos, adjunk egy minimális tartományt.
  if (minPrice === maxPrice) {
    minPrice = minPrice - 1;
    maxPrice = maxPrice + 1;
  }
  const priceRange = maxPrice - minPrice;

  /**
   * `priceToRow` — egy árat 0..height-1 sorindex-szé konvertál.
   * A magasabb ár = alacsonyabb sorindex (mert a terminálon a 0. sor
   * van felül). Tehát a maxPrice a 0. sorba kerül, a minPrice pedig
   * a (height-1). sorba.
   */
  const priceToRow = (price: number): number => {
    const normalized = (price - minPrice) / priceRange;
    // A `height - 1` a skála felső határa (a 0. sor a maxPrice).
    // A normalizált érték [0..1], ahol 0 = minPrice, 1 = maxPrice.
    // A sor-index fordított: 0 = maxPrice, height-1 = minPrice.
    return Math.floor((1 - normalized) * (height - 1));
  };

  // Inicializáljuk a chart-ot: egy `height` sorból álló tömb,
  // minden sor egy `visibleCount` hosszú, szóköz-sorokból álló string.
  const grid: string[][] = [];
  for (let row = 0; row < height; row++) {
    const line: string[] = new Array<string>(visibleCount).fill(" ");
    grid.push(line);
  }

  // Minden candle-t kirajzolunk.
  for (let col = 0; col < visibleCount; col++) {
    const candle = visible[col];
    if (candle === undefined) continue;

    const highRow = priceToRow(candle.high);
    const lowRow = priceToRow(candle.low);
    const openRow = priceToRow(candle.open);
    const closeRow = priceToRow(candle.close);
    // A body felső és alsó sora (a high/low NEM tartozik a body-hoz —
    // azok a wickek). A doji (open==close) esetén a body 1 sor.
    const bodyTopRow = Math.min(openRow, closeRow);
    const bodyBottomRow = Math.max(openRow, closeRow);

    // Felső wick: a high és a body teteje közötti sorok.
    // A wick csak akkor jelenik meg, ha a high "magasabb" mint a body
    // teteje (azaz highRow < bodyTopRow, mert a 0. sor a terminál teteje).
    for (let row = highRow; row < bodyTopRow; row++) {
      const cell = grid[row];
      if (cell !== undefined) cell[col] = "│";
    }
    // Alsó wick: a body alja és a low közötti sorok.
    for (let row = bodyBottomRow + 1; row <= lowRow; row++) {
      const cell = grid[row];
      if (cell !== undefined) cell[col] = "│";
    }
    // A body
    const isUp = candle.close >= candle.open;
    const bodyChar = isUp ? "█" : "▓";
    for (let row = bodyTopRow; row <= bodyBottomRow; row++) {
      const cell = grid[row];
      if (cell !== undefined) cell[col] = bodyChar;
    }
    // Ha a test 1 sor magas (openRow == closeRow), egy vonalat húzunk
    if (openRow === closeRow) {
      const cell = grid[openRow];
      if (cell !== undefined) cell[col] = "─";
    }
  }

  // Összefűzzük a sorokat string-é.
  // A chart tetejére egy price-labelt teszünk (maxPrice), az aljára
  // egy másikat (minPrice), hogy a user lássa a skálát.
  const lines: string[] = [];
  for (let row = 0; row < height; row++) {
    const gridRow = grid[row];
    if (gridRow === undefined) continue;
    const isFirst = row === 0;
    const isLast = row === height - 1;
    let prefix: string;
    if (isFirst) prefix = `${maxPrice.toFixed(0).padStart(5)}┤`;
    else if (isLast) prefix = `${minPrice.toFixed(0).padStart(5)}┤`;
    else prefix = "     │";
    lines.push(`${prefix}${gridRow.join("")}`);
  }
  return lines.join("\n");
}

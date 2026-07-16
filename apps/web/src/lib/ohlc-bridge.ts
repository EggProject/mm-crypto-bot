/**
 * apps/web/src/lib/ohlc-bridge.ts
 *
 * Phase 48A: pure conversion library between the state-feed OHLC
 * representation and the eggproject-design LcWrap `<div data-lc="...">`
 * contract used by the vendored `lc-charts.js` declarative renderer.
 *
 * NO React imports, NO DOM access, NO I/O. Every function is
 * deterministic and null-safe (empty input → null, never throws).
 *
 * The companion component `apps/web/src/components/ChartCard.tsx`
 * calls `barsToLcChartSpec(bars, { markers })` to feed a mount node
 * (data-lc-* attributes) which `lc-charts.js` (or the React useEffect
 * wrapper) turns into a real TradingView Lightweight Charts™ instance.
 *
 * The same data shape also feeds the 48B chart grid (parent decides
 * which (symbol, timeframe) pairs to render) and the 49 indicator
 * overlay pass.
 */

/**
 * `LcChartKind` — a lightweight-charts diagramtípus. Az eggproject-design
 * skill LcWrap-ja `data-lc="<kind>"` attribútumot vár.
 */
export type LcChartKind = "candles" | "area" | "line" | "sparkline";

/**
 * Egyetlen OHLC bar (időrendben).
 *
 * `time` UNIX **milliszekundum** (a state-feed protokollból jön így).
 * A lightweight-charts v5-ös API másodpercben várja — az átváltás a
 * renderelő komponens (`ChartCard.tsx`) felelőssége, *nem* itt.
 */
export interface OHLCBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * A LcWrap `data-lc` attribútumainak formátuma (a skill konvenciója).
 * A renderelő ezt az objektumot `data-lc-*` HTML attribútumokká
 * lapítja a mount node-on.
 */
export interface LcChartSpec {
  readonly kind: LcChartKind;
  readonly seed: number;
  readonly base: number;
  readonly vol: number;
  readonly drift: number;
  readonly count: number;
  readonly markersJson: string | null;
}

/**
 * A `ChartMarker` a lightweight-charts marker plugin formátumának
 * MI-verziója (a state-feed `MARKER` üzenetekből jön). A renderelő
 * ezt közvetlenül a `createSeriesMarkers(...).setMarkers([...])` hívás
 * paramétereként használja.
 *
 * A pozíció `belowBar` (long entry / short exit) vagy `aboveBar`
 * (short entry / long exit). A `barToMarker` segédfüggvény az,
 * ami ezt a leképezést elvégzi a `side` mező alapján.
 */
export interface ChartMarker {
  readonly time: number;
  readonly position: "belowBar" | "aboveBar";
  readonly color: string;
  readonly shape: "arrowUp" | "arrowDown" | "circle" | "square";
  readonly text: string;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Determinisztikus seed egy OHLC sorozathoz.
 *
 * A lc-charts.js mulberry32 PRNG-t használ, ami 32 bites unsigned
 * seed-et vár. A seed az idősor hosszából + az első bar timestampjéből
 * származik (másodpercben) — ez azért jó, mert:
 *   - azonos adatsor → azonos seed → azonos PRNG-sorozat → azonos
 *     "szintetikus" candles (a lc-charts.js seed-ből generálja a
 *     barokat, ha nincs explicit data attribútum)
 *   - különböző hosszúságú vagy kezdő idejű sorozatok → különböző
 *     seed → vizuálisan is megkülönböztethető chart
 *   - a seed Math.imul + >>> 0 miatt mindig 32 bites unsigned,
 *     soha nem NaN vagy negatív
 */
function deriveSeed(bars: readonly OHLCBar[]): number {
  if (bars.length === 0) return 1;
  const first = bars[0];
  const seedSeconds = Math.floor(first.time / 1000);
  // 31 egy prím-szerű szorzó, azonos hosszúságú, de eltérő kezdő
  // idejű sorozatokhoz determinisztikusan különböző seedet ad.
  // A Math.imul 32 bites signed int-re vág, a >>> 0 unsigned-ra.
  return Math.imul(bars.length, 31 + (seedSeconds & 0xff)) >>> 0;
}

/**
 * Per-step volatilitás (USD) a high-low range-ből.
 *
 * A legegyszerűbb értelmes definíció: a maximális high-low spread
 * a sorozatban. Ha minden bar high === low (pl. csak 1 bar vagy
 * üres volume), akkor 0 — ezt a renderelő "no volatility" overlay-ként
 * kezeli.
 */
function deriveVol(bars: readonly OHLCBar[]): number {
  let maxRange = 0;
  for (const bar of bars) {
    const range = bar.high - bar.low;
    if (range > maxRange) maxRange = range;
  }
  return maxRange;
}

/**
 * Per-step drift (USD) — first close → last close irányultság.
 *
 * `(last - first) / (count - 1)`, hogy azonos irányultságú, de
 * eltérő hosszúságú sorozatokra azonos per-step drift jöjjön ki.
 * 1 bar esetén a nevező 0 lenne, ezért `Math.max(1, count - 1)`.
 */
function deriveDrift(bars: readonly OHLCBar[]): number {
  if (bars.length === 0) return 0;
  const first = bars[0];
  const last = bars[bars.length - 1];
  if (bars.length === 1) return 0;
  return (last.close - first.close) / (bars.length - 1);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * `barsToLcChartSpec` — egy OHLC sorozatot LcChartSpec-é alakít.
 *
 * A renderelő a kapott spec minden mezőjét `data-lc-*` HTML
 * attribútummá konvertálja, és átadja a mount node-nak; az
 * eggproject-design `lc-charts.js` (vagy a React useEffect) ebből
 * épít fel egy valódi lightweight-charts instance-t.
 *
 * **Determinizmus:** a seed és a derived mezők (`base`, `vol`,
 * `drift`) kizárólag a `bars` tömb elemeiből származnak, így azonos
 * input → azonos output. Ez fontos a Phase 48D Playwright snapshot
 * tesztekhez.
 *
 * **Null-safety:** üres tömb → `null` (a renderelő "no data" placeholder-t
 * mutat ilyenkor). Soha nem dob kivételt.
 *
 * @param bars    - rendezett OHLC sorozat (a state-feed garantálja a
 *                  időrendet, de itt nem ellenőrizzük — a `mergeBars`
 *                  az, ami erre szolgál több sorozat egyesítésekor).
 * @param options.kind    - default: "candles". A többi érték:
 *                  "area" (terület), "line" (vonal), "sparkline"
 *                  (vékony vonal, kompakt).
 * @param options.markers - opcionális marker lista. Ha van, a JSON
 *                  reprezentáció a `markersJson` mezőbe kerül.
 * @returns LcChartSpec, vagy `null` ha `bars` üres.
 */
export function barsToLcChartSpec(
  bars: readonly OHLCBar[],
  options: { readonly kind?: LcChartKind; readonly markers?: readonly ChartMarker[] } = {},
): LcChartSpec | null {
  if (bars.length === 0) return null;

  const kind: LcChartKind = options.kind ?? "candles";
  const seed = deriveSeed(bars);
  const last = bars[bars.length - 1];
  const base = last.close;
  const vol = deriveVol(bars);
  const drift = deriveDrift(bars);
  const count = bars.length;
  const markersJson = markersToLcChartSpec(options.markers ?? []);

  return {
    kind,
    seed,
    base,
    vol,
    drift,
    count,
    markersJson,
  };
}

/**
 * `markersToLcChartSpec` — marker lista JSON-reprezentációját adja
 * vissza (a LcWrap `data-lc-markers` attribútumához).
 *
 * A JSON string formátum azért kell, mert a `data-lc-markers`
 * attribútum értéke string (a HTML attribútumok mindig azok). Az
 * üres tömb `null`-t ad vissza, így a renderelő egyszerűen kihagyhatja
 * az attribútumot a mount node-ról.
 *
 * A JSON determinisztikus: a `JSON.stringify` billentyűsorrendje a
 * `ChartMarker` interface deklarációs sorrendjét követi, így a
 * Phase 48D snapshot tesztek string-összehasonlítást is tudnak
 * csinálni.
 */
export function markersToLcChartSpec(
  markers: readonly ChartMarker[],
): string | null {
  if (markers.length === 0) return null;
  return JSON.stringify(markers);
}

/**
 * A `barToMarker` "side" paraméterének lehetséges értékei.
 *
 * A state-feed `MARKER` üzenetek két névvel is küldhetik a side-ot:
 *   - "long" / "short" — a strategy kódjából jön (a pozíció nyitás
 *     iránya)
 *   - "buy"  / "sell"  — az exchange feed-ből jön (a kitöltés iránya)
 *
 * A kettő ugyanazt jelenti, csak más domain-ből származik. Az
 * elfogadott 4 érték az interface union type-jában van rögzítve —
 * TypeScript-szel nem lehet mást átadni.
 */
export type BarMarkerSide = "long" | "short" | "buy" | "sell";

/**
 * `barToMarker` — egy MARKER state-feed üzenetet ChartMarker-ré alakít.
 *
 * A `side` alapján választ pozíciót / színt / shape-et:
 *   - "long" / "buy"   → belowBar + arrowUp + "#22c55e" (zöld)
 *   - "short" / "sell" → aboveBar + arrowDown + "#ef4444" (piros)
 *
 * Az exhausztivitást a `switch` default ága (TypeScript `never`)
 * garantálja: ha bővül a `BarMarkerSide` unió, a fordító azonnal
 * szól.
 *
 * A színek megegyeznek a `LcWrap` demo `data-lc-markers` chart-ján
 * használtakkal, így a state-feed markerei vizuálisan konzisztensek
 * a skill saját szintetikus markereivel.
 */
export function barToMarker(
  side: BarMarkerSide,
  // The state-feed `MARKER` message carries a price field; we keep
  // the parameter in the public signature for forward-compat (a
  // future ChartMarker variant may need it for `atPrice*` markers)
  // but the v1 marker shape only needs `time`. The underscore
  // prefix opts the param out of the unused-vars lint rule.
  _price: number,
  time: number,
  label: string,
): ChartMarker {
  switch (side) {
    case "long":
    case "buy":
      return {
        time,
        position: "belowBar",
        color: "#22c55e",
        shape: "arrowUp",
        text: label,
      };
    case "short":
    case "sell":
      return {
        time,
        position: "aboveBar",
        color: "#ef4444",
        shape: "arrowDown",
        text: label,
      };
    default: {
      // Exhaustive check — ha bővül a BarMarkerSide unió, a fordító
      // itt 'never' típust fog látni, és azonnal hibát jelez.
      const _exhaustive: never = side;
      throw new Error(`barToMarker: unknown side ${String(_exhaustive)}`);
    }
  }
}

/**
 * `mergeBars` — több OHLC sorozatot egyesít időrendben.
 *
 * A kimenet `readonly OHLCBar[]`, időrendben növekvő, duplikátum
 * time-oknál az UTOLSÓ (későbbi a forrás-listában) bar nyer.
 *
 * Tipikus használat: a Phase 48B chart grid összefűzi a bootstrap
 * adatokat (200 bar a state-feed `ohlcBootstrap` üzenetből) és a
 * realtime BAR üzenetekből összegyűlt frissítéseket — ez a függvény
 * biztosítja, hogy az eredmény időrendben legyen, és ne legyenek
 * benne duplikátum barok.
 *
 * **Algoritmus:** O(N log N) ahol N az összes bar száma. A
 * kimeneti tömböt `slice()`-el másoljuk, hogy a hívó biztonságosan
 * módosíthassa a saját belső tömbjét anélkül, hogy ez a merge
 * eredményt befolyásolná.
 *
 * @param series - tetszőleges számú OHLC sorozat. Az üres külső
 *                 tömb is megengedett (üres kimenetet ad).
 * @returns idősorrendben rendezett, dedup-olt `OHLCBar[]`.
 */
export function mergeBars(
  series: readonly (readonly OHLCBar[])[],
): readonly OHLCBar[] {
  if (series.length === 0) return [];

  // Flatten + sort by time asc. A rendezés stabil (Array.prototype.sort
  // a V8-ban TimSort), de a mi esetünkben a stabilitás nem számít,
  // mert a dedup ciklus amúgy is "later wins" szabályt alkalmaz.
  const all: OHLCBar[] = [];
  for (const s of series) {
    for (const bar of s) {
      all.push(bar);
    }
  }
  all.sort((a, b) => a.time - b.time);

  // Dedup: végigmegyünk a rendezett tömbön, és minden time-hoz az
  // UTOLSÓ elemet tartjuk meg (mivel a források sorrendje a
  // `series` tömbben van, a későbbi forrás barjai felülírják a
  // korábbiakat — ehhez a rendezés STABIL kellene, de a mi
  // implementációnk egyszerűsít: az azonos time-ú barok közül az
  // utolsó (a tömbben hátrább lévő) nyer, függetlenül a forrástól.
  // Ez megfelel a "newer wins" szemantikának, mert a rendezés
  // után a későbbi forrásból származó bar a tömb végén van.
  if (all.length === 0) return [];

  const out: OHLCBar[] = [];
  let i = 0;
  while (i < all.length) {
    // eslint-disable-next-line security/detect-object-injection -- loop variable, not user input
    const current = all[i];
    // Find the LAST bar with the same time.
    let j = i + 1;
    while (j < all.length) {
      // eslint-disable-next-line security/detect-object-injection -- loop variable, not user input
      const next = all[j];
      if (next.time !== current.time) break;
      j += 1;
    }
    // j is the exclusive end of the run of bars with `current.time`.
    // The last bar in the run is all[j-1].
    out.push(all[j - 1]);
    i = j;
  }
  return out;
}

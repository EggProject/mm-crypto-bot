/**
 * apps/bot/src/state-feed/ohlc-bootstrap.ts
 *
 * ============================================================================
 * PHASE 73 — HISTORICAL OHLCV BOOTSTRAP
 * ============================================================================
 *
 * A `bootstrapOhlcStoreFromCsv` függvény a bot indításakor beolvassa
 * a `data/ohlcv/binance_{symbol}_{timeframe}.csv` fájlokat, és az
 * OhlcStore-ba tölti a historical map-ot. Ez a state-feed SNAPSHOT
 * `ohlcBootstrap` mezőjének a forrása — így a dashboard azonnal a
 * teljes backtest időszakot látja (BTC 2024-01-01 → 2026-07-09 =
 * ~30 hónap), nem csak az utolsó 200 bar-t (ami 1h timeframen 8 nap).
 *
 * ============================================================================
 * FELÉPÍTÉS
 * ============================================================================
 *
 *   - A `bun run ohlcv` parancs (a `packages/backtest-tools/`
 *     `download-ohlcv.ts` scriptje) tölti le a Binance publikus
 *     OHLCV adatait. A fájlok a `data/ohlcv/` mappába kerülnek, és
 *     a `MANIFEST.json` összesíti a metadata-t.
 *   - A CSV formátum: `timestamp,open,high,low,close,volume` — az
 *     első sor a header, a maradék time-ascending bar-ok.
 *   - A `timestamp` UNIX **milliszekundumban** van (a Binance public
 *     API ezt a formátumot adja), az OhlcStore belső reprezentációja
 *     szintén ms.
 *   - A fájlnév konvenció: `binance_{symbol}_{timeframe}.csv`, ahol
 *     `{symbol}` ∈ {`btc`, `eth`, `sol`} (lowercase) és `{timeframe}`
 *     ∈ {`5m`, `15m`, `1h`, `4h`, `1d`}.
 *
 * ============================================================================
 * SZŰRÉS — csak a konfigurált symbol/tf párosok
 * ============================================================================
 *
 *   A bot config `symbols.enabled` listája határozza meg, hogy mely
 *   aktív párokat kell bootstrappelni (alapértelmezetten BTC/USDC,
 *   ETH/USDC, SOL/USDC). A timeframes listája a SNAPSHOT-kompatibilis
 *   halmaz: `["1h", "4h", "1d"]` (a Phase 45B konvenció).
 *
 *   Ha egy (symbol, tf) pároshoz NINCS CSV fájl (pl. a user nem
 *   futtatta a `bun run ohlcv`-t), a bootstrap átugorja — a state-feed
 *   SNAPSHOT üres tömböt küld, és a dashboard "no data" üzenetet
 *   jelez. Ez a korábbi viselkedéssel konzisztens.
 *
 * ============================================================================
 * HIBAKEZELÉS
 * ============================================================================
 *
 *   - A CSV olvasás I/O hibát dobhat — ezt a hívó kapja el
 *     (`start.ts`), és a stderr-re írja a figyelmeztetést.
 *   - A sor parse-olási hiba (rossz formátumú timestamp vagy ár)
 *     WARNING-ot ír, és a sort eldobja — a backtest integritás
 *     fontosabb, mint a részleges adat.
 *   - A `bootstrapHistorical` a `bars` tömböt defensive-copy-val
 *     tárolja, tehát a hívó a későbbiekben szabadon módosíthatja
 *     a forrástömböt.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { type OhlcBarInput, type OhlcStore } from "./ohlc-store.js";

// ============================================================================
// Types
// ============================================================================

/**
 * `BootstrapResult` — a `bootstrapOhlcStoreFromCsv` visszatérési
 * értéke. A `start.ts` a `console.log`-ba írja a státuszt; a tesztek
 * a mezőkön assert-olnak.
 */
export interface BootstrapResult {
  /** A sikeresen betöltött (symbol, tf) párosok száma. */
  readonly loaded: number;
  /** A kihagyott (symbol, tf) párosok száma (hiányzó CSV). */
  readonly skipped: number;
  /** Az összes betöltött bar száma. */
  readonly totalBars: number;
  /**
   * A betöltött (symbol, tf) párosok listája, bar-számmal együtt —
   * a `console.log` és a tesztek is ezt olvassák.
   */
  readonly details: readonly {
    readonly symbol: string;
    readonly timeframe: string;
    readonly bars: number;
    readonly firstTs: number;
    readonly lastTs: number;
  }[];
  /** Az esetleges WARNING-ok listája (parse-hibák, hiányzó mezők). */
  readonly warnings: readonly string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * `FILE_SYMBOL_TO_TRADING_SYMBOL` — a CSV fájlnév-beli kisbetűs
 * ticker (`btc`) és a config / state-feed által használt slashed
 * formátum (`BTC/USDC`) közötti mapping. A Binance-en nincs `BTC/USDC`
 * market (a USDC market alacsony likviditású), ezért a `bun run
 * ohlcv` a `BTC/USDT` párt tölti le, de a bot config és a state-feed
 * a `BTC/USDC` nevet használja (USDC kvázi 1:1 USDT-vel).
 */
const FILE_SYMBOL_TO_TRADING_SYMBOL: Readonly<Record<string, string>> = {
  btc: "BTC/USDC",
  eth: "ETH/USDC",
  sol: "SOL/USDC",
};

/**
 * A SNAPSHOT-ban használt timeframes (a Phase 45B konvenció).
 */
const DEFAULT_TIMEFRAMES: readonly string[] = ["1h", "4h", "1d"];

/**
 * A CSV header — az `bun run ohlcv` ezt a formátumot írja.
 */
const CSV_HEADER = "timestamp,open,high,low,close,volume";

// ============================================================================
// Public API
// ============================================================================

/**
 * `bootstrapOhlcStoreFromCsv(store, options)` — beolvassa a
 * `data/ohlcv/*.csv` fájlokat, és feltölti az `OhlcStore` historical
 * map-ját. A `start.ts` hívja a bot indítása után (amikor a state-feed
 * már csatlakoztatva van, de a `bot.start()` még nem hívódott).
 *
 * A függvény NEM dob kivételt a hiányzó CSV-k esetén — a WARNING-ok
 * a `result.warnings` tömbbe kerülnek, és a bot tovább indul. A
 * részleges bootstrap jobb, mint a crash.
 *
 * @param store     - Az OhlcStore instance, ahova a historical bar-ok
 *                    kerülnek.
 * @param options   - Konfigurációs opciók (lásd lent).
 */
export async function bootstrapOhlcStoreFromCsv(
  store: OhlcStore,
  options: {
    /** A `data/ohlcv/` mappa abszolút vagy relatív útvonala. */
    readonly dataDir: string;
    /** A bootstrappelendő szimbólumok (a config `symbols.enabled`-ből jön). */
    readonly symbols: readonly string[];
    /** A bootstrappelendő timeframes listája. Default: `["1h", "4h", "1d"]`. */
    readonly timeframes?: readonly string[];
  },
): Promise<BootstrapResult> {
  const timeframes = options.timeframes ?? DEFAULT_TIMEFRAMES;
  const dataDir = resolve(options.dataDir);

  const warnings: string[] = [];
  const details: BootstrapResult["details"][number][] = [];
  let loaded = 0;
  let skipped = 0;
  let totalBars = 0;

  // Inverz mapping: BTC/USDC → btc
  const tradingSymbolToFile = new Map<string, string>();
  for (const [fileSym, tradingSym] of Object.entries(FILE_SYMBOL_TO_TRADING_SYMBOL)) {
    tradingSymbolToFile.set(tradingSym, fileSym);
  }

  for (const symbol of options.symbols) {
    const fileSym = tradingSymbolToFile.get(symbol);
    if (fileSym === undefined) {
      warnings.push(`[ohlc-bootstrap] unknown symbol ${symbol} — no CSV mapping`);
      continue;
    }
    for (const tf of timeframes) {
      const filename = `binance_${fileSym}_${tf}.csv`;
      const filepath = join(dataDir, filename);
      try {
        // Először `stat`, hogy ne olvassunk nem létező fájlt (az
        // `ENOENT` warning-ot egy `readFile` is adná, de a `stat`
        // kevésbé zajos).
        await stat(filepath);
      } catch {
        warnings.push(`[ohlc-bootstrap] missing ${filename} — skipping`);
        skipped += 1;
        continue;
      }
      let bars: OhlcBarInput[];
      try {
        bars = await readOhlcvCsv(filepath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`[ohlc-bootstrap] failed to read ${filename}: ${msg}`);
        skipped += 1;
        continue;
      }
      if (bars.length === 0) {
        warnings.push(`[ohlc-bootstrap] ${filename} is empty — skipping`);
        skipped += 1;
        continue;
      }
      store.bootstrapHistorical(symbol, tf, bars);
      loaded += 1;
      totalBars += bars.length;
      const first = bars[0]!;
      const last = bars[bars.length - 1]!;
      details.push({
        symbol,
        timeframe: tf,
        bars: bars.length,
        firstTs: first.time,
        lastTs: last.time,
      });
    }
  }

  return { loaded, skipped, totalBars, details, warnings };
}

// ============================================================================
// Internal: CSV parsing
// ============================================================================

/**
 * `readOhlcvCsv(filepath)` — beolvas és parse-ol egy
 * `binance_{sym}_{tf}.csv` fájlt. A CSV formátum:
 *
 *   ```
 *   timestamp,open,high,low,close,volume
 *   1704067200000,42283.58,42554.57,42261.02,42475.23,1271.68108
 *   ...
 *   ```
 *
 * A `timestamp` UNIX **milliszekundumban** van. A parse-olás
 * defensív: a hibás sorok WARNING-ot adnak, és kimaradnak (a
 * backtest integritás fontosabb, mint a részleges adat).
 *
 * @throws Ha a fájl nem olvasható, vagy a header nem egyezik.
 */
export async function readOhlcvCsv(
  filepath: string,
): Promise<OhlcBarInput[]> {
  const text = await readFile(filepath, "utf8");
  const lines = text.split("\n");
  if (lines.length === 0) {
    throw new Error(`empty file: ${filepath}`);
  }
  // Az első sor a header. A trailing newline miatt az utolsó sor
  // lehet üres — `filter`-rel szűrjük.
  const headerLine = lines[0];
  if (headerLine !== CSV_HEADER) {
    throw new Error(
      `unexpected CSV header in ${filepath}: expected "${CSV_HEADER}", got "${headerLine ?? ""}"`,
    );
  }
  const bars: OhlcBarInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (line.length === 0) continue; // trailing newline
    const cols = line.split(",");
    if (cols.length !== 6) {
      // WARNING — a parse-olás kihagyja ezt a sort, de a
      // bootstrap folytatódik. A start.ts-ban a `result.warnings`
      // tartalmazza.
      continue;
    }
    const tsRaw = cols[0];
    const oRaw = cols[1];
    const hRaw = cols[2];
    const lRaw = cols[3];
    const cRaw = cols[4];
    const vRaw = cols[5];
    if (tsRaw === undefined || oRaw === undefined || hRaw === undefined ||
        lRaw === undefined || cRaw === undefined || vRaw === undefined) {
      continue;
    }
    const time = Number(tsRaw);
    const open = Number(oRaw);
    const high = Number(hRaw);
    const low = Number(lRaw);
    const close = Number(cRaw);
    const volume = Number(vRaw);
    if (
      !Number.isFinite(time) || time <= 0 ||
      !Number.isFinite(open) || open <= 0 ||
      !Number.isFinite(high) || high <= 0 ||
      !Number.isFinite(low) || low <= 0 ||
      !Number.isFinite(close) || close <= 0 ||
      !Number.isFinite(volume) || volume < 0
    ) {
      continue;
    }
    bars.push({ time, open, high, low, close, volume });
  }
  return bars;
}

/**
 * `listAvailableOhlcvFiles(dataDir)` — a `data/ohlcv/` mappa
 * `binance_*.csv` fájljainak listája. A `start.ts` NEM hívja — a
 * tesztek és a `bun run ohlcv --dry-run` flag használhatja. A
 * `bootstrapOhlcStoreFromCsv` maga kezeli a missing-fájl esetét.
 */
export async function listAvailableOhlcvFiles(
  dataDir: string,
): Promise<readonly string[]> {
  try {
    const entries = await readdir(dataDir);
    return entries
      .filter((name) => name.startsWith("binance_") && name.endsWith(".csv"))
      .sort();
  } catch {
    return [];
  }
}

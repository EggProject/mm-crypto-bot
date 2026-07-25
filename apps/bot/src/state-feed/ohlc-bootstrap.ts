/**
 * apps/bot/src/state-feed/ohlc-bootstrap.ts
 *
 * ============================================================================
 * PHASE 73 — OHLCV BOOTSTRAP FROM CSV
 * PHASE 74 — propagation fix: bootstrap → OhlcStore.historical → getAll() →
 *             SNAPSHOT message → ws-relay → http-server cache → /api/ohlc
 *             → web app `barsByKey` (30-month chart history, 85638 bars).
 * ============================================================================
 *
 * A bot indításakor betölti a `data/ohlcv/binance_{symbol}_{tf}.csv`
 * fájlokat az `OhlcStore`-ba. A CSV formátum:
 *
 *   timestamp,open,high,low,close,volume
 *   1704067200000,42283.58,42554.57,42261.02,42475.23,1271.68108
 *   ...
 *
 * A `timestamp` mező UNIX milliszekundumban van (a CSV header-ből jön).
 *
 * A fájlnevek a binance historical adatok letöltő script konvencióját
 * követik (lásd `packages/backtest-tools` `binance-csv` modul). A
 * symbol mapping a fájlnévből jön (pl. `binance_btc_1h.csv` →
 * `BTC/USDC` timeframe `1h`).
 */

import { open } from "node:fs/promises";
import { join } from "node:path";
import type { OhlcStore, OhlcBarInput } from "./ohlc-store.js";

// ============================================================================
// Types
// ============================================================================

/** A bootstrap-olandó (symbol, tf) pár. */
export interface OhlcBootstrapKey {
  readonly symbol: string;
  readonly timeframe: string;
}

/** A bootstrap opciói. */
export interface OhlcBootstrapOptions {
  /** A `data/ohlcv/` mappa elérési útja. Default: `<repo-root>/data/ohlcv/`. */
  readonly dataDir?: string;
  /** A bootstrapolandó kulcsok. Ha undefined, akkor a default
   *  (BTC, ETH, SOL) × (1h, 4h, 1d) konfigurációt használja. */
  readonly keys?: readonly OhlcBootstrapKey[];
}

/** A bootstrap futás eredménye (logging-hoz + teszthez). */
export interface OhlcBootstrapResult {
  /** Hány kulcshoz talált CSV-t és töltötte be. */
  readonly loaded: number;
  /** Hány kulcshoz NEM talált CSV-t (skip). */
  readonly skipped: number;
  /** Az összes betöltött bar szám. */
  readonly totalBars: number;
  /** A betöltött kulcsok listája (symbol, tf, barCount). */
  readonly details: readonly {
    readonly symbol: string;
    readonly timeframe: string;
    readonly file: string;
    readonly bars: number;
  }[];
}

// ============================================================================
// Defaults
// ============================================================================

/** A default symbol mapping. A binance CSV nevek a fájlnévben kisbetűsek. */
const DEFAULT_KEYS: readonly OhlcBootstrapKey[] = [
  { symbol: "BTC/USDC", timeframe: "1h" },
  { symbol: "BTC/USDC", timeframe: "4h" },
  { symbol: "BTC/USDC", timeframe: "1d" },
  { symbol: "ETH/USDC", timeframe: "1h" },
  { symbol: "ETH/USDC", timeframe: "4h" },
  { symbol: "ETH/USDC", timeframe: "1d" },
  { symbol: "SOL/USDC", timeframe: "1h" },
  { symbol: "SOL/USDC", timeframe: "4h" },
  { symbol: "SOL/USDC", timeframe: "1d" },
];

/** A symbol részből a fájlnév-rész. BTC/USDC → "btc". */
function symbolSlug(symbol: string): string {
  // A "/USDC" suffix levágása (paper mode USDC pair-eket használ).
  const idx = symbol.indexOf("/");
  return idx > 0 ? symbol.slice(0, idx).toLowerCase() : symbol.toLowerCase();
}

/** A fájlnév a `(symbol, tf)` kulcshoz. */
function fileNameFor(symbol: string, timeframe: string): string {
  return `binance_${symbolSlug(symbol)}_${timeframe}.csv`;
}

/** A `data/ohlcv/` mappa alapértelmezett útvonala (a repo root-hoz képest). */
function defaultDataDir(): string {
  // Az `apps/bot/src/state-feed/ohlc-bootstrap.ts` fájlból a repo root
  // 4 szinttel feljebb van: state-feed/ → src/ → bot/ → apps/ → <root>.
  // A `data/ohlcv/` a repo root-ban van.
  //
  // Biztonságosabb megoldás: a cwd-t használjuk, mert a bot mindig a
  // repo root-ból indul (a `package.json` `start` scriptje). Ha más
  // mappából indulna, a caller a `dataDir` opcióval felülírhatja.
  return join(process.cwd(), "data", "ohlcv");
}

// ============================================================================
// CSV parser
// ============================================================================

/**
 * `parseOhlcvCsv` — egy CSV sort parsol. A formátum:
 *   `timestamp,open,high,low,close,volume`
 *
 * A `timestamp` UNIX milliszekundumban van. A számok `Number()`-ra
 * konvertálódnak. Hibás sort `null`-lal jelez (a caller kihagyja).
 */
function parseOhlcvCsvLine(line: string): OhlcBarInput | null {
  const parts = line.split(",");
  if (parts.length < 6) return null;
  const time = Number(parts[0]);
  const open = Number(parts[1]);
  const high = Number(parts[2]);
  const low = Number(parts[3]);
  const close = Number(parts[4]);
  const volume = Number(parts[5]);
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    !Number.isFinite(volume)
  ) {
    return null;
  }
  return { time, open, high, low, close, volume };
}

/**
 * `readOhlcvCsv` — beolvas egy CSV fájlt és visszaadja a bar-okat.
 *
 * A header sort (első sor, `timestamp,open,...`) kihagyja. Az üres
 * sorokat és a hibás sorokat átugorja.
 */
async function readOhlcvCsv(filePath: string): Promise<OhlcBarInput[]> {
  const fh = await open(filePath, "r");
  try {
    const content = await fh.readFile("utf-8");
    const lines = content.split("\n");
    const out: OhlcBarInput[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (i === 0 && trimmed.startsWith("timestamp")) continue;
      const bar = parseOhlcvCsvLine(trimmed);
      if (bar === null) continue;
      out.push(bar);
    }
    return out;
  } finally {
    await fh.close();
  }
}

// ============================================================================
// Bootstrap
// ============================================================================

/**
 * `bootstrapOhlcStore` — a `data/ohlcv/` mappából betölti a historikus
 * OHLCV bar-okat az `OhlcStore`-ba (a `bootstrapHistorical()` metódussal).
 *
 * A függvény NEM dob, ha egy CSV hiányzik — csak a `skipped` counter-t
 * növeli. A `totalBars` és a `details` a logging-hoz + a tesztekhez
 * kell (a unit teszt assert-eli a betöltött bar-számot).
 */
export async function bootstrapOhlcStore(
  store: OhlcStore,
  options: OhlcBootstrapOptions = {},
): Promise<OhlcBootstrapResult> {
  const dataDir = options.dataDir ?? defaultDataDir();
  const keys = options.keys ?? DEFAULT_KEYS;

  let loaded = 0;
  let skipped = 0;
  let totalBars = 0;
  const details: { symbol: string; timeframe: string; file: string; bars: number }[] = [];

  for (const key of keys) {
    const fileName = fileNameFor(key.symbol, key.timeframe);
    const filePath = join(dataDir, fileName);
    let bars: OhlcBarInput[];
    try {
      bars = await readOhlcvCsv(filePath);
    } catch {
      // A fájl nem található vagy nem olvasható — kihagyjuk.
      skipped += 1;
      continue;
    }
    if (bars.length === 0) {
      skipped += 1;
      continue;
    }
    store.bootstrapHistorical(key.symbol, key.timeframe, bars);
    loaded += 1;
    totalBars += bars.length;
    details.push({ symbol: key.symbol, timeframe: key.timeframe, file: filePath, bars: bars.length });
  }

  return { loaded, skipped, totalBars, details };
}

// packages/tui/src/utils/format.ts — formázó segédletek
//
// A TUI-ban megjelenített számok (árak, PnL, százalékok) magyar
// nyelvű formázást igényelnek: ezres elválasztó szóközzel,
// tizedesvesszővel, és a mértékegység (USDT, %) utótagként.
// Ezek a függvények egységesítik a megjelenítést.

/**
 `formatUsdt` — USDT összeg formázása 2 tizedesjeggyel.
 Negatív szám esetén a `-` előjelet a szám elé tesszük.
*/
export function formatUsdt(value: number, decimals = 2): string {
  const fixed = value.toFixed(decimals);
  const [intPart, decPart] = fixed.split(".");
  const safeInt = intPart ?? "0";
  const safeDec = decPart ?? "00";
  // Magyar formátum: ezres szóköz, tizedes vessző.
  // A regex biztonságos: nincs backtracking-veszély, a `\B` + `(?=(\d{3})+...)`
  // minta lineáris idejű, mivel a bemenet hossza korlátos (max ~20 karakter).
  // eslint-disable-next-line security/detect-unsafe-regex -- thousand-separator regex, lineáris, biztonságos
  const grouped = safeInt.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${value < 0 ? "-" : ""}${grouped},${safeDec}`;
}

/**
 `formatPct` — százalék formázása 2 tizedesjeggyel.
 Az előjel a szám előtt jelenik meg (`+12,34%` / `-3,45%`).
*/
export function formatPct(value: number, decimals = 2): string {
  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  return `${sign}${formatUsdt(value, decimals)}%`;
}

/**
 `formatPrice` — ár formázása a szimbólumtól függő tizedesjeggyel.
 A BTC/USDT 0 tizedesjegy, az ETH 2, a SOL 2 (a bybit.eu tick size).
*/
export function formatPrice(symbol: string, value: number): string {
  if (symbol.startsWith("BTC")) return formatUsdt(value, 0);
  if (symbol.startsWith("ETH")) return formatUsdt(value, 2);
  if (symbol.startsWith("SOL")) return formatUsdt(value, 2);
  return formatUsdt(value, 2);
}

/**
 `formatDuration` — időtartam formázása `HH:MM:SS` formátumban.
 A pozíció nyitva-tartási idejének megjelenítéséhez használjuk.
*/
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/**
 `formatTimestamp` — UNIX timestamp átalakítása `HH:MM:SS` formátumba.
*/
export function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/**
 `colorForValue` — a PnL-értékhez tartozó ANSI színkód.
 Pozitív = zöld, negatív = piros, nulla = semleges.
 Az Ink `<Text color="...">` prop-jához használjuk.
*/
export function colorForValue(value: number): "green" | "red" | "gray" {
  if (value > 0) return "green";
  if (value < 0) return "red";
  return "gray";
}

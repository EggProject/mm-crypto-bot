// packages/tui/src/hooks/useTerminalSize.ts — terminal méret hook
//
// Phase 41: a TUI responsive 2x2 / 2x1 / 1x4 grid layout-jának
// alapja. A hook visszaadja a terminál szélességét és magasságát,
// ÉS egy `LayoutMode` enum-ot, ami az adott szélességhez tartozó
// optimális grid-elrendezést jelzi.
//
// A hook az Ink `useWindowSize` hook-ját wrapping-eli (ami a
// terminál resize-ra re-renderel). A fallback a `process.stdout`
// mérete, ha az Ink hook 0-t ad (pl. unit test környezetben, ahol
// nincs valódi stdout) — ilyenkor a `useState` + `useEffect` egy
// saját resize listener-t állít fel.
//
// A `LayoutMode` breakpointok:
//   - cols >= 120 → "2x2"   (2 oszlop, 2 sor) — wide terminal
//   - 80 <= cols < 120 → "2x1"  (2 oszlop, 1 sor) — medium
//   - cols < 80  → "1x4"  (1 oszlop, 4 sor) — narrow fallback
//
// A töréspontok a Phase 41 spec-ből jönnek (az user a 170 széles
// iTerm2-n panaszkodott a stacked layout-ra, a 80 colos fallback
// a TUI minimum-elfogadható szélessége).
//
// A hook TISZTA: nincs külső side-effect (a resize listener cleanup
// a useEffect return-jében van), a `useSyncExternalStore` mintát
// az Ink `useWindowSize` belsőleg kezeli.
//
// A `readStdoutSize` helper a process.stdout columns/rows olvasását
// + a default fallback-et külön függvénybe szervezi — így a resize
// handler body unit tesztekkel 100%-ban lefedhető, anélkül, hogy
// a React render-ciklusát kellene szimulálnunk.

import { useEffect, useState } from "react";
import { useWindowSize } from "ink";

/**
 * `LayoutMode` — a responsive grid elrendezés módja.
 *
 * - `"2x2"`: 2 oszlop × 2 sor (széles terminál, ≥120 col)
 * - `"2x1"`: 2 oszlop × 1 sor (közepes, 80-119 col)
 * - `"1x4"`: 1 oszlop × 4 sor (keskeny, <80 col fallback)
 */
export type LayoutMode = "2x2" | "2x1" | "1x4";

/**
 * `BREAKPOINTS` — a layout módok töréspontjai (oszlop-szám).
 *
 * A `>= WIDE_THRESHOLD` → 2x2, a `>= MEDIUM_THRESHOLD` → 2x1,
 * egyébként 1x4. A default értékek a Phase 41 spec-ből jönnek.
 */
export const BREAKPOINTS = {
  WIDE_THRESHOLD: 120,
  MEDIUM_THRESHOLD: 80,
  DEFAULT_COLUMNS: 80,
  DEFAULT_ROWS: 24,
} as const;

/**
 * `TerminalSize` — a terminál mérete + az aktuális layout mód.
 */
export interface TerminalSize {
  readonly columns: number;
  readonly rows: number;
  readonly layoutMode: LayoutMode;
}

/**
 * `resolveLayoutMode` — tiszta függvény, ami az oszlopszámból
 * meghatározza a layout módot. A hook ÉS a tesztek is ezt hívják
 * (a hook csak becsomagolja).
 *
 * A függvény a `BREAKPOINTS` konstansokkal dolgozik, így a
 * töréspontok központi helyen vannak definiálva.
 */
export function resolveLayoutMode(columns: number): LayoutMode {
  if (columns >= BREAKPOINTS.WIDE_THRESHOLD) {
    return "2x2";
  }
  if (columns >= BREAKPOINTS.MEDIUM_THRESHOLD) {
    return "2x1";
  }
  return "1x4";
}

/**
 * `resolveTerminalSize` — tiszta függvény, ami a hook belső
 * state-éből visszaadja a `TerminalSize`-t.
 *
 * A függvény `columns: 0` esetén is a DEFAULT_COLUMNS-szal
 * tér vissza (a 0 a "nincs adat" jele — a tesztekben hasznos,
 * mert az ink-testing library nem ad vissza valódi stdout-ot).
 */
export function resolveTerminalSize(
  columns: number,
  rows: number,
): TerminalSize {
  const safeColumns = columns > 0 ? columns : BREAKPOINTS.DEFAULT_COLUMNS;
  const safeRows = rows > 0 ? rows : BREAKPOINTS.DEFAULT_ROWS;
  return {
    columns: safeColumns,
    rows: safeRows,
    layoutMode: resolveLayoutMode(safeColumns),
  };
}

/**
 * `readStdoutSize` — tiszta helper, ami a `process.stdout`
 * columns/rows értékéből olvas. A `useEffect` resize handler
 * hívja, ÉS a hook fallback state-jének kezdeti értéke is
 * ebből dolgozik.
 *
 * A helper a `?? BREAKPOINTS.DEFAULT_*` fallback-et alkalmazza,
 * így ha a process.stdout columns/rows undefined (pl. unit tesztben
 * ahol nincs TTY), a default értékeket adja vissza.
 *
 * A Phase 41 tesztelhetőség kedvéért külön függvénybe szedtük —
 * a resize handler body-ját így 100%-ban le tudjuk fedni unit
 * tesztekkel, anélkül, hogy a React render-ciklusát kellene
 * szimulálnunk.
 */
export function readStdoutSize(): { columns: number; rows: number } {
  // A process.stdout.columns / rows típusa a Node types-ban `number`,
  // DE futásidőben lehet undefined is (pl. unit teszt, vagy amikor
  // a process stdout-ja nem TTY). Az `||` használata az ESLint
  // szabályaival kompatibilis — a `??` feleslegesnek tűnik a típus
  // szempontjából, de a fallback-et futásidőben alkalmazni kell.
  const columns: number = process.stdout.columns || BREAKPOINTS.DEFAULT_COLUMNS;
  const rows: number = process.stdout.rows || BREAKPOINTS.DEFAULT_ROWS;
  return { columns, rows };
}

/**
 * `createResizeHandler` — a `useTerminalSize` hook belső
 * resize handler-jének factory függvénye.
 *
 * A hook a useEffect body-jában hívja, és a visszatérési
 * értéket adja át a `process.stdout.on("resize", ...)`-nak.
 *
 * A factory pattern azért kell, mert a handler a React
 * `setFallback` setter-t hívja — a setter a hook-on belül
 * van definiálva, ÉS a handler-t a useEffect body-jában
 * hozzuk létre. A factory egy closure-t ad vissza, ami a
 * setter-t bezárja.
 *
 * A Phase 41 tesztelhetőség kedvéért a factory-t külön
 * függvénybe szerveztük — így a handler body (a `setFallback`
 * hívás) 100%-ban lefedhető, anélkül, hogy a useEffect-et
 * vagy a React render-ciklust kellene szimulálnunk.
 *
 * A `setSize` típusa React.Dispatch<React.SetStateAction<...>> —
 * a hook a useState setterét adja át.
 */
export function createResizeHandler(
  setSize: (size: { columns: number; rows: number }) => void,
): () => void {
  return (): void => {
    setSize(readStdoutSize());
  };
}

/**
 * `useTerminalSize` — React hook, ami a terminál méretét +
 * a layout módot adja vissza.
 *
 * Az Ink `useWindowSize` hook-ját használja elsődlegesen, ami a
 * `resize` event-re re-renderel. Ha a hook 0 columns/rows értéket
 * ad vissza (pl. unit teszt, ahol nincs valódi stdout), a hook
 * a `process.stdout.columns` / `process.stderr.columns` fallback-ből
 * dolgozik, és a `process.stdout.on("resize")` event listener-t
 * állít fel.
 *
 * A hook a `TerminalSize` típussal tér vissza — a consumer
 * (az `App` komponens) a `layoutMode` alapján dönti el,
 * hogy 2x2 / 2x1 / 1x4 grid-et renderel-e.
 */
export function useTerminalSize(): TerminalSize {
  // Az Ink `useWindowSize` hookja — ha van valódi stdout
  // (Ink renderelés alatt), ez adja a columns/rows értékeit,
  // és re-renderel resize eseményre.
  const windowSize = useWindowSize();

  // A fallback state: a `process.stdout.columns` / `rows` értékéből
  // indulunk ki (ez a unit tesztekben hasznos, ahol az Ink hook
  // 0-t ad vissza).
  const [fallback, setFallback] = useState<{ columns: number; rows: number }>(
    () => readStdoutSize(),
  );

  useEffect(() => {
    // Ha a process.stdout egy TTY (valódi terminál), a resize
    // event-re frissítjük a fallback state-et. Unit tesztekben
    // általában nincs TTY, ilyenkor a listener nem aktív.
    const handleResize = createResizeHandler(setFallback);
    if (process.stdout.isTTY) {
      process.stdout.on("resize", handleResize);
      return (): void => {
        process.stdout.off("resize", handleResize);
      };
    }
    return undefined;
  }, []);

  // A hook eredménye: ha az Ink `useWindowSize` érvényes
  // (columns > 0) értéket ad, azt használjuk; egyébként a
  // fallback-ből dolgozunk.
  const columns = windowSize.columns > 0
    ? windowSize.columns
    : fallback.columns;
  const rows = windowSize.rows > 0 ? windowSize.rows : fallback.rows;

  return resolveTerminalSize(columns, rows);
}

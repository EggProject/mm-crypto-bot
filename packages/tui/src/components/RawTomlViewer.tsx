/**
 * packages/tui/src/components/RawTomlViewer.tsx
 *
 * Phase 36 Track C2 — a nyers `mm-bot.toml` viewer (`suspendTerminal`).
 *
 * ===========================================================================
 * MI EZ?
 * ===========================================================================
 * A settings panel-ből a user a `[v]` billentyűvel megnyithatja a
 * nyers `mm-bot.toml` fájlt a saját `$EDITOR`-ában (vagy a `less` /
 * `$PAGER`-ben, ha nincs editor). A nézet a Phase 36 Track A2
 * során bevezetett Ink 7 `useApp().suspendTerminal` API-t használja
 * — a TUI terminál állapotát elmenti, a child process-t elindítja,
 * majd a child kilépésekor visszaállítja a TUI-t.
 *
 * A nézet:
 *   1. Meghívja a `suspendTerminal`-t, ami release-eli a terminált.
 *   2. A callback-ben spawn-olja a child process-t (`$PAGER` ||
 *      `$EDITOR` || `less`).
 *   3. A child kilépésekor a `suspendTerminal` callback visszatér,
 *   4. a TUI re-renderelődik (az Ink újra felveszi a terminált).
 *
 * A komponens a `useApp().suspendTerminal` API-t használja — ez
 * NEM tesztelhető unit-tesztben (a TUI raw mode a teszt környezetben
 * nem elérhető). A teszt a `suspendTerminal` callback-jének
 * meghívását ellenőrzi egy spy-on keresztül.
 *
 * ===========================================================================
 */

import { Text } from "ink";
import type { ReactElement } from "react";
import { spawn } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";

import { stringifyToml } from "../hooks/useConfigStore.js";

/**
 * `SuspendFn` — a `useApp().suspendTerminal` callback-jének típusa.
 * Exportálva van, hogy a tesztek (és a `runRawTomlViewer` helper)
 * mockolhassák anélkül, hogy a teljes Ink `useApp` API-t importálnák.
 */
export type SuspendFn = (cb: () => Promise<void>) => Promise<void>;

/**
 * `runRawTomlViewer` — a nyers TOML viewer indítási logikája,
 * kiemelve a React komponensből a tesztelhetőség kedvéért.
 *
 * A függvény:
 *   1. Kiírja a `data`-t a `configPath` mellé tmp fájlba.
 *   2. Meghívja a `suspendTerminal`-t a `spawnViewer(tmpPath)`-szel.
 *   3. A nézet bezáródásakor törli a tmp fájlt.
 *   4. Opcionálisan meghívja az `onClose` callback-et.
 *
 * A `suspendFn` injektálható — a React komponens a `useApp()`-ból
 * adja át, a tesztek közvetlenül átadnak egy fake függvényt.
 */
export async function runRawTomlViewer(
  data: Readonly<Record<string, unknown>>,
  configPath: string,
  suspendFn: SuspendFn,
  onClose?: () => void,
): Promise<void> {
  const tmpPath = `${configPath}.viewer.tmp`;
  await writeFile(tmpPath, stringifyToml(data), "utf8");
  try {
    try {
      await suspendFn(async () => {
        await spawnViewer(tmpPath);
      });
    } finally {
      // A tmp fájl cleanup — a nézet bezáródásakor (sikeres vagy hibás
      // esetben is) töröljük. A hibát lenyeljük (a tmp fájl opcionális).
      try {
        await unlink(tmpPath);
      } catch {
        void 0;
      }
    }
  } finally {
    // Az `onClose` a külső try/finally-ban van, hogy MINDIG
    // hívódjon — akár sikeres a nézet, akár a `suspendFn` hibát
    // dob. A React komponens az `onClose` hívásakor unmountolja
    // a RawTomlViewer-t, így a loading state nem ragad be.
    if (onClose !== undefined) {
      onClose();
    }
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * `RawTomlViewerProps` — a `RawTomlViewer` komponens propjai.
 */
export interface RawTomlViewerProps {
  /**
   * `data` — a settings panel-ről kapott in-memory config (TOML
   * szerializálás előtt). A komponens ezt sorosítja és írja ki
   * egy tmp fájlba, amit a `$PAGER` megnyit.
   */
  readonly data: Readonly<Record<string, unknown>>;
  /**
   * `configPath` — az eredeti `mm-bot.toml` útvonal. Ha a user a
   * `$PAGER`-ben a fájlt szerkeszti, a módosítások nem kerülnek
   * vissza a TUI-ba — ez csak egy READ-ONLY viewer.
   */
  readonly configPath: string;
  /**
   * `suspendTerminal` — a `useApp().suspendTerminal` függvénye.
   * A SettingsPanel a `useApp()` hookból adja át, hogy a
   * komponens maga ne legyen hook-függő (tesztelhetőség).
   */
  readonly suspendTerminal: SuspendFn;
  /**
   * `onClose` — opcionális callback, ami a nézet bezárásakor hívódik.
   * A SettingsPanel a `suspendTerminal` kilépése után hívja.
   */
  readonly onClose?: () => void;
}

// ============================================================================
// Spawn helper
// ============================================================================

/**
 * `spawnViewer` — a child process indítása a `$PAGER` / `$EDITOR` /
 * `less` alapján.
 *
 * A függvény visszatér, amikor a child process kilép. A child
 * átveszi a terminált (a `suspendTerminal` már release-elte), és
 * a `stdio: "inherit"` biztosítja, hogy a child közvetlenül a
 * user terminálját használja.
 *
 * A függvény a Phase 36 Track C2 tesztelhetősége kedvéért
 * EXPORTÁLVA van — a unit-teszt a `spawnViewer` signature-ját
 * mockolja, és a `suspendTerminal` callback-jében hívja.
 */
export function spawnViewer(configPath: string): Promise<void> {
  return new Promise<void>((resolve) => {
    // A viewer sorrend:
    //   1. `$PAGER` (ha be van állítva)
    //   2. `$EDITOR` (ha be van állítva)
    //   3. `less` (default Linux/Mac)
    //   4. `cat` (fallback — kiírja a fájlt, nem interaktív)
    const viewer =
      process.env["PAGER"] ??
      process.env["EDITOR"] ??
      "less";

    const child = spawn(viewer, [configPath], {
      stdio: "inherit",
      // A `detached: true` biztosítja, hogy a child a parent-től
      // függetlenül fusson (a TUI exit ne ölje meg a viewert).
      detached: false,
    });

    child.on("exit", () => {
      resolve();
    });
    child.on("error", () => {
      // Ha a spawn viewer nem elérhető (pl. `less` nincs telepítve),
      // a fallback `cat` kiírja a fájlt — a `cat` biztosan elérhető
      // minden POSIX rendszeren.
      const fallback = spawn("cat", [configPath], { stdio: "inherit" });
      fallback.on("exit", () => {
        resolve();
      });
    });
  });
}

// ============================================================================
// Main component
// ============================================================================

/**
 * `RawTomlViewer` — a `suspendTerminal`-alapú nyers TOML viewer.
 *
 * A komponens mount-oláskor azonnal megnyitja a viewert
 * (`useEffect`-ben). A user a child process-ben nézi a fájlt,
 * majd a child kilépésekor a TUI visszanyeri a vezérlést.
 *
 * A komponens nem renderel UI-t — a nézet a child process-ben
 * történik. A komponens egy "loading" állapotot mutat, amíg a
 * child fut.
 */
export function RawTomlViewer({
  data,
  configPath,
  suspendTerminal,
  onClose,
}: RawTomlViewerProps): ReactElement {
  // A `suspendTerminal` prop-ból jön (a SettingsPanel a useApp()
  // hookból adja át) — így a komponens maga nem hív useApp-ot,
  // és a mount-teszt nem igényel Ink `<App>` wrapper-t.
  // A tényleges indítás a `runRawTomlViewer` helper-ben történik
  // (tesztelhető, lásd a `RawTomlViewer.runRawTomlViewer` describe).
  handleRawTomlViewerLaunch(data, configPath, suspendTerminal, onClose);
  return renderRawTomlViewerLoading(onClose);
}

/**
 * `handleRawTomlViewerLaunch` — a `RawTomlViewer` mount-kor
 * hívandó indító helper. Kiemelve, hogy a tesztek a React
 * komponens mountolása nélkül is ellenőrizhessék az indítási
 * logikát (a `runRawTomlViewer` describe blokk).
 */
function handleRawTomlViewerLaunch(
  data: Readonly<Record<string, unknown>>,
  configPath: string,
  suspendTerminal: SuspendFn,
  onClose: (() => void) | undefined,
): void {
  void runRawTomlViewer(data, configPath, suspendTerminal, onClose);
}

/**
 * `renderRawTomlViewerLoading` — a `RawTomlViewer` render
 * metódusa. Kiemelve, hogy a `RawTomlViewerLoading` JSX-e
 * közvetlenül tesztelhető legyen.
 */
function renderRawTomlViewerLoading(
  onClose: (() => void) | undefined,
): ReactElement {
  return (
    <>
      <RawTomlViewerLoading
        {...(onClose !== undefined ? { onClose } : {})}
      />
    </>
  );
}

/**
 * `RawTomlViewerLoading` — a nézet "loading" állapota (amíg a
 * child process fut). A SettingsPanel ezt mountolja, és a
 * nézet bezáródásakor a SettingsPanel `onClose`-t hív.
 */
function RawTomlViewerLoading({
  onClose,
}: {
  readonly onClose?: () => void;
}): ReactElement {
  // Az "onClose" itt a SettingsPanel visszahívását jelenti.
  // A tényleges nézet a `suspendTerminal` callback-en belül fut.
  void onClose;
  return (
    <>
      <Text>Opening raw TOML viewer...</Text>
    </>
  );
}

// Re-export a `suspendTerminal` API típusát a fogyasztók számára.
export type { SuspendTerminal, TerminalSuspension } from "ink";

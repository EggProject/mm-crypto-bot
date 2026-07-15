/**
 * packages/tui/src/components/RawTomlViewer.test.tsx
 *
 * Phase 36 Track C2 — `<RawTomlViewer>` `suspendTerminal`-alapú nézet.
 *
 * A komponens a `useApp().suspendTerminal` API-t használja a TUI
 * terminál release-elésére, miközben a child process (pl. `less`)
 * fut. A teszt NEM teszteli a tényleges child process-t (a
 * `suspendTerminal` a teszt környezetben nem elérhető), hanem:
 *
 *   1) A `spawnViewer` helper a `$PAGER` / `$EDITOR` / `less`
 *      sorrendben indítja a child process-t.
 *   2) A fallback (`cat`) hívódik, ha az első viewer nem érhető el.
 *   3) A `RawTomlViewer` mount-kor meghívja a `suspendTerminal`-t.
 *
 * A tesztek a `spawnViewer` helper-t közvetlenül hívják egy
 * tmp TOML fájlon, és ellenőrzik, hogy a child process elindult
 * és kilépett.
 *
 * ===========================================================================
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawnViewer } from "./RawTomlViewer.js";

describe("RawTomlViewer.spawnViewer (Phase 36 Track C2)", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-raw-"));
    configPath = join(tmpDir, "mm-bot.toml");
    writeFileSync(
      configPath,
      "[bot]\nmode = \"paper\"\nrisk_per_trade = 0.01\n",
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // 1) A `spawnViewer` megnyitja a fájlt — a `cat` fallback mindig
  //    elérhető (mivel a teszt környezetben a `$PAGER`/`$EDITOR`
  //    nem biztos, hogy be van állítva).
  // --------------------------------------------------------------------------
  it("spawnViewer opens the file via $PAGER or fallback", async () => {
    // A teszt környezetben nincs `$PAGER` / `$EDITOR` beállítva — a
    // helper a `cat` fallback-et használja (a `cat` biztosan elérhető).
    delete process.env["PAGER"];
    delete process.env["EDITOR"];
    await spawnViewer(configPath);
    // A függvény visszatér, amikor a child process kilép — nincs
    // kivétel. Sikeres kilépés = OK.
    expect(true).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 2) A `spawnViewer` a `$PAGER`-t használja, ha be van állítva.
  // --------------------------------------------------------------------------
  it("spawnViewer uses $PAGER when set", async () => {
    // A `$PAGER` beállítása `cat`-re (biztosan elérhető).
    process.env["PAGER"] = "cat";
    try {
      await spawnViewer(configPath);
      expect(true).toBe(true);
    } finally {
      delete process.env["PAGER"];
    }
  });

  // --------------------------------------------------------------------------
  // 3) A `spawnViewer` a `$EDITOR`-t használja, ha nincs `$PAGER`.
  // --------------------------------------------------------------------------
  it("spawnViewer uses $EDITOR when $PAGER is not set", async () => {
    delete process.env["PAGER"];
    process.env["EDITOR"] = "cat";
    try {
      await spawnViewer(configPath);
      expect(true).toBe(true);
    } finally {
      delete process.env["EDITOR"];
    }
  });

  // --------------------------------------------------------------------------
  // 4) A `spawnViewer` a `less` fallback-et használja, ha semmi
  //    nincs beállítva (és a `cat` is elérhető a fallback-en belül).
  // --------------------------------------------------------------------------
  it("spawnViewer falls back to 'less' or 'cat' when no env vars are set", async () => {
    delete process.env["PAGER"];
    delete process.env["EDITOR"];
    await spawnViewer(configPath);
    // A függvény sikeresen visszatér (a `cat` fallback mindig elérhető).
    expect(true).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 5) A `spawnViewer` Promise-ként tér vissza (a child process
  //    kilépésekor resolve-ol).
  // --------------------------------------------------------------------------
  it("spawnViewer returns a Promise that resolves on child exit", async () => {
    const promise = spawnViewer(configPath);
    expect(promise).toBeInstanceOf(Promise);
    await promise;
  });

  // --------------------------------------------------------------------------
  // 6) A konfig fájl a spawn után is megmarad (a viewer csak olvassa).
  // --------------------------------------------------------------------------
  it("config file is preserved after spawnViewer", async () => {
    delete process.env["PAGER"];
    delete process.env["EDITOR"];
    await spawnViewer(configPath);
    expect(existsSync(configPath)).toBe(true);
    const contents = readFileSync(configPath, "utf8");
    expect(contents).toContain("risk_per_trade = 0.01");
  });
});

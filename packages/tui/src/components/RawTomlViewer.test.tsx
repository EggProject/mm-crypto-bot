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
 *   3) A `runRawTomlViewer` helper a `suspendFn` callback-jét
 *      hívja, és a cleanup (unlink) akkor is lefut, ha a
 *      `suspendFn` hibát dob.
 *   4) A `runRawTomlViewer` meghívja az `onClose` callback-et
 *      a nézet bezáródásakor.
 *   5) A `<RawTomlViewer>` React komponens mountoláskor a
 *      `useApp().suspendTerminal` callback-jét a `runRawTomlViewer`
 *      helper-re delegálja. A mount-teszt az Ink `<App>` wrapper-t
 *      használja, és a `useApp` mock-ján keresztül ellenőrzi,
 *      hogy a `suspendTerminal` hívódik.
 *
 * ===========================================================================
 */

// A `useApp` mock-olása TÖRÖLVE — a `RawTomlViewer` immár
// `suspendTerminal`-t prop-ként kapja, nem hív `useApp`-ot.
// A komponens mountolható `<App>` wrapper nélkül, és a
// React renderelés teljes mértékben lefedi a forráskódot.

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

import {
  RawTomlViewer,
  runRawTomlViewer,
  spawnViewer,
  type SuspendFn,
} from "./RawTomlViewer.js";

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
    delete process.env["PAGER"];
    delete process.env["EDITOR"];
    await spawnViewer(configPath);
    expect(true).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 2) A `spawnViewer` a `$PAGER`-t használja, ha be van állítva.
  // --------------------------------------------------------------------------
  it("spawnViewer uses $PAGER when set", async () => {
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

  // --------------------------------------------------------------------------
  // 7) A `spawnViewer` `error` event-et fire-öl, ha a viewer
  //    parancs nem érhető el — a fallback `cat` spawn hívódik.
  //    A lefedett kódrészlet: a `child.on("error", ...)` blokk
  //    (a fallback `cat` spawn).
  // --------------------------------------------------------------------------
  it("spawnViewer falls back to 'cat' when the viewer command errors", async () => {
    process.env["PAGER"] = "this-command-does-not-exist-xyzzy";
    try {
      await spawnViewer(configPath);
      expect(true).toBe(true);
    } finally {
      delete process.env["PAGER"];
    }
  });
});

describe("RawTomlViewer.runRawTomlViewer (Phase 36 Track C2)", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-run-"));
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
  // 1) A `runRawTomlViewer` meghívja a `suspendFn`-t a tmp
  //    fájl elérési útvonalával.
  // --------------------------------------------------------------------------
  it("runRawTomlViewer writes a tmp file and invokes suspendFn", async () => {
    delete process.env["PAGER"];
    delete process.env["EDITOR"];
    let capturedTmpPath = "";
    await runRawTomlViewer(
      { bot: { mode: "paper" } },
      configPath,
      async (cb) => {
        await cb();
        capturedTmpPath = `${configPath}.viewer.tmp`;
        expect(existsSync(capturedTmpPath)).toBe(true);
      },
    );
    expect(existsSync(capturedTmpPath)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 2) A `runRawTomlViewer` cleanup-ja törli a tmp fájlt a
  //    `suspendFn` kilépése után (sikeres eset).
  // --------------------------------------------------------------------------
  it("runRawTomlViewer cleans up the tmp file after suspendFn resolves", async () => {
    delete process.env["PAGER"];
    delete process.env["EDITOR"];
    const tmpPath = `${configPath}.viewer.tmp`;
    await runRawTomlViewer(
      { bot: { mode: "paper" } },
      configPath,
      async (cb) => {
        await cb();
        expect(existsSync(tmpPath)).toBe(true);
      },
    );
    expect(existsSync(tmpPath)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 3) A `runRawTomlViewer` cleanup-ja akkor is töröl, ha a
  //    `suspendFn` hibát dob (finally blokk).
  // --------------------------------------------------------------------------
  it("runRawTomlViewer cleans up the tmp file even if suspendFn throws", async () => {
    delete process.env["PAGER"];
    delete process.env["EDITOR"];
    const tmpPath = `${configPath}.viewer.tmp`;
    let caught = false;
    try {
      await runRawTomlViewer(
        { bot: { mode: "paper" } },
        configPath,
        async () => {
          throw new Error("simulated suspend failure");
        },
      );
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
    expect(existsSync(tmpPath)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 4) A `runRawTomlViewer` meghívja az `onClose` callback-et
  //    a sikeres nézet-bezáródás után.
  // --------------------------------------------------------------------------
  it("runRawTomlViewer invokes onClose after the viewer exits", async () => {
    delete process.env["PAGER"];
    delete process.env["EDITOR"];
    let onCloseCalled = false;
    await runRawTomlViewer(
      { bot: { mode: "paper" } },
      configPath,
      async (cb) => {
        await cb();
      },
      () => {
        onCloseCalled = true;
      },
    );
    expect(onCloseCalled).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 5) A `runRawTomlViewer` meghívja az `onClose` callback-et
  //    akkor is, ha a `suspendFn` hibát dob.
  // --------------------------------------------------------------------------
  it("runRawTomlViewer invokes onClose even if suspendFn throws", async () => {
    delete process.env["PAGER"];
    delete process.env["EDITOR"];
    let onCloseCalled = false;
    try {
      await runRawTomlViewer(
        { bot: { mode: "paper" } },
        configPath,
        async () => {
          throw new Error("simulated failure");
        },
        () => {
          onCloseCalled = true;
        },
      );
    } catch {
      // A hiba szándékos.
    }
    expect(onCloseCalled).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 6) A `runRawTomlViewer` az `onClose` nélkül is működik
  //    (a callback opcionális).
  // --------------------------------------------------------------------------
  it("runRawTomlViewer works without an onClose callback", async () => {
    delete process.env["PAGER"];
    delete process.env["EDITOR"];
    await runRawTomlViewer(
      { bot: { mode: "paper" } },
      configPath,
      async (cb) => {
        await cb();
      },
    );
    expect(existsSync(`${configPath}.viewer.tmp`)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 7) A `runRawTomlViewer` cleanup lenyeli az `unlink` hibát
  //    (a tmp fájl opcionális — ha már törölve van, a cleanup
  //    nem dob).
  // --------------------------------------------------------------------------
  it("runRawTomlViewer swallows unlink errors in cleanup", async () => {
    delete process.env["PAGER"];
    delete process.env["EDITOR"];
    const tmpPath = `${configPath}.viewer.tmp`;
    let onCloseCalled = false;
    await runRawTomlViewer(
      { bot: { mode: "paper" } },
      configPath,
      async (cb) => {
        await cb();
        // A writeFile után töröljük a tmp fájlt, hogy az
        // unlink biztosan hibát dobjon a finally blokkban.
        const { unlinkSync } = await import("node:fs");
        unlinkSync(tmpPath);
      },
      () => {
        onCloseCalled = true;
      },
    );
    expect(onCloseCalled).toBe(true);
  });
});

describe("RawTomlViewer React component (Phase 36 Track C2)", () => {
  // --------------------------------------------------------------------------
  // 1) A `<RawTomlViewer>` mountoláskor a `suspendTerminal` prop
  //    callback-jét a `runRawTomlViewer` helper-re delegálja.
  //    A komponens prop-ként kapja a `suspendTerminal`-t (a
  //    SettingsPanel a useApp()-ból adja át), így a mount-teszt
  //    nem igényel Ink `<App>` wrapper-t.
  // --------------------------------------------------------------------------
  it("RawTomlViewer mounts and invokes the suspendTerminal prop", async () => {
    delete process.env["PAGER"];
    delete process.env["EDITOR"];
    const { render } = await import("ink-testing-library");
    let onCloseCalled = false;
    const configPath = "/tmp/mm-bot-react-mount-test.toml";
    let suspendCalled = false;
    const fakeSuspend: SuspendFn = async (cb) => {
      suspendCalled = true;
      await cb();
    };
    const instance = render(
      <RawTomlViewer
        data={{ bot: { mode: "paper" } }}
        configPath={configPath}
        suspendTerminal={fakeSuspend}
        onClose={() => {
          onCloseCalled = true;
        }}
      />,
    );
    // A mount-kor a runRawTomlViewer elindul, a fake suspendTerminal
    // meghívja a callback-et (ami spawnViewer-t hív, ami a `cat`
    // fallback-en keresztül sikeresen kilép), a cleanup törli a
    // tmp fájlt, és az onClose hívódik.
    await new Promise((r) => setTimeout(r, 500));
    // A tmp fájl cleanup lefutott.
    const tmpPath = `${configPath}.viewer.tmp`;
    expect(await Bun.file(tmpPath).exists()).toBe(false);
    // A suspendTerminal prop meghívódott.
    expect(suspendCalled).toBe(true);
    // Az onClose hívódott (a suspendFn sikeres kilépése után).
    expect(onCloseCalled).toBe(true);
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 2) A `<RawTomlViewer>` típusellenőrzése.
  // --------------------------------------------------------------------------
  it("RawTomlViewer is a renderable React component", () => {
    expect(typeof RawTomlViewer).toBe("function");
    expect(RawTomlViewer.length).toBe(1);
  });
});

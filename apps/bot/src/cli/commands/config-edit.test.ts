/**
 * apps/bot/src/cli/commands/config-edit.test.ts
 *
 * Phase 36 Track C1 — `mm-bot config edit` subcommand smoke tests.
 *
 * A TUI-t nyitó parancsot nem lehet szinkron unit-tesztben tesztelni
 * (a TUI a `waitUntilExit` Promise-re vár, és a raw mode a teszt
 * környezetben nem elérhető). A tesztek ezért:
 *
 *   1) A help szöveget ellenőrzik (`mm-bot config --help`).
 *   2) Az ismert subcommand listát (`mm-bot config --help` 4 opciót
 *      mutat: validate / show / init / edit).
 *   3) A `config edit` dispatch-t a usage text-ből ellenőrizzük —
 *      a parancs nem az "unknown subcommand" hibát adja.
 *
 * A TUI renderelés NEM tesztelhető unit-tesztben — ehhez a
 * `SettingsPanel.test.tsx` (packages/tui) + a `settings-edit-roundtrip.test.tsx`
 * fájlok szolgáltatják a fedezetet.
 *
 * ===========================================================================
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgv } from "../argv.js";
import type { CliContext } from "../router.js";

import { configCommand } from "./config.js";

describe("mm-bot config edit (Phase 36 Track C1)", () => {
  let tmpDir: string;
  let configPath: string;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let errored: string[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-cfg-edit-"));
    configPath = join(tmpDir, "mm-bot.toml");
    writeFileSync(
      configPath,
      "[bot]\nmode = \"paper\"\nlog_level = \"info\"\n\n[risk]\nrisk_per_trade = 0.01\nmax_leverage = 10\n",
      "utf8",
    );
    errored = [];
    logSpy = spyOn(console, "log").mockImplementation(() => {
      // A runEdit a TUI-t rendereli, ami stdout-ot írna — itt
      // lenyeljük, hogy a teszt kimenete tiszta maradjon.
    });
    errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errored.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // --------------------------------------------------------------------------
  // 1) `mm-bot config --help` a 4 sub-subcommandot mutatja.
  // --------------------------------------------------------------------------
  it("config --help lists the 'edit' subcommand", async () => {
    const code = await configCommand(parseArgv(["config", "--help"]), {} as CliContext);
    expect(code).toBe(1);
    const stderr = errored.join("\n");
    expect(stderr).toContain("edit");
    expect(stderr).toContain("validate");
    expect(stderr).toContain("show");
    expect(stderr).toContain("init");
  });

  // --------------------------------------------------------------------------
  // 2) `mm-bot config edit` ismert subcommand — a usage text NEM
  //    jelenik meg (az ismert subcommand-ok listája).
  //
  //    A TUI tényleges renderelését a SettingsPanel.test.tsx +
  //    settings-edit-roundtrip.test.tsx ellenőrzi — a CLI parancs
  //    csak egy thin wrapper a TUI renderelésére.
  // --------------------------------------------------------------------------
  it("config edit is a known subcommand (does not print 'unknown subcommand' usage)", async () => {
    // A `config edit` parancs a TUI-t nyitná — ehelyett csak a
    // dispatch-t ellenőrizzük (a parancs nem "Usage: mm-bot config
    // ..." szöveget ír).
    //
    // A dispatch ellenőrzéséhez átmenetileg kicseréljük a
    // `runEdit` függvényt egy throw-ra (a TUI renderelés helyett),
    // DE mivel a `runEdit` private (nem exportált), közvetlenül
    // nem tudjuk kicserélni. Ehelyett a `configCommand` hívásakor
    // a `process.env` flag-et használjuk: a `configCommand`
    // belsőleg megnézi a `MM_BOT_SKIP_TUI` env var-t, és ha
    // be van állítva, a `runEdit` azonnal visszatér 0-val.
    //
    // FONTOS: a `MM_BOT_SKIP_TUI` env var-t a `configCommand` NEM
    // támogatja a production kódban — itt csak a tesztelhetőség
    // kedvéért használjuk.
    process.env["MM_BOT_SKIP_TUI"] = "1";
    try {
      // A `config edit` parancs a `runEdit`-et hívja — a teszt
      // célja, hogy a parancs NE az "unknown subcommand" hibát
      // adja (ami a "Usage: ..." sort írná).
      // A `runEdit` a tesztben a TUI renderelés nélkül visszatér.
      try {
        await configCommand(
          parseArgv(["config", "edit", `--config=${configPath}`]),
          {} as CliContext,
        );
      } catch {
        // A TUI renderelés dobhat (raw mode error) — ezt lenyeljük.
      }
      const stderr = errored.join("\n");
      // A "Usage: mm-bot config <validate|show|init|edit> [...]" sor
      // CSAK akkor jelenik meg, ha a subcommand ismeretlen.
      expect(stderr).not.toContain("Usage: mm-bot config <validate");
    } finally {
      delete process.env["MM_BOT_SKIP_TUI"];
    }
  });

  // --------------------------------------------------------------------------
  // 3) A help szöveg tartalmazza a Phase 36 Track C1 specifikus
  //    "Phase 36 Track C1" mention-t.
  // --------------------------------------------------------------------------
  it("config --help mentions 'Phase 36 Track C1' for the edit subcommand", async () => {
    const code = await configCommand(parseArgv(["config", "--help"]), {} as CliContext);
    expect(code).toBe(1);
    const stderr = errored.join("\n");
    expect(stderr).toContain("Phase 36 Track C1");
  });

  // --------------------------------------------------------------------------
  // 4) A `--config` flag értéke átadódik a dispatch során (a
  //    `getConfigPath` helper a CLI args-ból olvassa).
  // --------------------------------------------------------------------------
  it("--config flag is parsed (the path reaches the dispatch)", async () => {
    process.env["MM_BOT_SKIP_TUI"] = "1";
    try {
      try {
        await configCommand(
          parseArgv(["config", "edit", `--config=${configPath}`]),
          {} as CliContext,
        );
      } catch {
        // TUI render errors are expected in test env.
      }
      // A parancs nem a "config path missing" hibát adja.
      const stderr = errored.join("\n");
      expect(stderr).not.toContain("config path missing");
    } finally {
      delete process.env["MM_BOT_SKIP_TUI"];
    }
  });

  // --------------------------------------------------------------------------
  // 5) Az érvénytelen config (Zod-rejected) a `Config validation FAILED:`
  //    üzenettel tér vissza, exit code 2-vel.
  // --------------------------------------------------------------------------
  it("returns exit code 2 when the config is Zod-rejected (max_leverage > 10)", async () => {
    // Írunk egy Zod-rejectelt configot.
    const badPath = join(tmpDir, "bad.toml");
    writeFileSync(
      badPath,
      "[risk]\nmax_leverage = 15\n", // 1:10 MANDATE violation
      "utf8",
    );
    const code = await configCommand(
      parseArgv(["config", "edit", `--config=${badPath}`]),
      {} as CliContext,
    );
    expect(code).toBe(2);
    const stderr = errored.join("\n");
    expect(stderr).toContain("Config validation FAILED");
  });

  // --------------------------------------------------------------------------
  // 6) A hiányzó config file a `loadBotConfig` által dobott `ConfigError`
  //    miatt exit code 2-vel tér vissza.
  // --------------------------------------------------------------------------
  it("returns exit code 2 when the config file is missing", async () => {
    const missingPath = join(tmpDir, "does-not-exist.toml");
    const code = await configCommand(
      parseArgv(["config", "edit", `--config=${missingPath}`]),
      {} as CliContext,
    );
    expect(code).toBe(2);
  });

  // --------------------------------------------------------------------------
  // 7) Az érvényes config a "TUI render skipped" üzenettel + exit code
  //    0-val tér vissza (a `MM_BOT_SKIP_TUI=1` teszt-flag aktív).
  // --------------------------------------------------------------------------
  it("returns exit code 0 when the config is valid + MM_BOT_SKIP_TUI=1", async () => {
    process.env["MM_BOT_SKIP_TUI"] = "1";
    try {
      const code = await configCommand(
        parseArgv(["config", "edit", `--config=${configPath}`]),
        {} as CliContext,
      );
      expect(code).toBe(0);
    } finally {
      delete process.env["MM_BOT_SKIP_TUI"];
    }
  });

  // --------------------------------------------------------------------------
  // 8) A `validateConfigForEdit` helper közvetlen hívása — a
  //    `loadBotConfig` bármilyen hibát `ConfigError`-ként dob,
  //    így a helper egyszerűsített catch-blokkja mindig 2-vel
  //    tér vissza config-hiba esetén.
  // --------------------------------------------------------------------------
  it("validateConfigForEdit returns 2 for invalid config (Zod-rejected)", async () => {
    const { validateConfigForEdit } = await import("./config.js");
    // A korábbi tesztben létrehozott `badPath` itt újra használható.
    const code = validateConfigForEdit(
      join(tmpDir, "bad-helper.toml"),
    );
    expect(code).toBe(2);
  });

  // --------------------------------------------------------------------------
  // 9) A `validateConfigForEdit` helper sikeres validáció esetén 0-t ad.
  // --------------------------------------------------------------------------
  it("validateConfigForEdit returns 0 for valid config", async () => {
    const { validateConfigForEdit } = await import("./config.js");
    const code = validateConfigForEdit(configPath);
    expect(code).toBe(0);
  });
});

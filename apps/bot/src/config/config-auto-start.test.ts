/**
 * apps/bot/src/config/config-auto-start.test.ts
 *
 * ===========================================================================
 * PHASE 36 TRACK A1 — `bot.auto_start` config field tests
 * ===========================================================================
 *
 * User mandate (2026-07-14 20:58 Budapest):
 *   "`mm-bot start` ne induljon automatikusan — a TUI `stopped` állapotban
 *    nyíljon, a user a `[s]` billentyűvel indítsa a botot."
 *
 * Research doc: `docs/audits/phase36-research-findings.md` §5 (Angle E).
 *
 * A `bot.auto_start` mező a `BotConfigSchema.bot` objektumba kerül,
 * default `false` (a user kérésére: NEM induljon automatikusan).
 * A `true` érték op-in: a bot a TUI indulásával egyidőben indul.
 * A CLI `--auto-start` / `--no-auto-start` flag-ek ezt a flag-et
 * futásidőben felülírják.
 *
 * Ez a teszt file PONTOSAN a `bot.auto_start` mező viselkedését
 * fedi le:
 *   1. Default érték: `false` (a régi viselkedéshez képest fordított
 *      default — a Phase 36 user-mandate szellemében).
 *   2. TOML-ből `auto_start = true` felülírja a default-ot.
 *   3. TOML-ből `auto_start = false` explicit is megadható.
 *   4. `bot.auto_start` boolean típusú — `auto_start = "yes"` elutasítva.
 *   5. `bot.auto_start` a `bot` szekció része, nem top-level.
 *   6. A `BotConfigSchema.parse({})` a default `false` értéket adja.
 *
 * A flag-ek kölcsönhatását (CLI `--auto-start` vs. config `auto_start`)
 * a `apps/bot/src/cli/commands/start.ts` integration teszt fedi le
 * (a Track A1 PR másik commit-jában).
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BotConfigSchema } from "./schema.js";
import { loadBotConfig } from "./loader.js";

describe("BotConfigSchema — bot.auto_start (Phase 36 Track A1)", () => {
  // --------------------------------------------------------------------------
  // 1) Default: `bot.auto_start === false` (a régi viselkedés fordítottja)
  // --------------------------------------------------------------------------
  it("default config has bot.auto_start === false (no auto-start)", () => {
    const config = BotConfigSchema.parse({});
    expect(config.bot.auto_start).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 2) loadBotConfig() no path → default `auto_start === false`
  // --------------------------------------------------------------------------
  it("loadBotConfig() without path yields bot.auto_start === false", () => {
    const config = loadBotConfig();
    expect(config.bot.auto_start).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 3) TOML `auto_start = true` felülírja a default-ot
  // --------------------------------------------------------------------------
  it("TOML auto_start = true overrides default", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-autostart-"));
    const path = join(dir, "autostart-on.toml");
    writeFileSync(path, "[bot]\nauto_start = true\n", "utf8");
    try {
      const config = loadBotConfig(path);
      expect(config.bot.auto_start).toBe(true);
      // A többi bot-section default nem változik
      expect(config.bot.mode).toBe("paper");
      expect(config.bot.log_level).toBe("info");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 4) TOML `auto_start = false` explicit is megadható (a default megegyezik,
  //    de a user a TOML-ben láthatja, mit kap)
  // --------------------------------------------------------------------------
  it("TOML auto_start = false (explicit default) is preserved", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-autostart-"));
    const path = join(dir, "autostart-off.toml");
    writeFileSync(path, "[bot]\nmode = \"live\"\nauto_start = false\n", "utf8");
    try {
      const config = loadBotConfig(path);
      expect(config.bot.auto_start).toBe(false);
      expect(config.bot.mode).toBe("live");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 5) `auto_start` boolean típusú — `auto_start = "yes"` elutasítva
  // --------------------------------------------------------------------------
  it("REJECTS bot.auto_start = 'yes' (boolean expected, got string)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-autostart-"));
    const path = join(dir, "autostart-string.toml");
    writeFileSync(path, "[bot]\nauto_start = \"yes\"\n", "utf8");
    try {
      expect(() => loadBotConfig(path)).toThrow(/auto_start/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 6) Az `auto_start` mező a `bot` szekció része, NEM top-level
  // --------------------------------------------------------------------------
  it("auto_start is a sub-field of bot, not top-level", () => {
    // Top-level `auto_start = true` a passthrough-on átment, de a
    // `bot.auto_start` továbbra is a default `false` marad.
    const parsed = BotConfigSchema.parse({ auto_start: true });
    expect(parsed.bot.auto_start).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 7) A `bot.auto_start` mező megjelenik a `BotConfig` típusban
  // --------------------------------------------------------------------------
  it("the inferred BotConfig type has bot.auto_start: boolean", () => {
    // TypeScript type-check: ez a teszt a fordítási időben garantálja,
    // hogy a `BotConfig` típusban van `auto_start: boolean`. Ha a
    // séma eltávolítja a mezőt, ez a teszt NEM fordul le.
    const config = loadBotConfig();
    const value: boolean = config.bot.auto_start;
    expect(typeof value).toBe("boolean");
  });

  // --------------------------------------------------------------------------
  // 8) A `bot.auto_start` mező megőrződik a deep-merge során
  // --------------------------------------------------------------------------
  it("auto_start is preserved through deep-merge with other bot fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-autostart-"));
    const path = join(dir, "deep-merge.toml");
    writeFileSync(
      path,
      `
[bot]
mode = "live"
log_level = "debug"
state_file = "data/prod.json"
auto_start = true
`,
      "utf8",
    );
    try {
      const config = loadBotConfig(path);
      expect(config.bot.mode).toBe("live");
      expect(config.bot.log_level).toBe("debug");
      expect(config.bot.state_file).toBe("data/prod.json");
      expect(config.bot.auto_start).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

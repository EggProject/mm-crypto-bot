/**
 * apps/bot/src/config/config-auto-start.test.ts
 *
 * ===========================================================================
 * PHASE 36 TRACK A1 + PHASE 81 — `bot.auto_start` config field tests
 * ===========================================================================
 *
 * Phase 36 user mandate (2026-07-14 20:58 Budapest):
 *   "`mm-bot start` ne induljon automatikusan — a TUI `stopped` állapotban
 *    nyíljon, a user a `[s]` billentyűvel indítsa a botot."
 *
 * Research doc: `docs/audits/phase36-research-findings.md` §5 (Angle E).
 *
 * Phase 81 user mandate (2026-07-25 Budapest):
 *   "a paper-backtest-verified.toml-mal indított bot ne induljon
 *    automatikusan — a user a dashboard 'Start' gombbal indítsa."
 *
 * A `bot.auto_start` mező a `BotConfigSchema.bot` objektumba kerül.
 *
 * PHASE 81: a default `false`-ról `true`-ra változott (BACKWARD COMPAT).
 *   - A Phase 36-ban a default `false` volt (TUI-ban a user a `[s]`
 *     billentyűvel indított). A Phase 44-gyel a TUI törölve lett
 *     (`PURE HEADLESS start`), és a bot MINDIG indult a `mm-bot start`
 *     parancsra — függetlenül a config-tól. A Phase 81 a konfiguráció-
 *     vezérelt viselkedést hozza vissza, DE a backward compatibility
 *     kedvéért a default `true` marad — azaz a meglévő config-ok
 *     (amelyek nem definiálják a flag-et) TOVÁBBRA IS auto-startolnak.
 *   - A `paper-backtest-verified.toml` explicit `auto_start = false`-t
 *     állít be; a `live-eu.toml` explicit `auto_start = true`-t
 *     (ami egyenértékű a hiányzó mezővel).
 *   - A CLI `--auto-start` / `--no-auto-start` flag-ek ezt a flag-et
 *     futásidőben felülírják.
 *
 * Ez a teszt file a `bot.auto_start` mező viselkedését fedi le:
 *   1. Default érték: `true` (Phase 81 — backward compat).
 *   2. TOML-ből `auto_start = false` felülírja a default-ot.
 *   3. TOML-ből `auto_start = true` explicit is megadható.
 *   4. `bot.auto_start` boolean típusú — `auto_start = "yes"` elutasítva.
 *   5. `bot.auto_start` a `bot` szekció része, nem top-level.
 *
 * A flag-ek kölcsönhatását (CLI `--auto-start` vs. config `auto_start`)
 * a `apps/bot/src/__tests__/phase81-auto-start-honored.test.ts` integration
 * teszt fedi le.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BotConfigSchema } from "./schema.js";
import { loadBotConfig } from "./loader.js";

describe("BotConfigSchema — bot.auto_start (Phase 36 Track A1 + Phase 81)", () => {
  // --------------------------------------------------------------------------
  // 1) Default: `bot.auto_start === true` (Phase 81 — backward compat)
  // --------------------------------------------------------------------------
  it("default config has bot.auto_start === true (backward compat)", () => {
    const config = BotConfigSchema.parse({});
    expect(config.bot.auto_start).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 2) loadBotConfig() no path → default `auto_start === true`
  // --------------------------------------------------------------------------
  it("loadBotConfig() without path yields bot.auto_start === true", () => {
    const config = loadBotConfig();
    expect(config.bot.auto_start).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 3) TOML `auto_start = false` felülírja a default-ot (Phase 81 use case)
  // --------------------------------------------------------------------------
  it("TOML auto_start = false overrides default (paper-backtest-verified use case)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-autostart-"));
    const path = join(dir, "autostart-off.toml");
    writeFileSync(path, "[bot]\nauto_start = false\n", "utf8");
    try {
      const config = loadBotConfig(path);
      expect(config.bot.auto_start).toBe(false);
      // A többi bot-section default nem változik
      expect(config.bot.mode).toBe("paper");
      expect(config.bot.log_level).toBe("info");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 4) TOML `auto_start = true` explicit is megadható (live-eu use case)
  // --------------------------------------------------------------------------
  it("TOML auto_start = true (explicit default) is preserved", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-autostart-"));
    const path = join(dir, "autostart-on.toml");
    writeFileSync(path, "[bot]\nmode = \"live\"\nauto_start = true\n", "utf8");
    try {
      const config = loadBotConfig(path);
      expect(config.bot.auto_start).toBe(true);
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
    // Top-level `auto_start = false` a passthrough-on átment, de a
    // `bot.auto_start` a saját default-ját követi (Phase 81: `true`).
    const parsed = BotConfigSchema.parse({ auto_start: false });
    expect(parsed.bot.auto_start).toBe(true);
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
auto_start = false
`,
      "utf8",
    );
    try {
      const config = loadBotConfig(path);
      expect(config.bot.mode).toBe("live");
      expect(config.bot.log_level).toBe("debug");
      expect(config.bot.state_file).toBe("data/prod.json");
      expect(config.bot.auto_start).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

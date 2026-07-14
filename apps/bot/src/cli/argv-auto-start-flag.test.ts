/**
 * apps/bot/src/cli/argv-auto-start-flag.test.ts
 *
 * ===========================================================================
 * PHASE 36 TRACK A1 — `--auto-start` / `--no-auto-start` flag tesztek
 * ===========================================================================
 *
 * User mandate (2026-07-14 20:58 Budapest, issue #1):
 *   "`mm-bot start` ne induljon automatikusan — a TUI `stopped` állapotban
 *    nyíljon, a user a `[s]` billentyűvel indítsa a botot."
 *
 * A flag-eket a meglévő `parseArgv` kezeli:
 *   - `--auto-start`         → `flags.get("auto-start") === true`        (boolean, pozitív)
 *   - `--no-auto-start`      → `flags.get("auto-start") === false`       (boolean, negatív — meglévő parser)
 *                            → `flags.get("no-auto-start") === true`     (explicit-jel, Phase 36)
 *
 * A kettő együtt adja a "last wins" kölcsönhatás lehetőségét. A
 * tényleges ütközés-feloldás a `start` parancsban történik (lásd
 * `apps/bot/src/cli/commands/start.ts`), nem itt.
 *
 * Ez a teszt file CSAK a parser szintű viselkedést fedi le. A
 * "last wins + WARN to stderr" logikát a start.ts integration
 * tesztje (Track A1 PR második commitja) ellenőrzi.
 */

import { describe, expect, it } from "bun:test";

import { parseArgv } from "./argv.js";

describe("parseArgv — --auto-start / --no-auto-start (Phase 36 Track A1)", () => {
  // --------------------------------------------------------------------------
  // 1) `--auto-start` → `flags.get("auto-start") === true`
  // --------------------------------------------------------------------------
  it("--auto-start sets flags.get('auto-start') === true", () => {
    const result = parseArgv(["start", "--auto-start"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.get("auto-start")).toBe(true);
    // A `--no-auto-start` kulcs NEM jelenik meg, ha a user csak a pozitívot írta.
    expect(result.flags.has("no-auto-start")).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 2) `--no-auto-start` → `flags.get("no-auto-start") === true` (Phase 36)
  //    + a flag értéke `false` (a meglévő --no-X szabály miatt)
  // --------------------------------------------------------------------------
  it("--no-auto-start sets BOTH 'auto-start: false' AND 'no-auto-start: true'", () => {
    const result = parseArgv(["start", "--no-auto-start"]);
    expect(result.subcommand).toBe("start");
    // A meglévő --no-X szabály: a pozitív flag értéke `false`.
    expect(result.flags.get("auto-start")).toBe(false);
    // A Phase 36 kiegészítés: a "no-auto-start" önálló flag is bejön.
    expect(result.flags.get("no-auto-start")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 3) `--auto-start=value` — explicit értékkel is használható (backward-compat)
  // --------------------------------------------------------------------------
  it("--auto-start=true is a valid explicit form", () => {
    const result = parseArgv(["start", "--auto-start=true"]);
    expect(result.flags.get("auto-start")).toBe("true");
  });

  it("--auto-start=false is a valid explicit form", () => {
    const result = parseArgv(["start", "--auto-start=false"]);
    expect(result.flags.get("auto-start")).toBe("false");
  });

  // --------------------------------------------------------------------------
  // 4) A flag-ek kombinálhatók más flag-ekkel
  // --------------------------------------------------------------------------
  it("--auto-start combines with other flags", () => {
    const result = parseArgv(["start", "--config=./prod.toml", "--auto-start", "--no-color"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.get("config")).toBe("./prod.toml");
    expect(result.flags.get("auto-start")).toBe(true);
    expect(result.flags.get("no-color")).toBe(true);
    expect(result.flags.get("color")).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 5) A flag-ek a subcommand ELŐTT is megadhatók. Viszont a parser
  //    `--flag value` konvenciója miatt, ha a subcommand a flag UTÁN
  //    jön, a subcommand lesz a flag értéke (key-value). A helyes
  //    használat: a subcommand az első nem-flag token, a flag-ek
  //    UTÁNA jönnek (pl. `mm-bot start --auto-start`).
  // --------------------------------------------------------------------------
  it("--auto-start before the subcommand consumes the subcommand as the value (parser key-value convention)", () => {
    // A parser a `--auto-start start` formát `auto-start: "start"`-ként
    // értelmezi (a "start" a flag értéke, nem a subcommand). Ez a
    // meglévő konvenció, nem a Phase 36 újdonsága.
    const result = parseArgv(["--auto-start", "start"]);
    expect(result.flags.get("auto-start")).toBe("start");
    expect(result.subcommand).toBe("");
  });

  // --------------------------------------------------------------------------
  // 6) A flag-ek KÖLCSÖNÖS kizárása — a parser mindkettőt bejegyzi,
  //    a start.ts felelős az "last wins + WARN" logikáért.
  //
  //    A parser szintjén: ha mindkét flag megjelenik, a későbbi
  //    (last-write-wins) értékadás érvényesül a `Map` setter-én át.
  //    A `flags.get("auto-start")` az utolsó értéket adja vissza.
  // --------------------------------------------------------------------------
  it("--auto-start followed by --no-auto-start: last wins (auto-start=false)", () => {
    const result = parseArgv(["start", "--auto-start", "--no-auto-start"]);
    // A `--no-auto-start` felülírja a korábbi `--auto-start` értéket.
    expect(result.flags.get("auto-start")).toBe(false);
    // A "no-auto-start" önálló flag is megjelenik.
    expect(result.flags.get("no-auto-start")).toBe(true);
  });

  it("--no-auto-start followed by --auto-start: last wins (auto-start=true)", () => {
    const result = parseArgv(["start", "--no-auto-start", "--auto-start"]);
    // A `--auto-start` felülírja a korábbi `--no-auto-start` értéket.
    expect(result.flags.get("auto-start")).toBe(true);
    // A "no-auto-start" önálló flag is megjelenik (mert explicit kiírták).
    expect(result.flags.get("no-auto-start")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 7) A `--auto-start` önmagában (a parancs végén) boolean true.
  //    A `--auto-start` UTÁN írt nem-flag token a flag ÉRTÉKE lesz
  //    (a parser konvenciója: `--flag value` = key-value pár, ugyanúgy
  //    mint `--config ./foo.toml`). Ez NEM hiba, hanem a parser tervezett
  //    viselkedése — az ajánlott hívás: `mm-bot start --auto-start`
  //    (a subcommand után a flag-ek a parancs végén állnak).
  // --------------------------------------------------------------------------
  it("--auto-start at end of argv is boolean true (no following token)", () => {
    const result = parseArgv(["start", "--auto-start"]);
    expect(result.flags.get("auto-start")).toBe(true);
  });

  it("--no-auto-start at end of argv is a boolean pair (auto-start: false, no-auto-start: true)", () => {
    const result = parseArgv(["start", "--no-auto-start"]);
    expect(result.flags.get("auto-start")).toBe(false);
    expect(result.flags.get("no-auto-start")).toBe(true);
  });

  it("--auto-start=explicit_value uses the explicit value (parser key-value convention)", () => {
    // A `--auto-start=anything` formával a user explicit értéket adhat —
    // a start.ts-ban ezt `String(auto-start) === "true"` formában olvassuk.
    const result = parseArgv(["start", "--auto-start=foo"]);
    expect(result.flags.get("auto-start")).toBe("foo");
  });

  // --------------------------------------------------------------------------
  // 8) A "no-auto-start" önálló kulcs csak a `--no-auto-start` flag-ből jön,
  //    más úton nem. A backward-compat megerősítése.
  // --------------------------------------------------------------------------
  it("'no-auto-start' key is NOT set by --auto-start alone", () => {
    const result = parseArgv(["start", "--auto-start"]);
    expect(result.flags.has("no-auto-start")).toBe(false);
  });

  it("'no-auto-start' key is NOT set by default (no flags)", () => {
    const result = parseArgv(["start"]);
    expect(result.flags.has("no-auto-start")).toBe(false);
    expect(result.flags.has("auto-start")).toBe(false);
  });
});

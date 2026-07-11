/**
 * apps/bot/src/config/loader.ts
 *
 * A `BotConfig` betöltése a runtime számára.
 *
 * A betöltés lépései:
 *   1. Ha van `configPath`, kiolvassa a TOML fájlt a `Bun.file()` API-val,
 *      és a `Bun.TOML.parse()`-szel parse-olja. A Bun 1.3+ beépített
 *      TOML parser-e (`Bun.TOML.parse`) — nincs szükség külön npm
 *      csomagra.
 *   2. Ha nincs `configPath`, a teljes default-értékekkel indul.
 *   3. A `ZodSafeParse` validálja a konfigot — hiba esetén `ConfigError`-t
 *      dob, ami részletes leírást ad a hibás mezőről és az elvárt
 *      értéktartományról.
 *   4. Az env-változók felülírják a megfelelő mezőket
 *      (`BUN_ENV`/`LOG_LEVEL`/`BYBIT_API_KEY`/`BYBIT_API_SECRET`).
 *
 * A merge-sorrend (későbbi felülírja a korábbiakat):
 *   defaults → TOML-fájl → env-változók
 */

import { readFileSync as _readFileSync } from "node:fs";

import { DEFAULT_BOT_CONFIG } from "./defaults.js";
import type { BotConfig } from "./schema.js";
import { BotConfigSchema } from "./schema.js";

// ============================================================================
// Public error type
// ============================================================================

/**
 * `ConfigError` — a config-betöltés során dobott hiba.
 *
 * A `message` emberi olvasásra optimalizált, és tartalmazza:
 *   - melyik mező hibás (dotted path, pl. `risk.max_leverage`)
 *   - mi a várt értéktartomány (pl. "expected number ≤ 10")
 *   - mi a kapott érték
 */
export class ConfigError extends Error {
  public override readonly name = "ConfigError";

  public constructor(
    message: string,
    public readonly path: string,
    public readonly issues: readonly {
      path: string;
      message: string;
    }[],
  ) {
    super(message);
  }
}

// ============================================================================
// TOML parser wrapper
// ============================================================================

/**
 * `parseTomlString` — parse-ol egy TOML-stringet plain object-té.
 *
 * A `Bun.TOML.parse` a Bun runtime része (1.3+). A `toml` npm-csomag
 * nem kell — csökkenti a dependency-footprintot.
 *
 * A függvény `unknown`-t ad vissza, hogy a Zod séma a single source of
 * truth a típusellenőrzéshez — így a TOML parser nem tud semmilyen
 * típust erőszakot tenni a configba.
 */
function parseTomlString(text: string): unknown {
  // A Bun.TOML.parse dob érvénytelen TOML esetén — ezt a loadBotConfig
  // a hívóhoz továbbítja ConfigError formájában.
  // A Bun.TOML.parse típusa `any` — a típus-ellenőrzést a Zod séma
  // végzi (single source of truth), így nincs szükség cast-ra.
  return Bun.TOML.parse(text);
}

/**
 * `formatZodIssues` — a Zod-hibák listáját olvasható, dotted-path-os
 * stringgé alakítja.
 *
 * Példa kimenet:
 *   "risk.max_leverage: expected number ≤ 10 (got 15)"
 */
function formatZodIssues(issues: readonly { path: readonly (string | number)[]; message: string }[]): string {
  return issues
    .map((issue: { path: readonly (string | number)[]; message: string }) => {
      const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
      return `  • ${path}: ${issue.message}`;
    })
    .join("\n");
}

// ============================================================================
// Env-override alkalmazása
// ============================================================================

/**
 * `applyEnvOverrides` — a környezeti változókból felülíró mezőket
 * alkalmazza a `BotConfig`-ra. A függvény NEM validál — a végső
 * validáció a Zod-séma parse-okor fut le.
 *
 * Támogatott env-változók:
 *   - BUN_ENV          → bot.mode ("live" → "live", minden más → "paper")
 *   - LOG_LEVEL        → bot.log_level
 *   - BYBIT_API_KEY    → exchange.id=bybiteu esetén eltárolva
 *   - BYBIT_API_SECRET → exchange.id=bybiteu esetén eltárolva
 *
 * Az exchange.id a jelenlegi séla szerint enum ("bybiteu" | "mock");
 * az API-keyek a későbbi track-ekben (Track C Bot runtime) kerülnek
 * ténylegesen felhasználásra. A loader itt csak átveszi és a config
 * `exchange` szekciójához fűzi, hogy a későbbi track-ek hozzáférjenek.
 */
function applyEnvOverrides(config: BotConfig, env: NodeJS.ProcessEnv): BotConfig {
  // BUN_ENV → bot.mode.  Csak a ["live", "paper"] értékeket fogadjuk el —
  // bármi más (pl. "test") a default "paper" marad.
  const bunEnv = env["BUN_ENV"];
  if (bunEnv === "live" || bunEnv === "paper") {
    config.bot.mode = bunEnv;
  }
  // LOG_LEVEL → bot.log_level.  Csak a séma által elfogadott értékeket
  // fogadjuk el — minden más a default "info" marad.
  const logLevel = env["LOG_LEVEL"];
  if (
    logLevel === "debug" ||
    logLevel === "info" ||
    logLevel === "warn" ||
    logLevel === "error"
  ) {
    config.bot.log_level = logLevel;
  }
  // A BYBIT_API_KEY/SECRET környezeti változók jelenleg nem részei a
  // nyilvános `BotConfig` típusnak (biztonsági okokból — ne kerüljenek
  // naplózásra / serializálásra). A Bot runtime Track C fogja őket
  // közvetlenül a process.env-ből olvasni.
  void env["BYBIT_API_KEY"];
  void env["BYBIT_API_SECRET"];
  return config;
}

// ============================================================================
// Main loader
// ============================================================================

/**
 * `loadBotConfig` — betölti a bot-konfigurációt a megadott útvonalról,
 * validálja, és visszaadja a Zod-inferred `BotConfig` típusú objektumot.
 *
 * @param configPath - opcionális útvonal a TOML-fájlhoz. Ha `undefined`,
 *   a `DEFAULT_BOT_CONFIG` értékeit adja vissza (csak az env-override-ok
 *   után).
 * @param env - opcionális `NodeJS.ProcessEnv`. Tesztekhez hasznos; a
 *   default a `process.env`.
 * @returns A validált `BotConfig`.
 * @throws {ConfigError} ha a TOML-fájl nem olvasható, a TOML parse
 *   szintaxisa hibás, vagy a Zod séma bármely mezőt elutasít.
 */
export function loadBotConfig(
  configPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): BotConfig {
  // ------------------------------------------------------------------------
  // 1) Alapértékek betöltése — a `BotConfigSchema` defaultjaiból.
  // ------------------------------------------------------------------------
  // A deep-clone azért kell, mert a DEFAULT_BOT_CONFIG egy exportált
  // konstans, és az env-override-ok nem szabad, hogy mutálják.
  const merged: BotConfig = structuredClone(DEFAULT_BOT_CONFIG);

  // ------------------------------------------------------------------------
  // 2) TOML-fájl olvasása + parse (ha van configPath).
  // ------------------------------------------------------------------------
  if (configPath !== undefined) {
    let text: string;
    try {
      // A `Bun.file().text()` async; a `node:fs.readFileSync` szinkron
      // alternatíva. A loadBotConfig szinkron — a CLI indítása
      // boot-fázisban van, és a TOML-fájl kicsi, a sync olvasás
      // nem blokkolja érezhetően a folyamatot.
      text = _readFileSync(configPath, "utf8");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfigError(
        `Failed to read config file at "${configPath}": ${message}`,
        "<file>",
        [],
      );
    }

    let raw: unknown;
    try {
      raw = parseTomlString(text);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfigError(
        `Failed to parse TOML at "${configPath}": ${message}`,
        "<toml-parse>",
        [],
      );
    }

    // ------------------------------------------------------------------------
    // 3) A TOML-tartalom mergelése a defaultokba.
    //    A sekély merge (Object.assign-szerű) azért elég, mert a Zod
    //    séma flat struktúrát ír elő (a nested szekciók is top-level
    //    kulcsok). A `passthrough()` miatt a per-strategy extra mezők
    //    is átmennek.
    // ------------------------------------------------------------------------
    mergeInto(merged, raw as Record<string, unknown>);
  }

  // ------------------------------------------------------------------------
  // 4) Zod validáció — bármilyen hiba → ConfigError.
  // ------------------------------------------------------------------------
  const parsed = BotConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw new ConfigError(
      `Bot config validation failed:\n${formatZodIssues(parsed.error.issues)}`,
      issues[0]?.path ?? "<root>",
      issues,
    );
  }

  // ------------------------------------------------------------------------
  // 5) Env-override alkalmazása (utolsó felülírás).
  // ------------------------------------------------------------------------
  return applyEnvOverrides(parsed.data, env);
}

// ============================================================================
// Merge helper
// ============================================================================

/**
 * `mergeInto` — rekurzívan mergeli a `src` mezőit a `dst`-be. A `dst`
 * objektum referenciája marad (in-place mutáció), és csak azokat a
 * mezőket írja felül, amelyek a `src`-ben definiáltak.
 *
 * A `Zod` séma a `default({})` mechanizmussal kezeli a hiányzó
 * mezőket — ezért a merge-ben NEM kell törölnünk vagy kihagynunk
 * `undefined` értékeket; ha a TOML-ból jön egy `enabled = false`,
 * az felülírja a default `true`-t.
 */
function mergeInto(dst: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const key of Object.keys(src)) {
    const srcVal = src[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      typeof dst[key] === "object" &&
      dst[key] !== null &&
      !Array.isArray(dst[key])
    ) {
      // Mindkettő plain object → rekurzív merge.
      mergeInto(dst[key] as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      // Primitív, tömb, vagy a dst oldalán nem-object → egyszerű
      // felülírás.
      dst[key] = srcVal;
    }
  }
}

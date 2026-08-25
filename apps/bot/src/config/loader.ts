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
 *   4. Environment overrides apply only to `BUN_ENV` and `LOG_LEVEL`.
 *
 * A merge-sorrend (későbbi felülírja a korábbiakat):
 *   defaults → TOML-fájl → env-változók
 */

import * as nodeFileSystem from "node:fs";

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
 * Parses a TOML string into its runtime-guaranteed top-level object.
 *
 * A `Bun.TOML.parse` a Bun runtime része (1.3+). A `toml` npm-csomag
 * nem kell — csökkenti a dependency-footprintot.
 *
 * Bun rejects malformed scalar and array documents. The record keeps every
 * parsed value unknown so the Zod schema remains the validation authority.
 */
function parseTomlString(text: string): Record<string, unknown> {
  // A Bun.TOML.parse dob érvénytelen TOML esetén — ezt a loadBotConfig
  // a hívóhoz továbbítja ConfigError formájában.
  // A Bun.TOML.parse típusa `any` — a típus-ellenőrzést a Zod séma
  // végzi (single source of truth), így nincs szükség cast-ra.
  return Object.fromEntries(Object.entries(Bun.TOML.parse(text)));
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
      const path = issue.path.join(".");
      return `  • ${path}: ${issue.message}`;
    })
    .join("\n");
}

// ============================================================================
// Env-override alkalmazása
// ============================================================================

/**
 * Applies supported environment overrides to a validated configuration.
 *
 * Supported environment variables:
 *   - BUN_ENV   → paper-mode selection; `live` is rejected before loading.
 *   - LOG_LEVEL → bot.log_level
 */
function applyEnvironmentOverrides(config: BotConfig, environment: NodeJS.ProcessEnv): BotConfig {
  // BUN_ENV may only select paper mode. Live activation has an explicit,
  // separately guarded flow and cannot be selected through an environment
  // override.
  const bunEnvironment = environment["BUN_ENV"];
  if (bunEnvironment === "paper") config.bot.mode = bunEnvironment;
  // LOG_LEVEL → bot.log_level.  Csak a séma által elfogadott értékeket
  // fogadjuk el — minden más a default "info" marad.
  const logLevel = environment["LOG_LEVEL"];
  switch (logLevel) {
    case "debug":
    case "info":
    case "warn":
    case "error": {
      config.bot.log_level = logLevel;
      break;
    }
    default: {
      break;
    }
  }
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
export function loadBotConfig(configPath?: string, environment: NodeJS.ProcessEnv = process.env): BotConfig {
  if (environment["BUN_ENV"] === "live") {
    throw new ConfigError("BUN_ENV=live cannot activate live mode.", "BUN_ENV", [
      { path: "BUN_ENV", message: "BUN_ENV=live cannot activate live mode." },
    ]);
  }

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
      text = nodeFileSystem.readFileSync(configPath, "utf8");
    } catch (error: unknown) {
      const message = String(error);
      throw new ConfigError(`Failed to read config file at "${configPath}": ${message}`, "<file>", []);
    }

    let raw: Record<string, unknown>;
    try {
      raw = parseTomlString(text);
    } catch (error: unknown) {
      const message = String(error);
      throw new ConfigError(`Failed to parse TOML at "${configPath}": ${message}`, "<toml-parse>", []);
    }

    // ------------------------------------------------------------------------
    // 3) A TOML-tartalom mergelése a defaultokba.
    //    A sekély merge (Object.assign-szerű) azért elég, mert a Zod
    //    séma flat struktúrát ír elő (a nested szekciók is top-level
    //    kulcsok). A `passthrough()` miatt a per-strategy extra mezők
    //    is átmennek.
    // ------------------------------------------------------------------------
    mergeInto(merged, raw);
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
      issues.map((issue) => issue.path).join(", "),
      issues,
    );
  }

  // ------------------------------------------------------------------------
  // 5) Env-override alkalmazása (utolsó felülírás).
  // ------------------------------------------------------------------------
  return applyEnvironmentOverrides(parsed.data, environment);
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
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeInto(destination: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, sourceValue] of Object.entries(source)) {
    const destinationValue = Reflect.get(destination, key);
    if (isPlainObject(sourceValue) && isPlainObject(destinationValue)) {
      // Mindkettő plain object → rekurzív merge.
      mergeInto(destinationValue, sourceValue);
    } else {
      // Primitív, tömb, vagy a dst oldalán nem-object → egyszerű
      // felülírás.
      Reflect.set(destination, key, sourceValue);
    }
  }
}

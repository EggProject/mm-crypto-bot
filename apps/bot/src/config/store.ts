import nodePath from "node:path";

import type { BotConfig, StrategyName } from "./schema.js";
import { BotConfigSchema, StrategySectionSchema } from "./schema.js";
import {
  ConfigLiveConfirmError,
  ConfigReadError,
  ConfigValidationError,
  type ConfigStoreDependencies,
  type LiveModeAuditEntry,
} from "./store-contracts.js";
import { DEFAULT_CONFIG_STORE_DEPENDENCIES, getTomlParseErrorMessage } from "./store-node-adapter.js";

export {
  ConfigLiveConfirmError,
  ConfigReadError,
  ConfigValidationError,
  type ConfigStoreDependencies,
  type LiveModeAuditEntry,
} from "./store-contracts.js";

export class ConfigStore {
  private readonly dependencies: ConfigStoreDependencies;
  public readonly path: string;

  /**
   * `ConfigStore` konstruktor.
   *
   * @param path A TOML-fájl abszolút vagy CWD-relatív útvonala.
   *   A `getConfigStore()` singleton factory NEM tárolja el a
   *   `ConfigStore`-t; minden `getConfigStore(<path>)` hívás egy
   *   új példányt ad vissza. A `getCachedConfigStore()` az a
   *   singleton getter, ami per-path memoizál.
   */
  public constructor(path: string, dependencies: Partial<ConfigStoreDependencies> = {}) {
    this.path = nodePath.resolve(path);
    this.dependencies = { ...DEFAULT_CONFIG_STORE_DEPENDENCIES, ...dependencies };
  }

  // --------------------------------------------------------------------------
  // read — TOML → raw object
  // --------------------------------------------------------------------------

  /**
   * `read` — beolvassa a TOML-fájlt, és visszaadja a `BotConfig`
   * Zod-validált formáját. A környezeti változók NEM kerülnek
   * alkalmazásra; ez a tároló kizárólag a fájl tartalmát dolgozza fel.
   *
   * Ha a fájl nem létezik, `ConfigReadError`-t dob (a "missing file"
   * hibaüzenettel) — a hívónak kell döntenie, hogy defaults-szal
   * indul, vagy kilép.
   *
   * @throws {ConfigReadError} ha a fájl nem olvasható vagy a TOML
   *   parse szintaxisa hibás.
   * @throws {ConfigValidationError} ha a Zod séma elutasítja a
   *   beolvasott struktúrát.
   */
  public read(): BotConfig {
    let text: string;
    try {
      text = this.dependencies.readText(this.path);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ConfigReadError(`Failed to read config file at "${this.path}": ${message}`, this.path, error);
    }

    let raw: unknown;
    try {
      raw = this.dependencies.parse(text);
    } catch (error: unknown) {
      // A smol-toml `TomlError`-t dob érvénytelen TOML-ra.
      // A natív `Bun.TOML.parse` szintaktikailag kompatibilis
      // eredményt ad, így a hibakezelés ugyanaz.
      const message = getTomlParseErrorMessage(error);
      throw new ConfigReadError(`Failed to parse TOML at "${this.path}": ${message}`, this.path, error);
    }

    // A TOML-tartalom Zod-validációja. A séma a `passthrough()` miatt
    // a per-strategy extra mezőket is átengedi — a `validate()`
    // metódus ugyanazt a Zod-parse-t használja, mint a `read()`,
    // csak explicit a hívó kezdeményezi.
    return this.validate(raw);
  }

  // --------------------------------------------------------------------------
  // validate — raw object → Zod-validated BotConfig
  // --------------------------------------------------------------------------

  /**
   * `validate` — a Zod-séma szerinti típus- és tartomány-ellenőrzés.
   *
   * Sikeres parse esetén a Zod-inferred `BotConfig` típusú objektumot
   * adja vissza. Hiba esetén `ConfigValidationError`-t dob, ami a
   * `fieldErrors` map-ben tartja a mező-szintű üzeneteket.
   *
   * @throws {ConfigValidationError} ha bármely mező elutasítódik.
   */
  public validate(raw: unknown): BotConfig {
    const parsed = BotConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      // A `fieldErrors` a Zod `flatten()` formátumot követi:
      // { "field.path": ["msg1", "msg2"] }.
      const fieldErrors = new Map<string, string[]>();
      for (const issue of parsed.error.issues) {
        const key = issue.path.length === 0 ? "<root>" : issue.path.join(".");
        const list = fieldErrors.get(key) ?? [];
        list.push(issue.message);
        fieldErrors.set(key, list);
      }
      throw new ConfigValidationError(
        `Bot config validation failed:\n${issues.map((issue) => `  • ${issue.path}: ${issue.message}`).join("\n")}`,
        Object.fromEntries(fieldErrors),
        issues,
      );
    }
    return parsed.data;
  }

  // --------------------------------------------------------------------------
  // write — BotConfig → atomic TOML write
  // --------------------------------------------------------------------------

  /**
   * `write` — atomikusan kiírja a `BotConfig`-ot a `this.path` fájlba.
   *
   * Lépések:
   *   1. `validate` a Zod-sémával (ha a hívó eddig nem tette meg).
   *   2. `smol-toml.stringify` — szerializáció.
   *   3. Round-trip check: a serialized string visszaolvasása
   *      + újra-validálás (bug-detektálás: ha a TOML-stringify
   *      adatot veszít, a második `BotConfigSchema.safeParse`
   *      elbukik).
   *   4. Backup: a korábbi fájl `mm-bot.toml.bak`-ba másolása
   *      (ha a fájl létezik).
   *   5. `write-file-atomic.sync` write-tmp → rename (POSIX-on
   *      atomi).
   *   6. A `mm-bot.toml` biztosítása (a write-file-atomic a tmp-t
   *      a végleges névre renameli, így a `.bak` lépés NEM az új,
   *      hanem a régi tartalmat őrzi meg).
   *
   * This method is synchronous so validation, backup, and atomic replacement
   * complete before control returns to the caller.
   *
   * @param next A kiírandó `BotConfig`.
   * @throws {ConfigValidationError} ha a Zod séma elutasítja a `next`-et.
   * @throws {Error} ha az IO művelet bármelyike sikertelen.
   */
  public write(next: BotConfig): void {
    // 1) Zod re-validate. Ha a hívó már validált, a második
    // safeParse költsége elhanyagolható (a Zod parse-ideje
    // ~10-100 µs egy 100-mezős configra).
    const validated = this.validate(next);

    // 2) Serialize. A `stringifyToml` a `validated`-ot `Record<string, unknown>`
    // -ként fogadja — a `BotConfig` típus kompatibilis ezzel a típussal.
    const serialized = this.dependencies.stringify(validated);

    // 3) Round-trip check. A TOML-stringify bug (adatvesztés) az
    // esetek 99%-ában itt jönne ki. A `parse` költsége elhanyagolható
    // (a TOML-fájl kicsi).
    let reparsed: unknown;
    try {
      reparsed = this.dependencies.parse(serialized);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ConfigStore.write: round-trip parse failed (smol-toml bug?): ${message}`, {
        cause: error,
      });
    }
    this.validate(reparsed);

    // 4) Biztosítsuk, hogy a cél-könyvtár létezik (a user adhatott
    // meg olyan path-ot, ami még nem létezik).
    const directory = nodePath.dirname(this.path);
    if (!this.dependencies.exists(directory)) {
      this.dependencies.ensureDirectory(directory);
    }

    // 5) Backup a korábbi fájlról — a `bak` MINDIG az előző write
    // előtti állapotot őrzi, így a user bármikor vissza tudja
    // állítani a write előtti konfigot.
    if (this.dependencies.exists(this.path)) {
      this.dependencies.copy(this.path, `${this.path}.bak`);
    }

    // 6) Atomic write. A `write-file-atomic.sync` a write-tmp + rename
    // pattern-t használja, és a `chmod` / `chown` hibákat is kezeli.
    // A string átadáshoz a default `utf8` encoding-ot használja.
    try {
      this.dependencies.atomicWrite(this.path, serialized);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ConfigStore.write: failed to write ${this.path}: ${message}`, {
        cause: error,
      });
    }
  }

  // --------------------------------------------------------------------------
  // writeAfterTypedLive — Track C2 typed "LIVE" guard
  // --------------------------------------------------------------------------

  /**
   * `writeAfterTypedLive` — a `bot.mode = "live"` típusos megerősítő
   * őre. A metódus CSAK akkor írja ki a `next` configot, ha a
   * `typedValue` pontosan egyenlő a case-sensitive "LIVE" string-gel.
   *
   * Mellékhatás: a `<path>.audit.log` fájlba append-öl egy
   * `LiveModeAuditEntry` bejegyzést (JSON-line formátumban).
   *
   * A metódus a `write` metódust hívja a tényleges mentéshez, tehát
   * a Zod re-validate + round-trip + atomic write + backup mind
   * automatikus.
   *
   * A `prevMode`-ot a metódus a `next.bot.mode` ELŐTTI állapotból
   * olvassa — ehhez a hívónak VÁLTOZTATATLAN `BotConfig`-ot kell
   * átadnia, vagy expliciten meg kell adnia a `prevMode` értéket.
   * Ha a `next` módosítva van (`bot.mode = "live"`), a `prevMode`
   * a `next` jelenlegi értéke alapján számítódik (a metódus
   * megbízható abban, hogy a hívó az in-memory frissítés ELŐTT
   * olvassa a `prev` módot a `this.read()`-ból, ÉS a frissítés UTÁN
   * hívja a metódust — így a `next.bot.mode === "live"` az új
   * mód, a `prevMode` pedig a `next` ÁTADÁSA ELŐTTI).
   *
   * A félreértések elkerülése érdekében a metódus NEM próbálja
   * kitalálni a `prevMode`-ot — a hívó felelőssége, hogy helyes
   * értéket adjon át. Ha a `next.bot.mode === "live"`, akkor a
   * `prevMode` a hívó kontextusából származik; itt a metódus az
   * audit-logba a `prevMode` paramétert írja (a `next` mező helyett).
   *
   * @param next A kiírandó `BotConfig` (a `bot.mode` itt már "live").
   * @param typedValue A user által begépelt megerősítő szöveg.
   *   CSAK a "LIVE" (case-sensitive) értékkel fogadja el.
   * @param prevMode A bot MÓDJA a confirm ELŐTT ("paper" | "live").
   *   A hívó a `this.read()`-ból olvassa, MIELŐTT a `next`-ben
   *   átállítaná "live"-ra.
   * @returns Az audit-log bejegyzés, ami a fájlba került.
   * @throws {ConfigLiveConfirmError} ha `typedValue !== "LIVE"`.
   * @throws {ConfigValidationError} ha a Zod séma elutasítja a `next`-et.
   */
  public writeAfterTypedLive(
    next: BotConfig,
    typedValue: string,
    previousMode: "paper" | "live",
  ): LiveModeAuditEntry {
    if (typedValue !== "LIVE") {
      throw new ConfigLiveConfirmError(
        `Refusing to switch to LIVE mode: typed value "${typedValue}" does not match "LIVE".`,
        typedValue,
      );
    }

    const entry: LiveModeAuditEntry = {
      ts: new Date().toISOString(),
      event: "live-mode-confirm",
      value: true,
      prevMode: previousMode,
      newMode: next.bot.mode,
    };

    // Audit-log append. A `<path>.audit.log` fájl a bot-config melletti
    // sidecar — append-only, JSON-lines formátumban. A user bármikor
    // `cat mm-bot.toml.audit.log | jq` formában ellenőrizheti a
    // korábbi megerősítéseket.
    const auditPath = `${this.path}.audit.log`;
    try {
      this.dependencies.appendText(auditPath, `${JSON.stringify(entry)}\n`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ConfigStore.writeAfterTypedLive: failed to write audit log ${auditPath}: ${message}`, {
        cause: error,
      });
    }

    // Tényleges write — a `write` metódus a Zod re-validate + atomic
    // write + backup pattern-t alkalmazza.
    this.write(next);
    return entry;
  }

  // --------------------------------------------------------------------------
  // Phase 37 Track 2 — per-section EDITABLE update methods
  // --------------------------------------------------------------------------

  /**
   * `setStrategyEnabled` — a `strategies.<id>.enabled` flag állítása.
   *
   * A metódus a jelenlegi configot olvassa (read), beállítja a
   * `strategies.<id>.enabled` értéket, és a `write` metódussal
   * menti (atomic + .bak + Zod re-validate).
   *
   * @param strategyId A strategy-kulcs (pl. "donchian_pivot_composition").
   *   A `StrategyName` típus szűkíti a lehetséges értékeket.
   * @param enabled A kívánt enabled-flag érték.
   * @throws {ConfigReadError} ha a config-fájl nem olvasható.
   * @throws {ConfigValidationError} ha a write során a Zod séma
   *   elutasítja az új konfigot (ritka — csak akkor, ha a
   *   meglévő config már eleve inkonzisztens).
   */
  public setStrategyEnabled(strategyId: StrategyName, isEnabled: boolean): void {
    const current = this.read();
    const next: BotConfig = {
      ...current,
      strategies: {
        ...current.strategies,
        // eslint-disable-next-line security/detect-object-injection -- strategyId is the validated StrategyName union
        [strategyId]: { ...current.strategies[strategyId], enabled: isEnabled },
      },
    };
    this.write(next);
  }

  /**
   * `setStrategySetting` — egy adott strategy egy mezőjének állítása.
   *
   * A metódus a `StrategySectionSchema` Zod-sémával validálja az új
   * strategy-értéket, mielőtt a `write` meghívódik. Ha a Zod séma
   * elutasítja, a write NEM történik meg, és `ConfigValidationError`
   * dobódik.
   *
   * @param strategyId A strategy-kulcs.
   * @param key A mező neve (pl. "cap", "leverage", "risk_per_trade",
   *   "max_positions", "symbols", "timeframes", vagy bármely
   *   `passthrough()`-ön átengedett custom mező).
   * @param value Az új érték. A típus a `StrategySectionSchema`
   *   shape-jéből következik — a helper a `StrategySectionSchema.partial()`
   *   + `passthrough()` sémával validál, hogy a `passthrough()`-ön
   *   átengedett mezők is működjenek.
   * @throws {ConfigValidationError} ha a Zod séma elutasítja az
   *   új értéket (pl. `leverage = 15` → 1:10 MANDATE breach).
   */
  public setStrategySetting(strategyId: StrategyName, key: string, value: unknown): void {
    // Először a jelenlegi strategy-section-t olvassuk, és ellenőrizzük,
    // hogy az új `{ [key]: value }` shape érvényes-e a sémán.
    const candidate = { [key]: value };
    // A `passthrough()`-höz a Zod `.passthrough()` sémát használjuk
    // — a `StrategySectionSchema.safeParse` a teljes objektumot
    // validálja, és a `passthrough()` miatt a custom mezőket is
    // átengedi. Csak az adott mező validitását ellenőrizzük: a
    // `partial()` sémával.
    const fieldOnlySchema = StrategySectionSchema.partial();
    const parsed = fieldOnlySchema.safeParse(candidate);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: `strategies.${strategyId}.${key}`,
        message: issue.message,
      }));
      const fieldErrors = new Map<string, string[]>();
      for (const issue of parsed.error.issues) {
        const fkey = `strategies.${strategyId}.${key}`;
        const list = fieldErrors.get(fkey) ?? [];
        list.push(issue.message);
        fieldErrors.set(fkey, list);
      }
      throw new ConfigValidationError(
        `Strategy setting validation failed for strategies.${strategyId}.${key}:\n${issues
          .map((issue) => `  • ${issue.path}: ${issue.message}`)
          .join("\n")}`,
        Object.fromEntries(fieldErrors),
        issues,
      );
    }

    const current = this.read();
    const next: BotConfig = {
      ...current,
      strategies: {
        ...current.strategies,
        // eslint-disable-next-line security/detect-object-injection -- strategyId/key are schema-validated config keys
        [strategyId]: { ...current.strategies[strategyId], [key]: value },
      },
    };
    this.write(next);
  }

  /**
   * `setExchangeConfig` — az `exchange` szekció egy részének frissítése.
   *
   * A metódus a jelenlegi configot olvassa, a `partial` object merge-eli
   * az `exchange` szekcióba, és a `write` metódussal menti.
   *
   * A Zod séma elutasítja az érvénytelen értéket (pl.
   * `slippage_pct = 2.0` → 0..1 range breach) — a write NEM történik
   * meg, és `ConfigValidationError` dobódik.
   *
   * @param partial Az `exchange` szekció frissítendő mezői.
   * @throws {ConfigValidationError} ha a Zod séma elutasítja az új
   *   konfigot.
   */
  public setExchangeConfig(partial: Partial<BotConfig["exchange"]>): void {
    const current = this.read();
    const next: BotConfig = {
      ...current,
      exchange: { ...current.exchange, ...partial },
    };
    this.write(next);
  }

  /**
   * `setSymbols` — a `symbols.enabled` lista cseréje.
   *
   * A metódus a jelenlegi configot olvassa, a `symbols.enabled`
   * mezőt a `symbols` tömbbel helyettesíti, és a `write` metódussal
   * menti.
   *
   * A Zod séma a `z.array(z.string())` — bármilyen string-tömböt
   * elfogad (nincs symbol-formátum-kényszer a sémában).
   *
   * @param symbols Az új `enabled` lista (CCXT unified formátumban,
   *   pl. `["BTC/USDC", "ETH/USDC"]`).
   * @throws {ConfigValidationError} ha a write során a Zod séma
   *   elutasítja a konfigot.
   */
  public setSymbols(symbols: readonly string[]): void {
    const current = this.read();
    const next: BotConfig = {
      ...current,
      symbols: { ...current.symbols, enabled: [...symbols] },
    };
    this.write(next);
  }

  /**
   * `setTelemetryConfig` — a `telemetry` szekció egy részének frissítése.
   *
   * A metódus a jelenlegi configot olvassa, a `partial` object merge-eli
   * a `telemetry` szekcióba, és a `write` metódussal menti.
   *
   * A Zod séma elutasítja az érvénytelen értéket (pl.
   * `heartbeat_interval_sec = 500` → 1..300 range breach).
   *
   * @param partial A `telemetry` szekció frissítendő mezői.
   * @throws {ConfigValidationError} ha a Zod séma elutasítja az új
   *   konfigot.
   */
  public setTelemetryConfig(partial: Partial<BotConfig["telemetry"]>): void {
    const current = this.read();
    const next: BotConfig = {
      ...current,
      telemetry: { ...current.telemetry, ...partial },
    };
    this.write(next);
  }
}

// ============================================================================
// Singleton getter
// ============================================================================

/**
 * `storeCache` — per-path `ConfigStore` memoization cache.
 *
 * A `getConfigStore()` factory ezt a Map-et használja, hogy azonos
 * path-ra mindig ugyanazt a `ConfigStore` példányt adja vissza. A
 * cache-t a `resetConfigStoreCache()` függvénnyel lehet törölni
 * (tesztekben hasznos).
 */
const storeCache = new Map<string, ConfigStore>();

/**
 * `getConfigStore` — factory / singleton getter.
 *
 * Ha a `path` már szerepel a cache-ben, visszaadja a tárolt
 * példányt. Ha nem, létrehoz egy újat, eltárolja, és visszaadja.
 *
 * @param path A TOML-fájl útvonala. Ha `undefined`, a
 *   default `./mm-bot.toml`-ot használja.
 */
export function getConfigStore(path?: string): ConfigStore {
  const resolved = nodePath.resolve(path ?? "./mm-bot.toml");
  const cached = storeCache.get(resolved);
  if (cached !== undefined) {
    return cached;
  }
  const fresh = new ConfigStore(resolved);
  storeCache.set(resolved, fresh);
  return fresh;
}

/**
 * `resetConfigStoreCache` — törli a singleton cache-t.
 *
 * A tesztek hívják, hogy minden teszt friss `ConfigStore` példányt
 * kapjon (a cache-elt példányok a `path` alapján azonosak lennének,
 * ami a tesztek közötti state-szivárgáshoz vezetne).
 */
export function resetConfigStoreCache(): void {
  storeCache.clear();
}

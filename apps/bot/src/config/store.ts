import { randomUUID } from "node:crypto";
import nodePath from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  normalizeBotConfigForValidation,
  toTomlSerializableBotConfig as serializeSelectedLeverageConfig,
} from "./selected-leverage-config.js";
import type { BotConfig, StrategyName } from "./schema.js";
import { BotConfigSchema } from "./schema.js";
import {
  ConfigLiveConfirmError,
  ConfigReadError,
  ConfigValidationError,
  type CommittedLiveModeAuditEntry,
  type ConfigStoreDependencies,
  type LiveModeAuditEntry,
  type PendingLiveModeAuditEntry,
  type TomlSerializableBotConfig,
} from "./store-contracts.js";
import { DEFAULT_CONFIG_STORE_DEPENDENCIES, getTomlParseErrorMessage } from "./store-node-adapter.js";
export {
  ConfigLiveConfirmError,
  ConfigReadError,
  ConfigValidationError,
  type ConfigStoreDependencies,
  type LiveModeAuditEntry,
} from "./store-contracts.js";

function selectedLeverageValidationError(): ConfigValidationError {
  const path = "bot.selected_leverage";
  const message = "Selected leverage must be an authentic SelectedLeverage value.";
  return new ConfigValidationError(
    `Bot config validation failed:\n  • ${path}: ${message}`,
    { [path]: [message] },
    [{ path, message }],
  );
}

function roundTripValidationError(path: string): ConfigValidationError {
  const message = "Serialized configuration does not exactly round-trip through the TOML codec.";
  return new ConfigValidationError(
    `Bot config validation failed:\n  • ${path}: ${message}`,
    { [path]: [message] },
    [{ path, message }],
  );
}

function toTomlSerializableConfig(config: BotConfig): TomlSerializableBotConfig {
  try {
    return serializeSelectedLeverageConfig(config);
  } catch {
    throw selectedLeverageValidationError();
  }
}

function hasSameTomlRepresentation(
  left: TomlSerializableBotConfig,
  right: TomlSerializableBotConfig,
): boolean {
  return isDeepStrictEqual(left, right);
}

function toRawConfigCandidate(candidate: unknown): unknown {
  try {
    return normalizeBotConfigForValidation(candidate);
  } catch {
    throw selectedLeverageValidationError();
  }
}

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

  private appendAuditRecord(entry: LiveModeAuditEntry): void {
    const auditPath = `${this.path}.audit.log`;
    try {
      this.dependencies.appendText(auditPath, `${JSON.stringify(entry)}\n`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ConfigStore.writeAfterTypedLive: failed to write audit log ${auditPath}: ${message}`, {
        cause: error,
      });
    }
  }

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

    // The closed schema validates TOML with the same parse path used by validate().
    return this.validate(raw);
  }

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
    // 1) Convert the in-memory exact domain value to its canonical TOML
    // representation, then re-validate the raw persistence boundary.
    const serializedInput = toTomlSerializableConfig(next);
    const validated = this.validate(serializedInput);

    // 2) Serialize only the explicit TOML representation, never the domain
    // value object held by the validated in-memory configuration.
    const serialized = this.dependencies.stringify(toTomlSerializableConfig(validated));

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
    const reparsedConfig = this.validate(reparsed);
    const reparsedTomlConfig = toTomlSerializableConfig(reparsedConfig);
    if (!hasSameTomlRepresentation(serializedInput, reparsedTomlConfig)) {
      const path =
        serializedInput.bot.selected_leverage === reparsedTomlConfig.bot.selected_leverage
          ? "<round-trip>"
          : "bot.selected_leverage";
      throw roundTripValidationError(path);
    }

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

  /**
   * Records a pending transition, writes atomically, then records its commit.
   */
  public writeAfterTypedLive(next: unknown, typedValue: string): CommittedLiveModeAuditEntry {
    if (typedValue !== "LIVE") {
      throw new ConfigLiveConfirmError(
        `Refusing to switch to LIVE mode: typed value "${typedValue}" does not match "LIVE".`,
        typedValue,
      );
    }
    const validatedNext = this.validate(toRawConfigCandidate(next));
    if (validatedNext.bot.mode !== "live") {
      throw new ConfigLiveConfirmError(
        "Refusing to confirm a config whose bot.mode is not live.",
        typedValue,
      );
    }
    const transactionId = randomUUID();
    const previousMode = this.read().bot.mode;
    const pending: PendingLiveModeAuditEntry = {
      ts: new Date().toISOString(),
      event: "live-mode-confirm",
      transactionId,
      status: "pending",
      success: false,
      previousMode,
      newMode: "live",
    };
    this.appendAuditRecord(pending);
    this.write(validatedNext);
    const committed: CommittedLiveModeAuditEntry = {
      ...pending,
      ts: new Date().toISOString(),
      status: "committed",
      success: true,
    };
    this.appendAuditRecord(committed);
    return committed;
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
   * Updates one strategy field and validates the completed closed config before persisting it.
   */
  public setStrategySetting(strategyId: StrategyName, key: string, value: unknown): void {
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

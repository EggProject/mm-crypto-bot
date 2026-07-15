/**
 * apps/bot/src/config/store.ts
 *
 * Phase 36 Track C1 — `ConfigStore` — a typed, atomic, audited
 * read/write API for the `mm-bot.toml` config file.
 *
 * ===========================================================================
 * WHY THIS CLASS
 * ===========================================================================
 * A `mm-bot.toml` config file a 4 szekcióból áll (bot / exchange / risk /
 * strategies + symbols + telemetry), és a 1:10 leverage MANDATE + a
 * `bot.mode = "live"` typed-confirm guard miatt a save-útvonalat
 * egységesíteni kell:
 *
 *   1. Round-trip safe: a write-ot megelőzi egy re-validate (a Zod séma
 *      a single source of truth, nem az adott UI mező).
 *   2. Atomic: `write-file-atomic` (write-tmp → rename → backup) —
 *      a write közbeni crash nem ronthatja el a meglévő TOML-t.
 *   3. Backed up: minden write előtt a korábbi fájl `mm-bot.toml.bak`-ba
 *      kerül, így a user mindig vissza tudja állítani a korábbi verziót.
 *   4. Audit-friendly: a `bot.mode = "live"` megerősítés külön
 *      `writeAfterTypedLive` metóduson megy keresztül (Track C2) — ez
 *      a metódus NEM fogadja el a "live" lowercase változatot, és
 *      audit-logot ír a `bot-audit.log` fájlba.
 *
 * ===========================================================================
 * USAGE
 * ===========================================================================
 *   import { getConfigStore } from "./config/store.js";
 *
 *   const store = getConfigStore("./mm-bot.toml");
 *   const raw = await store.read();
 *   const next = { ...raw, risk: { ...raw.risk, risk_per_trade: 0.02 } };
 *   const validated = store.validate(next);   // throws on Zod failure
 *   await store.write(validated);
 *
 * ===========================================================================
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml, TomlError } from "smol-toml";
// `write-file-atomic` CJS — a default export egy `writeFile` függvény,
// amihez `.sync` property-ként csatlakozik a szinkron write. Bun alatt
// a CJS import TS-ből a default néven érhető el.
import writeFileAtomic from "write-file-atomic";

import type { BotConfig, StrategyName } from "./schema.js";
import { BotConfigSchema, StrategySectionSchema } from "./schema.js";

// ============================================================================
// Public error types
// ============================================================================

/**
 * `ConfigReadError` — a TOML-fájl olvasásakor fellépő hiba.
 *
 * A `ConfigStore.read()` metódus ezt dobja, ha:
 *   - a fájl nem olvasható (nincs rá jogosultság, hiányzik)
 *   - a TOML parse szintaxisa hibás
 *
 * A `cause` mező tartalmazza az eredeti hibát (a `node:fs` hibát vagy
 * a `TomlError`-t).
 */
export class ConfigReadError extends Error {
  public override readonly name = "ConfigReadError";

  public readonly path: string;
  public readonly originalCause: unknown;

  public constructor(
    message: string,
    path: string,
    cause: unknown,
  ) {
    super(message);
    this.path = path;
    this.originalCause = cause;
  }
}

/**
 * `ConfigValidationError` — a Zod séma szerinti validáció elutasított
 * egy config-jelöltet.
 *
 * A `ConfigStore.validate()` metódus ezt dobja, ha a `safeParse`
 * sikertelen. A `fieldErrors` a Zod `flatten()`-ből jön:
 *   {
 *     "risk.max_leverage": ["expected number ≤ 10"],
 *     "bot.mode": ["expected 'paper' | 'live'"]
 *   }
 *
 * A UI a `fieldErrors`-t 1:1-ben meg tudja jeleníteni.
 */
export class ConfigValidationError extends Error {
  public override readonly name = "ConfigValidationError";

  public constructor(
    message: string,
    public readonly fieldErrors: Readonly<Record<string, readonly string[]>>,
    public readonly issues: readonly {
      readonly path: string;
      readonly message: string;
    }[],
  ) {
    super(message);
  }
}

/**
 * `ConfigLiveConfirmError` — a Track C2 typed "LIVE" megerősítés
 * elutasítása (rossz input, pl. "live" lowercase).
 *
 * A `writeAfterTypedLive()` metódus ezt dobja, ha a beírt szöveg
 * nem egyezik a case-sensitive "LIVE" string-gel.
 */
export class ConfigLiveConfirmError extends Error {
  public override readonly name = "ConfigLiveConfirmError";

  public constructor(
    message: string,
    public readonly typedValue: string,
  ) {
    super(message);
  }
}

/**
 * `LiveModeAuditEntry` — a `bot.mode = "live"` audit-log bejegyzés.
 *
 * A `writeAfterTypedLive()` metódus ezt írja a `<path>.audit.log`
 * fájlba (append-only). A bejegyzés típus-szinten is megőrzi a
 * kontextust (timestamp + előző/új mód + user-typed input).
 */
export interface LiveModeAuditEntry {
  readonly ts: string;
  readonly event: "live-mode-confirm";
  readonly value: true;
  readonly prevMode: "paper" | "live";
  readonly newMode: "paper" | "live";
}

// ============================================================================
// ConfigStore class
// ============================================================================

/**
 * `ConfigStore` — a `mm-bot.toml` típusos, auditált olvasó/író.
 *
 * Minden metódus promise- vagy sync- (a `read` és `write` a `node:fs`
 * async verzióját használja a UI responsiveness megőrzéséért; a
 * `validate` és `writeAfterTypedLive` a `safeParse` miatt sync).
 */
export class ConfigStore {
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
  public constructor(path: string) {
    this.path = resolve(path);
  }

  // --------------------------------------------------------------------------
  // read — TOML → raw object
  // --------------------------------------------------------------------------

  /**
   * `read` — beolvassa a TOML-fájlt, és visszaadja a `BotConfig`
   * Zod-validált formáját. A környezeti változók NEM kerülnek
   * alkalmazásra (ez a settings-panel feladata, nem a store-é).
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
      text = readFileSync(this.path, "utf8");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfigReadError(
        `Failed to read config file at "${this.path}": ${message}`,
        this.path,
        err,
      );
    }

    let raw: unknown;
    try {
      raw = parseToml(text);
    } catch (err: unknown) {
      // A smol-toml `TomlError`-t dob érvénytelen TOML-ra.
      // A natív `Bun.TOML.parse` szintaktikailag kompatibilis
      // eredményt ad, így a hibakezelés ugyanaz.
      const message = err instanceof TomlError ? err.message : String(err);
      throw new ConfigReadError(
        `Failed to parse TOML at "${this.path}": ${message}`,
        this.path,
        err,
      );
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
      // { "field.path": ["msg1", "msg2"] } — az UI ezt 1:1-ben
      // meg tudja jeleníteni.
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.length === 0 ? "<root>" : issue.path.join(".");
        const list = fieldErrors[key] ?? [];
        list.push(issue.message);
        fieldErrors[key] = list;
      }
      throw new ConfigValidationError(
        `Bot config validation failed:\n${issues
          .map((i) => `  • ${i.path}: ${i.message}`)
          .join("\n")}`,
        fieldErrors,
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
   * A függvény szinkron — a CLI és a TUI boot-fázisban hívja, ahol
   * a sync IO nem blokkol érezhetően.
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
    const serialized = stringifyToml(validated);

    // 3) Round-trip check. A TOML-stringify bug (adatvesztés) az
    // esetek 99%-ában itt jönne ki. A `parse` költsége elhanyagolható
    // (a TOML-fájl kicsi).
    let reparsed: unknown;
    try {
      reparsed = parseToml(serialized);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `ConfigStore.write: round-trip parse failed (smol-toml bug?): ${message}`,
        { cause: err },
      );
    }
    this.validate(reparsed);

    // 4) Biztosítsuk, hogy a cél-könyvtár létezik (a user adhatott
    // meg olyan path-ot, ami még nem létezik).
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // 5) Backup a korábbi fájlról — a `bak` MINDIG az előző write
    // előtti állapotot őrzi, így a user bármikor vissza tudja
    // állítani a write előtti konfigot.
    if (existsSync(this.path)) {
      copyFileSync(this.path, `${this.path}.bak`);
    }

    // 6) Atomic write. A `write-file-atomic.sync` a write-tmp + rename
    // pattern-t használja, és a `chmod` / `chown` hibákat is kezeli.
    // A string átadáshoz a default `utf8` encoding-ot használja.
    try {
      writeFileAtomic.sync(this.path, serialized, "utf8");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`ConfigStore.write: failed to write ${this.path}: ${message}`, {
        cause: err,
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
    prevMode: "paper" | "live",
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
      prevMode,
      newMode: next.bot.mode,
    };

    // Audit-log append. A `<path>.audit.log` fájl a bot-config melletti
    // sidecar — append-only, JSON-lines formátumban. A user bármikor
    // `cat mm-bot.toml.audit.log | jq` formában ellenőrizheti a
    // korábbi megerősítéseket.
    const auditPath = `${this.path}.audit.log`;
    try {
      writeFileSync(auditPath, `${JSON.stringify(entry)}\n`, { flag: "a" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `ConfigStore.writeAfterTypedLive: failed to write audit log ${auditPath}: ${message}`,
        { cause: err },
      );
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
  public setStrategyEnabled(strategyId: StrategyName, enabled: boolean): void {
    const current = this.read();
    const strategiesSection: Record<string, Record<string, unknown>> = {
      ...current.strategies,
    };
    const existingStrategy = strategiesSection[strategyId] ?? {};
    strategiesSection[strategyId] = { ...existingStrategy, enabled };
    const next: BotConfig = {
      ...current,
      strategies: strategiesSection as unknown as BotConfig["strategies"],
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
  public setStrategySetting(
    strategyId: StrategyName,
    key: string,
    value: unknown,
  ): void {
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
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const fkey = `strategies.${strategyId}.${key}`;
        const list = fieldErrors[fkey] ?? [];
        list.push(issue.message);
        fieldErrors[fkey] = list;
      }
      throw new ConfigValidationError(
        `Strategy setting validation failed for strategies.${strategyId}.${key}:\n${issues
          .map((i) => `  • ${i.path}: ${i.message}`)
          .join("\n")}`,
        fieldErrors,
        issues,
      );
    }

    const current = this.read();
    const strategiesSection: Record<string, Record<string, unknown>> = {
      ...current.strategies,
    };
    const existingStrategy = strategiesSection[strategyId] ?? {};
    strategiesSection[strategyId] = { ...existingStrategy, [key]: value };
    const next: BotConfig = {
      ...current,
      strategies: strategiesSection as unknown as BotConfig["strategies"],
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
  public setExchangeConfig(
    partial: Partial<BotConfig["exchange"]>,
  ): void {
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
  public setTelemetryConfig(
    partial: Partial<BotConfig["telemetry"]>,
  ): void {
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
  const resolved = resolve(path ?? "./mm-bot.toml");
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

/**
 * packages/tui/src/hooks/useConfigStore.ts
 *
 * Phase 36 Track C1 — a TUI settings panel TOML persistence hook.
 *
 * ===========================================================================
 * DESIGN
 * ===========================================================================
 * A `useConfigStore` hook egy általános (`Record<string, unknown>`-szintű)
 * TOML read/write state-machine, ami a TUI settings panel belső state-jét
 * kezeli. A hook NEM függ a `BotConfig` Zod-sémától — a típus-validáció
 * a consumer oldalán (apps/bot) történik, a `save` callback-en keresztül.
 *
 * State machine:
 *   idle (clean, data === disk) ──── edit field ────► dirty (in-memory ≠ disk)
 *   ▲                                                       │
 *   │                                                       │
 *   └──── save() (success) ◄──── save() (error: errors[]) ─┤
 *                                                           │
 *   ▲                                                       │
 *   └──────── abandon() (discard in-memory) ────────────────┘
 *
 * A hook az alábbi primitíveket biztosítja:
 *   - `data: Record<string, unknown>`   — a jelenlegi in-memory config
 *   - `dirty: boolean`                 — true ha az in-memory adat ≠ disk
 *   - `errors: ReadonlyArray<...>`     — a save() során fellépő hibák
 *   - `save(): Promise<boolean>`       — save indítása (a consumer validál)
 *   - `abandon(): void`                — in-memory elvetése, újraolvasás
 *   - `setData(next): void`           — in-memory frissítése (UI binding)
 *
 * A hook a `useEffect` mount-oláskor automatikusan beolvassa a
 * `configPath` TOML-fájlt. Hiba esetén (a fájl nem létezik, parse-hiba)
 * a `data` üres object-re inicializálódik, és a `readError` mezőben
 * tárolja a hibát.
 *
 * ===========================================================================
 * USAGE (a consumer — apps/bot — oldaláról)
 * ===========================================================================
 *
 *   const cfg = useConfigStore({
 *     configPath: "./mm-bot.toml",
 *     save: async (data) => {
 *       // A consumer validál a Zod-sémával, és a ConfigStore.write
 *       // metódussal írja ki (atomic + .bak).
 *       const store = getConfigStore(configPath);
 *       const validated = store.validate(data);  // throws on failure
 *       store.write(validated);
 *       return true;
 *     },
 *   });
 *
 *   if (cfg.readError !== null) console.error(cfg.readError);
 *   cfg.setData({ ...cfg.data, risk: { ...cfg.data.risk, max_leverage: 5 } });
 *   if (cfg.dirty) await cfg.save();
 *
 * ===========================================================================
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { readFileSync } from "node:fs";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
// `write-file-atomic` CJS — a default export egy `writeFile` függvény,
// amihez `.sync` property-ként csatlakozik a szinkron write.
// A `write-file-atomic` 8.x nem szállít TypeScript típus-deklarációt,
// ezért a lokális `global-types/write-file-atomic.d.ts` fájl biztosítja
// a típusokat (lásd `packages/tui/src/global-types/`).
// eslint-disable-next-line @typescript-eslint/no-require-imports
import writeFileAtomic from "write-file-atomic";

// ============================================================================
// Public types
// ============================================================================

/**
 * `ConfigStoreError` — a save során keletkezett hiba.
 *
 * A `SaveResult` discriminated union `kind: "validation"` vagy
 * `kind: "io"` mezővel jelzi a hiba típusát — a UI más-más
 * megjelenítést ad nekik (a validation hiba a Zod fieldErrors-t
 * tartalmazza, míg az io hiba egy általános "could not write"
 * üzenet).
 */
export type ConfigStoreError =
  | {
      readonly kind: "validation";
      readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
      readonly message: string;
    }
  | {
      readonly kind: "io";
      readonly message: string;
    };

/**
 * `UseConfigStoreOptions` — a `useConfigStore` hook konfigurációs objektuma.
 */
export interface UseConfigStoreOptions {
  /**
   * A TOML-fájl útvonala. A hook mount-kor beolvassa, és a `save()`
   * is ide ír. A hook az útvonalat `resolve()`-eli a hook indításakor,
   * és onnantól a `setData` hatására frissített in-memory másolatot
   * kezel.
   */
  readonly configPath: string;

  /**
   * A consumer save callback-je. A hook meghívja, amikor a user
   * a `[Ctrl+S]` billentyűt nyomja. A callback kapja a jelenlegi
   * in-memory adatot (`Record<string, unknown>`), és:
   *   - siker esetén `void`-ot ad vissza, és a hook a `setData`
   *     értékét a disk-ről újraolvassa (a `dirty` false-ra vált);
   *   - hiba esetén `throw`-ol, és a hook a `errors` tömbben
   *     tárolja a hibát.
   *
   * A consumer itt végzi a Zod-validációt + az atomic write-ot
   * + az audit-log írást. A hook NEM próbálja a Zod-ot futtatni —
   * az a fogyasztó réteg felelőssége.
   */
  readonly save: (data: Readonly<Record<string, unknown>>) => Promise<void> | void;
}

/**
 * `UseConfigStoreResult` — a `useConfigStore` hook visszatérési értéke.
 */
export interface UseConfigStoreResult {
  readonly data: Record<string, unknown>;
  readonly dirty: boolean;
  readonly errors: readonly ConfigStoreError[];
  readonly readError: string | null;
  readonly saving: boolean;
  readonly setData: (next: Record<string, unknown>) => void;
  readonly save: () => Promise<boolean>;
  readonly abandon: () => void;
}

// ============================================================================
// Hook implementation
// ============================================================================

/**
 * `readToml` — a TOML-fájl beolvasása + parse.
 *
 * A függvény a `node:fs.readFileSync` szinkron verzióját használja,
 * mert a hook a mount-oláskor fut (a React `useEffect` indítja).
 * A parse-hiba `Error`-t dob, amit a hook elkap és a `readError`
 * mezőben tárol.
 *
 * A `smol-toml` parse formátuma `Record<string, unknown>`, tehát
 * a visszatérési érték kompatibilis a hook `data` típusával.
 */
function readToml(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf8");
  // A `parse` a `smol-toml` ESM exportja, ami `TomlTable` (azaz
  // `Record<string, unknown>`) típusú értéket ad vissza. A TS-típus
  // A `parseToml` visszatérési típusa `Record<string, TomlValue>`,
  // ami strukturálisan kompatibilis a `Record<string, unknown>`-kal
  // (a `TomlValue` unió típus minden ága `unknown`-kompatibilis).
  return parseToml(text);
}

/**
 * `useConfigStore` — a TUI settings panel TOML persistence hook.
 *
 * A hook a mount-oláskor beolvassa a `configPath` TOML-fájlt, és
 * egy state-machine-t kezel az in-memory adatok, a dirty flag, és
 * a save-hibák fölött. A consumer a `save` callback-en keresztül
 * felelős a Zod-validációért és az atomic write-ért.
 */
export function useConfigStore(options: UseConfigStoreOptions): UseConfigStoreResult {
  const { configPath, save: saveCallback } = options;

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  // A mount-kor beolvasott, a disk-ről származó "baseline" — ehhez
  // képest számoljuk a `dirty` flaget.
  const [baseline, setBaseline] = useState<Record<string, unknown>>({});
  // Az in-memory szerkesztett adat.
  const [data, setDataState] = useState<Record<string, unknown>>({});
  // A save-hibák listája (sikeres save után []).
  const [errors, setErrors] = useState<readonly ConfigStoreError[]>([]);
  // A read-hiba (mount-kor vagy a frissítéskor).
  const [readError, setReadError] = useState<string | null>(null);
  // A save folyamatban van-e (UI spinner).
  const [saving, setSaving] = useState<boolean>(false);
  // A baseline frissítésének trigger flagje (a save sikeres).
  const [baselineRev, setBaselineRev] = useState<number>(0);

  // --------------------------------------------------------------------------
  // Mount: TOML read
  // --------------------------------------------------------------------------

  useEffect(() => {
    try {
      const onDisk = readToml(configPath);
      setBaseline(onDisk);
      setDataState(onDisk);
      setReadError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setReadError(message);
      setBaseline({});
      setDataState({});
    }
    // A `configPath` a hook indításakor `resolve`-elve van, és a
    // hook nem figyeli a path-változásokat (a consumer felelőssége
    // a `key` prop használata, ha új path-ot akar).
  }, [configPath, baselineRev]);

  // --------------------------------------------------------------------------
  // Dirty flag
  // --------------------------------------------------------------------------

  // A dirty flag a `data` és a `baseline` JSON-szerializált
  // összehasonlításából jön. Az `useRef` használata azért kell,
  // mert a `dirty` kiszámítása `useEffect`-ben fut, NEM a render
  // során (a render-ben a `useState` értékét használjuk).
  const dirtyRef = useRef<boolean>(false);
  const [dirty, setDirty] = useState<boolean>(false);

  useEffect(() => {
    const a = JSON.stringify(baseline);
    const b = JSON.stringify(data);
    const isDirty = a !== b;
    if (isDirty !== dirtyRef.current) {
      dirtyRef.current = isDirty;
      setDirty(isDirty);
    }
  }, [baseline, data]);

  // --------------------------------------------------------------------------
  // setData — UI binding
  // --------------------------------------------------------------------------

  const setData = useCallback((next: Record<string, unknown>): void => {
    setDataState(next);
  }, []);

  // --------------------------------------------------------------------------
  // save — consumer callback invocation + error handling
  // --------------------------------------------------------------------------

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setErrors([]);
    try {
      await saveCallback(data);
      // A save sikeres: a baseline-ot a frissített data-ra állítjuk,
      // és a dirty flag false-ra vált.
      setBaseline(data);
      setBaselineRev((n) => n + 1);
      return true;
    } catch (err: unknown) {
      // A Zod-validációs hiba a `ConfigValidationError` típusú
      // (apps/bot/src/config/store.ts). A consumer itt a Zod
      // fieldErrors-ét adja vissza a UI-nak.
      if (isConfigValidationError(err)) {
        setErrors([
          {
            kind: "validation",
            fieldErrors: err.fieldErrors,
            message: err.message,
          },
        ]);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setErrors([{ kind: "io", message }]);
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [data, saveCallback]);

  // --------------------------------------------------------------------------
  // abandon — in-memory discard + disk re-read
  // --------------------------------------------------------------------------

  const abandon = useCallback((): void => {
    setDataState(baseline);
    setErrors([]);
  }, [baseline]);

  return {
    data,
    dirty,
    errors,
    readError,
    saving,
    setData,
    save,
    abandon,
  };
}

/**
 * `ConfigValidationErrorShape` — a duck-typed shape, amit a
 * `ConfigStore` az apps/bot-ban dob. A hook NEM importálja az
 * apps/bot típust (rossz irányú lenne a monorepo dep-ek között),
 * hanem a shape-re type guard-ot ír.
 */
interface ConfigValidationErrorShape {
  readonly name: "ConfigValidationError";
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly message: string;
}

/**
 * `isConfigValidationError` — type guard a `ConfigValidationError`
 * duck-typed shape-re.
 *
 * A `fieldErrors` mező jelenléte + a `message` string + a `name`
 * együttesen egyértelműen azonosítja a Zod-rejected save-ot. Az
 * apps/bot `ConfigValidationError` osztálya ezt a formátumot adja.
 */
function isConfigValidationError(
  err: unknown,
): err is ConfigValidationErrorShape {
  if (err === null || typeof err !== "object") return false;
  const candidate = err as {
    name?: unknown;
    fieldErrors?: unknown;
    message?: unknown;
  };
  return (
    candidate.name === "ConfigValidationError" &&
    typeof candidate.fieldErrors === "object" &&
    candidate.fieldErrors !== null &&
    typeof candidate.message === "string"
  );
}

// Re-export a `stringifyToml` és a `writeFileAtomic` referenciaként —
// a consumer (vagy a `RawTomlViewer` Track C2) közvetlenül is
// használhatja a TOML-szerializáláshoz. Így a settings panel és a
// raw viewer ugyanazt a TOML-formázót használja (nincs drift).
export { parseToml, stringifyToml, writeFileAtomic };

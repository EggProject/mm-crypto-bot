// Shared structured logger.
//
// Routing invariants:
//   - accepted entries are serialized as one JSON object per line;
//   - file-enabled mode persists entries and mirrors them to stderr;
//   - `noFile` mode sends accepted entries only to stderr;
//   - stdout never receives log entries;
//   - the configured threshold is applied before any write.

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
  info: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
  warn: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
  error: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
}

const LOG_LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  // A LogLevel literal union típus védi a `level` / `threshold` értékeit.
  // eslint-disable-next-line security/detect-object-injection -- typed Record index
  const a = LOG_LEVEL_ORDER[level];
  // eslint-disable-next-line security/detect-object-injection -- typed Record index
  const b = LOG_LEVEL_ORDER[threshold];
  return a >= b;
}

/**
 * A `createLogger` opcióinak típusa.
 *
 * A `level` a threshold — az ennél alacsonyabb szintű log sorok
 * NEM kerülnek kiírásra. A `noFile` kikapcsolja a fájl-írást
 * (tesztek / CI esetén hasznos). A `logDir` a log fájl könyvtára
 * (default: `"logs/bot"`). A `logFileBase` a fájlnév-prefixum
 * (default: `"bot"` — a fájlnév `bot-YYYY-MM-DD.log` formátumban
 * jön létre).
 */
export interface CreateLoggerOptions {
  readonly level?: LogLevel;
  readonly noFile?: boolean;
  readonly logDir?: string;
  readonly logFileBase?: string;
}

/**
 * `writeToStderr` — egy sort ír a `process.stderr`-re (és egy newline-t).
 *
 * A `process.stderr.write` a Node.js-ben egy alacsony-szintű write
 * metódus, ami a `console.error`-hez hasonlóan működik, de a tesztek
 * a `process.stderr.write` spy-on könnyen monitorozhatják.
 */
function writeToStderr(text: string): void {
  // A `process.stderr.write` a visszatérési értéke `boolean` (true = siker).
  // Az `unknown` típusú cast azért kell, mert a TS szigorú típusú
  // `WriteStream.write` overload-okkal rendelkezik, és mi a legegyszerűbb
  // formát használjuk.
  process.stderr.write(`${text}\n`);
}

/**
 * `createLogger` — visszaad egy `Logger` interfészt, amely
 *   - writes accepted entries to the configured destinations, never stdout,
 *   - a `stderr`-re ír (operator-facing: warn/error azonnal látszik)
 *   - threshold-ot alkalmaz (a `level` opciónál alacsonyabb szintű
 *     sorok eldobva)
 *
 * Implementáció: `appendFileSync` a fájlba (szinkron, azonnal
 * olvasható) + `process.stderr.write` a stderr-re. A `Console` osztály
 * használata helyett ez a közvetlen megközelítés egyszerűbb, és a
 * Bun runtime-tal is kompatibilis (a `Console` osztály fake-stream
 * kezelése a Bun alatt problémás volt).
 *
 * A hagyományos string-alapú hívásforma is támogatott backward-compat
 * okokból: `createLogger("info")` ≡ `createLogger({ level: "info" })`.
 */
export function createLogger(
  levelOrOptions: LogLevel | CreateLoggerOptions = "info",
): Logger {
  // Backward-compat: a régi `createLogger(level: LogLevel)` forma.
  // Ha a paraméter string, átalakítjuk opció-objektummá.
  const options: CreateLoggerOptions =
    typeof levelOrOptions === "string" ? { level: levelOrOptions } : levelOrOptions;

  const level: LogLevel = options.level ?? "info";
  const noFile: boolean = options.noFile ?? false;
  const logDir: string = options.logDir ?? "logs/bot";
  const logFileBase: string = options.logFileBase ?? "bot";

  // A log fájl útvonala (ha `noFile === false`). A `mkdirSync` a
  // `createLogger` hívásakor fut le — a tesztek a `logDir` opcióval
  // egyedi tmp-könyvtárba írhatnak.
  const logFilePath: string | null = noFile
      ? null
      : (() => {
        // A `mkdirSync({ recursive: true })` idempotens.
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- logDir is the explicit caller-selected logger destination
        mkdirSync(logDir, { recursive: true });
        const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        return join(logDir, `${logFileBase}-${date}.log`);
      })();

  /**
   * `emit` — a log sor összeállítása és kiírása.
   *   - A threshold alatti szintű sorok eldobva.
   *   - A `warn` + `error` szintek a stderr-re mennek (azonnali láthatóság).
   *   - Az `info` + `debug` szintek a fájlba (vagy stderr-re, ha `noFile`).
   *   - A meta objektum spread-elve az entry-be.
   */
  const emit = (
    msgLevel: LogLevel,
    msg: string,
    meta?: Readonly<Record<string, unknown>>,
  ): void => {
    if (!shouldLog(msgLevel, level)) return;
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: msgLevel,
      msg,
      ...(meta ?? {}),
    };
    const serialized = JSON.stringify(entry);
    if (noFile) {
      // `noFile` mód: minden log a `stderr`-re megy (tesztek, CI).
      writeToStderr(serialized);
    } else {
      // Production mód (`noFile: false`): a log sor a FÁJLBA ÉS a
      // `stderr`-re is kerül. A fájl a post-mortem elemzéshez kell
      // (grep-elhető history); a `stderr` az azonnali láthatóságot
      // biztosítja a headless módban futó bot operátorának.
      //
      // Az `if (!noFile) ... else` ágak garantálják, hogy
      // `logFilePath` itt nem lehet `null` — a `!` assertion csak
      // a TS típus-szűkítést segíti.
      writeToStderr(serialized);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- logFilePath is derived from the explicit caller-selected logger destination
      appendFileSync(logFilePath!, `${serialized}\n`, "utf8");
    }
  };

  return {
    debug: (msg, meta) => {
      emit("debug", msg, meta);
    },
    info: (msg, meta) => {
      emit("info", msg, meta);
    },
    warn: (msg, meta) => {
      emit("warn", msg, meta);
    },
    error: (msg, meta) => {
      emit("error", msg, meta);
    },
  };
}

// Shared structured logger.
//
// Routing invariants:
//   - accepted entries are serialized as one JSON object per line;
//   - file-enabled mode persists entries and mirrors them to stderr;
//   - `noFile` mode sends accepted entries only to stderr;
//   - stdout never receives log entries;
//   - the configured threshold is applied before any write.

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  info: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  warn: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  error: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
}

function logLevelWeight(level: LogLevel): number {
  switch (level) {
    case "debug": {
      return 0;
    }
    case "info": {
      return 1;
    }
    case "warn": {
      return 2;
    }
    case "error": {
      return 3;
    }
  }
}

function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  return logLevelWeight(level) >= logLevelWeight(threshold);
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

type LoggerDestination = { readonly kind: "stderr" } | { readonly kind: "file"; readonly filePath: string };

function createLoggerDestination(
  isNoFile: boolean,
  logDirectory: string,
  logFileBase: string,
): LoggerDestination {
  if (isNoFile) {
    return { kind: "stderr" };
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- logDirectory is the explicit caller-selected logger destination
  mkdirSync(logDirectory, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  return { kind: "file", filePath: path.join(logDirectory, `${logFileBase}-${date}.log`) };
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
export function createLogger(levelOrOptions: LogLevel | CreateLoggerOptions = "info"): Logger {
  // Backward-compat: a régi `createLogger(level: LogLevel)` forma.
  // Ha a paraméter string, átalakítjuk opció-objektummá.
  const options: CreateLoggerOptions =
    typeof levelOrOptions === "string" ? { level: levelOrOptions } : levelOrOptions;

  const level: LogLevel = options.level ?? "info";
  const isNoFile: boolean = options.noFile ?? false;
  const logDirectory: string = options.logDir ?? "logs/bot";
  const logFileBase: string = options.logFileBase ?? "bot";

  const destination = createLoggerDestination(isNoFile, logDirectory, logFileBase);

  /**
   * `emit` — a log sor összeállítása és kiírása.
   *   - A threshold alatti szintű sorok eldobva.
   *   - A `warn` + `error` szintek a stderr-re mennek (azonnali láthatóság).
   *   - Az `info` + `debug` szintek a fájlba (vagy stderr-re, ha `noFile`).
   *   - A meta objektum spread-elve az entry-be.
   */
  const emit = (messageLevel: LogLevel, message: string, meta?: Readonly<Record<string, unknown>>): void => {
    if (!shouldLog(messageLevel, level)) return;
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: messageLevel,
      msg: message,
      ...meta,
    };
    const serialized = JSON.stringify(entry);
    if (destination.kind === "stderr") {
      // `noFile` mód: minden log a `stderr`-re megy (tesztek, CI).
      writeToStderr(serialized);
    } else {
      // Production mód (`noFile: false`): a log sor a FÁJLBA ÉS a
      // `stderr`-re is kerül. A fájl a post-mortem elemzéshez kell
      // (grep-elhető history); a `stderr` az azonnali láthatóságot
      // biztosítja a headless módban futó bot operátorának.
      //
      writeToStderr(serialized);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- destination.filePath is derived from the explicit caller-selected logger destination
      appendFileSync(destination.filePath, `${serialized}\n`, "utf8");
    }
  };

  return {
    debug: (message, meta) => {
      emit("debug", message, meta);
    },
    info: (message, meta) => {
      emit("info", message, meta);
    },
    warn: (message, meta) => {
      emit("warn", message, meta);
    },
    error: (message, meta) => {
      emit("error", message, meta);
    },
  };
}

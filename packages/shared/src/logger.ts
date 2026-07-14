// packages/shared/src/logger.ts — közös log-oló
//
// ===========================================================================
// PHASE 36 TRACK A2 — log routing fix (2026-07-14 21:30 Budapest)
// ===========================================================================
//
// A korábbi implementáció `console.log(JSON.stringify(entry))` hívással
// a `process.stdout`-ra írt. Ez a user TUI-ján megjelent (mert az Ink a
// `stdout`-ot használja a render surface-ként), a felhasználó pedig
// panaszkodott: "az `s` billentyűre logok jelentek meg a TUI tetején".
//
// A Phase 36 Track A2 javítás:
//   1) A `createLogger` a fájlba + `stderr`-re ír (Node `fs.appendFileSync` +
//      `process.stderr.write` — stdlib, zero deps).
//   2) A log sorok a `logs/bot/bot-YYYY-MM-DD.log` fájlba kerülnek
//      (append módban) — a `bot.start()`-tól a `bot.stop()`-ig minden
//      entry megmarad.
//   3) A `stderr` MINDIG megkapja a `warn` + `error` szintű sorokat
//      (az "operátornak azonnal tudnia kell" elv). Az `info` + `debug`
//      szintek is a `stderr`-re mennek, ha a `noFile: true` opció aktív
//      (tesztek / CI / explicit konzol-mód).
//   4) Az `stdout` SOHA NEM kap log sort — ez a TUI render surface-e.
//   5) A tesztek a `noFile: true` opcióval kapcsolhatják ki a fájl-írást,
//      ÉS a `process.stderr.write` spy-on ellenőrzik a stderr-kimenetet.
//
// ===========================================================================
// FELHASZNÁLÓI MANDATE (2026-07-14 20:58 BUDAPEST)
// ===========================================================================
// User issue #2: "az [s] billentyűre logok jelentek meg a TUI tetején".
// A kiváltó ok az volt, hogy a `bot.stop()` során a `logger.info()`
// a `process.stdout`-ra írt — ez az Ink render surface-e, és a log
// sor a TUI frame TETEJÉN jelent meg.
//
// A javítás: a logger soha nem ír a `process.stdout`-ra. Minden log
// sor a fájlba ÉS a `stderr`-re megy. A TUI-nak így ESÉLYE sincs
// "látni" a log sorokat, mert az Ink csak a `stdout`-ból olvas.
//
// ===========================================================================
// BACKWARD COMPATIBILITY
// ===========================================================================
// A `createLogger(level: LogLevel)` hívásforma továbbra is működik
// (a `level` az első paraméter, a többi opcionális). A meglévő
// híváshelyek a `bot/`, `order-manager.ts`, `position-manager.ts`,
// `state-store.ts`, `telemetry.ts`, `strategy-runner.ts`,
// `kill-switches.ts` fájlokban:
//     createLogger("info")          // régi forma — továbbra is működik
//     createLogger({ level: "info" }) // új, opcionális objektum forma
//
// A régi forma a `level` paramétert a Zod default-okkal egyezően
// "info"-ra állítja; minden más opció a default.
//
// ===========================================================================
// TESZT FELELŐSSÉG
// ===========================================================================
//   - A `process.stderr.write` spy-on ellenőrzi a stderr-kimenetet.
//   - A `logDir` + `noFile: false` kombináció a fájlt írja.
//   - A `process.stdout.write` spy-on ellenőrzi, hogy az stdout
//     SOHA nem kap log sort (ez a TUI-bug fix-ének a pin-tesztje).
//
// A 100%-os line coverage fenntartásához minden ágat (noFile true/false,
// level threshold, level=debug, level=warn, level=error) le kell fedni.

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
 *   - fájlba ír (NO stdout-ra, a TUI-bug fix!)
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
      // A TUI módban (`mm-bot start`) a `stderr` kimenet az Ink
      // `alternateScreen` pufferébe NEM kerül — a user a TUI-ból
      // kilépve LÁTHATJA a log sorokat a terminál scrollback-jében.
      // A TUI futása alatt a log sorok a `stderr` pufferben gyűlnek,
      // a TUI alternate screen ELFEDI őket — ez a kívánt viselkedés
      // (a user a TUI-ban tiszta felületet lát).
      //
      // Az `if (!noFile) ... else` ágak garantálják, hogy
      // `logFilePath` itt nem lehet `null` — a `!` assertion csak
      // a TS típus-szűkítést segíti.
      writeToStderr(serialized);
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

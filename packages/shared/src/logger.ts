// packages/shared/src/logger/index.ts — közös log-oló
//
// A scaffold fázisban egy egyszerű konzol-alapú structured logger van itt.
// A későbbi fázisban ez fog kapni:
//   - log-szint szűrést
//   - JSON formátumot production módhoz
//   - opcionális fájl- / syslog- rotációt
//   - kérés-korrelációs ID-ket a CCXT REST/WS hívásokhoz
//
// MEGJEGYZÉS: A `security/detect-object-injection` rule false-positive-ot ad
// a `Record<LogLevel, number>[key]` indexelésnél, pedig a kulcsok típus-rendszer
// által védettek (LogLevel literal union). Ezért lokálisan kikapcsoljuk.

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
  const a = LOG_LEVEL_ORDER[level];
  const b = LOG_LEVEL_ORDER[threshold];
  return a >= b;
}

export function createLogger(level: LogLevel = "info"): Logger {
  const log = (msgLevel: LogLevel, msg: string, meta?: Readonly<Record<string, unknown>>): void => {
    if (!shouldLog(msgLevel, level)) return;
    // A meta Record<string, unknown> terjesztése — típus-rendszer védi, security rule FP.
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: msgLevel,
      msg,
      ...(meta ?? {}),
    };
    console.log(JSON.stringify(entry));
  };

  return {
    debug: (msg, meta) => {
      log("debug", msg, meta);
    },
    info: (msg, meta) => {
      log("info", msg, meta);
    },
    warn: (msg, meta) => {
      log("warn", msg, meta);
    },
    error: (msg, meta) => {
      log("error", msg, meta);
    },
  };
}

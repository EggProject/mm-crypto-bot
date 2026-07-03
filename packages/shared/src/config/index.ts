// packages/shared/src/config/index.ts — konfiguráció betöltése
//
// A `@mm/shared/config` modul a `.env` fájlból és a futtatókörnyezetből
// olvassa ki a beállításokat, és típusosan adja vissza a fogyasztóknak.
// A scaffold fázisban egy `loadConfig()` placeholder van itt, ami a
// későbbi fázisokban fog tényleges implementációt kapni.

export interface AppConfig {
  readonly env: "paper" | "live";
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly ccxtRateLimitMs: number;
}

export function loadConfig(): AppConfig {
  // A későbbi fázisban: tényleges .env betöltés és zod-séma validáció.
  // Egyelőre biztonságos default-okat adunk vissza.
  return {
    env: (process.env["BUN_ENV"] === "live" ? "live" : "paper"),
    logLevel: (process.env["LOG_LEVEL"] ?? "info") as AppConfig["logLevel"],
    ccxtRateLimitMs: Number.parseInt(process.env["CCXT_RATE_LIMIT_MS"] ?? "100", 10),
  };
}

/**
 * apps/bot/src/cli/commands/start.ts
 *
 * Phase 33 Track D + Phase 34 Track A + Phase 36 Track A1 + Phase 44 —
 * `mm-bot start` — a bot indítása.
 *
 * ===========================================================================
 * PHASE 44 — PURE HEADLESS START (2026-07-16)
 * ===========================================================================
 *
 *   User mandate (2026-07-16 16:53 Budapest, verbatim):
 *     "a bot inditasi terv nem jo, mondtam hogy a bot parancs headles
 *      induljon es masik parancs inditsa el a websocket es minden egyeb
 *      dolgot. Igy a bot nem pazarol eroforrast ha csak headless akarom
 *      futtatni, de barmikor ra tudok csatlakozni ezzel a kulon webes
 *      kliens elinditasaval."
 *
 * A Phase 44 előtt a `mm-bot start` ALAPÉRTELMEZETTEN az Ink TUI-t
 * indította (a `runTui` útvonalon). A Phase 44 törölte a TUI-t
 * (`packages/tui/`, `apps/bot/src/tui/`, a `tui` subcommand), és a
 * `mm-bot start` mostantól KIZÁRÓLAG headless módban fut. Nincs
 * `--headless` / `--no-tui` flag (nincs TUI, ami ellen alternatíva
 * lenne), nincs Ink dependency, nincs React, nincs WebSocket.
 *
 * A headless mód:
 *   - A bot elindul a `bot.start()` hívással.
 *   - A `console.log` / `console.error` egy log fájlba íródik
 *     át (`<state_file>.log`), hogy a bot futása alatt a stdout
 *     tiszta maradjon (a Phase 43 Track 3-ból megörökölt log-routing
 *     logika).
 *   - A SIGINT / SIGTERM signal-okra a bot graceful leáll.
 *
 * ===========================================================================
 * FLAGS
 * ===========================================================================
 *   --config=<path>     TOML config file (opcionális; default-ot használ)
 *   --auto-start        A bot induljon a parancs kiadásakor (default: true)
 *   --no-auto-start     Ne indítsa el a botot — a state-feed csatlakozáshoz
 *                       kell (Phase 45+). A Phase 44-ben ez egy no-op
 *                       (nincs state-feed szerver), de a flag parsolva
 *                       van a backward compatibility kedvéért.
 *   --no-color          Letiltja az ANSI színkódokat. A NO_COLOR=1
 *                       env var-t a `startCommand` végén is beállítja
 *                       (a subcommand-handler-ek futása ELŐTT, a
 *                       `apps/bot/src/index.ts` már megtette).
 *   --help, -h          Help szöveg.
 *
 * ===========================================================================
 * FLAG PRECEDENCE
 * ===========================================================================
 *   A `bot.auto_start` érték feloldási sorrendje (Phase 36 Track A1):
 *     1) CLI flag (--auto-start / --no-auto-start) — utolsó nyer
 *     2) TOML config (`[bot] auto_start = true/false`)
 *     3) Default: `true` (a Phase 44-gyel: a bot mindig indul, ha a
 *                     `start` parancsot kiadjuk; a `--no-auto-start`
 *                     a Phase 45 state-feed csatlakozáshoz kell).
 *
 * ===========================================================================
 * 1:10 LEVERAGE INVARIANT (Phase 10G §3-layer defense-in-depth)
 * ===========================================================================
 * A headless indítás NEM érinti a position management-et — a 3 layer
 * (`loadBotConfig` Zod, `OrderManager.placeOrder` pre-place check,
 * `PositionManager.recordFill` post-fill check) továbbra is érvényesül.
 *
 * ===========================================================================
 * EXIT CODES
 * ===========================================================================
 *   0 — clean shutdown (after SIGINT/SIGTERM or self-completion)
 *   1 — startup error (config load, instantiation, etc)
 *   2 — config validation failure
 */

import { ConfigError, loadBotConfig } from "../../config/index.js";
import type { BotConfig } from "../../config/schema.js";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir, open } from "node:fs/promises";
import { Bot } from "../../bot/bot.js";
import type { SubcommandHandler } from "../router.js";

/**
 * `getConfigPath` — pull the `--config=path` flag, or `undefined`.
 */
function getConfigPath(flags: ReadonlyMap<string, string | boolean>): string | undefined {
  const v = flags.get("config");
  if (typeof v === "string" && v.length > 0) {
    return v;
  }
  return undefined;
}

/**
 * `isNoColor` — `--no-color` flag jelenlétét ellenőrzi.
 *
 * A Phase 34 Track C-ből megörökölt logika: a `NO_COLOR=1` env var-t
 * a `startCommand` végén is beállítja (a subcommand-handler-ek futása
 * ELŐTT, az `apps/bot/src/index.ts` már megtette — defense in depth).
 */
function isNoColor(flags: ReadonlyMap<string, string | boolean>): boolean {
  if (flags.get("no-color") === true) return true;
  if (flags.get("color") === false) return true; // --no-color explicit
  return false;
}

/**
 * `startCommand` — a `mm-bot start` handler.
 *
 * Phase 44: a parancs PURE HEADLESS. Nincs TUI, nincs Ink, nincs React.
 * A bot a `runHeadless` útvonalon indul el, és a console.log/console.error
 * a `<state_file>.log` fájlba íródik.
 *
 * Megjegyzés a `--auto-start` / `--no-auto-start` flag-ekről:
 *   Ezek a flag-ek a Phase 36 Track A1 user mandate-ból származnak
 *   (a TUI `stopped` alapállapotához). A Phase 44-gyel a TUI törölve
 *   lett, és a bot MINDIG indul a `start` parancs kiadásakor. A
 *   flag-ek a backward-compat kedvéért PARSOLVA maradnak, de a
 *   jelenlegi implementációban nincs hatásuk. A Phase 45+ state-feed
 *   szerver bevezetésekor a `--no-auto-start` flag ismét értelmet
 *   nyer (a state-feed csatlakozáshoz kell — a bot indítása nélkül
 *   figyeli a bot state-ét).
 */
export const startCommand: SubcommandHandler = async (args) => {
  const configPath = getConfigPath(args.flags);
  const noColor = isNoColor(args.flags);

  // --------------------------------------------------------------------------
  // 0) NO_COLOR env var beállítása, ha a user kérte.
  // --------------------------------------------------------------------------
  if (noColor && process.env["NO_COLOR"] === undefined) {
    process.env["NO_COLOR"] = "1";
  }

  // --------------------------------------------------------------------------
  // 1) Help: --help / -h esetén kiírjuk a parancs-saját help szöveget.
  // --------------------------------------------------------------------------
  if (args.flags.get("help") === true) {
    printStartHelp();
    return 1;
  }

  // --------------------------------------------------------------------------
  // 2) Load + validate config.
  // --------------------------------------------------------------------------
  let config;
  try {
    config = loadBotConfig(configPath);
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      console.error("Config validation FAILED:");
      console.error(err.message);
      return 2;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to load config: ${message}`);
    return 1;
  }

  // --------------------------------------------------------------------------
  // 3) Warn if mode=live and no API keys are set.
  // --------------------------------------------------------------------------
  if (config.bot.mode === "live") {
    const hasKey = typeof process.env["BYBIT_API_KEY"] === "string" && process.env["BYBIT_API_KEY"].length > 0;
    if (!hasKey) {
      console.warn("[start] WARNING: bot.mode = 'live' but BYBIT_API_KEY is not set");
      console.warn("[start]          the exchange client will fail to authenticate at first request");
    }
  }

  // --------------------------------------------------------------------------
  // 4) Create Bot instance + run headless. A `--no-auto-start` flag
  //    jelenleg no-op (a Phase 45+ state-feed attach path-hoz kell).
  //    A bot mindig indul a `mm-bot start` parancsra.
  // --------------------------------------------------------------------------
  const bot = new Bot({ config });

  // --------------------------------------------------------------------------
  // 5) Run headless — a console.log/console.error átirányítása a log
  //    fájlba, hogy a bot futása alatt a stdout tiszta maradjon.
  // --------------------------------------------------------------------------
  return await runHeadless(bot, config);
};

/**
 * `runHeadless` — a plain text log mód. A bot-ot elindítja, és a
 * SIGINT/SIGTERM signal-okra graceful leállítja.
 *
 * Phase 44 óta ez az EGYETLEN mód — nincs TUI/headless branch. A
 * console.log/console.error a `<state_file>.log` fájlba íródik, hogy
 * a bot futása alatt a stdout tiszta maradjon (a Phase 43 Track 3-ból
 * megörökölt log-routing logika).
 */
async function runHeadless(bot: Bot, config: BotConfig): Promise<number> {
  // -------------------------------------------------------------------------
  // Phase 43 Track 3 — Console redirection in headless mode
  // -------------------------------------------------------------------------
  // A bot futása alatt a `console.log` / `console.error` a
  // `<state_file>.log` fájlba íródik. A stdout tiszta marad
  // (a user ne lásson log sorokat a terminálján, ha a botot
  // háttérben futtatja, vagy egy másik terminálból monitorozza).
  //
  // A `process.stdout.write`-ot NEM írjuk felül — a logger a
  // console.log/console.error-t használja, a structured output
  // (pl. a jövőbeli state-feed JSON üzenetek) a process.stdout.write
  // -on át megy, és a fájlba való átirányítás nem érinti.
  const logFilePath = resolveLogFilePath(config);
  const logFileStream = await openLogFile(logFilePath);
  const consoleBackup = installConsoleRedirection(logFileStream);

  let stopping = false;
  const onSignal = (sig: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[start] received ${sig} — initiating graceful shutdown`);
    void bot.stop().then(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    await bot.start();
    return 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[start] bot crashed: ${message}`);
    return 1;
  } finally {
    restoreConsoleRedirection(consoleBackup);
    await closeLogFile(logFileStream);
  }
}

/**
 * `printStartHelp` — a `mm-bot start --help` szövege.
 */
function printStartHelp(): void {
  const lines: string[] = [
    "Usage: mm-bot start [--config=path] [--no-color] [--help]",
    "",
    "Launch the bot in PURE HEADLESS mode (no TUI, no Ink, no React).",
    "  The bot runs until SIGINT/SIGTERM, or until it crashes.",
    "  Console output is redirected to <state_file>.log.",
    "",
    "Options:",
    "  --config=<path>       TOML config file (optional; uses defaults if absent)",
    "  --no-color            Disable ANSI color codes",
    "  --help, -h            Show this help",
    "",
    "Examples:",
    "  mm-bot start                          # start the bot (paper mode by default)",
    "  mm-bot start --no-color               # start the bot without color",
    "  mm-bot start --config=./prod.toml     # start the bot with custom config",
  ];
  for (const line of lines) {
    console.error(line);
  }
}

// ============================================================================
// Phase 43 Track 3 — Headless-mode console redirection helpers
// ============================================================================

/**
 * `resolveLogFilePath` — a headless módban használt log-fájl abszolút
 * path-ját adja vissza. A fájl ugyanoda kerül, mint a bot state_file
 * (alapértelmezetten `data/bot-state.json` → `data/bot-state.json.log`).
 *
 * A user a `startCommand` futtatásakor a bot kimenetét látja; ha hiba
 * van, a log fájl `tail -f` módban olvasható egy másik terminálban.
 */
function resolveLogFilePath(config: BotConfig): string {
  const stateFile = config.bot.state_file;
  return `${stateFile}.log`;
}

/**
 * `openLogFile` — megnyitja (vagy létrehozza) a log fájlt append
 * módban. A fs promises API-t használja (Bun-kompatibilis). A
 * visszatérési `FileHandle` a finally blokkban záródik.
 */
async function openLogFile(path: string): Promise<FileHandle> {
  // Biztosítjuk, hogy a parent directory létezzen.
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  return open(path, "a");
}

/**
 * `installConsoleRedirection` — a `console.log` / `console.error`
 * függvényeket átirányítja a megadott `FileHandle`-re. Visszaadja
 * az eredeti függvényeket, hogy a `finally` blokkban vissza lehessen
 * állítani.
 *
 * Fontos: CSAK a `console.log` / `console.error`-t írjuk felül, NEM
 * a `process.stdout.write`-ot. A `process.stdout.write` a jövőbeli
 * state-feed JSON kimenet számára van fenntartva (Phase 45+).
 *
 * A helper formázza a sorokat: timestamp + szint + sor + newline.
 */
function installConsoleRedirection(
  stream: FileHandle,
): { readonly log: typeof console.log; readonly error: typeof console.error } {
  const origLog = console.log;
  const origError = console.error;
  const writeLine = (level: "log" | "error", args: readonly unknown[]): void => {
    const text = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    const ts = new Date().toISOString();
    // A write lehet, hogy részleges — de a console.log/error mindig
    // teljes sorokkal dolgozik, így a `\n` hozzáadás biztonságos.
    stream.write(`${ts} [${level}] ${text}\n`).catch(() => {
      // Ha a write elbukik (pl. a fájl törölve futás közben),
      // csendben elnyeljük — a user a bot kimenetét látja, a log
      // másodlagos.
    });
  };
  console.log = (...args: unknown[]): void => {
    writeLine("log", args);
  };
  console.error = (...args: unknown[]): void => {
    writeLine("error", args);
  };
  return { log: origLog, error: origError };
}

/**
 * `restoreConsoleRedirection` — visszaállítja az eredeti
 * `console.log` / `console.error` függvényeket.
 */
function restoreConsoleRedirection(backup: {
  readonly log: typeof console.log;
  readonly error: typeof console.error;
}): void {
  console.log = backup.log;
  console.error = backup.error;
}

/**
 * `closeLogFile` — a finally blokkban hívódik. Megvárja a függő
 * write-okat, majd lezárja a fájlt.
 */
async function closeLogFile(stream: FileHandle): Promise<void> {
  try {
    await stream.sync();
  } catch {
    // best-effort
  }
  await stream.close();
}

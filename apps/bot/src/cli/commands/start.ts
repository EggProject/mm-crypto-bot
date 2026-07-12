/**
 * apps/bot/src/cli/commands/start.ts
 *
 * Phase 33 Track D + Phase 34 Track A — `mm-bot start` — a bot indítása.
 *
 * ===========================================================================
 * DEFAULT MODE: INK TUI (Phase 34 Track A — user mandate 2026-07-12 02:00)
 * ===========================================================================
 *
 *   "TUI-t es headless-t is akarom, default color, headless kapcsolhato ki a
 *    color, default Ink TUI."
 *
 * A `mm-bot start` parancs ALAPÉRTELMEZETTEN az Ink TUI-t indítja a
 * `LiveBotStateProvider` segítségével. A TUI a bot minden state-változását
 * realtime megjeleníti, és a [q] / Ctrl+C megnyomásával a botot
 * graceful leállítja.
 *
 * ===========================================================================
 * FLAGS
 * ===========================================================================
 *   --config=<path>     TOML config file (opcionális; default-ot használ)
 *   --headless          NO TUI — csak strukturált log a stdout-ra.
 *                       Ebben a módban a `@mm-crypto-bot/tui` csomag
 *                       NEM töltődik be (dynamic import), így a `bun build`
 *                       output-ból is kimarad.
 *   --no-tui            Alias a --headless flag-re.
 *   --no-color          Letiltja az ANSI színkódokat. Headless módban a
 *                       logger kimenetén; TUI módban az Ink natívan
 *                       tiszteletben tartja a `NO_COLOR=1` env var-t.
 *   --help, -h          Help szöveg.
 *
 * ===========================================================================
 * USER MANDATE (2026-07-12 02:00 BUDAPEST)
 * ===========================================================================
 * A user kéri, hogy a TUI legyen az ALAPÉRTELMEZETT mód, és a headless
 * módban (plain text logok) NE importálódjon az Ink. A `--no-color` flag
 * a `--headless` móddal kombinálva clean text-only kimenetet ad.
 *
 * ===========================================================================
 * 1:10 LEVERAGE INVARIANT (Phase 10G §3-layer defense-in-depth)
 * ===========================================================================
 * A TUI integráció NEM érinti a position management-et — a 3 layer
 * (`loadBotConfig` Zod, `OrderManager.placeOrder` pre-place check,
 * `PositionManager.recordFill` post-fill check) továbbra is érvényesül.
 * A TUI csak a bot state-ét olvassa, soha nem ír bele.
 *
 * ===========================================================================
 * EXIT CODES
 * ===========================================================================
 *   0 — clean shutdown (after SIGINT/SIGTERM or self-completion)
 *   1 — startup error (config load, instantiation, etc)
 *   2 — config validation failure
 */

import { ConfigError, loadBotConfig } from "../../config/index.js";
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
 * `isHeadless` — `--headless` vagy `--no-tui` flag jelenlétét ellenőrzi.
 * Mindkettő ugyanazt jelenti: a TUI kikapcsolása, plain text logok.
 */
function isHeadless(flags: ReadonlyMap<string, string | boolean>): boolean {
  if (flags.get("headless") === true) return true;
  if (flags.get("no-tui") === true) return true;
  if (flags.get("tui") === false) return true; // --no-tui explicit
  return false;
}

/**
 * `isNoColor` — `--no-color` flag jelenlétét ellenőrzi.
 * Ha aktív, a process indítása ELŐTT beállítjuk a `NO_COLOR=1` env var-t,
 * hogy az Ink (és minden más library, ami támogatja a NO_COLOR-t) tudjon
 * róla a dynamic import előtt.
 */
function isNoColor(flags: ReadonlyMap<string, string | boolean>): boolean {
  if (flags.get("no-color") === true) return true;
  if (flags.get("color") === false) return true; // --no-color explicit
  return false;
}

/**
 * `startCommand` — a `mm-bot start` handler.
 *
 * A flag-ek korai kiértékelése (mielőtt a TUI importálódna):
 *   - `--no-color` → `process.env.NO_COLOR = "1"`
 *   - `--headless` → NEM importáljuk a `@mm-crypto-bot/tui` csomagot
 *   - default → a TUI-t dynamic importáljuk, és rendereljük
 */
export const startCommand: SubcommandHandler = async (args) => {
  const configPath = getConfigPath(args.flags);
  const headless = isHeadless(args.flags);
  const noColor = isNoColor(args.flags);

  // --------------------------------------------------------------------------
  // 0) NO_COLOR env var beállítása, ha a user kérte.
  //    Ezt a TUI import ELŐTT tesszük, mert az Ink induláskor olvassa
  //    a környezeti változót.
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
  // 4) Create Bot instance.
  // --------------------------------------------------------------------------
  const bot = new Bot({ config });

  // --------------------------------------------------------------------------
  // 5) Branch: HEADLESS vs TUI.
  //    A `--headless` mód NEM importálja a `@mm-crypto-bot/tui` csomagot —
  //    így a TUI-s dependency-k (ink, react) nem töltődnek be.
  // --------------------------------------------------------------------------
  if (headless) {
    return await runHeadless(bot);
  }
  return await runTui(bot, config.symbols.enabled);
};

/**
 * `runHeadless` — a plain text log mód. Csak a strukturált logger ír a
 * stdout-ra; a TUI NEM indul el, és a `@mm-crypto-bot/tui` NEM importálódik.
 */
async function runHeadless(bot: Bot): Promise<number> {
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
  }
}

/**
 * `runTui` — az Ink TUI mód. Dynamic importálja a `@mm-crypto-bot/tui`
 * csomagot (és a `LiveBotStateProvider`-t), rendereli a TUI-t, és a
 * TUI kilépésekor (`[q]` / Ctrl+C / `app.unmount()`) leállítja a botot.
 *
 * A dynamic import azért fontos, mert:
 *   - A `--headless` mód futtatásakor a bundler NEM húzza be az ink/react
 *     csomagokat (a `bun build` output-ból kimaradnak).
 *   - Az Ink induláskor olvassa a `NO_COLOR` env var-t; a dynamic import
 *     időpontjában az env már be van állítva.
 */
async function runTui(bot: Bot, enabledSymbols: readonly string[]): Promise<number> {
  // Dynamic import — CSAK a TUI módban töltődik be.
  const tuiModule = await import("@mm-crypto-bot/tui");
  const { LiveBotStateProvider } = await import("../../tui/live-bot-state-provider.js");

  // A provider a bot-hoz csatlakozik, mielőtt a bot elindul.
  // A `LiveBotStateProvider` feliratkozik a bot state-változásaira,
  // és a TUI-nak adja tovább.
  const provider = new LiveBotStateProvider({
    bot,
    enabledSymbols,
    initialEquityUsdt: 10_000,
  });
  await provider.start();

  // A bot indul, a TUI renderelése párhuzamosan történik.
  // Ha a bot indítása elszáll, a TUI kilép, és a hibát a start
  // Promise-ből olvassuk ki.
  const botStartPromise = bot.start().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[start] bot crashed: ${message}`);
    return err as Error;
  });

  // A TUI renderelése — az Ink `render` függvénye egy `Instance`-et
  // ad vissza, aminek `waitUntilExit()` Promise-re vár.
  // A Phase 34 Track B kiegészítés: az `onStop` / `onPause` callback-eket
  // átadjuk az `App`-nak, hogy a TUI-ból jövő stop/pause kérések a
  // start command szintjén is megjelenjenek (log + persist).
  const app = tuiModule.renderTuiWithCallbacks(provider, {
    onStop: () => {
      console.error("[start] TUI requested stop — bot stopping");
    },
    onPause: (paused: boolean) => {
      console.error(`[start] TUI requested pause=${String(paused)}`);
    },
  });

  // SIGINT handler: ha a TUI nem kapja el (vagy a user a process-t
  // öli meg), a bot szintén leáll. A TUI-ból jövő [q] / Ctrl+C a
  // provider.stop() → bot.stop() útvonalon megy.
  let signalStopping = false;
  const onSignal = (sig: NodeJS.Signals): void => {
    if (signalStopping) return;
    signalStopping = true;
    console.error(`[start] received ${sig} — initiating graceful shutdown`);
    void (async () => {
      try {
        await bot.stop();
      } catch {
        // best-effort
      }
      app.unmount();
    })();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  // Várunk, amíg a TUI ki nem lép.
  await app.waitUntilExit();

  // A TUI kilépett — a botot is leállítjuk (idempotens, ha a TUI
  // már hívta a stop-ot a provider-en át).
  try {
    await bot.stop();
  } catch {
    // best-effort
  }

  // A bot indítás Promise-jét is kivárjuk (ha a bot indítása a TUI
  // futása közben reject-elt volna, a hibát itt látjuk).
  const startErr = await botStartPromise;
  if (startErr instanceof Error) {
    return 1;
  }
  return 0;
}

/**
 * `printStartHelp` — a `mm-bot start --help` szövege.
 */
function printStartHelp(): void {
  const lines: string[] = [
    "Usage: mm-bot start [--config=path] [--headless] [--no-color] [--help]",
    "",
    "Start the bot. Default mode is the Ink TUI (interactive).",
    "",
    "Options:",
    "  --config=<path>     TOML config file (optional; uses defaults if absent)",
    "  --headless          No TUI — plain text logs only (NO ink/react loaded)",
    "  --no-tui            Alias for --headless",
    "  --no-color          Disable ANSI color codes (headless + TUI both respect it)",
    "  --help, -h          Show this help",
    "",
    "Examples:",
    "  mm-bot start                          # TUI (default)",
    "  mm-bot start --headless               # plain text logs, no TUI",
    "  mm-bot start --no-color               # TUI without color",
    "  mm-bot start --headless --no-color    # clean text logs (no color, no TUI)",
    "  mm-bot start --config=./prod.toml     # TUI with custom config",
  ];
  for (const line of lines) {
    console.error(line);
  }
}

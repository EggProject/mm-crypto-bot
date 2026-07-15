/**
 * apps/bot/src/cli/commands/start.ts
 *
 * Phase 33 Track D + Phase 34 Track A + Phase 36 Track A1 —
 * `mm-bot start` — a bot indítása.
 *
 * ===========================================================================
 * DEFAULT MODE: INK TUI + STOPPED STATE (Phase 36 Track A1 — 2026-07-14)
 * ===========================================================================
 *
 *   User mandate (2026-07-14 20:58 Budapest, issue #1):
 *     "`mm-bot start` ne induljon automatikusan — a TUI `stopped`
 *      állapotban nyíljon, a user a `[s]` billentyűvel indítsa a botot."
 *
 * A Phase 36 Track A1 változás: a `mm-bot start` ALAPÉRTELMEZETTEN NEM
 * indítja el a botot. A TUI megnyílik, és a bot `stopped` állapotban
 * várja a user `[s]` billentyűs indítását.
 *
 *   A régi viselkedés (auto-start) visszakapcsolható:
 *     - TOML: `[bot] auto_start = true`
 *     - CLI: `mm-bot start --auto-start`
 *
 *   `--headless` módban a `bot.auto_start` default-ját a `--auto-start`
 *   / `--no-auto-start` CLI flag-ekkel lehet felülbírálni. A `--headless`
 *   flag NEM jelent auto-start-ot (a headless a TUI-ról szól, nem az
 *   indításról).
 *
 * ===========================================================================
 * DEFAULT MODE: INK TUI (Phase 34 Track A — 2026-07-12 02:00)
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
 *   --auto-start        Indítsa el a botot a TUI indulásával együtt
 *                       (felülbírálja a `bot.auto_start = false` default-ot).
 *   --no-auto-start     Ne indítsa el a botot automatikusan (a TOML-beli
 *                       `bot.auto_start = true`-t is felülbírálja).
 *   --no-color          Letiltja az ANSI színkódokat. Headless módban a
 *                       logger kimenetén; TUI módban az Ink natívan
 *                       tiszteletben tartja a `NO_COLOR=1` env var-t.
 *   --help, -h          Help szöveg.
 *
 * ===========================================================================
 * FLAG PRECEDENCE (Phase 36 Track A1)
 * ===========================================================================
 *   A `bot.auto_start` érték feloldási sorrendje:
 *     1) CLI flag (--auto-start / --no-auto-start) — utolsó nyer
 *     2) TOML config (`[bot] auto_start = true/false`)
 *     3) Default: `false` (a user mandate: NEM indul automatikusan)
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
 *
 * Phase 34 Track C: the canonical `NO_COLOR=1` env-var set is now done
 * globally in `apps/bot/src/index.ts` (before any subcommand dispatches).
 * This `isNoColor()` is kept as a defense-in-depth check: if a caller
 * invokes `startCommand` directly (e.g. from a test that bypasses the
 * entry point), the local env-var set still runs. The conditional
 * `&& process.env["NO_COLOR"] === undefined` makes the local set a
 * no-op when the global one already wrote the var.
 */
function isNoColor(flags: ReadonlyMap<string, string | boolean>): boolean {
  if (flags.get("no-color") === true) return true;
  if (flags.get("color") === false) return true; // --no-color explicit
  return false;
}

/**
 * `resolveAutoStart` — feloldja a `bot.auto_start` végső értékét
 * a CLI flag-ek és a TOML config alapján.
 *
 * Precedence (Phase 36 Track A1):
 *   1) CLI `--auto-start`     → `true`  (explicit pozitív)
 *   2) CLI `--no-auto-start`  → `false` (explicit negatív)
 *   3) TOML `config.bot.auto_start`     (a Zod default `false`)
 *
 * Ha a user MINDKETTŐ CLI flag-et megadja, a parser `Map`-je az utolsó
 * értéket tartja (a `Map.set` last-write-wins). Ezt a függvényt a
 * parser hívása UTÁN hívjuk, így a flags.get(...) a végső értéket adja.
 *
 * @param configAutoStart  A `config.bot.auto_start` értéke (Zod-ból).
 * @param flags            A `parseArgv` által visszaadott flag-ek.
 * @returns                A végső `auto_start` boolean érték.
 */
function resolveAutoStart(
  configAutoStart: boolean,
  flags: ReadonlyMap<string, string | boolean>,
): boolean {
  // Phase 36 Track A1: a parser a `--no-X` formát `flags.set(X, false)`-szal
  // ÉS `flags.set("no-" + X, true)`-vel is bejegyzi. A "no-auto-start" kulcs
  // jelenléte jelzi, hogy a user explicit kiírta a `--no-auto-start`-et.
  // A `--auto-start` flag a parserben `flags.set("auto-start", value)`-ként
  // jelenik meg (boolean, vagy value, ha a flag után nem-flag token jön).
  //
  // A legegyszerűbb feloldás:
  //   - Ha `flags.get("auto-start") === true`  → auto-start
  //   - Ha `flags.get("no-auto-start") === true` → NO auto-start (explicit)
  //   - Különben: a config értéke.
  //
  // A "last wins" kölcsönhatás a `Map.set` szemantikájából jön: a parser
  // sorban dolgozza fel a flag-eket, és az utolsó `set` felülírja az előzőt.
  // Tehát ha a user `start --auto-start --no-auto-start`-et ír, a
  // `flags.get("auto-start")` a `--no-auto-start` által beállított `false`,
  // ÉS a `flags.get("no-auto-start")` is `true`. A végső érték `false`.
  if (flags.get("no-auto-start") === true) {
    // Explicit `--no-auto-start` a parancsban — a config-ot FELÜLBÍRÁLJA.
    return false;
  }
  if (flags.get("auto-start") === true) {
    // Explicit `--auto-start` a parancsban — a config-ot FELÜLBÍRÁLJA.
    return true;
  }
  // Nincs explicit CLI flag — a config értéke érvényesül.
  return configAutoStart;
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
  // 4) Resolve auto_start (CLI flag + TOML config precedence).
  //    Phase 36 Track A1: a user mandate a "stopped" default, így az
  //    `auto_start` alapértelmezetten `false`. Ha a config vagy a CLI
  //    flag `true`-ra állítja, a bot indul; ha `false`, a TUI
  //    `stopped` állapotban nyílik.
  // --------------------------------------------------------------------------
  const autoStart = resolveAutoStart(config.bot.auto_start, args.flags);

  // --------------------------------------------------------------------------
  // 5) Közös infó-sor a stderr-re: a felhasználó mindig LÁSSA, hogy
  //    a bot indul-e vagy stopped állapotban vár. Ez a Phase 36 Track A1
  //    "változás láthatóvá tétele" elve — nincs silent behavior change.
  // --------------------------------------------------------------------------
  if (headless) {
    // Headless mód: a `--auto-start` flag NEM érvényesül (a headless
    // mindig indul, hiszen nincs TUI, ami megállítaná). A bot a headless
    // módban a `bot.start()` hívással indul.
    console.error(
      "[start] headless mode: bot will start automatically (--headless implies start)",
    );
  } else if (autoStart) {
    // TUI + auto-start: a bot indul a TUI-val együtt.
    console.error(
      "[start] TUI mode + auto-start: bot starts immediately (pass --no-auto-start to stay paused)",
    );
  } else {
    // TUI + no auto-start: a TUI `stopped` állapotban nyílik. A user
    // a `[s]` billentyűvel indítja a botot.
    console.error(
      "[start] TUI mode + NO auto-start: bot starts STOPPED — press [s] to start",
    );
  }

  // --------------------------------------------------------------------------
  // 6) Create Bot instance.
  // --------------------------------------------------------------------------
  const bot = new Bot({ config });

  // --------------------------------------------------------------------------
  // 7) Branch: HEADLESS vs TUI.
  //    A `--headless` mód NEM importálja a `@mm-crypto-bot/tui` csomagot —
  //    így a TUI-s dependency-k (ink, react) nem töltődnek be.
  // --------------------------------------------------------------------------
  if (headless) {
    return await runHeadless(bot);
  }
  return await runTui(bot, config.symbols.enabled, autoStart);
};

/**
 * `runHeadless` — a plain text log mód. Csak a strukturált logger ír a
 * stdout-ra; a TUI NEM indul el, és a `@mm-crypto-bot/tui` NEM importálódik.
 *
 * Phase 36 Track A1: a headless mód MINDIG auto-start (a `--auto-start` /
 * `--no-auto-start` CLI flag-ek csak TUI módban érvényesülnek, mert a
 * headless-ben nincs TUI, ami megállítaná a botot). A felhasználó ezt
 * a `startCommand` 5) lépésében lévő stderr INFO-sorból láthatja.
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
 *
 * Phase 36 Track A1: a `bot.start()` hívás CSAK akkor történik meg, ha
 * `autoStart === true`. Ha `false`, a bot `stopped` állapotban marad,
 * és a TUI-ból jövő `[s]` billentyű indítja. A `LiveBotStateProvider`
 * a bot indítása ELŐTT subscribe-ol a bot state-re, így a provider
 * `getSnapshot()` mindig a friss state-et adja vissza (a bot indítása
 * előtt `running: false`, utána `running: true`).
 */
async function runTui(
  bot: Bot,
  enabledSymbols: readonly string[],
  autoStart: boolean,
): Promise<number> {
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

  // A bot indul CSAK HA az auto-start kérte. Ha `autoStart === false`,
  // a TUI `stopped` állapotban nyílik, és a user a `[s]` billentyűvel
  // indítja a botot.
  //
  // Ha a bot indítása elszáll, a hibát a `botStartPromise` reject-jéből
  // olvassuk ki, ÉS a TUI-ban az `engineError` mezőben is megjelenik.
  //
  // Phase 38 Fix #38: a `state.running` TUI mező CSAK a bot
  // sikeres indulása után `true`. A provider-t a bot indulása ELŐTT
  // indítjuk (hogy a TUI stopped state-ben nyíljon), és a
  // `markBotStarted()` hívással jelezzük, amikor a bot valóban
  // futni kezd. Az `autoStart=false` ág NEM hívja a `markBotStarted()`-et
  // — ebben az esetben a TUI a stopped state-et mutatja a user
  // interakciójáig.
  const botStartPromise = autoStart
    ? bot
        .start()
        .then(() => {
          provider.markBotStarted();
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[start] bot crashed: ${message}`);
          return err as Error;
        })
    : Promise.resolve(undefined);

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
        // Phase 38 Fix #38: a TUI-nak a stopped state-et KELL mutatnia,
        // ha a bot leállt (akár a user, akár a SIGINT állította le).
        provider.markBotStopped();
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
    // Phase 38 Fix #38: a TUI bezárása előtt a `botRunning` flag-et
    // `false`-ra állítjuk. A provider belső logikája is megteszi ezt
    // a `provider.stop()` híváskor, de a TUI-ból jövő [q] NEM
    // feltétlenül hívja a provider.stop()-ot (lásd az App.tsx
    // useInput handler-ét: a [q] mindig kilép, de a `state.running`
    // ellenőrzése előtt). A TUI-s kilépéskor explicit jelezzük a
    // provider felé, hogy a bot leállt.
    provider.markBotStopped();
  } catch {
    // best-effort
  }

  // A bot indítás Promise-jét is kivárjuk (ha a bot indítása a TUI
  // futása közben reject-elt volna, a hibát itt látjuk).
  if (autoStart) {
    const startErr = await botStartPromise;
    if (startErr instanceof Error) {
      return 1;
    }
  }
  return 0;
}

/**
 * `printStartHelp` — a `mm-bot start --help` szövege.
 *
 * Phase 36 Track A1: a help átszervezése a clig.dev "lead with examples"
 * elve alapján. Az első sor a "stopped" default-ot hangsúlyozza, a
 * FLAGS szekcióban az `--auto-start` / `--headless` kerül előre, és
 * 3 konkrét usage example mutatja a tipikus hívásokat.
 */
function printStartHelp(): void {
  const lines: string[] = [
    "Usage: mm-bot start [--config=path] [--auto-start|--no-auto-start] [--headless] [--no-color] [--help]",
    "",
    "Launch the mm-bot TUI in the STOPPED state (no trades until you press [s]).",
    "  The bot does NOT auto-start — you control start/stop from the TUI.",
    "  Use --auto-start to bring back the old behavior (bot starts with the TUI).",
    "",
    "Options:",
    "  --auto-start          Start the bot when the TUI opens (default: false)",
    "  --no-auto-start       Force stopped state even if config says otherwise",
    "  --headless            No TUI — plain text logs only (NO ink/react loaded)",
    "  --no-tui              Alias for --headless",
    "  --config=<path>       TOML config file (optional; uses defaults if absent)",
    "  --no-color            Disable ANSI color codes (headless + TUI both respect it)",
    "  --help, -h            Show this help",
    "",
    "Flag precedence:  CLI > TOML > default (false). Last --auto-start/--no-auto-start wins.",
    "",
    "Examples:",
    "  mm-bot start                          # TUI in stopped state (press [s] to start)",
    "  mm-bot start --auto-start             # TUI, bot starts immediately (old behavior)",
    "  mm-bot start --headless               # plain text logs, bot runs continuously",
    "  mm-bot start --no-color               # TUI without color (stays stopped)",
    "  mm-bot start --config=./prod.toml     # TUI with custom config (default stopped)",
  ];
  for (const line of lines) {
    console.error(line);
  }
}

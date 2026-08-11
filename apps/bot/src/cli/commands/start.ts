/**
 * apps/bot/src/cli/commands/start.ts
 *
 * Phase 33 Track D + Phase 34 Track A + Phase 36 Track A1 + Phase 44 +
 * Phase 81 — `mm-bot start` — a bot indítása.
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
 *   - A bot a `bot.auto_start` config mező értékétől függően indul.
 *   - A `console.log` / `console.error` egy log fájlba íródik
 *     át (`<state_file>.log`), hogy a bot futása alatt a stdout
 *     tiszta maradjon (a Phase 43 Track 3-ból megörökölt log-routing
 *     logika).
 *   - A SIGINT / SIGTERM signal-okra a bot graceful leáll.
 *
 * ===========================================================================
 * PHASE 81 — `auto_start` HONORED IN HEADLESS MODE (2026-07-25)
 * ===========================================================================
 *
 *   User mandate (2026-07-25 Budapest, verbatim):
 *     "a paper-backtest-verified.toml-mal indított bot ne induljon
 *      automatikusan — a user a dashboard 'Start' gombbal indítsa."
 *
 *   A Phase 36 Track A1 óta a `[bot] auto_start` config mező a
 *   sémában van, de a Phase 44 óta a `mm-bot start` MINDIG indítja
 *   a botot (a flag-ek parsolva vannak, de nincs hatásuk). A
 *   Phase 81 a konfiguráció-vezérelt viselkedést visszahozza:
 *
 *     - `bot.auto_start = true` (vagy hiányzó) → bot indul a parancs
 *       kiadásával egyidőben (BACKWARD COMPAT — a meglévő config-ok
 *       nem törnek el).
 *     - `bot.auto_start = false` → a bot `stopped` állapotban marad.
 *       A state-feed csatlakozik, a dashboard `Bot: STOPPED` feliratot
 *       mutat, és a user a "Start" gombra kattintva indítja a botot.
 *       A folyamat a SIGINT / SIGTERM-ig fut (a state-feed TCP szerver
 *       tartja életben az event loopot).
 *
 *   A `paper-backtest-verified.toml` explicit `auto_start = false`-t
 *   állít be (a Phase 30b backtest-eredmények reprodukálásához a user
 *   kézi indítása mellett); a `live-eu.toml` explicit `auto_start = true`-t
 *   (ami egyenértékű a hiányzó mezővel).
 *
 * ===========================================================================
 * FLAGS
 * ===========================================================================
 *   --config=<path>     TOML config file (opcionális; default-ot használ)
 *   --auto-start        A bot induljon a parancs kiadásakor
 *                       (CLI override: felülírja a config `[bot] auto_start` értéket)
 *   --no-auto-start     Ne indítsa el a botot — a state-feed csatlakozik,
 *                       de a bot `stopped` állapotban marad. A dashboard
 *                       "Start" gombbal indítja.
 *   --no-color          Letiltja az ANSI színkódokat. A NO_COLOR=1
 *                       env var-t a `startCommand` végén is beállítja
 *                       (a subcommand-handler-ek futása ELŐTT, a
 *                       `apps/bot/src/index.ts` már megtette).
 *   --help, -h          Help szöveg.
 *
 * ===========================================================================
 * FLAG PRECEDENCE
 * ===========================================================================
 *   A `bot.auto_start` érték feloldási sorrendje (Phase 36 Track A1 +
 *   Phase 81):
 *     1) CLI flag (--auto-start / --no-auto-start) — utolsó nyer
 *        Ha a user mindkettőt kiírta, a PARSER last-write-wins alapján
 *        utolsó érvényesül (a Map setter felülírja a korábbi értéket).
 *     2) TOML config (`[bot] auto_start = true/false`) — ha a CLI flag
 *        NINCS kiírva, a config értéke érvényesül.
 *     3) Default: `true` (Phase 81 — backward compat). A meglévő
 *        config-ok, amelyek nem definiálják a flag-et, TOVÁBBRA IS
 *        auto-startolnak.
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
import { attachStateFeed, resolveFeedPort, type StateFeedHandle } from "../../state-feed/index.js";
import { OhlcStore } from "../../state-feed/ohlc-store.js";
import { bootstrapOhlcStore } from "../../state-feed/ohlc-bootstrap.js";
import { HeadlessBotLifecycle } from "./start-lifecycle.js";

export { HeadlessBotLifecycle } from "./start-lifecycle.js";

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
 * `resolveAutoStart` — a `bot.auto_start` effektív értékének feloldása
 * (Phase 81).
 *
 * Precedence (last-wins a CLI flag-eknél):
 *   1) `--auto-start` vagy `--no-auto-start` CLI flag → utolsó nyer
 *   2) `config.bot.auto_start` (a Zod séma default-ja: `true`)
 *
 * A parser a `--auto-start` → `flags.get("auto-start") === true` és
 * `--no-auto-start` → `flags.get("auto-start") === false` (valamint
 * `flags.get("no-auto-start") === true`) formátumban tárolja. Ha a
 * user mindkettőt kiírta, a Map setter last-write-wins viselkedése
 * miatt az utolsó nyer.
 *
 * Visszatérés: `{ autoStart: boolean, source: "cli" | "config" }`
 *   - `source` jelzi, hogy a CLI flag vagy a config értéke volt a
 *     nyertes — a `startCommand` ezt használja a "CLI override"
 *     WARN kiírásához.
 */
function resolveAutoStart(
  flags: ReadonlyMap<string, string | boolean>,
  configAutoStart: boolean,
): { readonly autoStart: boolean; readonly source: "cli" | "config" } {
  // A parser a `flags.get("auto-start")` értékétől függően tárolja
  // a CLI döntést. Ha a user explicit kiírt --auto-start VAGY
  // --no-auto-start flag-et, a Map-ben jelen van az "auto-start" kulcs
  // (a --no- a meglévő --no-X szabály miatt `false` értékkel írja be).
  // Ha a kulcs hiányzik, a CLI nem mondott semmit — a config dönt.
  if (flags.has("auto-start")) {
    const v = flags.get("auto-start");
    // A `--auto-start=true` / `--auto-start=false` explicit formát a
    // parser STRING-ként tárolja. A `String(v) === "true"` konverzió
    // ezt normalizálja.
    const autoStart = v === true || (typeof v === "string" && v === "true");
    return { autoStart, source: "cli" };
  }
  return { autoStart: configAutoStart, source: "config" };
}

/**
 * `startCommand` — a `mm-bot start` handler.
 *
 * Phase 44: a parancs PURE HEADLESS. Nincs TUI, nincs Ink, nincs React.
 * A bot a `runHeadless` útvonalon indul el, és a console.log/console.error
 * a `<state_file>.log` fájlba íródik.
 *
 * Phase 81: a `bot.auto_start` config mező (ÉS a `--auto-start` /
 * `--no-auto-start` CLI flag-ek) mostantól valóban szabályozzák a bot
 * indulását:
 *   - `autoStart = true`  → a bot a parancs kiadásával egyidőben indul
 *   - `autoStart = false` → a bot `stopped` állapotban marad; a
 *     dashboard "Start" gombbal indítja
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
  // 4) Resolve the effective `auto_start` value (Phase 81).
  //    Precedence: CLI flag (--auto-start/--no-auto-start, last wins) >
  //    config `[bot] auto_start` (Zod default: `true`).
  //    Ha a CLI override-olta a config-ot, WARN-t írunk (a user
  //    tudja, mit csinál, de a nyilvánvaló figyelmeztetés segít).
  // --------------------------------------------------------------------------
  const { autoStart, source } = resolveAutoStart(args.flags, config.bot.auto_start);
  if (source === "cli" && autoStart !== config.bot.auto_start) {
    const cliValue = String(autoStart);
    const configValue = String(config.bot.auto_start);
    console.warn(
      `[start] WARNING: --${autoStart ? "auto-start" : "no-auto-start"} (CLI) ` +
        `overrides config [bot] auto_start = ${configValue} → effective = ${cliValue}`,
    );
  }

  // --------------------------------------------------------------------------
  // 5) Create Bot instance + run headless.
  // --------------------------------------------------------------------------
  const bot = new Bot({ config });

  // --------------------------------------------------------------------------
  // 6) Run headless — a console.log/console.error átirányítása a log
  //    fájlba, hogy a bot futása alatt a stdout tiszta maradjon.
  //    A `runHeadless` megkapja az `autoStart` értéket, és ennek
  //    megfelelően hívja / NEM hívja a `bot.start()`-ot.
  // --------------------------------------------------------------------------
  return await runHeadless(bot, config, autoStart);
};

/**
 * `runHeadless` — a plain text log mód. A bot-ot elindítja (vagy
 * `stopped` állapotban hagyja — Phase 81), és a SIGINT/SIGTERM
 * signal-okra graceful leállítja.
 *
 * Phase 44 óta ez az EGYETLEN mód — nincs TUI/headless branch. A
 * console.log/console.error a `<state_file>.log` fájlba íródik, hogy
 * a bot futása alatt a stdout tiszta maradjon (a Phase 43 Track 3-ból
 * megörökölt log-routing logika).
 *
 * Phase 81: a `autoStart` paraméter szabályozza, hogy a bot indul-e
 *   - `true`  → a lifecycle elindítja a botot, és csak sikeres init után
 *                publikálja a `running` állapotot
 *   - `false` → a bot `stopped` állapotban marad, a state-feed csatlakozik,
 *               a dashboard "Start" gombbal indítja (a `handleControl("start")`
 *               callback hívja a `bot.start()`-ot)
 *
 * A process mindkét esetben a SIGINT/SIGTERM-ig fut — a state-feed TCP
 * szerver (vagy a `bot.start()` promise) tartja életben az event loopot.
 */
async function runHeadless(bot: Bot, config: BotConfig, autoStart: boolean): Promise<number> {
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

  // -------------------------------------------------------------------------
  // Phase 45 — State-feed attach
  // -------------------------------------------------------------------------
  // The state-feed starts before the engine so its TCP port is available while
  // initialization is in progress.  It intentionally exposes a coherent
  // `stopped` snapshot until the post-init readiness boundary marks it running.
  //
  // A port az `MM_BOT_FEED_PORT` env var-ból jön (fallback 7914).
  // A state-feed egyetlen stderr-sort ír: `[start] state-feed
  // listening on 127.0.0.1:<port>` — ez az EGYETLEN stderr output
  // a Phase 43 Track 3 log-routing óta.
  const feedPort = resolveFeedPort(process.env["MM_BOT_FEED_PORT"]);
  let stateFeed: StateFeedHandle | null = null;
  let lifecycle: HeadlessBotLifecycle | null = null;

  let stopping = false;
  const onSignal = (sig: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[start] received ${sig} — initiating graceful shutdown`);
    const stop = lifecycle === null ? bot.stop() : lifecycle.stop();
    void stop.then(async () => {
      // Phase 72: a graceful shutdown során a publisher `botRunning`
      // flag-jét is visszaállítjuk `false`-ra, hogy a state-feed az
      // utolsó pillanatban is a helyes "stopped" state-et sugározza.
      // A `markBotStopped()` idempotens — ha a flag már `false` (pl.
      // kill-switch triggered előtte), nem csinál semmit.
      if (stateFeed !== null) {
        stateFeed.publisher.markBotStopped();
        await stateFeed.close();
      }
      process.exit(0);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    // A state-feed attach a bot.start() ELŐTT kell, mert a
    // LiveStatePublisher a bot engine publisher-ére subscribe-ol,
    // és a bot engine a bot.start() során a publisher-en át
    // notify-olja a state-változásokat. Ha az attach a bot.start()
    // UTÁN történik, a bot engine run loopja már elindult, és a
    // publisher start() a bot engine notify-ciklusára vár, ami
    // soha nem következik be (deadlock) — ez volt a Phase 52E
    // teszt során felfedezett bug. (Komment a state-feed/index.ts:122.)
    // Phase 52E bugfix #2: a config.strategies objektumból a
    // publisher-stratégia listát is átadjuk, hogy a dashboard
    // mind a 3 (vagy N) stratégiát lássa, ne csak 1-et.
    //
    // Phase 76 fix: a korábbi `.filter(([, s]) => s.enabled)` sort
    // TÖRÖLTÜK. A user kérése: "minden strategiat a chartokon meg
    // kell jeleniteni" — a dashboard minden konfigurált stratégiát
    // mutasson, ne csak az engedélyezetteket. A chart kártya
    // `enabled` flag-je jelzi, hogy a stratégia valójában fut-e;
    // a `activeStrategyCount` a status banner-ban a publisher
    // `staticStrategies.filter(s => s.enabled).length`-ből jön
    // (publisher.ts:640), tehát a "X active strategies" szöveg
    // továbbra is a tényleges futó stratégiák számát mutatja.
    // A disabled stratégiák chartja ugyanazt az OHLC adatot
    // mutatja (a chart a (symbol, tf) párokra subscribe-ol, nem
    // stratégiára), csak a strategy név jelenik meg a title-ban
    // — így a user LÁTTA mind a 3 stratégiát, és a status banner
    // "1 active strategies" feliratból tudja, hogy valójában
    // mennyi fut.
    const strategiesFromConfig = Object.entries(config.strategies)
      .map(([name, s]) => {
        const section = s as {
          enabled?: boolean;
          cap?: number;
          symbols?: readonly string[];
          min_consensus?: number;
        };
        // `StateFeedStrategyDescriptor.cap` opcionális (`exactOptionalPropertyTypes`),
        // ezért csak akkor rakjuk be, ha ténylegesen van értéke.
        const descriptor: {
          name: string;
          enabled: boolean;
          symbols: string[];
          timeframes: readonly ["1h", "4h", "1d"];
          cap?: number;
        } = {
          name,
          enabled: section.enabled ?? true,
          symbols: [...(section.symbols ?? config.symbols.enabled)],
          timeframes: ["1h", "4h", "1d"] as const,
        };
        if (section.cap !== undefined) {
          descriptor.cap = section.cap;
        }
        return descriptor;
      });
    // Phase 73/74: bootstrap the OhlcStore from the data/ohlcv/ CSVs
    // BEFORE creating the state-feed. The `getAll()` method on the
    // store will return `[...historical, ...live]` for each (symbol, tf)
    // key, so the SNAPSHOT `ohlcBootstrap` field carries the full
    // 30-month history (85638 bars across 9 keys) into the web app
    // via the ws-relay → http-server cache → /api/ohlc path.
    const ohlcStore = new OhlcStore();
    const bootstrapResult = await bootstrapOhlcStore(ohlcStore);
    process.stderr.write(
      `[start] OHLCV bootstrap: ${String(bootstrapResult.loaded)} loaded, ${String(bootstrapResult.skipped)} skipped, ${String(bootstrapResult.totalBars)} total bars\n`,
    );
    stateFeed = await attachStateFeed(bot, {
      port: feedPort,
      enabledSymbols: config.symbols.enabled,
      // A bot config jelenleg nem tárolja az initial equity-t külön
      // mezőként (a mock feed balances[]-ából jön; a Phase 45A óta
      // 10 000 USDT a default). A Phase 45B a config-ból fogja
      // venni a `risk.max_position_fraction`-ből számítva.
      initialEquityUsdt: 10_000,
      // Phase 73/74: pass the pre-bootstrapped store so the SNAPSHOT
      // message carries the full 30-month history (instead of the
      // default 200-bar ring buffer).
      ohlcStore,
      strategies: strategiesFromConfig,
      // Phase 69: a state-feed CONTROL üzeneteit a bot életciklusához
      // kötjük. A `web-client HTTP /api/control` endpoint ezen a
      // csatornán küldi a start / stop / pause / resume / kill_switch
      // parancsokat; a `FeedServer` a state-feed-ből jövő CONTROL
      // üzeneteket a `handleControl` callback-en át ide továbbítja.
      //
      // A bot engine indulás utáni életciklusát (markBotStarted /
      // markBotStopped) a `bot.start()` / `bot.stop()` Promise
      // resolve-ja UTÁN hívjuk — a publisher a `botRunning` flag-en
      // és a `paused` flag-en át jelzi a dashboardnak a state-váltást.
      handleControl: (command, payload) => {
        switch (command) {
          case "start":
            // The lifecycle resolves at Bot's post-init boundary, not at the
            // long-lived `Bot.start()` shutdown promise.
            void lifecycle?.start().catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[start] handleControl(start) failed: ${msg}`);
            });
            return;
          case "stop":
            void (lifecycle === null ? bot.stop() : lifecycle.stop()).catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[start] handleControl(stop) failed: ${msg}`);
            });
            return;
          case "pause":
            // A `paused` flag a state-feed protokoll szerint a
            // `paused` payload mezőben jön (boolean). A Phase 69 UI
            // a Pause gombbal `paused: true`-t küld, a Resume gombbal
            // `paused: false`-t.  The publisher flag is only the UI mirror;
            // the engine gate lives on Bot/StrategyRunner and must be changed
            // in the same control action so a displayed pause cannot emit
            // orders in the background.
            bot.pause();
            stateFeed?.publisher.setPaused(payload.paused ?? true);
            return;
          case "resume":
            bot.resume();
            stateFeed?.publisher.setPaused(false);
            return;
          case "kill_switch":
            // A kill-switch vészleállító: a botot leállítja ÉS a
            // kill-switch UI-state-et `triggered`-re állítja. A
            // `publisher.killSwitch()` a `bot.stop()`-ot is hívja,
            // és a `killSwitchState` flag-et is frissíti.
            void stateFeed?.publisher.killSwitch();
            return;
        }
      },
    });
    // Phase 66: wire the state-feed handle INTO the bot so the OHLCV/ticker
    // callback inside `run()` can publish bars to the state-feed TCP socket.
    // Without this, `this.stateFeed` is `null` and the dashboard shows
    // "No charts configured" even though the bot is streaming real bybit.eu
    // data.
    bot.attachStateFeed(stateFeed);
    lifecycle = new HeadlessBotLifecycle(bot, stateFeed.publisher);
    // `attachStateFeed()` completed the TCP bind. Publish the listening
    // milestone before any engine work so the run loop can never delay port
    // availability or hide the initial stopped snapshot.
    process.stderr.write(
      `[start] state-feed listening on 127.0.0.1:${String(stateFeed.port)}\n`,
    );
    // A bot engine indítása a state-feed attach UTÁN — a publisher
    // a bot engine-en át kapja a notify-kat, és a state-feed TCP
    // socket-ére továbbítja a kliens felé.
    //
    // ===========================================================================
    // PHASE 72 — STATUS BROADCAST FIX (fire-and-forget bot.start)
    // ===========================================================================
    //   Phase 71 hiba (CSAK a Phase 72 diagnosztika során feltárt): a
    //   `start.ts:353` eredeti kódja `await bot.start()`-ot hívott, ami
    //   DEADLOCK-ot okozott. A `Bot.start()` belsejében az
    //   `await this.run()` hívódik, ami egy végtelen run-loop — CSAK a
    //   `bot.stop()` hívására tér vissza. Az `await` soha nem oldódott
    //   fel, így a `stateFeed.publisher.markBotStarted()` hívás
    //   ELÉRHETETLEN volt — a publisher `botRunning` flag-je örökre
    //   `false` maradt, és a dashboard `/api/status` endpointja
    //   `state: "stopped"`, `startedAt: 0` értékeket adott vissza
    //   (a cache-elt SNAPSHOT a bot induláskori "stopped" állapotot
    //   tükrözte, és a Phase 71 periodic refresh sem tudta frissíteni,
    //   mert `botRunning` mindig `false` volt).
    //
    //   A fix:
    //     1) `bot.start()` fire-and-forget (nem `await`!) — a bot init
    //        elindul, de a Promise csak a `bot.stop()`-ra oldódik fel.
    //     2) `markBotStarted()` SZINKRON hívása közvetlenül utána — a
    //        flag azonnal `true`-ra vált, és a publisher a SNAPSHOT
    //        event-en át broadcastolja az új state-et a state-feed-en.
    //        A `markBotStarted` NEM igényli a bot init befejezését —
    //        a flag a "a bot TERVEZETTEN fut" szemantikát jelenti,
    //        nem a "bot minden pozíciója megnyitva" állapotot.
    //     3) `botStartPromise.catch()` ASYNC hibaelkapás — ha a bot init
    //        elbukik, a `markBotStopped()` visszaállítja a flag-et.
    //     4) `await botStartPromise` BLOKKOLÁS a bot leállásáig — ez
    //        tartja életben a process-t, és a finally blokk csak a
    //        bot.stop() után fut le (graceful shutdown).
    // ===========================================================================
    //
    // ===========================================================================
    // PHASE 81 — `autoStart` HONORED (manual start from dashboard)
    // ===========================================================================
    //   Phase 81 user mandate: a `paper-backtest-verified.toml` config-gal
    //   indított bot NE induljon automatikusan. A `bot.auto_start = false`
    //   esetén:
    //     - NEM hívunk `bot.start()`-ot a `mm-bot start` parancsra.
    //     - A `stateFeed` csatlakozik, a dashboard `Bot: STOPPED` UI-t
    //       mutat, és a user a "Start" gombra kattintva indítja a botot.
    //     - A process-t a SIGINT/SIGTERM signal tartja életben (a
    //       `onSignal` handler hívja a `process.exit(0)`-t).
    //     - A `bot.start()` hívás később a `handleControl("start")`
    //       callback-en át történik (amikor a dashboard "Start" gombját
    //       megnyomja a user) — a meglévő callback logika változatlan.
    //   Ha `autoStart = true` (vagy hiányzik a flag), a régi viselkedés
    //   él: a `bot.start()` fire-and-forget hívódik, és a publisher
    //   `markBotStarted()` jelzi a dashboardnak, hogy a bot fut.
    // ===========================================================================
    if (autoStart) {
      await lifecycle.start();
      await lifecycle.waitForStop();
    } else {
      // Phase 81: a bot `stopped` állapotban marad. A `botRunning` flag
      // `false` (mert a `markBotStarted()` nem hívódik), a dashboard
      // "Bot: STOPPED" feliratot mutat. A user a dashboard "Start"
      // gombbal indítja a botot — a `handleControl("start")` callback
      // hívja a `bot.start()`-ot.
      process.stderr.write(
        `[start] auto_start=false — bot is in STOPPED state. ` +
          `Click "Start" in the dashboard to begin trading.\n`,
      );
      // A process-t a SIGINT/SIGTERM signal tartja életben. Az
      // `await new Promise<void>(() => undefined)` egy soha-fel-nem-oldódó
      // Promise — CSAK a `process.exit(0)` hívás (az `onSignal`
      // handler-ben) tud kilépni. A state-feed TCP szerver amúgy is
      // tartja az event loopot.
      await new Promise<never>(() => undefined);
    }
    return 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[start] bot crashed: ${message}`);
    return 1;
  } finally {
    if (stateFeed !== null) {
      try {
        await stateFeed.close();
      } catch {
        // best-effort
      }
    }
    restoreConsoleRedirection(consoleBackup);
    await closeLogFile(logFileStream);
  }
}

/**
 * `printStartHelp` — a `mm-bot start --help` szövege.
 */
function printStartHelp(): void {
  const lines: string[] = [
    "Usage: mm-bot start [--config=path] [--auto-start|--no-auto-start] [--no-color] [--help]",
    "",
    "Launch the bot in PURE HEADLESS mode (no TUI, no Ink, no React).",
    "  The bot runs until SIGINT/SIGTERM, or until it crashes.",
    "  Console output is redirected to <state_file>.log.",
    "",
    "Options:",
    "  --config=<path>       TOML config file (optional; uses defaults if absent)",
    "  --auto-start          Start the bot on launch (overrides [bot] auto_start = false)",
    "  --no-auto-start       Leave the bot in STOPPED state on launch (overrides",
    "                        [bot] auto_start = true). Click 'Start' in the dashboard",
    "                        to begin trading. (Phase 81)",
    "  --no-color            Disable ANSI color codes",
    "  --help, -h            Show this help",
    "",
    "Auto-start precedence:",
    "  1) CLI flag (--auto-start / --no-auto-start) — last wins",
    "  2) TOML config [bot] auto_start — used if no CLI flag",
    "  3) Default: true (backward compat — existing configs auto-start)",
    "",
    "Examples:",
    "  mm-bot start                          # start the bot (paper mode by default)",
    "  mm-bot start --no-color               # start the bot without color",
    "  mm-bot start --config=./prod.toml     # start the bot with custom config",
    "  mm-bot start --config=./paper.toml --no-auto-start   # paper bot in STOPPED state",
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

/**
 * apps/bot/src/cli/commands/tui.ts
 *
 * Phase 34 Track A — `mm-bot tui` — TUI-only mód, BOT NÉLKÜL.
 *
 * ===========================================================================
 * MI AZ A `mm-bot tui`?
 * ===========================================================================
 * A `mm-bot tui` parancs kizárólag az Ink TUI-t indítja el, MÍGHOGY nem
 * indít botot. A háttérben a `@mm-crypto-bot/tui` két beépített provider-e
 * egyikét használja:
 *
 *   --data-source=simulated   (default)   Szintetikus adatok (1 Hz tick).
 *                                        Nincs valós piaci adat; a
 *                                        `SimulatedProvider` PRNG-vel
 *                                        generál realisztikus price-walkot.
 *   --data-source=paper                   A `PaperProvider` — a paper-trading
 *                                        engine-t indítja (ha elérhető;
 *                                        különben a fallback szimulációra
 *                                        vált graceful degradation-nel).
 *
 * Ez a parancs a UI/UX demó és a TUI-only fejlesztés eszköze. NEM alkalmas
 * valós kereskedésre — a `mm-bot start` az, ami a futó botot indítja.
 *
 * ===========================================================================
 * ÖSSZEHASONLÍTÁS A `mm-bot start` PARANCCSAL
 * ===========================================================================
 *   `mm-bot start`           `mm-bot tui`
 *   ─────────────────────    ───────────────────────────
 *   Bot indul (valós feed)   Nincs bot; csak a TUI provider
 *   LiveBotStateProvider     SimulatedProvider / PaperProvider
 *   TUI frissítések valódi   TUI frissítések szintetikusak
 *   `[q]` leállítja a botot  `[q]` kilép a TUI-ból (nincs bot)
 *
 * ===========================================================================
 * FLAGS
 * ===========================================================================
 *   --data-source=<source>  "simulated" (default) | "paper"
 *   --seed=<n>              A szimuláció seed-je (csak --data-source=simulated)
 *   --no-color              Letiltja az ANSI színkódokat (NO_COLOR=1)
 *   --help, -h              Help szöveg
 *
 * ===========================================================================
 * HASZNÁLAT
 * ===========================================================================
 *   mm-bot tui                           # simulated provider (default)
 *   mm-bot tui --data-source=paper       # paper provider
 *   mm-bot tui --seed=42                 # reprodukálható szimuláció
 *   mm-bot tui --no-color                # szín nélkül
 */

import type { SubcommandHandler } from "../router.js";

/**
 * `getDataSource` — a `--data-source=<source>` flag értékét olvassa ki.
 * Ha nincs megadva vagy érvénytelen, a default a "simulated".
 */
function getDataSource(flags: ReadonlyMap<string, string | boolean>): "simulated" | "paper" {
  const v = flags.get("data-source");
  if (typeof v !== "string") return "simulated";
  if (v === "simulated" || v === "paper") return v;
  return "simulated";
}

/**
 * `getSeed` — a `--seed=<n>` flag értékét olvassa ki (opcionális).
 * Csak a `SimulatedProvider` használja (reprodukálható szimuláció).
 */
function getSeed(flags: ReadonlyMap<string, string | boolean>): number | null {
  const v = flags.get("seed");
  if (typeof v !== "string") return null;
  const parsed = Number.parseInt(v, 10);
  if (Number.isFinite(parsed)) return parsed;
  return null;
}

/**
 * `isNoColor` — a `--no-color` flag jelenlétét ellenőrzi.
 */
function isNoColor(flags: ReadonlyMap<string, string | boolean>): boolean {
  if (flags.get("no-color") === true) return true;
  if (flags.get("color") === false) return true;
  return false;
}

/**
 * `tuiCommand` — a `mm-bot tui` handler.
 *
 * A parancs NEM indít botot — csak a TUI-t rendereli a választott
 * provider-rel. A kilépéskor (`[q]` / Ctrl+C) a TUI `unmount`-ol,
 * és a process kilép a 0 exit kóddal.
 */
export const tuiCommand: SubcommandHandler = async (args) => {
  // --------------------------------------------------------------------------
  // 0) Help: --help / -h esetén kiírjuk a parancs-saját help szöveget.
  // --------------------------------------------------------------------------
  if (args.flags.get("help") === true) {
    printTuiHelp();
    return 1;
  }

  const dataSource = getDataSource(args.flags);
  const seed = getSeed(args.flags);
  const noColor = isNoColor(args.flags);

  // --------------------------------------------------------------------------
  // 1) NO_COLOR env var beállítása, ha a user kérte.
  // --------------------------------------------------------------------------
  if (noColor && process.env["NO_COLOR"] === undefined) {
    process.env["NO_COLOR"] = "1";
  }

  // --------------------------------------------------------------------------
  // 2) Dynamic import a TUI csomagból.
  //    A `mm-bot tui` CSAK TUI — a bot sosem indul el.
  // --------------------------------------------------------------------------
  const tuiModule = await import("@mm-crypto-bot/tui");

  // --------------------------------------------------------------------------
  // 3) Provider kiválasztása a `--data-source` flag alapján.
  // --------------------------------------------------------------------------
  let provider;
  if (dataSource === "paper") {
    // A `PaperProvider` a `@mm/paper` motort indítja (ha elérhető);
    // különben a fallback szimulációra vált. A konstruktor nem
    // dob hibát — a provider belső try/catch logikája kezeli.
    provider = new tuiModule.PaperProvider();
  } else {
    // A `SimulatedProvider` a TUI-only mód alapértelmezett provider-e.
    // A seed opcionális — ha nincs megadva, az aktuális időbélyegből
    // generálunk egyet (nem-reprodukálható, de életszerű).
    const opts: { mode: "tui-only"; seed?: number } = { mode: "tui-only" };
    if (seed !== null) {
      opts.seed = seed;
    }
    provider = new tuiModule.SimulatedProvider(opts);
  }

  // --------------------------------------------------------------------------
  // 4) A TUI renderelése.
  // --------------------------------------------------------------------------
  const app = tuiModule.renderTui(provider);

  // --------------------------------------------------------------------------
  // 5) SIGINT handler — a TUI-ból jövő [q] / Ctrl+C a provider.stop() +
  //    dispose() útvonalon megy. Ha a user a process-t öli meg, a
  //    bot nem fut, csak kilépünk.
  // --------------------------------------------------------------------------
  let signalStopping = false;
  const onSignal = (sig: NodeJS.Signals): void => {
    if (signalStopping) return;
    signalStopping = true;
    console.error(`[tui] received ${sig} — exiting`);
    app.unmount();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  // --------------------------------------------------------------------------
  // 6) Várunk, amíg a TUI ki nem lép.
  // --------------------------------------------------------------------------
  await app.waitUntilExit();
  return 0;
};

/**
 * `printTuiHelp` — a `mm-bot tui --help` szövege.
 */
function printTuiHelp(): void {
  const lines: string[] = [
    "Usage: mm-bot tui [--data-source=<simulated|paper>] [--seed=<n>] [--no-color] [--help]",
    "",
    "Launch the Ink TUI without starting the bot. Useful for UI/UX demos",
    "and TUI-only development.",
    "",
    "Options:",
    "  --data-source=<source>  \"simulated\" (default) | \"paper\"",
    "  --seed=<n>              Seed for the simulated provider (reproducible)",
    "  --no-color              Disable ANSI color codes (NO_COLOR=1)",
    "  --help, -h              Show this help",
    "",
    "Examples:",
    "  mm-bot tui                              # simulated (default)",
    "  mm-bot tui --data-source=paper          # paper-trading engine",
    "  mm-bot tui --seed=42                    # reproducible simulation",
    "  mm-bot tui --no-color                   # without color",
  ];
  for (const line of lines) {
    console.error(line);
  }
}

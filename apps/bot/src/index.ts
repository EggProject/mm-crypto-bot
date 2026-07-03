// apps/bot/src/index.ts — `@mm/bot` belépési pont (futtatható bináris)
//
// FELADAT: A `@mm/bot` a teljes mm-crypto-bot rendszer belépési pontja.
// Két üzemmódot támogat:
//
//   1. `bun run tui`   — CSAK a TUI-t indítja (a robot nem indul el).
//                        A háttérben a `SimulatedProvider` fut, ami
//                        szintetikus adatokkal tölti fel a TUI-t.
//                        Cél: a TUI megjelenésének és működésének
//                        tesztelése a bot-motor elkészülte előtt.
//
//   2. `bun run start` — a TUI-t ÉS a robotot is indítja.
//                        A háttérben a `PaperProvider` próbálja
//                        elindítani a `@mm/paper` paper-trading
//                        engine-t. Ha az még nem elérhető (a scaffold
//                        fázisban `not implemented yet` hibát dob),
//                        a TUI sárga figyelmeztetéssel jelzi, és
//                        a szimulált adatokra vált (graceful
//                        degradation).
//
// A parancssori argumentumok felismerése a `command` változó
// meghatározásával történik. A `Bun.argv[2]` a `bun run tui` /
// `bun run start` parancsokból jön.

import { loadConfig } from "@mm/shared/config";
import { createLogger } from "@mm/shared/logger";
import { PaperProvider, renderTui, SimulatedProvider } from "@mm/tui";

const log = createLogger("info");

/**
 `Command` — a parancssorból felismert üzemmód.
 - `tui`   : CSAK TUI (a robot nem indul el)
 - `start` : TUI + bot-motor (paper / live)
*/
type Command = "tui" | "start";

/**
 `detectCommand` — a parancssori argumentumokból megállapítja a kért
 üzemmódot. A `bun run tui` a `Bun.argv[2]`-ben a `tui` szót adja
 át, míg a `bun run start` a `start` szót.
*/
function detectCommand(argv: readonly string[]): Command {
  // Az argv[0] a `bun` / `node` bináris; argv[1] gyakran a script;
  // a tényleges parancs a `tui` / `start` az argv[2..]-ben.
  for (const arg of argv) {
    if (arg === "tui") return "tui";
    if (arg === "start") return "start";
  }
  // Ha a `bun run tui` szkriptet hívják, a `Bun.argv` a következő:
  //   [bun, src/index.ts, "tui"]
  // Ha a `bun run start` szkriptet hívják:
  //   [bun, src/index.ts, "start"]
  // A fenti ciklus ezt kezeli. Ha nincs egyezés, alapértelmezetten
  // a TUI-only módot indítjuk (biztonságos default).
  return "tui";
}

/**
 `main` — a bot fő belépési pontja.
 A kiválasztott üzemmód alapján létrehozza a provider-t, és
 elindítja a TUI-t. A függvény addig blokkol, amíg a TUI-ból
 a felhasználó ki nem lép.
*/
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = detectCommand(argv);
  const cfg = loadConfig();

  log.info("bot indítása", { command, env: cfg.env });

  if (command === "start" && cfg.env === "live") {
    log.warn("LIVE mód — valódi pénzmozgás. Ellenőrizd az API kulcsokat és a kockázati limiteket!");
  }

  if (command === "tui") {
    // CSAK a TUI indul — a bot-motor nem.
    // A SimulatedProvider szintetikus adatokkal tölti fel a felületet.
    log.info("TUI-only mód — a robot nem indul el, csak a felület jön fel (szimulált adatok).");
    const provider = new SimulatedProvider({ mode: "tui-only" });
    renderTui(provider);
    // A `renderTui` blokkol, amíg a TUI fut; a kilépéskor ez a
    // sor már nem fut le. A graceful shutdown-t a `renderTui`
    // belsejében kezeljük (provider.dispose).
    return;
  }

  // `start` parancs — a TUI ÉS a bot-motor is indul.
  log.info("Bot mód — a TUI és a paper/live motor is indul.");
  const provider = new PaperProvider();
  // A PaperProvider a `start()` hívásakor próbálja elindítani a
  // @mm/paper engine-t. Ha az `not implemented yet` hibát dob, a
  // TUI-ban sárga figyelmeztetés jelenik meg, és a szimulált
  // adatokra váltunk. Így a TUI mindig működőképes.
  await provider.start();
  renderTui(provider);
  // A `renderTui` blokkol; ide soha nem érünk el.
}

main().catch((err: unknown) => {
  log.error("végzetes hiba a bot indítása közben", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

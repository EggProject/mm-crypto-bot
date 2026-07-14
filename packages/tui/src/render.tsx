// packages/tui/src/render.tsx — a TUI renderelő függvény
//
// Ez a modul a `renderTui` függvényt tartalmazza, amelyet a
// `@mm/bot` `bun run tui` és `bun run start` parancsai hívnak.
// A függvény egy `BotStateProvider` köré építi fel a TUI-t, és
// addig blokkol, amíg a felhasználó ki nem lép.
//
// Külön modulba tesszük, hogy a `BotStateProvider` importálható
// legyen a `renderTui` nélkül is (körkörös import elkerülése).

import { render } from "ink";
import type { Instance } from "ink";
import type { ReactElement } from "react";
import { App } from "./App.js";
import type { AppProps } from "./App.js";
import type { BotStateProvider } from "./providers/BotStateProvider.js";

/**
 `renderTui` — a TUI renderelése a megadott provider-rel.
 A függvény az Ink `render` függvényét hívja, és a
 `waitUntilExit` Promise-re vár — így a folyamat addig fut,
 amíg a felhasználó a TUI-ból ki nem lép ([q] vagy Ctrl+C).

 A kilépéskor a `provider.dispose()` automatikusan hívódik az
 `App` komponens `useEffect` cleanup-jában, így nincs
 erőforrás-szivárgás.

 ===========================================================================
 PHASE 36 TRACK A2 — `alternateScreen: true` (2026-07-14 21:30 Budapest)
 ===========================================================================

 Az Ink 7.0.0 (released 2026-06-16) bevezette az `alternateScreen` opciót
 — ez a vim/less-style "alternate screen buffer" aktiválása, ami:

   1) A TUI kilépéskor VISSZAÁLLÍTJA a terminál eredeti scrollback-
      pufferét (a TUI előtti tartalom újra látható).
   2) A TUI futása alatt a terminál scrollback-puffere a TUI
      scrollbackje, NEM a felhasználó korábbi parancs-kimenetei.

 Ez a standard TUI-viselkedés (lazygit, k9s, btop, htop mind ezt
 használja), és a Phase 36 user mandate egyik elvárása: a TUI-ból
 kilépve a user ne veszítse el a korábbi terminál-tartalmat.

 A `patchConsole: true` (default) felülírja a `console.log`-ot, hogy
 a TUI-ból esetlegesen kikerülő log sorok a stdout-RA menjenek (a TUI
 render surface-e), ne a stderr-re. Ezt itt kikapcsoljuk: a logger
 maga úgy van refaktorálva (lásd Phase 36 Track A2 logger.ts), hogy
 SOHA ne írjon a stdout-ra. A `patchConsole: true` felesleges, sőt
 zavaró lenne — ha egy library véletlenül `console.log`-ot hív, a
 patchConsole azt a stdout-ra küldené, és a TUI-ban megjelenne.

 A `exitOnCtrlC: true` (default) a Ctrl+C-t a TUI kilépéséhez köti.

 A `exitOnCtrlC: false` KELL a `suspendTerminal` működéséhez (a jövőben
 a "view raw TOML" feature-höz). Most alapértelmezetten true (a
 meglévő viselkedés megőrzése).
*/
export function renderTui(provider: BotStateProvider): Instance {
  const element: ReactElement = <App provider={provider} />;
  return render(element, {
    // Az Ink 7.0.0-ban bevezetett `alternateScreen` opció — a TUI
    // az "alternate screen buffer"-t használja, így a kilépéskor a
    // terminál scrollback-puffere VISSZAÁLL a TUI előtti állapotra.
    alternateScreen: true,
    // A `patchConsole: false` kikapcsolja az Ink `console.log`/`console.error`
    // felülírását — a Phase 36 Track A2 logger refaktor óta a logger
    // direkt a `process.stderr.write`-ot hívja, így nincs szükség
    // patch-re. Ha a patch aktív lenne, és egy library `console.log`-ot
    // hív, a kimenet a stdout-ra menne (a TUI render surface-e), és
    // a felhasználó a TUI-ban látná — pont az a bug, amit javítunk.
    patchConsole: false,
    // A `Ctrl+C` kilépés a TUI-ból (graceful).
    exitOnCtrlC: true,
  });
}

/**
 `renderTuiWithCallbacks` — a TUI renderelése a provider-rel ÉS
 opcionális `onStop` / `onPause` callback-ekkel. A callback-eket
 az `App` a megfelelő billentyű (`s` / `p`) megnyomásakor hívja,
 a `provider.stop()` / `setPaused(...)` UTÁN.

 A Phase 34 Track B kiegészítés: a fogyasztó (pl. a `mm-bot start`
 parancs) így a TUI-ból jövő stop/pause kéréseket a saját
 logikájával is kiegészítheti (pl. log-írás, persist).

 A `renderTui`-val megegyező render opciókat használja (alternateScreen,
 patchConsole, exitOnCtrlC) — a TUI viselkedés konzisztens mindkét
 belépési ponton.
*/
export function renderTuiWithCallbacks(
  provider: BotStateProvider,
  callbacks: Pick<AppProps, "onStop" | "onPause">,
): Instance {
  const element: ReactElement = (
    <App
      provider={provider}
      {...(callbacks.onStop !== undefined ? { onStop: callbacks.onStop } : {})}
      {...(callbacks.onPause !== undefined ? { onPause: callbacks.onPause } : {})}
    />
  );
  return render(element, {
    alternateScreen: true,
    patchConsole: false,
    exitOnCtrlC: true,
  });
}

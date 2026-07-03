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
import type { BotStateProvider } from "./providers/BotStateProvider.js";

/**
 `renderTui` — a TUI renderelése a megadott provider-rel.
 A függvény az Ink `render` függvényét hívja, és a
 `waitUntilExit` Promise-re vár — így a folyamat addig fut,
 amíg a felhasználó a TUI-ból ki nem lép ([q] vagy Ctrl+C).

 A kilépéskor a `provider.dispose()` automatikusan hívódik az
 `App` komponens `useEffect` cleanup-jában, így nincs
 erőforrás-szivárgás.
*/
export function renderTui(provider: BotStateProvider): Instance {
  const element: ReactElement = <App provider={provider} />;
  return render(element);
}

// packages/tui/src/index.tsx — a `@mm/tui` CLI belépési pontja
//
// Ez a fájl a `bun run tui` script belépési pontja. A `Bun` runtime
// közvetlenül futtatja (jsx → tsx transzformálás nélkül, mivel a
// tsconfig `jsx: "react-jsx"` beállítást használ).
//
// FELADATOK:
//   1. A kiválasztott provider (alapértelmezetten: SimulatedProvider) létrehozása
//   2. A TUI renderelése az Ink `render` függvényével
//   3. Graceful shutdown biztosítása (SIGINT / SIGTERM)
//
// A fogyasztók (pl. `@mm/bot`) a `renderTui(provider)` függvényt
// hívhatják, ha saját provider-t szeretnének átadni.

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { render, useApp, useInput } from "ink";
import { App } from "./App.js";
import { renderTui } from "./render.js";
import { SimulatedProvider } from "./providers/SimulatedProvider.js";
import { PaperProvider } from "./providers/PaperProvider.js";
import type { BotStateProvider } from "./providers/BotStateProvider.js";

/**
 `renderTui` — a TUI renderelése a megadott provider-rel.
 Ez a függvény a `@mm/bot` `bun run tui` és `bun run start`
 parancsokból hívódik. A függvény blokkol, amíg a TUI fut.
 A tényleges implementáció a `render.tsx` modulban található;
 itt újra-exportáljuk, hogy a CLI-ből is elérhető legyen.
*/
export { renderTui };

/**
 `InternalApp` — a CLI bináris belső alkalmazás-komponense.
 Ez a wrapper szolgál arra, hogy a `--with-bot` kapcsolót már a
 CLI-ben kezeljük (parancssori argumentum), és ne kelljen a
 fogyasztónak saját provider-választó logikát írnia.
*/
function InternalApp({ provider }: { readonly provider: BotStateProvider }): ReactElement {
  const { exit } = useApp();
  const [started, setStarted] = useState<boolean>(false);

  // Az induláskor a useEffect-ben hívjuk a `start()`-ot —
  // így a TUI felépülése után a bot automatikusan elindul.
  // A `--no-autostart` kapcsolóval ez kikapcsolható.
  useEffect(() => {
    if (started) return;
    setStarted(true);
    void (async () => {
      try {
        await provider.start();
      } catch (err: unknown) {
        // A start-hiba nem kritikus — a TUI ettől még megjelenik,
        // csak a `status.engineError` jelzi a hibát.
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error("A bot indítása sikertelen:", msg);
      }
    })();
  }, [provider, started]);

  // A [q] és Ctrl+C kilép.
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      void (async () => {
        await provider.stop();
        await provider.dispose();
        exit();
      })();
      return;
    }
    if (input === "q" && provider.getSnapshot().killSwitch !== "confirm") {
      void (async () => {
        await provider.stop();
        await provider.dispose();
        exit();
      })();
    }
  });

  return <App provider={provider} />;
}

/**
 `parseArgs` — a CLI kapcsolók feldolgozása.
 Támogatott kapcsolók:
   --with-bot      A PaperProvider-t használja (alap: SimulatedProvider)
   --no-autostart  Nem indítja el automatikusan a botot a TUI indulásakor
   --seed=N        A szimuláció seed-je (reprodukálható tesztekhez)
*/
function parseArgs(argv: readonly string[]): { readonly withBot: boolean; readonly autostart: boolean; readonly seed: number | null } {
  let withBot = false;
  let autostart = true;
  let seed: number | null = null;

  for (const arg of argv) {
    if (arg === "--with-bot") withBot = true;
    if (arg === "--no-autostart") autostart = false;
    if (arg.startsWith("--seed=")) {
      const parsed = Number.parseInt(arg.slice("--seed=".length), 10);
      if (Number.isFinite(parsed)) seed = parsed;
    }
  }

  return { withBot, autostart, seed };
}

/**
 `main` — a CLI belépési pontja.
 Csak akkor fut le, ha a fájlt közvetlenül hívják (Bun `import.meta.main`).
*/
function main(): void {
  const argv = process.argv.slice(2);
  const { withBot, autostart, seed } = parseArgs(argv);

  let provider: BotStateProvider;
  if (withBot) {
    provider = new PaperProvider();
  } else {
    const opts: { mode: "tui-only"; seed?: number } = { mode: "tui-only" };
    if (seed !== null) {
      Object.assign(opts, { seed });
    }
    provider = new SimulatedProvider(opts);
  }

  if (!autostart) {
    // A `--no-autostart` módban a provider-t nem indítjuk el automatikusan —
    // a felhasználónak a TUI-ból kell indítania az [s] billentyűvel.
    // Ilyenkor a `renderTui`-t használjuk, ami az `App`-ot rendereli
    // provider nélküli auto-start nélkül.
    const instance = renderTui(provider);
    void instance.waitUntilExit();
    return;
  }

  // Az `InternalApp` wrapper szolgál az auto-start kezelésére.
  const instance = render(<InternalApp provider={provider} />);
  void instance.waitUntilExit();
}

// A `Bun` runtime támogatja az `import.meta.main` mintát —
// ha a fájlt közvetlenül futtatjuk (és nem importáljuk), indul a `main`.
if (import.meta.main) {
  main();
}

// Az `InternalApp` komponenst a `Bun` runtime-on kívül is elérhetővé
// tesszük a könyvtári API-n keresztül, hogy a fogyasztók (pl. tesztek)
// közvetlenül használhassák.
export { InternalApp };

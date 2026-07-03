// packages/tui/src/App.tsx — a TUI fő alkalmazás-komponense
//
// Ez a komponens fogja össze a TUI összes panelét (Header,
// StatisticsPanel, LiveTradingPanel, HistoryList, StatusBar) és
// kezeli a billentyűzet-bemenetet (`useInput` hook):
//
//   [s]   — start / stop (csak akkor, ha nincs kill-switch megerősítés)
//   [k]   — kill-switch (megnyitja a megerősítő promptot)
//   [i]   — kill-switch megerősítése (csak a "confirm" állapotban)
//   [n]   — kill-switch megerősítés elvetése
//   [r]   — manuális frissítés kérése (a provider új tick-et küld)
//   [q]   — kilépés a TUI-ból (graceful: stop + dispose)
//   [Ctrl+C] — ugyanaz, mint a [q]
//
// A komponens a `BotStateProvider`-en keresztül kapcsolódik a
// háttér-motorhoz, és a `useBotState` hook-kal olvassa ki a
// legfrissebb state-et.

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Box, useApp, useInput } from "ink";
import type { BotStateProvider } from "./providers/BotStateProvider.js";
import { useBotState } from "./hooks/useBotState.js";
import {
  Header,
  HistoryList,
  LiveTradingPanel,
  StatisticsPanel,
  StatusBar,
} from "./components/index.js";

/**
 `App` — a TUI root komponense.
 A `provider` a `BotStateProvider` interfészt implementáló osztály
 egy példánya (SimulatedProvider / PaperProvider).
*/
export function App({ provider }: { readonly provider: BotStateProvider }): ReactElement {
  const { exit } = useApp();
  const state = useBotState(provider);

  // Az "aktuális idő" állapot, amit 1 másodpercenként frissítünk —
  // a pozíciók életkora és a "zárás óta eltelt idő" ehhez van kötve.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  // A TUI kilépésekor a provider dispose-ol.
  useEffect(() => {
    return () => {
      void provider.dispose();
    };
  }, [provider]);

  // A billentyűzet-kezelés. A `useInput` mindig aktív, de a kill-switch
  // "confirm" állapotában csak a megerősítő billentyűk (`i` / `n`) hatnak.
  useInput((input, key) => {
    // A Ctrl+C és a [q] mindig kilép — kivéve a megerősítő promptban,
    // ahol a [q] = "nem" (kilépés a megerősítésből).
    if (key.ctrl && input === "c") {
      void (async () => {
        if (state.running) {
          await provider.stop();
        }
        await provider.dispose();
        exit();
      })();
      return;
    }

    if (state.killSwitch === "confirm") {
      if (input === "i" || input === "y") {
        // A vészleállító aktiválódik.
        void (async () => {
          await provider.killSwitch();
        })();
        return;
      }
      if (input === "n" || input === "q" || input === "escape") {
        // A megerősítés elvetése — visszaállunk "armed" állapotba.
        provider.setKillSwitchState("armed");
        return;
      }
      return;
    }

    if (input === "q") {
      void (async () => {
        if (state.running) {
          await provider.stop();
        }
        await provider.dispose();
        exit();
      })();
      return;
    }

    if (input === "s") {
      void (async () => {
        if (state.running) {
          await provider.stop();
        } else {
          await provider.start();
        }
      })();
      return;
    }

    if (input === "k") {
      // A kill-switch prompt csak akkor nyílik, ha a bot fut, ÉS
      // a kill-switch még nincs aktiválva.
      if (state.running && state.killSwitch === "armed") {
        provider.setKillSwitchState("confirm");
      }
      return;
    }

    if (input === "r") {
      // A manuális frissítés egy explicit re-render-t kér. Mivel a
      // state frissítése async (a provider tickIntervaljától függ),
      // itt a `now` állapotot frissítjük — ez vizuálisan jelzi a
      // frissítést a felhasználónak.
      setNow(Date.now());
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Header state={state} />
      <Box marginTop={1} flexDirection="row" gap={1}>
        <StatisticsPanel statistics={state.statistics} />
      </Box>
      <Box marginTop={1} flexDirection="row" gap={1}>
        <LiveTradingPanel
          tickers={state.tickers}
          positions={state.positions}
          now={now}
        />
      </Box>
      <Box marginTop={1}>
        <HistoryList history={state.history} now={now} />
      </Box>
      <Box marginTop={1}>
        <StatusBar killSwitch={state.killSwitch} />
      </Box>
    </Box>
  );
}

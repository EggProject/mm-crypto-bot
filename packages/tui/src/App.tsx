// packages/tui/src/App.tsx — a TUI fő alkalmazás-komponense
//
// Ez a komponens fogja össze a TUI összes panelét (Header,
// StatisticsPanel, LiveTradingPanel, HistoryList, StatusBar,
// HelpOverlay) és kezeli a billentyűzet-bemenetet (`useInput` hook).
//
// BILLENTYŰKOMBINÁCIÓK (Phase 34 §4.3 spec + Track B kiegészítések):
//   [q]           — kilépés a TUI-ból (graceful: stop + dispose)
//   [Ctrl+C]      — ugyanaz, mint a [q]
//   [s]           — start / stop (TUI-only módban NEM elérhető)
//   [p]           — pause / resume (TUI-only módban NEM elérhető)
//   [k]           — kill-switch (confirm prompt: [i] igen, [n] nem)
//   [r]           — manuális frissítés (re-snapshot kérése)
//   [t]           — history rendezési kulcs váltása (time / pnl / symbol)
//   [Tab] / [←→]  — panel fókusz váltása (statisztika / live / history)
//   [?]           — help overlay megjelenítése / elrejtése
//   [Esc]         — help overlay bezárása (ha nyitva van)
//
// A komponens a `BotStateProvider`-en keresztül kapcsolódik a
// háttér-motorhoz, és a `useBotState` hook-kal olvassa ki a
// legfrissebb state-et.
//
// A Phase 34 Track B kiegészítések:
//   - Opcionális `onStop` / `onPause` callback-ek — a `Bot` saját
//     state-szintű pause/stop logikáját vezérlik (a `BotStateProvider`
//     provider-metódusain túl, ha a fogyasztó szükségesnek tartja).
//   - `focusedPanel` state (Tab + nyilak).
//   - `sortKey` state a HistoryList rendezéséhez.
//   - `helpVisible` state a HelpOverlay megjelenítéséhez.

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Box, useApp, useInput } from "ink";
import type { BotStateProvider } from "./providers/BotStateProvider.js";
import { useBotState } from "./hooks/useBotState.js";
import {
  Header,
  HelpOverlay,
  HistoryList,
  LiveTradingPanel,
  StatisticsPanel,
  StatusBar,
} from "./components/index.js";
import type { FocusedPanel, HistorySortKey } from "./types.js";

/**
 `AppProps` — az `App` komponens opcionális callback-jei.
 A `BotStateProvider` provider-metódusain túl a fogyasztó
 (pl. a `mm-bot start` parancs) saját logikát is becsatolhat.
*/
export interface AppProps {
  readonly provider: BotStateProvider;
  /**
   `onStop` — opcionális callback, amit a TUI az `s` (stop)
   billentyűre hív, a `provider.stop()` UTÁN. A fogyasztó
   itt saját teardown logikát futtathat (pl. log-írás).
  */
  readonly onStop?: () => void;
  /**
   `onPause` — opcionális callback, amit a TUI a `p` (pause)
   billentyűre hív, a `provider.setPaused(...)` UTÁN. A
   fogyasztó itt pl. egy pause-state fájlba írhat.
  */
  readonly onPause?: (paused: boolean) => void;
}

/**
 `App` — a TUI root komponense.
 A `provider` a `BotStateProvider` interfészt implementáló osztály
 egy példánya (SimulatedProvider / PaperProvider / LiveBotStateProvider).
*/
export function App({ provider, onStop, onPause }: AppProps): ReactElement {
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

  // Phase 34 Track B: UI-only state.
  const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>("live");
  // A focusedPanel a panel-ek border színét befolyásolja (focus = bright).
  const [sortKey, setSortKey] = useState<HistorySortKey>("time");
  const [helpVisible, setHelpVisible] = useState<boolean>(false);

  // A TUI-only módot a provider status.mode jelzi.
  const isTuiOnly = state.status.mode === "tui-only";

  /**
   `cyclePanel` — a panel-fókusz ciklikus váltása.
  */
  const cyclePanel = (direction: 1 | -1): void => {
    setFocusedPanel((current) => {
      if (current === "statistics") return direction === 1 ? "live" : "history";
      if (current === "live") return direction === 1 ? "history" : "statistics";
      return direction === 1 ? "statistics" : "live";
    });
  };

  /**
   `cycleSortKey` — a history rendezési kulcs ciklikus váltása.
   */
  const cycleSortKey = (): void => {
    setSortKey((current) => {
      if (current === "time") return "pnl";
      if (current === "pnl") return "symbol";
      return "time";
    });
  };

  // A billentyűzet-kezelés. A `useInput` mindig aktív, de a kill-switch
  // "confirm" állapotában csak a megerősítő billentyűk (`i` / `n`) hatnak,
  // és a help-overlay nyitott állapotában csak a help-bezáró billentyűk.
  useInput((input, key) => {
    // A Ctrl+C és a [q] mindig kilép — kivéve a megerősítő promptban,
    // ahol a [q] = "nem" (kilépés a megerősítésből).
    if (key.ctrl && input === "c") {
      void (async () => {
        if (state.running) {
          await provider.stop();
          if (onStop !== undefined) onStop();
        }
        await provider.dispose();
        exit();
      })();
      return;
    }

    // Help overlay: a [?] / [Esc] bezárja.
    if (helpVisible) {
      if (input === "?" || input === "escape" || input === "q") {
        setHelpVisible(false);
        return;
      }
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
          if (onStop !== undefined) onStop();
        }
        await provider.dispose();
        exit();
      })();
      return;
    }

    // Az `s` és `p` billentyűk TUI-only módban NEM elérhetők
    // (nincs bot a TUI-only módban).
    if (!isTuiOnly && input === "s") {
      void (async () => {
        if (state.running) {
          await provider.stop();
          if (onStop !== undefined) onStop();
        } else {
          await provider.start();
        }
      })();
      return;
    }

    if (!isTuiOnly && input === "p") {
      const newPaused = !state.paused;
      provider.setPaused(newPaused);
      if (onPause !== undefined) onPause(newPaused);
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

    if (input === "t") {
      // A history rendezési kulcs ciklikus váltása.
      cycleSortKey();
      return;
    }

    if (input === "?") {
      // A help overlay megjelenítése / elrejtése.
      setHelpVisible((v) => !v);
      return;
    }

    if (key.tab) {
      // Tab: panel-fókusz váltása előre.
      cyclePanel(1);
      return;
    }
    if (key.leftArrow) {
      cyclePanel(-1);
      return;
    }
    if (key.rightArrow) {
      cyclePanel(1);
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Header state={state} />
      <Box marginTop={1} flexDirection="row" gap={1}>
        <StatisticsPanel statistics={state.statistics} focused={focusedPanel === "statistics"} />
      </Box>
      <Box marginTop={1} flexDirection="row" gap={1}>
        <LiveTradingPanel
          tickers={state.tickers}
          positions={state.positions}
          tickerEvents={state.tickerEvents}
          now={now}
          killSwitchThresholdPct={state.killSwitchThresholdPct}
          focused={focusedPanel === "live"}
        />
      </Box>
      <Box marginTop={1}>
        <HistoryList history={state.history} now={now} sortKey={sortKey} focused={focusedPanel === "history"} />
      </Box>
      <Box marginTop={1}>
        <StatusBar killSwitch={state.killSwitch} tuiOnly={isTuiOnly} />
      </Box>
      {helpVisible && <HelpOverlay visible={helpVisible} tuiOnly={isTuiOnly} />}
    </Box>
  );
}

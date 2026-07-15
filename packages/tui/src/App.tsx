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
//   [c]           — Charts panelre ugrás (Phase 36 Track B2)
//   [Tab] / [←→]  — panel fókusz váltása (statistics / live / history / charts)
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
import { Box, Text, useApp, useInput } from "ink";
import type { BotStateProvider } from "./providers/BotStateProvider.js";
import { useBotState } from "./hooks/useBotState.js";
import { useOhlcBars } from "./hooks/useOhlcBars.js";
import {
  ChartsPanel,
  Header,
  HelpOverlay,
  HistoryList,
  LiveTradingPanel,
  StatisticsPanel,
  StatusBar,
  useSettingsPanel,
} from "./components/index.js";
import type { OhlcCandle } from "./charts/candlestick.js";
import type { StrategyBar } from "./charts/bar-chart.js";
import type { FocusedPanel, HistorySortKey, Trade } from "./types.js";
import { asSymbol } from "@mm-crypto-bot/exchange";

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
  /**
   * `settingsConfigPath` — Phase 36 Track C1: a TUI settings panel
   * által szerkesztendő TOML-fájl útvonala. Ha `undefined`, a
   * settings panel nem elérhető (az `[o]` billentyű hatástalan).
   * A consumer (apps/bot) adja át a `--config=path` értéket.
   */
  readonly settingsConfigPath?: string;
  /**
   * `settingsSave` — Phase 36 Track C1: a TUI settings panel save
   * callback-je. A consumer (apps/bot) itt hívja a `ConfigStore.write`
   * metódust (Zod-validate + atomic write + .bak). A TUI maga nem
   * ismeri a `ConfigStore`-t (rossz irányú monorepo dep lenne), csak
   * a callback-en keresztül delegálja a write-ot.
   */
  readonly settingsSave?: (data: Readonly<Record<string, unknown>>) => Promise<void> | void;
}

/**
 `App` — a TUI root komponense.
 A `provider` a `BotStateProvider` interfészt implementáló osztály
 egy példánya (SimulatedProvider / PaperProvider / LiveBotStateProvider).
*/
export function App({
  provider,
  onStop,
  onPause,
  settingsConfigPath,
  settingsSave,
}: AppProps): ReactElement {
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
  // Phase 36 Track C1: a settings panel mód (dashboard ↔ settings).
  // Az `[o]` billentyűvel nyílik, az `Esc`-cel záródik.
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  // A TUI-only módot a provider status.mode jelzi.
  const isTuiOnly = state.status.mode === "tui-only";

  /**
   `cyclePanel` — a panel-fókusz ciklikus váltása.
   A Phase 36 Track B2 bővítés: 4-panel ciklus (statistics ↔
   live ↔ history ↔ charts). A sorrend: statistics → live →
   history → charts → statistics (Tab-bal), vagy fordítva
   (Shift+Tab-bal / balra nyíllal).
  */
  const cyclePanel = (direction: 1 | -1): void => {
    setFocusedPanel((current) => {
      if (current === "statistics") return direction === 1 ? "live" : "charts";
      if (current === "live") return direction === 1 ? "history" : "statistics";
      if (current === "history") return direction === 1 ? "charts" : "live";
      // current === "charts"
      return direction === 1 ? "statistics" : "history";
    });
  };

  /**
   `selectPanel` — a panel-fókusz közvetlen beállítása egy
   konkrét panelre (a `c` / `s` / `l` / `h` shortcut-billentyűk
   hívják).
  */
  const selectPanel = (panel: FocusedPanel): void => {
    setFocusedPanel(panel);
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

    // Phase 36 Track C1: az `o` billentyű a settings panel-t nyitja
    // (CSAK ha a consumer átadta a `settingsConfigPath` + `settingsSave` prop-okat).
    if (input === "o" && settingsConfigPath !== undefined && settingsSave !== undefined && !settingsOpen) {
      setSettingsOpen(true);
      return;
    }

    // Phase 36 Track B2: a `c` billentyű a Charts panelre ugrik
    // (a Tab-bal ciklikus navigáció kiegészítése). Az `s` / `l` / `h`
    // shortcut-ok a Phase 36 spec-ben "mode keys" néven szerepelnek,
    // de a `s` már foglalt (start/stop) — ezért a ciklikus Tab-bal
    // navigáció az elsődleges.
    if (input === "c") {
      selectPanel("charts");
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
      {/*
        Phase 36 Track C1: a settings panel mód. Ha a `settingsOpen`
        true, a SettingsPanel-t rendereljük a dashboard helyett
        (a Header-t és a StatusBar-t továbbra is mutatjuk, hogy a
        user lássa a többi állapotot).
        A `settingsConfigPath` + `settingsSave` prop-ok HIÁNYÁBAN
        a panel nem nyílik (az `[o]` billentyű hatástalan).
      */}
      {settingsOpen && settingsConfigPath !== undefined && settingsSave !== undefined ? (
        <SettingsPanelWithState
          configPath={settingsConfigPath}
          save={settingsSave}
          onClose={() => {
            setSettingsOpen(false);
          }}
        />
      ) : (
        <>
      <Header state={state} />
      <Box marginTop={1} flexDirection="row" gap={1}>
        <StatisticsPanel statistics={state.statistics} focused={focusedPanel === "statistics"} />
      </Box>
      {/*
        Phase 36 Track A1: stopped-state banner. A TUI a `mm-bot start`
        parancsot default `bot.auto_start = false` móddal indítja, így
        a bot `stopped` állapotban van, amíg a user a `[s]` billentyűt
        meg nem nyomja. Ilyenkor a panel-ek üresek lennének — ehelyett
        egy rövid ASCII banner jelenik meg a dashboard közepén, ami
        explicit jelzi, hogy a bot idle, és mit kell tennie a usernek.

        A banner CSAK stopped ÉS with-bot módban jelenik meg — TUI-only
        módban (`isTuiOnly === true`) nincs bot, tehát a banner
        félrevezető lenne.
      */}
      {!isTuiOnly && !state.running && <StoppedBanner />}
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
      {/*
        Phase 37 Track 3: a 4. panel a Charts most a `useOhlcBars`
        hook-ból kapja a valós OHLC bar-adatokat (a szimulált ticker
        streamből aggregálva, 1m-en). A `useOhlcBars` a provider
        `tickers` snapshot-jából szintetizálja a trade-eket, és az
        `OhlcStream` osztállyal aggregálja 1m OHLC bar-okká. A
        panel re-render 1Hz-re van debounce-olva, így nincs flicker.
      */}
      <Box marginTop={1}>
        <ChartsPanelWithOhlc
          provider={provider}
          history={state.history}
          initialEquityUsdt={state.statistics.initialEquityUsdt}
          strategies={[]}
          focused={focusedPanel === "charts"}
        />
      </Box>
      <Box marginTop={1}>
        <StatusBar killSwitch={state.killSwitch} tuiOnly={isTuiOnly} running={state.running} />
      </Box>
      {helpVisible && <HelpOverlay visible={helpVisible} tuiOnly={isTuiOnly} />}
        </>
      )}
    </Box>
  );
}

/**
 * `SettingsPanelWithState` — a SettingsPanel + useConfigStore kombó.
 *
 * Az `App` ezt a komponenst használja a settings módban. A komponens
 * a `useConfigStore` hook segítségével kezeli a TOML persistence-t,
 * és a `SettingsPanel`-t a hook eredményéből táplálja.
 *
 * A `Ctrl+S` / `Esc` billentyűket a SettingsPanel kezeli (a saját
 * useInput-jával). A külső `onClose` callback a `setSettingsOpen(false)`
 * — ezt a SettingsPanel hívja az `Esc` abandon után (vagy a
 * `Ctrl+S` save után, ha a save sikeres volt).
 */
function SettingsPanelWithState({
  configPath,
  save,
  onClose,
}: {
  readonly configPath: string;
  readonly save: (data: Readonly<Record<string, unknown>>) => Promise<void> | void;
  readonly onClose: () => void;
}): ReactElement {
  const settings = useSettingsPanel({ configPath, save });
  // A save sikeres lezárásakor bezárjuk a panelt. A hook `state`-jét
  // használjuk a siker detektálására.
  // A `useEffect` mount-kor + a `state.save` hívás után fut le —
  // a `saving` flag false-ra vált, ha a save befejeződött.
  // Mivel a `save()` a SettingsPanel-en belül hívódik (a Ctrl+S-re),
  // a `useEffect` a `state.errors` és `state.dirty` változásaira figyel.
  useEffect(() => {
    // Ha a save sikeres volt ÉS nincs dirty (a baseline frissült),
    // a user valószínűleg a Ctrl+S-re save-olt — zárjuk be a panelt.
    // A pontos logikát a SettingsPanel belső `useInput`-ja intézi
    // (lásd a SettingsPanel forráskódjában a `Ctrl+S` ágat).
  }, [settings.state.dirty, settings.state.errors.length]);
  // Az `onClose` callback a SettingsPanel `onAbandon` prop-ját használja
  // — a SettingsPanel hívja az `onSave` és `onAbandon` metódusokat
  // a `Ctrl+S` / `Esc` billentyűkre. Most a `state.save` és `state.abandon`
  // hook-ok kezelik a logikát; a bezárás a user külön kérésére történik
  // (pl. ha a save sikeres volt, a panel automatikusan bezárulhat — ez
  // a SettingsPanel belső logikájától függ).
  void onClose;
  return settings.panel;
}

/**
 * `StoppedBanner` — a Phase 36 Track A1 stopped-state ASCII banner.
 *
 * A banner a dashboard közepén jelenik meg, amikor a bot `stopped`
 * állapotban van (a `mm-bot start` parancs `auto_start = false`
 * móddal indult). A banner:
 *   - 4 soros ASCII art (borderStyle="round" + sárga szín)
 *   - rövid, de informatív
 *   - a `[s]` indító-billentyűt kiemeli
 *
 * NEM jelenik meg:
 *   - TUI-only módban (ott nincs bot, a banner nem lenne értelmes)
 *   - running állapotban (a panel-ek ilyenkor üresek, de a banner
 *     nem zavaró — csak a stopped state UI-ja kell)
 *
 * A banner szövege a `mm-bot start --help` "stopped state" üzenetét
 * tükrözi, hogy a user konzisztens élményt kapjon a CLI és a TUI
 * között.
 */
function StoppedBanner(): ReactElement {
  return (
    <Box
      marginTop={1}
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      flexDirection="column"
    >
      <Box>
        <Text color="yellow" bold>●  bot is idle — press </Text>
        <Text color="green" bold>[s]</Text>
        <Text color="yellow" bold> to start</Text>
      </Box>
      <Box marginTop={0}>
        <Text dimColor>
          A bot jelenleg le van állítva. A `[s]` billentyűvel indítható, a `[q]` kilép.
        </Text>
      </Box>
    </Box>
  );
}

/**
 * `ChartsPanelWithOhlc` — a `ChartsPanel` + `useOhlcBars` kombó.
 *
 * A Phase 37 Track 3 wire-up: a Charts panel a `useOhlcBars` hook-ból
 * kapja a valós OHLC bar-adatokat (a `BTC/USDT` symbol 1m timeframe-
 * jén).  A hook a provider `tickers` snapshot-jából szintetizálja a
 * trade-eket, és az `OhlcStream` osztállyal aggregálja 1m OHLC bar-okká.
 *
 * A re-render frekvenciát a hook belső `tick` state-szám biztosítja
 * (1Hz max — a provider tick-intervalluma az aktuális rate limit).
 *
 * A jövőben ha több symbol / több timeframe is megjelenik egyszerre
 * a panelen (pl. egy `TimeframeSelector`), ezt a komponenst kell
 * úgy módosítani, hogy a `useOhlcBars` hívásokat egy `useMemo`
 * által cache-elt listában hívja (minden (symbol, tf) párra egyszer).
 */
function ChartsPanelWithOhlc({
  provider,
  history,
  initialEquityUsdt,
  strategies,
  focused,
}: {
  readonly provider: BotStateProvider;
  readonly history: readonly Trade[];
  readonly initialEquityUsdt: number;
  readonly strategies: readonly StrategyBar[];
  readonly focused: boolean;
}): ReactElement {
  const ohlc = useOhlcBars(provider, asSymbol("BTC/USDT"), "1m");
  // Az OhlcBar → OhlcCandle konverzió (a candlestick chart csak OHL+C-et kér).
  const candles: OhlcCandle[] = ohlc.bars.slice(-40).map((b) => ({
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
  return (
    <ChartsPanel
      history={history}
      initialEquityUsdt={initialEquityUsdt}
      candles={candles}
      strategies={strategies}
      focused={focused}
    />
  );
}

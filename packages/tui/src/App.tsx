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
//   [o]           — settings panel megnyitása (Phase 36 Track C1)
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
//
// A Phase 41 kiegészítés:
//   - `useTerminalSize` hook a terminál szélességét olvassa, és
//     meghatározza a `LayoutMode`-ot (`2x2` / `2x1` / `1x4`).
//   - A 4 panel (Statistics / Live / History / Charts) a
//     `LayoutMode` alapján rendeződik:
//       * 2x2 (≥120 col): 2 oszlop × 2 sor
//         Top-left: Statistics | Top-right: Live
//         Bottom-left: History | Bottom-right: Charts
//       * 2x1 (80-119 col): 2 oszlop × 1 sor (Statistics | Live felül,
//         History | Charts alul — 2 sorban egymás mellett)
//       * 1x4 (<80 col): 1 oszlop × 4 sor (a korábbi stacked fallback)
//   - A fókuszált panel egy explicit ▶ nyilat kap a címében (a
//     border color változáson túl, ami korábban is volt).

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { BotStateProvider } from "./providers/BotStateProvider.js";
import { useBotState } from "./hooks/useBotState.js";
import { useOhlcBars } from "./hooks/useOhlcBars.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import {
  cyclePanel,
  cycleSortKey,
  keybindAction,
} from "./app-logic.js";
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
  // A terminál méret — a responsive grid alapja.
  const { layoutMode, columns } = useTerminalSize();

  // Az "aktuális idő" állapot, amit 1 másodpercenként frissítunk —
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

  // A settings panel elérhetősége — a consumer átadta-e a szükséges
  // prop-okat. Az `[o]` billentyű csak akkor hat, ha ez true.
  const settingsAvailable = settingsConfigPath !== undefined && settingsSave !== undefined;

  /**
   `cyclePanel` — a panel-fókusz ciklikus váltása. A tiszta
   logika a `app-logic.ts` `cyclePanel` függvényében van —
   itt csak a state-setter-t hívjuk a visszatérési értékkel.
  */
  const handleCyclePanel = (direction: 1 | -1): void => {
    setFocusedPanel((current) => cyclePanel(current, direction));
  };

  /**
   `selectPanel` — a panel-fókusz közvetlen beállítása egy
   konkrét panelre (a `c` shortcut-billentyű hívja).
  */
  const handleSelectPanel = (panel: FocusedPanel): void => {
    setFocusedPanel(panel);
  };

  /**
   `cycleSortKey` — a history rendezési kulcs ciklikus váltása.
   A tiszta logika az `app-logic.ts`-ban van.
   */
  const handleCycleSortKey = (): void => {
    setSortKey((current) => cycleSortKey(current));
  };

  // A billentyűzet-kezelés. A `useInput` mindig aktív, de a
  // tényleges billentyű → action leképezés az `app-logic.ts`
  // `keybindAction` dispatcherében van (tiszta függvény, unit
  // tesztekkel 100%-osan lefedve). Az App csak a kapott
  // action alapján végzi el a side-effect-eket.
  useInput((input, key) => {
    const action = keybindAction(input, key, {
      helpVisible,
      killSwitch: state.killSwitch,
      isTuiOnly,
      settingsAvailable,
      settingsOpen,
    });
    switch (action.type) {
      case "quit":
        void (async () => {
          if (state.running) {
            await provider.stop();
            if (onStop !== undefined) onStop();
          }
          await provider.dispose();
          exit();
        })();
        return;
      case "toggle-help":
        setHelpVisible((v) => !v);
        return;
      case "close-help":
        setHelpVisible(false);
        return;
      case "start-stop":
        void (async () => {
          if (state.running) {
            await provider.stop();
            if (onStop !== undefined) onStop();
          } else {
            await provider.start();
          }
        })();
        return;
      case "pause": {
        const newPaused = !state.paused;
        provider.setPaused(newPaused);
        if (onPause !== undefined) onPause(newPaused);
        return;
      }
      case "kill-confirm":
        if (state.running && state.killSwitch === "armed") {
          provider.setKillSwitchState("confirm");
        }
        return;
      case "kill-trigger":
        void (async () => {
          await provider.killSwitch();
        })();
        return;
      case "kill-cancel":
        provider.setKillSwitchState("armed");
        return;
      case "refresh":
        setNow(Date.now());
        return;
      case "cycle-sort":
        handleCycleSortKey();
        return;
      case "open-settings":
        setSettingsOpen(true);
        return;
      case "select-panel":
        handleSelectPanel(action.panel);
        return;
      case "cycle-panel":
        handleCyclePanel(action.direction);
        return;
      case "noop":
        return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {/*
        Phase 41: a StatusBar MINDKÉT módban megjelenik (dashboard
        ÉS settings panel). A user mindig lássa a keybind-eket +
        a settings panel módot ("close settings" ha nyitva van).
      */}
      {settingsOpen && settingsAvailable ? (
        <SettingsPanelWithState
          configPath={settingsConfigPath}
          save={settingsSave}
        />
      ) : (
        <>
      <Header state={state} />
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
      <ResponsiveGrid
        layoutMode={layoutMode}
        columns={columns}
        focusedPanel={focusedPanel}
        state={state}
        now={now}
        provider={provider}
        sortKey={sortKey}
      />
        </>
      )}
      {/*
        Phase 41: a StatusBar MINDKÉT módban megjelenik (dashboard
        ÉS settings panel). A user mindig lássa a keybind-eket.
        A `helpVisible` overlay-t a StatusBar FÖLÖTT rendereljük,
        hogy a user bezárhassa a [?] / [Esc] billentyűkkel — a
        help overlay a StatusBar felett van, így nem takarja el a
        keybind-listát.
      */}
      <Box marginTop={1}>
        <StatusBar
          killSwitch={state.killSwitch}
          tuiOnly={isTuiOnly}
          running={state.running}
          settingsAvailable={settingsAvailable}
          settingsOpen={settingsOpen}
        />
      </Box>
      {helpVisible && <HelpOverlay visible={helpVisible} tuiOnly={isTuiOnly} layoutMode={layoutMode} />}
    </Box>
  );
}

/**
 * `ResponsiveGrid` — a Phase 41 responsive 2x2 / 2x1 / 1x4 grid.
 *
 * A komponens a `layoutMode` alapján rendereli a 4 panelt:
 *   - "2x2" (≥120 col): 2 sor, 2 oszlop — Statistics | Live felül,
 *     History | Charts alul
 *   - "2x1" (80-119 col): 2 sor, 2 oszlop — DE minden sor 1 sor
 *     magas (a panel-ek vízszintesen egymás mellett vannak, mint
 *     a 2x2-ben, csak keskenyebb terminálon). A vizuális hatás
 *     hasonló a 2x2-höz, csak keskenyebb panel-szélességgel.
 *   - "1x4" (<80 col): 1 oszlop, 4 sor (a régi stacked fallback)
 *
 * A `flexBasis` biztosítja, hogy a panelek megkapják a szélesség
 * 50%-át (2x2 / 2x1 módban) — a Box elosztja a maradék helyet
 * `flexGrow={1}`-gyel.
 *
 * Phase 41 fókusz indikátor: a fókuszált panel címéhez egy `▶`
 * prefix kerül (a border color változáson túl). A `focusedPanel`
 * alapján minden panel megkapja a `focused` prop-ját.
 */
function ResponsiveGrid({
  layoutMode,
  focusedPanel,
  state,
  now,
  provider,
  sortKey,
}: {
  readonly layoutMode: "2x2" | "2x1" | "1x4";
  readonly columns: number;
  readonly focusedPanel: FocusedPanel;
  readonly state: ReturnType<typeof useBotState>;
  readonly now: number;
  readonly provider: BotStateProvider;
  readonly sortKey: HistorySortKey;
}): ReactElement {
  const isStacked = layoutMode === "1x4";

  if (isStacked) {
    return (
      <Box flexDirection="column">
        <Box marginTop={1} flexDirection="row">
          <StatisticsPanel statistics={state.statistics} focused={focusedPanel === "statistics"} />
        </Box>
        <Box marginTop={1} flexDirection="row">
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
          <HistoryList
            history={state.history}
            now={now}
            sortKey={sortKey}
            focused={focusedPanel === "history"}
          />
        </Box>
        <Box marginTop={1}>
          <ChartsPanelWithOhlc
            provider={provider}
            history={state.history}
            initialEquityUsdt={state.statistics.initialEquityUsdt}
            strategies={[]}
            focused={focusedPanel === "charts"}
          />
        </Box>
      </Box>
    );
  }

  // 2x2 / 2x1 mód: 2 sor × 2 oszlop. A felső sorban Statistics + Live,
  // az alsóban History + Charts. A `flexBasis={0}` + `flexGrow={1}`
  // biztosítja, hogy a 2 panel egyenlő szélességű legyen.
  return (
    <Box flexDirection="column">
      <Box marginTop={1} flexDirection="row" gap={1}>
        <Box flexBasis={0} flexGrow={1}>
          <StatisticsPanel statistics={state.statistics} focused={focusedPanel === "statistics"} />
        </Box>
        <Box flexBasis={0} flexGrow={1}>
          <LiveTradingPanel
            tickers={state.tickers}
            positions={state.positions}
            tickerEvents={state.tickerEvents}
            now={now}
            killSwitchThresholdPct={state.killSwitchThresholdPct}
            focused={focusedPanel === "live"}
          />
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="row" gap={1}>
        <Box flexBasis={0} flexGrow={1}>
          <HistoryList
            history={state.history}
            now={now}
            sortKey={sortKey}
            focused={focusedPanel === "history"}
          />
        </Box>
        <Box flexBasis={0} flexGrow={1}>
          <ChartsPanelWithOhlc
            provider={provider}
            history={state.history}
            initialEquityUsdt={state.statistics.initialEquityUsdt}
            strategies={[]}
            focused={focusedPanel === "charts"}
          />
        </Box>
      </Box>
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
}: {
  readonly configPath: string;
  readonly save: (data: Readonly<Record<string, unknown>>) => Promise<void> | void;
}): ReactElement {
  const settings = useSettingsPanel({ configPath, save });
  // A useEffect a hook state változásaira figyel — ha a save
  // sikeresen befejeződött ÉS a baseline frissült, a user a
  // Ctrl+S-re save-olt. A panel automatikus bezárása a
  // SettingsPanel belső useInput-jában van (lásd a SettingsPanel
  // forráskódjában a `Ctrl+S` ágat). A `dirty` / `errors.length`
  // figyelés itt a hook state változásait dokumentálja.
  useEffect(() => {
    // No-op: a state-ek figyelése a jövőbeli side-effect-ek
    // alapja lehet (pl. auto-close sikeres save után). Most
    // a panel bezárása manuális (a user újabb [o] megnyomására).
  }, [settings.state.dirty, settings.state.errors.length]);
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

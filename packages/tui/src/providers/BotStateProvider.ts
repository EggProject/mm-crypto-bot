// packages/tui/src/providers/BotStateProvider.ts — a state provider absztrakció
//
// A TUI a `BotStateProvider` interfészen keresztül kommunikál a háttér-motorral
// (paper / live engine). A provider felelős:
//   1. A bot indításáért / leállításáért (`start()`, `stop()`)
//   2. A vészleállító aktiválásáért (`killSwitch()`)
//   3. A state realtime frissítéséért (subscribe callback)
//   4. A CCXT Pro WS feed-ből (vagy szimulációból) jövő árak fogadásáért
//
// Két implementáció létezik:
//   - `SimulatedProvider` — TUI-only módhoz, szintetikus adatokkal
//   - `PaperProvider` — `bun run start` módhoz, a `@mm/paper` motorral
//
// A state frissítése "pull" modellben történik: a `getSnapshot()` mindig
// az aktuális állapotot adja vissza, a subscribe csupán értesíti a TUI-t,
// hogy újra kell renderelni.

import type { BotState, KillSwitchState, Position, Statistics, TickerEvent, TickerPrice, Trade } from "../types.js";

/**
 `Listener` — a state-változásra feliratkozó callback.
 Az Ink komponensek ezen keresztül kapnak értesítést, hogy
 újra kell renderelni a TUI-t.
*/
export type Listener = () => void;

/**
 `BotStateProvider` — a TUI és a bot-motor közötti absztrakció.

 Phase 34 Track B kiegészítés: `setPaused(paused)` — a TUI-ból jövő
 pause/resume kérés. A TUI a `p` billentyűvel hívja. A provider
 felelőssége, hogy a pause flag-et a state-be beépítse, és —
 amennyiben a saját logikája engedi — a nyitást szüneteltesse.
 A valós `Bot` esetén a pause UI-flag; a tényleges position-nyitás
 a `Bot.run()` logikájától függ.
*/
export interface BotStateProvider {
  /** Feliratkozás a state-változásokra. Visszatérési érték: leiratkozó függvény. */
  readonly subscribe: (listener: Listener) => () => void;
  /** Az aktuális state pillanatképe. */
  readonly getSnapshot: () => BotState;
  /** A bot indítása (új pozíciók keresése, WS feed megnyitása). */
  readonly start: () => Promise<void>;
  /** A bot szabályos leállítása (nyitott pozíciók megtartása, feed lezárása). */
  readonly stop: () => Promise<void>;
  /** Vészleállító — minden nyitott pozíció azonnali zárása. */
  readonly killSwitch: () => Promise<void>;
  /** A kill-switch állapot lekérdezése (UI-ból való megerősítéshez). */
  readonly setKillSwitchState: (state: KillSwitchState) => void;
  /**
   `setPaused(paused)` — a TUI-ból jövő pause/resume kérés.
   A `true` érték letiltja az új pozíciók nyitását (amennyiben a
   provider ezt támogatja); a `false` érték újra engedélyezi.
  */
  readonly setPaused: (paused: boolean) => void;
  /** Erőforrások felszabadítása (TUI kilépéskor hívandó). */
  readonly dispose: () => Promise<void>;
}

/**
 `EMPTY_STATISTICS` — a frissen induló statisztika-panel tartalma.
 Minden mező 0, az equity a `loadConfig` által szolgáltatott
 kezdőérték. A `későbbi` provider-ek felülírják az induláskor.
*/
export function emptyStatistics(initialEquityUsdt: number): Statistics {
  return {
    totalPnlUsdt: 0,
    totalPnlPct: 0,
    winRate: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    maxDrawdownPct: 0,
    currentDrawdownPct: 0,
    avgWinPnl: 0,
    avgLossPnl: 0,
    bestTradePnl: 0,
    worstTradePnl: 0,
    profitFactor: 0,
    sharpeRatio: 0,
    equityUsdt: initialEquityUsdt,
    initialEquityUsdt,
  };
}

/**
 `EMPTY_PROVIDER_STATUS` — a provider induló állapota (TUI-only mód).
*/
export function emptyStatus(mode: "tui-only" | "with-bot", error: string | null = null): BotState["status"] {
  return {
    mode,
    engineAvailable: error === null,
    engineError: error,
    connected: false,
    lastUpdate: 0,
  };
}

/**
 `EMPTY_BOT_STATE` — a frissen induló TUI state.

 Phase 34 Track B: a `tickerEvents` rolling buffer (max 32 event),
 a `paused` flag (default false), és a `killSwitchThresholdPct`
 (default -10% — a pozíciók 10%-os veszteség felett sötéten
 pirosra váltanak a LiveTradingPanel-ben).
*/
export function emptyBotState(
  mode: "tui-only" | "with-bot",
  initialEquityUsdt: number,
  engineError: string | null = null,
): BotState {
  return {
    status: emptyStatus(mode, engineError),
    running: false,
    killSwitch: "armed",
    positions: [] as readonly Position[],
    statistics: emptyStatistics(initialEquityUsdt),
    history: [] as readonly Trade[],
    tickers: [] as readonly TickerPrice[],
    tickerEvents: [] as readonly TickerEvent[],
    paused: false,
    killSwitchThresholdPct: -10,
  };
}

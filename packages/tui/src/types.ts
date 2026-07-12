// packages/tui/src/types.ts — a TUI állapot-típusai
//
// Ez a modul a TUI-ban megjelenített összes állapot (pozíciók, PnL,
// statisztikák, history) típus-definícióit tartalmazza. A típusok
// szándékosan "readonly" és "exact" szemantikát követnek, hogy a
// state-frissítések típus-szinten is biztonságosak legyenek.

/**
 `Side` — a kereskedés iránya.
 Megtartjuk a `@mm/shared` `Side` típusával kompatibilis formát,
 hogy a későbbi fázisokban a `@mm/paper` és `@mm/core` típusai
 közvetlenül felhasználhatók legyenek.
*/
export type Side = "buy" | "sell";

/**
 `Position` — egy aktuálisan nyitott kereskedési pozíció.
 A `currentPrice` mező realtime frissül a tőzsdei tick-ekből.
 Az `unrealizedPnl` az aktuális piaci ár alapján számított
 nem realizált nyereség/veszteség USDT-ben.
*/
export interface Position {
  readonly id: string;
  readonly symbol: string;
  readonly side: Side;
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly quantity: number;
  readonly leverage: number;
  readonly unrealizedPnl: number;
  readonly unrealizedPnlPct: number;
  readonly openedAt: number;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
}

/**
 `Trade` — egy lezárt kereskedés a history-ból.
 A `closedAt` timestamp a pozíció zárásának időpontja.
 A `pnlUsdt` a bruttó PnL USDT-ben (fee-kkel együtt).
*/
export interface Trade {
  readonly id: string;
  readonly symbol: string;
  readonly side: Side;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly leverage: number;
  readonly pnlUsdt: number;
  readonly pnlPct: number;
  readonly openedAt: number;
  readonly closedAt: number;
  readonly reason: string;
}

/**
 `Statistics` — aggregált statisztikai mutatók.
 Ezeket a panelek a "Statisztika" menüpontban jelenítik meg.
*/
export interface Statistics {
  readonly totalPnlUsdt: number;
  readonly totalPnlPct: number;
  readonly winRate: number;
  readonly totalTrades: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly maxDrawdownPct: number;
  readonly currentDrawdownPct: number;
  readonly avgWinPnl: number;
  readonly avgLossPnl: number;
  readonly bestTradePnl: number;
  readonly worstTradePnl: number;
  readonly profitFactor: number;
  readonly sharpeRatio: number;
  readonly equityUsdt: number;
  readonly initialEquityUsdt: number;
}

/**
 `TickerPrice` — egy adott szimbólum aktuális tőzsdei ára.
*/
export interface TickerPrice {
  readonly symbol: string;
  readonly price: number;
  readonly change24hPct: number;
  readonly volume24hUsdt: number;
}

/**
 `TickerEvent` — egy bejövő ticker-event a feed-ből (vagy a szimulációból).
 A TUI az utolsó N eventet mutatja egy sub-panelben (a Phase 34 §4.3
 "jelenlegi kereskedés figyelése" követelményhez).
 A `seq` a provider-en belüli sorszám, monoton növekvő.
*/
export interface TickerEvent {
  readonly seq: number;
  readonly symbol: string;
  readonly price: number;
  readonly volume: number;
  readonly timestamp: number;
}

/**
 `HistorySortKey` — a HistoryList rendezési kulcsa.
 A felhasználó a `s` (sort) billentyűvel válthat rendezési kulcsot:
   time (default) | pnl | symbol
*/
export type HistorySortKey = "time" | "pnl" | "symbol";

/**
 `FocusedPanel` — az App által kezelt panel-fókusz.
 A `Tab` / bal-jobb nyilak váltanak a panelek között.
*/
export type FocusedPanel = "statistics" | "live" | "history";

/**
 `KillSwitchState` — a vészleállító állapota.
 - `armed`: a vészleállító aktív, a bot nem köthet új pozíciót
 - `confirm`: a felhasználó megnyomta a vészleállító gombot, és
   egy megerősítő prompt várakozik a billentyűzetre
 - `triggered`: a vészleállító már aktiválódott, minden nyitott
   pozíció zárva van
*/
export type KillSwitchState = "armed" | "confirm" | "triggered";

/**
 `ProviderStatus` — a state provider állapota.
 - `mode`: a TUI milyen üzemmódban fut ("tui-only" / "with-bot")
 - `engineAvailable`: a háttér-motor (paper/live) elérhető-e
 - `engineError`: hibaüzenet, ha a motor nem érhető el
 - `connected`: a CCXT Pro WS feed csatlakoztatva van-e
*/
export interface ProviderStatus {
  readonly mode: "tui-only" | "with-bot";
  readonly engineAvailable: boolean;
  readonly engineError: string | null;
  readonly connected: boolean;
  readonly lastUpdate: number;
}

/**
 `BotState` — a TUI által megjelenített teljes állapot.
 Ez a `BotStateProvider.subscribe()` callback-jének payload típusa.
 Minden mező readonly — a state kizárólag a provider-en belül
 módosítható, kívülről csak olvasni lehet.

 Phase 34 Track B kiegészítések:
   - `paused`: a `p` billentyűvel kapcsolható; paused=true esetén a
     szimulált provider NEM nyit új pozíciót (a valós `Bot` önállóan
     kezeli ezt, de a UI jelzi).
   - `tickerEvents`: az utolsó N ticker-event rolling ablaka (a
     `LiveTradingPanel` sub-panel-jéhez).
   - `killSwitchThresholdPct`: az a küszöb (P&L %-ban), amely felett
     a pozíció sötétvörösre vált a `LiveTradingPanel`-ben. A default
     érték a config-ban van megadva.
*/
export interface BotState {
  readonly status: ProviderStatus;
  readonly running: boolean;
  readonly killSwitch: KillSwitchState;
  readonly positions: readonly Position[];
  readonly statistics: Statistics;
  readonly history: readonly Trade[];
  readonly tickers: readonly TickerPrice[];
  readonly tickerEvents: readonly TickerEvent[];
  readonly paused: boolean;
  readonly killSwitchThresholdPct: number;
}

// packages/tui/src/components/HistoryList.tsx — history (korábbi trade-ek) panel
//
// A "History" menüpont. Az utolsó N lezárt trade-et mutatja fordított
// időrendben (legfrissebb elöl). Minden sor tartalmazza:
//   - A trade ID-ját (rövidítve)
//   - A szimbólumot és az oldalt (LONG/SHORT)
//   - Az entry és exit árat
//   - A PnL-t (USDT + %)
//   - A zárás okát (stop / TP / időlimit / kill-switch)
//
// Phase 36 Track B1: a hand-rolled `Box` sorok (`HistoryRow`)
// cseréje a `@matthesketh/ink-table` `<Table>` komponensére.
// A `<Table data columns />` formátum:
//
//   - `data`: a rendezett trade-lista (Trade[])
//   - `columns`: a Column<Trade>[] tömb, ami leírja a megjelenítendő
//     oszlopokat (header, width, align, render).
//
// MEGJEGYZÉS: a Table v0.1.0 a cella-értékeket stringként kezeli —
// a `render` callback stringet ad vissza, amit a táblázat kitölt
// padding-gel. Színes cellák NEM támogatottak a Table-en belül
// (a Table a teljes sort egyszerre rendereli, a színezés sor-szinten
// lenne lehetséges). Ez a trade-off elfogadható: a táblázat
// egységes, könnyen olvasható, és a trade-ek színezés helyett
// szövegesen jelzik az oldalt (LONG/SHORT) + a PnL előjelét
// (`+` / `-` prefix).
//
// A Phase 36 user mandate: a TUI legyen "richer" (jobb színek,
// badge-ek, panel-borders, keybinding hint-ek) — a badge-ek a
// panel CÍMÉBEN maradnak (`StatusMessage`), a táblázat a history-t
// strukturáltan jeleníti meg (ami a hand-rolled Box-soroknál
// szebben néz ki).

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import { Table } from "@matthesketh/ink-table";
import type { Column } from "@matthesketh/ink-table";
import { StatusMessage } from "@inkjs/ui";
import type { HistorySortKey, Trade } from "../types.js";
import { formatPct, formatPrice, formatUsdt } from "../utils/format.js";

/** A history-panelen egyszerre megjelenített sorok száma. */
const VISIBLE_ROWS = 20;

/**
 * `TableRow` — a `<Table data>`-nak átadott "sorosított" trade-lista.
 * A trade-objektum mezőit előre formázzuk, mert a Table csak string
 * cellaértékeket kezel.
 */
interface TableRow {
  readonly id: string;
  readonly side: string;
  readonly symbol: string;
  readonly entry: string;
  readonly exit: string;
  readonly pnl: string;
  readonly reason: string;
  readonly closed: string;
}

/**
 * `sortTrades` — a HistoryList rendezési kulcs szerinti sorbarendezés.
 */
function sortTrades(trades: readonly Trade[], sortKey: HistorySortKey): readonly Trade[] {
  const sorted = [...trades];
  if (sortKey === "time") {
    sorted.sort((a, b) => b.closedAt - a.closedAt);
  } else if (sortKey === "pnl") {
    sorted.sort((a, b) => b.pnlUsdt - a.pnlUsdt);
  } else {
    sorted.sort((a, b) => {
      if (a.symbol !== b.symbol) {
        return a.symbol < b.symbol ? -1 : 1;
      }
      return b.closedAt - a.closedAt;
    });
  }
  return sorted;
}

/**
 * `sortKeyLabel` — a `sortKey` magyar nyelvű címkéje.
 */
function sortKeyLabel(sortKey: HistorySortKey): string {
  if (sortKey === "time") return "IDŐ";
  if (sortKey === "pnl") return "PNL";
  return "SYMBOL";
}

/**
 * `signedPnl` — a PnL formázása előjeles stringként.
 * Pozitív: `+12,50`, negatív: `-3,20`, nulla: `0,00`.
 * A Table-ben a cellák plain stringek, így a szín-jelzés
 * karakter-szinten történik (`+` / `-` prefix + a zárójelben
 * lévő százalék is előjeles).
 */
function signedPnl(usdt: number, pct: number): string {
  const sign = usdt > 0 ? "+" : usdt < 0 ? "" : "";
  return `${sign}${formatUsdt(usdt)} (${formatPct(pct)})`;
}

/**
 `HistoryList` — a lezárt trade-ek listája.
 Az `history` a `BotState.history` mező. A `now` az aktuális
 timestamp — a "mennyi ideje zártuk" mező frissítéséhez kell.
 A `sortKey` a rendezési kulcs — az App.tsx kezeli a `t` billentyűvel.
*/
export function HistoryList({
  history,
  now,
  sortKey,
  focused = false,
}: {
  readonly history: readonly Trade[];
  readonly now: number;
  readonly sortKey: HistorySortKey;
  readonly focused?: boolean;
}): ReactElement {
  const borderColor: "blueBright" | "blue" = focused ? "blueBright" : "blue";
  // A history rendezése a `sortKey` alapján.
  const sorted = sortTrades(history, sortKey);
  const visible = sorted.slice(0, VISIBLE_ROWS);
  const hiddenCount = Math.max(0, sorted.length - VISIBLE_ROWS);

  // A Table-nak átadandó sorok (a Trade objektumot "sorosítjuk"
  // a cellák formázásához).
  const tableData: TableRow[] = visible.map((t) => ({
    id: `#${t.id.slice(-4)}`,
    side: t.side === "buy" ? "LONG" : "SHORT",
    symbol: t.symbol.replace("/USDT", ""),
    entry: formatPrice(t.symbol, t.entryPrice),
    exit: formatPrice(t.symbol, t.exitPrice),
    pnl: signedPnl(t.pnlUsdt, t.pnlPct),
    reason: t.reason,
    closed: formatDurationShort(now - t.closedAt),
  }));

  // Az oszlop-definíciók. A `render` callback-ek csak a formázott
  // stringet adják vissza (a Table v0.1.0 NEM támogatja a soron belüli
  // színezést, mert a `cells.join(separator)` miatt a JSX object
  // literal "[object Object]" lenne a string helyén).
  const columns: Column<TableRow>[] = [
    { key: "id", header: "ID", width: 8 },
    { key: "side", header: "OLDAL", width: 8, align: "center" },
    { key: "symbol", header: "SYMBOL", width: 10 },
    { key: "entry", header: "BELÉPŐ", width: 14, align: "right" },
    { key: "exit", header: "KILÉPŐ", width: 14, align: "right" },
    { key: "pnl", header: "PNL", width: 22, align: "right" },
    { key: "reason", header: "OK", width: 14 },
    { key: "closed", header: "ZÁRVA", width: 12 },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        {/*
          Phase 36 Track B1: a panel címe `<StatusMessage>` formátumban.
          A `variant="info"` kék szín = "history / read-only data".

          Phase 41: a fókusz indikátor. A fókuszált panel címéhez
          egy `▶` prefix kerül (a border color változáson túl).
          A `focused` prop alapján a prefix megjelenik vagy eltűnik.
        */}
        <Box>
          {focused && <Text bold color="blue">▶  </Text>}
          <StatusMessage variant="info">📜  HISTORY (LEZÁRT TRADE-EK)</StatusMessage>
        </Box>
        <Box>
          <Text dimColor>Rendezve: </Text>
          <Text bold color="blue">{sortKeyLabel(sortKey)}</Text>
          <Text dimColor>  ·  </Text>
          <Text dimColor>{history.length} db összesen</Text>
        </Box>
      </Box>

      {visible.length === 0 ? (
        <Box marginTop={0} flexDirection="column">
          <Text color="gray" italic>Még nincs lezárt trade. A history a pozíciók zárásakor fog feltöltődni.</Text>
          {/*
            Phase 41: a korábbi passzív "Még nincs..." üzenet kiegészül
            egy explicit empty-state figyelmeztetéssel, ami a user-t
            a [s] indító-billentyű felé irányítja. Az `→` nyilat
            használunk (a focus indicator `▶` helyett), hogy a két
            vizuális jel ne ütközzön.
          */}
          <Box marginTop={0}>
            <Text color="yellow" bold>→  No closed trades yet — </Text>
            <Text dimColor>start the bot with </Text>
            <Text color="green" bold>[s]</Text>
            <Text dimColor> to begin trading.</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={0}>
          <Table data={tableData} columns={columns} emptyText="—" />
          {hiddenCount > 0 && (
            <Box marginTop={0}>
              <Text dimColor>... és még {hiddenCount} korábbi trade (a teljes listát lásd a log-ban).</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * `formatDurationShort` — egy tömörebb idő-formázó a history-sorok
 * "ZÁRVA" oszlopához (pl. "5m", "2h", "3d"). A `formatDuration`
 * util-függvényt a `utils/format` modulban újra felhasználhatnánk,
 * de a Table-szintű rövidítés itt praktikusabb.
 */
function formatDurationShort(ms: number): string {
  if (ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

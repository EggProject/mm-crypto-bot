// packages/tui/src/components/HistoryList.tsx — history (korábbi trade-ek) panel
//
// A "History" menüpont. Az utolsó N lezárt trade-et mutatja fordított
// időrendben (legfrissebb elöl). Minden sor tartalmazza:
//   - A trade ID-ját (rövidítve)
//   - A szimbólumot és az oldalt (LONG/SHORT)
//   - Az entry és exit árat
//   - A PnL-t (USDT + %)
//   - A zárás okát (stop / TP / időlimit / kill-switch)

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import type { Trade } from "../types.js";
import { colorForValue, formatDuration, formatPct, formatPrice, formatUsdt } from "../utils/format.js";

/** A history-panelen egyszerre megjelenített sorok száma. */
const VISIBLE_ROWS = 10;

/**
 `HistoryRow` — egyetlen lezárt trade sora.
*/
function HistoryRow({ trade, now }: { readonly trade: Trade; readonly now: number }): ReactElement {
  const pnlColor = colorForValue(trade.pnlUsdt);
  const sideLabel = trade.side === "buy" ? "LONG" : "SHORT";
  const sideColor: "green" | "red" = trade.side === "buy" ? "green" : "red";
  const closedDuration = formatDuration(now - trade.closedAt);
  return (
    <Box flexDirection="row">
      <Box width={8}>
        <Text dimColor>#{trade.id.slice(-4)}</Text>
      </Box>
      <Box width={6}>
        <Text bold color={sideColor}>{sideLabel}</Text>
      </Box>
      <Box width={10}>
        <Text bold>{trade.symbol.replace("/USDT", "")}</Text>
      </Box>
      <Box width={12}>
        <Text dimColor>in: </Text>
        <Text>{formatPrice(trade.symbol, trade.entryPrice)}</Text>
      </Box>
      <Box width={12}>
        <Text dimColor>out: </Text>
        <Text>{formatPrice(trade.symbol, trade.exitPrice)}</Text>
      </Box>
      <Box width={20}>
        <Text color={pnlColor} bold>
          {formatUsdt(trade.pnlUsdt)} ({formatPct(trade.pnlPct)})
        </Text>
      </Box>
      <Box width={14}>
        <Text dimColor>{trade.reason}</Text>
      </Box>
      <Box width={10}>
        <Text dimColor>{closedDuration} óta</Text>
      </Box>
    </Box>
  );
}

/**
 `HistoryList` — a lezárt trade-ek listája.
 Az `history` a `BotState.history` mező. A `now` az aktuális
 timestamp — a "mennyi ideje zártuk" mező frissítéséhez kell.
*/
export function HistoryList({
  history,
  now,
}: {
  readonly history: readonly Trade[];
  readonly now: number;
}): ReactElement {
  // Fordított időrend — a legfrissebb trade elöl.
  const sorted = [...history].sort((a, b) => b.closedAt - a.closedAt);
  const visible = sorted.slice(0, VISIBLE_ROWS);
  const hiddenCount = Math.max(0, sorted.length - VISIBLE_ROWS);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color="blue">📜  HISTORY (LEZÁRT TRADE-EK)</Text>
        <Text dimColor>{history.length} db összesen</Text>
      </Box>

      {visible.length === 0 ? (
        <Box marginTop={0}>
          <Text color="gray" italic>Még nincs lezárt trade. A history a pozíciók zárásakor fog feltöltődni.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={0}>
          <Box flexDirection="row">
            <Box width={8}><Text dimColor>ID</Text></Box>
            <Box width={6}><Text dimColor>OLDAL</Text></Box>
            <Box width={10}><Text dimColor>SYMBOL</Text></Box>
            <Box width={12}><Text dimColor>BELÉPŐ</Text></Box>
            <Box width={12}><Text dimColor>KILÉPŐ</Text></Box>
            <Box width={20}><Text dimColor>PNL</Text></Box>
            <Box width={14}><Text dimColor>OK</Text></Box>
            <Box width={10}><Text dimColor>ZÁRVA</Text></Box>
          </Box>
          {visible.map((t) => (
            <HistoryRow key={t.id} trade={t} now={now} />
          ))}
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

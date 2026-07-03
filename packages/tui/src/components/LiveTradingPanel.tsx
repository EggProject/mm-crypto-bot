// packages/tui/src/components/LiveTradingPanel.tsx — élő kereskedés panel
//
// A "Jelenlegi kereskedés figyelése" menüpont. Két részből áll:
//   1. A tőzsdei tickerek (BTC, ETH, SOL) — árak + 24h változás
//   2. A nyitott pozíciók listája — entry, current, PnL, stop/TP
//
// Az adatok 1 Hz-en frissülnek (a `useBotState` re-rendereli a
// komponenst, amikor a provider új state-et küld).

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import type { Position, TickerPrice } from "../types.js";
import { colorForValue, formatDuration, formatPct, formatPrice, formatUsdt } from "../utils/format.js";

/**
 `TickerRow` — egyetlen tőzsdei ticker sora a panel tetején.
*/
function TickerRow({ ticker }: { readonly ticker: TickerPrice }): ReactElement {
  const changeColor = colorForValue(ticker.change24hPct);
  return (
    <Box flexDirection="row" width={20}>
      <Text bold>{ticker.symbol.replace("/USDT", "")}</Text>
      <Text>  </Text>
      <Text>{formatPrice(ticker.symbol, ticker.price)}</Text>
      <Text>  </Text>
      <Text color={changeColor}>{formatPct(ticker.change24hPct)}</Text>
    </Box>
  );
}

/**
 `PositionRow` — egy nyitott pozíció sora.
*/
function PositionRow({ position, now }: { readonly position: Position; readonly now: number }): ReactElement {
  const pnlColor = colorForValue(position.unrealizedPnl);
  const sideLabel = position.side === "buy" ? "LONG" : "SHORT";
  const sideColor: "green" | "red" = position.side === "buy" ? "green" : "red";
  const ageMs = now - position.openedAt;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Box flexDirection="row">
        <Box width={12}>
          <Text bold color={sideColor}>{sideLabel}</Text>
        </Box>
        <Box width={10}>
          <Text bold>{position.symbol.replace("/USDT", "")}</Text>
        </Box>
        <Box width={10}>
          <Text>x{position.leverage}</Text>
        </Box>
        <Box width={14}>
          <Text>qty: {formatUsdt(position.quantity, 4)}</Text>
        </Box>
        <Box width={20}>
          <Text dimColor>Élettartam: {formatDuration(ageMs)}</Text>
        </Box>
      </Box>
      <Box flexDirection="row" marginTop={0}>
        <Box width={28}>
          <Text dimColor>Belépő: </Text>
          <Text>{formatPrice(position.symbol, position.entryPrice)}</Text>
        </Box>
        <Box width={28}>
          <Text dimColor>Jelenlegi: </Text>
          <Text bold>{formatPrice(position.symbol, position.currentPrice)}</Text>
        </Box>
        <Box width={28}>
          <Text dimColor>PnL: </Text>
          <Text color={pnlColor} bold>
            {formatUsdt(position.unrealizedPnl)} USDT ({formatPct(position.unrealizedPnlPct)})
          </Text>
        </Box>
      </Box>
      {(position.stopLoss !== null || position.takeProfit !== null) && (
        <Box flexDirection="row" marginTop={0}>
          {position.stopLoss !== null && (
            <Box width={28}>
              <Text dimColor>SL: </Text>
              <Text color="red">{formatPrice(position.symbol, position.stopLoss)}</Text>
            </Box>
          )}
          {position.takeProfit !== null && (
            <Box width={28}>
              <Text dimColor>TP: </Text>
              <Text color="green">{formatPrice(position.symbol, position.takeProfit)}</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 `LiveTradingPanel` — az élő kereskedés panelje.
 A `tickers` és `positions` a `BotState` megfelelő mezőiből jön.
 A `now` az aktuális UNIX timestamp (a re-render során frissül,
 így az "életkor" / "futásidő" mutatók is frissülnek).
*/
export function LiveTradingPanel({
  tickers,
  positions,
  now,
}: {
  readonly tickers: readonly TickerPrice[];
  readonly positions: readonly Position[];
  readonly now: number;
}): ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} flexGrow={1}>
      <Text bold color="yellow">📈  ÉLŐ KERESKEDÉS</Text>

      <Box flexDirection="column" marginTop={0}>
        <Text dimColor>TICKEREK</Text>
        <Box flexDirection="row" marginTop={0}>
          {tickers.map((t) => (
            <TickerRow key={t.symbol} ticker={t} />
          ))}
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>NYITOTT POZÍCIÓK ({positions.length} db)</Text>
        {positions.length === 0 ? (
          <Box marginTop={0}>
            <Text color="gray" italic>Jelenleg nincs nyitott pozíció.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={0}>
            {positions.map((p) => (
              <Box key={p.id} marginTop={0}>
                <PositionRow position={p} now={now} />
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

// packages/tui/src/components/LiveTradingPanel.tsx — élő kereskedés panel
//
// A "Jelenlegi kereskedés figyelése" menüpont. Három részből áll:
//   1. A tőzsdei tickerek (BTC, ETH, SOL) — árak + 24h változás
//   2. A nyitott pozíciók listája — entry, current, PnL, stop/TP
//   3. Az utolsó 5 ticker-event sub-panel (Phase 34 Track B)
//
// Az adatok a `useBotState` által biztosított state-ből jönnek —
// a provider minden notify-ja re-rendereli a komponenst.
//
// A Phase 34 Track B kiegészítések:
//   - Ticker-event sub-panel: a `state.tickerEvents` utolsó 5
//     elemét mutatja (symbol, last price, volume).
//   - Kill-switch flash: ha egy pozíció `unrealizedPnlPct` < a
//     `killSwitchThresholdPct` (default -10%), a pozíció sora
//     sötéten pirosra vált, és a `[KILL-SWITCH KÜSZÖB!]` felirat
//     jelenik meg a panelen.

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import type { Position, TickerEvent, TickerPrice } from "../types.js";
import { colorForValue, formatDuration, formatPct, formatPrice, formatUsdt } from "../utils/format.js";

/** A ticker-event sub-panelen egyszerre megjelenített sorok száma. */
const VISIBLE_TICKER_EVENTS = 5;

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
 `TickerEventRow` — egy ticker-event sora a sub-panelen.
 A Phase 34 Track B spec: symbol, last price, volume.
*/
function TickerEventRow({ event, now }: { readonly event: TickerEvent; readonly now: number }): ReactElement {
  const ageMs = now - event.timestamp;
  return (
    <Box flexDirection="row">
      <Box width={8}>
        <Text dimColor>#{String(event.seq).padStart(4, "0")}</Text>
      </Box>
      <Box width={10}>
        <Text bold>{event.symbol.replace("/USDT", "")}</Text>
      </Box>
      <Box width={14}>
        <Text>{formatPrice(event.symbol, event.price)}</Text>
      </Box>
      <Box width={14}>
        <Text dimColor>vol {formatUsdt(event.volume, 0)}</Text>
      </Box>
      <Box width={10}>
        <Text dimColor>{formatDuration(ageMs)}</Text>
      </Box>
    </Box>
  );
}

/**
 `PositionRow` — egy nyitott pozíció sora.
 Ha a pozíció `unrealizedPnlPct` < `thresholdPct`, a sor sötéten
 pirosra vált, és a `[KILL-SWITCH KÜSZÖB!]` figyelmeztetés jelenik meg.
*/
function PositionRow({
  position,
  now,
  thresholdPct,
}: {
  readonly position: Position;
  readonly now: number;
  readonly thresholdPct: number;
}): ReactElement {
  const pnlColor = colorForValue(position.unrealizedPnl);
  const sideLabel = position.side === "buy" ? "LONG" : "SHORT";
  const sideColor: "green" | "red" = position.side === "buy" ? "green" : "red";
  const ageMs = now - position.openedAt;
  // A kill-switch küszöb átlépése: a pozíció PnL%-a rosszabb, mint
  // a threshold (pl. -10%). Ekkor a sor pirosan villog és warning badge.
  const breachedThreshold = position.unrealizedPnlPct < thresholdPct;
  // A border színe: piros, ha a küszöb átlépve; egyébként gray.
  const borderColor: "red" | "gray" = breachedThreshold ? "red" : "gray";
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={borderColor} paddingX={1}>
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
        {breachedThreshold && (
          <Box width={24}>
            <Text color="red" bold>⚠  KILL-SWITCH KÜSZÖB!</Text>
          </Box>
        )}
      </Box>
      <Box flexDirection="row" marginTop={0}>
        <Box width={28}>
          <Text dimColor>Belépő: </Text>
          <Text>{formatPrice(position.symbol, position.entryPrice)}</Text>
        </Box>
        <Box width={28}>
          <Text dimColor>Jelenlegi: </Text>
          <Text bold color={breachedThreshold ? "red" : "white"}>{formatPrice(position.symbol, position.currentPrice)}</Text>
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
 A `tickers`, `positions`, `tickerEvents` a `BotState` megfelelő mezőiből jönnek.
 A `now` az aktuális UNIX timestamp (a re-render során frissül,
 így az "életkor" / "futásidő" mutatók is frissülnek).
 A `killSwitchThresholdPct` a BotState-ből jön, és a pozíció
 küszöb-detektálásához kell.
*/
export function LiveTradingPanel({
  tickers,
  positions,
  tickerEvents,
  now,
  killSwitchThresholdPct,
  focused = false,
}: {
  readonly tickers: readonly TickerPrice[];
  readonly positions: readonly Position[];
  readonly tickerEvents: readonly TickerEvent[];
  readonly now: number;
  readonly killSwitchThresholdPct: number;
  readonly focused?: boolean;
}): ReactElement {
  const borderColor: "yellowBright" | "yellow" = focused ? "yellowBright" : "yellow";
  // Az utolsó N ticker-event fordított időrendben (legfrissebb elöl).
  const visibleEvents = tickerEvents.slice(-VISIBLE_TICKER_EVENTS).reverse();

  // Van-e bármelyik pozíció, ami a kill-switch küszöböt átlépte?
  const hasBreachedPosition = positions.some((p) => p.unrealizedPnlPct < killSwitchThresholdPct);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} flexGrow={1}>
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
        {hasBreachedPosition && (
          <Box marginTop={0}>
            <Text color="red" bold>
              ⚠  Kill-switch küszöb átlépve (PnL% &lt; {formatPct(killSwitchThresholdPct, 1)})
            </Text>
          </Box>
        )}
        {positions.length === 0 ? (
          <Box marginTop={0}>
            <Text color="gray" italic>Jelenleg nincs nyitott pozíció.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={0}>
            {positions.map((p) => (
              <Box key={p.id} marginTop={0}>
                <PositionRow position={p} now={now} thresholdPct={killSwitchThresholdPct} />
              </Box>
            ))}
          </Box>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>UTOLSÓ TICKER-EVENT-EK ({tickerEvents.length} db a bufferben, legfrissebb {VISIBLE_TICKER_EVENTS})</Text>
        {visibleEvents.length === 0 ? (
          <Box marginTop={0}>
            <Text color="gray" italic>Még nincs ticker-event.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={0}>
            <Box flexDirection="row">
              <Box width={8}><Text dimColor>SORSZÁM</Text></Box>
              <Box width={10}><Text dimColor>SYMBOL</Text></Box>
              <Box width={14}><Text dimColor>LAST PRICE</Text></Box>
              <Box width={14}><Text dimColor>VOLUME</Text></Box>
              <Box width={10}><Text dimColor>ÉLETKOR</Text></Box>
            </Box>
            {visibleEvents.map((e) => (
              <TickerEventRow key={e.seq} event={e} now={now} />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

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
// Phase 36 Track B1: az "Connecting..." placeholder szöveg cseréje
// `@inkjs/ui` `<Spinner label="..." />` komponensre. A Spinner egy
// animált Unicode-braille glyph-öt jelenít meg, ami vizuálisan
// jelzi a felhasználónak, hogy a feed / engine még tölt.
//
// A "Jelenleg nincs nyitott pozíció" / "Még nincs ticker-event"
// üres állapotok `<Text italic>` szövegek maradnak — ezek NEM
// kapcsolódnak aktív folyamathoz, így nincs értelme animálni őket.

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import { Spinner, StatusMessage } from "@inkjs/ui";
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
  const breachedThreshold = position.unrealizedPnlPct < thresholdPct;
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

  // A feed-kapcsolat státusza: ha nincs ticker, nincs ticker-event
  // ÉS nincs pozíció, akkor "Connecting..." állapotban vagyunk
  // (a Spinner jelenik meg). Ha bármelyik adat megérkezett, a normál
  // tartalom jelenik meg — nem blokkoljuk a user-t a részleges
  // információtól.
  const isConnecting = tickers.length === 0 && tickerEvents.length === 0 && positions.length === 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} flexGrow={1}>
      {/*
        Phase 36 Track B1: a panel címe `<StatusMessage variant="warning">`-
        ként jelenik meg (sárga szín = "live / active trading data").
      */}
      <StatusMessage variant="warning">📈  ÉLŐ KERESKEDÉS</StatusMessage>

      {/*
        Phase 36 Track B1: a feed-kapcsolat állapota. Ha még nincs ticker
        vagy ticker-event, egy animált Spinner jelzi a usernek, hogy
        a feed / engine még tölt. Amint megérkezik az első ticker,
        a Spinner eltűnik, és a normál tartalom jelenik meg.
      */}
      {isConnecting && (
        <Box marginTop={0}>
          <Spinner label="Connecting..." />
        </Box>
      )}

      {!isConnecting && (
        <>
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
        </>
      )}
    </Box>
  );
}

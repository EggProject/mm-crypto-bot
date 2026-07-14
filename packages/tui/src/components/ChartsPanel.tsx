// packages/tui/src/components/ChartsPanel.tsx — a Phase 36 Track B2 Charts panel
//
// A 4. panel a TUI-n (Statistics / Live / History / Charts).
// A panel az "richer visuals" user mandate teljesítője: az
// equity görbe, a P&L sparkline, az OHLC candlestick, és a
// stratégia-breakdown BarChart egyszerre jelennek meg.
//
// Layout (Box flexDirection="column"):
//   - Cím: <StatusMessage variant="info">📊  CHARTS</StatusMessage>
//   - Top: equity curve (renderEquityCurve) — 6 sor, 60 széles
//   - Middle: candlestick (renderCandlesticks) — 8 sor, 40 széles
//   - Bottom: P&L sparkline (renderSparkline) — 16 széles unicode-bar
//   - Side: StrategyBarChart — 5 stratégia cap% sávok
//
// A panel stopped state-ben "Még nincs chart-adat" üzenetet
// mutat (a `equityValues` üres, ha a bot sosem zárt pozíciót).

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import { renderEquityCurve } from "../charts/equity-curve.js";
import { renderSparkline } from "../charts/sparkline.js";
import { renderCandlesticks } from "../charts/candlestick.js";
import type { OhlcCandle } from "../charts/candlestick.js";
import { StrategyBarChart } from "../charts/bar-chart.js";
import type { StrategyBar } from "../charts/bar-chart.js";
import type { Trade } from "../types.js";

/**
 * `computeEquitySeries` — a history lezárt trade-jeiből equity
 * görbét számol. Az első pont a `initialEquityUsdt` (10 000
 * USDT a default), minden trade az egyenleghez adódik.
 *
 * Visszatérési érték: `[]` ha nincs trade (a renderEquityCurve
 * ekkor a "Még nincs equity-adat" placeholder-t adja vissza).
 * Ha van legalább 1 trade, a sorozat a `[initialEquityUsdt, ...]`
 * formátumban kezdődik, és minden trade hatására nő/zsugorodik.
 */
function computeEquitySeries(
  history: readonly Trade[],
  initialEquityUsdt: number,
): number[] {
  if (history.length === 0) {
    return [];
  }
  const series: number[] = [initialEquityUsdt];
  let equity = initialEquityUsdt;
  // A history fordított időrendben van (legfrissebb elöl), de az
  // equity-görbéhez időrendben kell: a legrégebbi elöl.
  const sortedAsc = [...history].sort((a, b) => a.closedAt - b.closedAt);
  for (const trade of sortedAsc) {
    equity += trade.pnlUsdt;
    series.push(equity);
  }
  return series;
}

/**
 * `computePnlSeries` — a history lezárt trade-jeinek P&L
 * sorozata (csak a pnlUsdt értékek, időrendben).
 */
function computePnlSeries(history: readonly Trade[]): number[] {
  const sortedAsc = [...history].sort((a, b) => a.closedAt - b.closedAt);
  return sortedAsc.map((t) => t.pnlUsdt);
}

/**
 * `ChartsPanelProps` — a ChartsPanel propjai.
 *
 * - `history`: a lezárt trade-ek listája (a `BotState.history`).
 * - `initialEquityUsdt`: a kezdő equity (10 000 USDT default).
 * - `candles`: az utolsó 1h OHLC tick-ek listája. A Phase 36
 *   research-ben a feed-ből jön, de a Phase 36 Track B2
 *   tesztek mock-olják.
 * - `strategies`: a 5 stratégia cap+enabled állapota.
 * - `focused`: true, ha a panel a Tab-bal kijelölt panel.
 */
export interface ChartsPanelProps {
  readonly history: readonly Trade[];
  readonly initialEquityUsdt: number;
  readonly candles: readonly OhlcCandle[];
  readonly strategies: readonly StrategyBar[];
  readonly focused?: boolean;
}

/**
 * `ChartsPanel` — a TUI 4. panelje.
 *
 * Phase 36 user mandate "richer visuals": az equity görbe, a
 * candlestick, a sparkline, és a stratégia-breakdown BarChart
 * egyszerre jelennek meg a panelen, hogy a user egyetlen
 * pillantással lássa a bot teljesítményét.
 */
export function ChartsPanel({
  history,
  initialEquityUsdt,
  candles,
  strategies,
  focused = false,
}: ChartsPanelProps): ReactElement {
  const borderColor: "magentaBright" | "magenta" = focused
    ? "magentaBright"
    : "magenta";

  const equitySeries = computeEquitySeries(history, initialEquityUsdt);
  const pnlSeries = computePnlSeries(history);
  const equityChart = renderEquityCurve(equitySeries, { height: 6, width: 60 });
  const sparkline = renderSparkline(pnlSeries, { width: 16 });
  const candlestick = renderCandlesticks(candles, { width: 40, height: 8 });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text bold color="magenta">📊  CHARTS (EQUITY / CANDLESTICK / P&amp;L / STRATEGIES)</Text>

      <Box marginTop={0} flexDirection="row" gap={2}>
        {/* Bal oszlop: equity görbe + candlestick */}
        <Box flexDirection="column" width={62}>
          <Text dimColor>EQUITY GÖRBE (utolsó {Math.max(0, equitySeries.length - 1)} trade)</Text>
          <Text>{equityChart}</Text>

          <Box marginTop={1} flexDirection="column">
            <Text dimColor>OHLC CANDLESTICK (utolsó 1h)</Text>
            <Text>{candlestick}</Text>
          </Box>
        </Box>

        {/* Jobb oszlop: sparkline + stratégia-breakdown */}
        <Box flexDirection="column" width={28}>
          <Text dimColor>P&amp;L SPARKLINE (utolsó 16 trade)</Text>
          <Text>{sparkline}</Text>

          <Box marginTop={1} flexDirection="column">
            <Text dimColor>STRATÉGIA-BREAKDOWN (cap%)</Text>
            <StrategyBarChart strategies={strategies} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

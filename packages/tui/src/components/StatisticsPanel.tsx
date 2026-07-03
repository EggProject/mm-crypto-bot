// packages/tui/src/components/StatisticsPanel.tsx — statisztikai panel
//
// A "Statisztika" menüpont tartalma. Megjeleníti a legfontosabb
// mutatókat:
//   - Összesített PnL (USDT + %)
//   - Win rate (nyertes trade-ek aránya)
//   - Max drawdown + jelenlegi drawdown
//   - Trade-szám (összes / nyert / vesztett)
//   - Átlagos nyereség / átlagos veszteség
//   - Profit factor
//   - Sharpe ratio
//   - Equity görbe kezdő / jelenlegi értéke

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import type { Statistics } from "../types.js";
import { colorForValue, formatPct, formatUsdt } from "../utils/format.js";

/**
 `StatisticsPanel` — a statisztikai mutatókat megjelenítő panel.
 Az `statistics` prop a `BotState.statistics` mezőjéből jön.
*/
export function StatisticsPanel({ statistics }: { readonly statistics: Statistics }): ReactElement {
  const totalColor = colorForValue(statistics.totalPnlUsdt);
  const ddColor = statistics.currentDrawdownPct > 10 ? "red" : statistics.currentDrawdownPct > 5 ? "yellow" : "gray";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} flexGrow={1}>
      <Text bold color="green">📊  STATISZTIKA</Text>
      <Box marginTop={0} flexDirection="row">
        <Box flexDirection="column" width={28}>
          <Text dimColor>Összesített PnL:</Text>
          <Text>
            <Text color={totalColor} bold>{formatUsdt(statistics.totalPnlUsdt)} USDT</Text>
            <Text>  </Text>
            <Text color={totalColor}>{formatPct(statistics.totalPnlPct)}</Text>
          </Text>
        </Box>
        <Box flexDirection="column" width={20}>
          <Text dimColor>Win rate:</Text>
          <Text bold>{formatUsdt(statistics.winRate, 1)}%</Text>
        </Box>
        <Box flexDirection="column" width={22}>
          <Text dimColor>Trade-szám:</Text>
          <Text bold>{statistics.totalTrades} db</Text>
        </Box>
      </Box>

      <Box marginTop={0} flexDirection="row">
        <Box flexDirection="column" width={28}>
          <Text dimColor>Max drawdown:</Text>
          <Text color="red" bold>{formatUsdt(statistics.maxDrawdownPct, 2)}%</Text>
        </Box>
        <Box flexDirection="column" width={20}>
          <Text dimColor>Aktuális DD:</Text>
          <Text color={ddColor} bold>{formatUsdt(statistics.currentDrawdownPct, 2)}%</Text>
        </Box>
        <Box flexDirection="column" width={22}>
          <Text dimColor>Profit factor:</Text>
          <Text bold>
            {statistics.profitFactor === Number.POSITIVE_INFINITY
              ? "∞"
              : formatUsdt(statistics.profitFactor, 2)}
          </Text>
        </Box>
      </Box>

      <Box marginTop={0} flexDirection="row">
        <Box flexDirection="column" width={28}>
          <Text dimColor>Átlagos nyereség:</Text>
          <Text color="green">{formatUsdt(statistics.avgWinPnl)} USDT</Text>
        </Box>
        <Box flexDirection="column" width={20}>
          <Text dimColor>Átlagos veszteség:</Text>
          <Text color="red">{formatUsdt(statistics.avgLossPnl)} USDT</Text>
        </Box>
        <Box flexDirection="column" width={22}>
          <Text dimColor>Sharpe ratio:</Text>
          <Text bold>{formatUsdt(statistics.sharpeRatio, 2)}</Text>
        </Box>
      </Box>

      <Box marginTop={0} flexDirection="row">
        <Box flexDirection="column" width={28}>
          <Text dimColor>Equity (jelenlegi):</Text>
          <Text bold>{formatUsdt(statistics.equityUsdt)} USDT</Text>
        </Box>
        <Box flexDirection="column" width={20}>
          <Text dimColor>Kezdő equity:</Text>
          <Text dimColor>{formatUsdt(statistics.initialEquityUsdt)} USDT</Text>
        </Box>
        <Box flexDirection="column" width={22}>
          <Text dimColor>Nyert / Vesztett:</Text>
          <Text>
            <Text color="green">{statistics.winningTrades}</Text>
            <Text> / </Text>
            <Text color="red">{statistics.losingTrades}</Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

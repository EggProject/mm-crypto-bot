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
//
// Phase 36 Track B1 kiegészítés: a panel címe (`📊 STATISZTIKA`)
// `@inkjs/ui` `<StatusMessage variant="info">`-ra cserélve (a Phase 36
// user mandate: "richer visuals"). A metrikus label-ek megtartják az
// eredeti "Összesített PnL:" formátumot (dim szürke szöveg kettősponttal)
// a kompatibilitás kedvéért — a Badge komponens a `@inkjs/ui`-ban
// upper-case-re konvertálja a tartalmát, ami a tesztek által elvárt
// case-törönést okozná.
//
// A számítás NEM itt történik — a provider aggregálja a `Statistics`
// objektumot a `closedTrades` listából.

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import { StatusMessage } from "@inkjs/ui";
import type { Statistics } from "../types.js";
import { colorForValue, formatPct, formatUsdt } from "../utils/format.js";

/**
 `StatisticsPanel` — a statisztikai mutatókat megjelenítő panel.
 Az `statistics` prop a `BotState.statistics` mezőjéből jön, és
 a provider a `closedTrades` listából aggregálja (win-rate,
 Sharpe ratio, max drawdown, profit factor stb.).
*/
export function StatisticsPanel({ statistics, focused = false }: { readonly statistics: Statistics; readonly focused?: boolean }): ReactElement {
  const borderColor: "greenBright" | "green" = focused ? "greenBright" : "green";
  const totalColor = colorForValue(statistics.totalPnlUsdt);
  // A drawdown színe a súlyosságtól függ: < 5% semleges, 5-10% sárga, > 10% piros.
  const ddColor: "red" | "yellow" | "gray" =
    statistics.currentDrawdownPct > 10
      ? "red"
      : statistics.currentDrawdownPct > 5
        ? "yellow"
        : "gray";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} flexGrow={1}>
      {/*
        Phase 36 Track B1: a panel címe `@inkjs/ui` `<StatusMessage>`
        formátumban. A variant "info" = kék szín, ami a statisztikai
        dashboard-ot semleges, de kiemelt kontextusba helyezi.
      */}
      <StatusMessage variant="info">📊  STATISZTIKA</StatusMessage>

      {/* 1. sor: Összesített PnL · Win rate · Trade-szám */}
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

      {/* 2. sor: Max DD · Aktuális DD · Profit factor */}
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

      {/* 3. sor: Átlagos nyereség · Átlagos veszteség · Sharpe ratio */}
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

      {/* 4. sor: Equity · Kezdő equity · Nyert / Vesztett */}
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

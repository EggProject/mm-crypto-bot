/**
 * apps/tui/src/app.tsx
 *
 * Ink-alapú TUI frontend skeleton.
 *
 * TODO implementacio:
 * - Header (statusz, futo/stop allapot)
 * - PositionsPanel (nyitott poziciok)
 * - PnLPanel (napi/heti PnL, win rate, drawdown)
 * - HistoryList (lezart trade-ek, scrollozhato)
 * - Billentyukezeles: s (start/stop), h (history toggle), q (quit)
 *
 * A reszletes struktura es a design dontes a tui-decision.md fajlban
 * dokumentaltak szerint.
 */

import { Box, Text } from "ink";

export function App() {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">mm-crypto-bot TUI — skeleton</Text>
      <Text dimColor>TODO: implementacio a tui-decision.md szerint</Text>
    </Box>
  );
}
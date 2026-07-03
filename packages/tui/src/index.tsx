// packages/tui/src/index.tsx — `@mm/tui` belépési pont
//
// FELADAT: A `@mm/tui` az Ink-alapú (React for CLI) TUI frontend. A
// stack-döntés (Ink 7.1.0 + React 19+) a docs/research/tui-decision.md
// fájlban dokumentált (19/20 vs ratatui 14/20).
//
// A scaffold fázisban csak egy placeholder komponens van itt, ami kiírja
// a bot állapotát a terminálra. A teljes implementáció (Dashboard,
// PositionsPanel, PnLPanel, HistoryList, useBotState hook) a későbbi
// fázisokban készül el — a váz itt csak a build-chain működését
// demonstrálja.

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Box, Text } from "ink";

interface BotState {
  readonly running: boolean;
  readonly positions: number;
  readonly pnlUsdt: number;
}

export function App(): ReactElement {
  const [state] = useState<BotState>({ running: false, positions: 0, pnlUsdt: 0 });
  // A későbbi implementációban a CCXT Pro WS feed subscribe-ját és a
  // lokális state frissítését fogja végezni.
  useEffect(() => {
    /* placeholder — későbbi fázisban: subscribe WS feed → setState */
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">mm-crypto-bot TUI (scaffold)</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Állapot: {state.running ? "futat" : "leállítva"}</Text>
        <Text>Pozíciók: {state.positions}</Text>
        <Text>PnL: {state.pnlUsdt.toFixed(2)} USDT</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>A teljes TUI a későbbi fázisban készül el (lásd docs/research/tui-decision.md).</Text>
      </Box>
    </Box>
  );
}

export default App;

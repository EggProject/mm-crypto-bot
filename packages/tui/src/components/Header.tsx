// packages/tui/src/components/Header.tsx — a TUI fejléce
//
// A fejléc a TUI legfelső sora. Megjeleníti:
//   - A bot módját (TUI-only / with-bot)
//   - A futási állapotot (fut / leállítva)
//   - A kill-switch állapotát
//   - A kapcsolat állapotát (CCXT Pro WS feed)
//   - Az utolsó frissítés időbélyegét
//
// A háttérszín az állapottól függően változik (zöld = fut,
// piros = vészleállítva, sárga = megerősítésre vár).

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import type { BotState } from "../types.js";
import { formatTimestamp } from "../utils/format.js";

/**
 `Header` — a TUI fejléc-komponense.
 A `bot` prop a `BotStateProvider`-ből jön, amit a `useBotState`
 hook-ból kapunk.
*/
export function Header({ state }: { readonly state: BotState }): ReactElement {
  const { status, running, killSwitch } = state;

  // A mód magyar neve.
  const modeLabel = status.mode === "tui-only" ? "TUI-ONLY" : "BOT MÓD";

  // A futás állapota.
  const runningLabel = running ? "FUT" : "LEÁLLÍTVA";
  const runningColor: "green" | "red" = running ? "green" : "red";

  // A kill-switch állapota.
  let killLabel: string;
  let killColor: "gray" | "yellow" | "red";
  if (killSwitch === "armed") {
    killLabel = "KILL-SWITCH: ÉLES";
    killColor = "gray";
  } else if (killSwitch === "confirm") {
    killLabel = "KILL-SWITCH: MEGERŐSÍTÉS";
    killColor = "yellow";
  } else {
    killLabel = "KILL-SWITCH: AKTIVÁLVA";
    killColor = "red";
  }

  // A feed-kapcsolat állapota.
  const connectionLabel = status.connected ? "CSATLAKOZVA" : "NINCS KAPCSOLAT";
  const connectionColor: "green" | "yellow" = status.connected ? "green" : "yellow";

  // Az utolsó frissítés ideje.
  const lastUpdate = status.lastUpdate > 0
    ? `Frissítve: ${formatTimestamp(status.lastUpdate)}`
    : "Még nincs frissítés";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box>
          <Text bold color="cyan">mm-crypto-bot TUI</Text>
          <Text>  ·  </Text>
          <Text bold color="magenta">{modeLabel}</Text>
        </Box>
        <Box>
          <Text color={runningColor} bold>{runningLabel}</Text>
          <Text>  ·  </Text>
          <Text color={connectionColor}>{connectionLabel}</Text>
        </Box>
      </Box>
      <Box flexDirection="row" justifyContent="space-between" marginTop={0}>
        <Text color={killColor}>{killLabel}</Text>
        <Text dimColor>{lastUpdate}</Text>
      </Box>
      {status.engineError !== null && (
        <Box marginTop={0}>
          <Text color="yellow">⚠  Motor hiba: {status.engineError}</Text>
        </Box>
      )}
    </Box>
  );
}

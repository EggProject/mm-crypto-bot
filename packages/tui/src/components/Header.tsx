// packages/tui/src/components/Header.tsx — a TUI fejléce
//
// A fejléc a TUI legfelső sora. Megjeleníti:
//   - A bot módját (TUI-only / with-bot) — explicit badge formátumban
//   - A futási állapotot (fut / leállítva)
//   - A pause állapotát (ha a user pause-ölt)
//   - A kill-switch állapotát
//   - A kapcsolat állapotát (CCXT Pro WS feed)
//   - Az utolsó frissítés időbélyegét
//
// A Phase 34 Track B kiegészítések:
//   - A mód badge formátuma: `[LIVE]` (zöld) / `[TUI-ONLY]` (piros) /
//     `[PAUSED]` (sárga). Ezek explicit, vizuálisan könnyen felismerhető
//     jelzések — a user azonnal látja, milyen módban fut a TUI.
//   - A `paused` flag a `BotState.paused` mezőből jön, és a
//     `[PAUSED]` badge megjelenik, ha aktív.
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
  const { status, running, killSwitch, paused } = state;

  // A mód-badge színe és szövege.
  //   TUI-ONLY: piros, mert nincs valós bot mögötte.
  //   with-bot: zöld, mert a bot aktívan fut (vagy futhat).
  const modeBadge = status.mode === "tui-only" ? "[TUI-ONLY]" : "[LIVE]";
  const modeBadgeColor: "red" | "green" = status.mode === "tui-only" ? "red" : "green";

  // A futás állapota.
  //
  // Phase 36 Track A1: a `state.running === false` ÉS `mode === "with-bot"`
  // állapotban a badge egy AMBER színű `[● STOPPED]` lesz (a Phase 36
  // user mandate: a bot a TUI indulásakor `stopped` állapotban van).
  // A `running === true` állapotban a badge a régi "FUT" / zöld
  // marad. TUI-only módban a badge NEM jelenik meg (ott nincs bot,
  // a "stopped" fogalom nem értelmes).
  //
  // A "LEÁLLÍTVA" / piros label a jobboldali slotban továbbra is
  // megjelenik stopped state-ben, mert az a "bot le van állítva"
  // (graceful stop) és a "bot sosem indult el" (stopped) állapotot
  // is jelöli — a `[● STOPPED]` badge pontosítja, hogy melyikben vagyunk.
  //
  // A `●` karakter (U+25CF) egy kitöltött kör, ami a pitchfork /
  // btop TUI-konvencióját követi: a badge-ek mindig tartalmaznak
  // egy állapot-indikátort a szín mellett (színvak-biztos).
  const stoppedBadge = !running && status.mode === "with-bot" ? "[● STOPPED]" : null;
  const runningLabel = running ? "FUT" : "LEÁLLÍTVA";
  const runningColor: "green" | "red" = running ? "green" : "red";

  // A pause badge — a paused flag határozza meg.
  // Csak akkor jelenik meg, ha paused=true; a badge színe sárga
  // (figyelemfelkeltő, de nem piros — a pause NEM vészhelyzet).
  const pausedBadge = paused ? "[PAUSED]" : null;

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
          <Text bold color={modeBadgeColor}>{modeBadge}</Text>
          {pausedBadge !== null && (
            <>
              <Text>  </Text>
              <Text bold color="yellow">{pausedBadge}</Text>
            </>
          )}
          {stoppedBadge !== null && (
            <>
              <Text>  </Text>
              <Text bold color="yellow">{stoppedBadge}</Text>
            </>
          )}
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

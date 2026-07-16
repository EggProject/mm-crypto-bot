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
// A Phase 36 Track B1 kiegészítés: a hand-rolled `<Text bold color="...">`
// badge-ek lecserélése a `@inkjs/ui` `<Badge>` komponensére. A `<Badge>`
// a `@inkjs/ui` hivatalos, színvak-biztos (mindig tartalmaz egy állapot-
// indikátort) badge implementációja — a Phase 36 research 1.0
// ajánlása. A függőség-váltás nem változtatja meg a megjelenést
// (a `Badge` a `color` prop-ot kapja meg, és a children-t jeleníti meg).
//
// A háttérszín az állapottól függően változik (zöld = fut,
// piros = vészleállítva, sárga = megerősítésre vár).

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import { Badge } from "@inkjs/ui";
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
  //
  // Phase 43 Track 2: ha a `status.engineError` nem null, a badge
  // átvált piros `[● CRASHED]`-re. Ez a user-facing jelzés arra, hogy
  // a bot NEM egyszerűen le van állítva — a bot init/run során
  // elszállt, és a `state.status.engineError` tartalmazza a hiba
  // szövegét (a Header lentebb külön sorban is megjeleníti).
  const crashedBadge =
    !running && status.mode === "with-bot" && status.engineError !== null
      ? "[● CRASHED]"
      : null;
  const stoppedBadge =
    !running && status.mode === "with-bot" && status.engineError === null
      ? "[● STOPPED]"
      : null;
  const runningLabel = running ? "FUT" : "LEÁLLÍTVA";
  const runningColor: "green" | "red" = running ? "green" : "red";

  // A pause badge — a paused flag határozza meg.
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
          {/*
            Phase 36 Track B1: a badge-ek a `@inkjs/ui` `<Badge>`-re
            cserélve. A `<Badge color="...">label</Badge>` forma
            megőrzi a korábbi szín-szemantikát (zöld = LIVE, piros
            = TUI-ONLY, sárga = STOPPED / PAUSED).
          */}
          <Badge color={modeBadgeColor}>{modeBadge}</Badge>
          {pausedBadge !== null && (
            <>
              <Text>  </Text>
              <Badge color="yellow">{pausedBadge}</Badge>
            </>
          )}
          {stoppedBadge !== null && (
            <>
              <Text>  </Text>
              <Badge color="yellow">{stoppedBadge}</Badge>
            </>
          )}
          {crashedBadge !== null && (
            <>
              <Text>  </Text>
              <Badge color="red">{crashedBadge}</Badge>
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
          <Text color="red">⚠  Motor hiba: {status.engineError}</Text>
        </Box>
      )}
    </Box>
  );
}

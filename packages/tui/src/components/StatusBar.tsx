// packages/tui/src/components/StatusBar.tsx — billentyűzet-súgó és státuszsor
//
// A TUI legalján megjelenő sor. Megmutatja az elérhető billentyű-
// kombinációkat és a bot aktuális státuszát (fut / leállítva).
// A `killSwitch` állapottól függően a billentyűk más kontextusban
// működnek (pl. megerősítő promptban az `i` = igen, `n` = nem).

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import type { KillSwitchState } from "../types.js";

/**
 `StatusBar` — a billentyűzet-súgó és a státuszsor.
 A `killSwitch` prop határozza meg, hogy a normál vagy a
 megerősítő üzemmód billentyűi jelennek-e meg.
*/
export function StatusBar({ killSwitch }: { readonly killSwitch: KillSwitchState }): ReactElement {
  if (killSwitch === "confirm") {
    return (
      <Box borderStyle="round" borderColor="red" paddingX={1} justifyContent="space-between">
        <Text color="red" bold>⚠  VÉSZLEÁLLÍTÁS — Biztosan leállítod az összes nyitott pozíciót?</Text>
        <Text>
          <Text color="green" bold>[i] igen</Text>
          <Text>  ·  </Text>
          <Text color="red" bold>[n] nem</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Box>
        <Text dimColor>[</Text>
        <Text color="green" bold>s</Text>
        <Text dimColor>] start/stop</Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>[</Text>
        <Text color="red" bold>k</Text>
        <Text dimColor>] kill-switch</Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>[</Text>
        <Text color="cyan" bold>r</Text>
        <Text dimColor>] frissítés</Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>[</Text>
        <Text color="yellow" bold>q</Text>
        <Text dimColor>] kilépés</Text>
      </Box>
      <Text dimColor>mm-crypto-bot · v0.1.0</Text>
    </Box>
  );
}

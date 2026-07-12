// packages/tui/src/components/HelpOverlay.tsx — billentyűzet-súgó overlay
//
// A `?` billentyű megnyomására megjelenő modal overlay. Kilistázza
// az összes elérhető billentyű-kombinációt és azok hatását.
//
// Phase 34 Track B: a spec kéri, hogy `?` → keybinding help overlay.
// A panel a `visible` prop alapján jelenik meg (true esetén a teljes
// képernyőt elfoglalja, false esetén null-t ad vissza).

import type { ReactElement } from "react";
import { Box, Text } from "ink";

/**
 A `HelpOverlay` props-a.
 `tuiOnly`: ha true, a `s` (stop) és `p` (pause) billentyűk
            nem elérhetők (nincs bot a TUI-only módban).
*/
export interface HelpOverlayProps {
  readonly visible: boolean;
  readonly tuiOnly: boolean;
}

/**
 `HelpOverlay` — a `?` billentyűvel megnyíló súgó-overlay.
 A `visible=false` esetén nem renderel semmit.
*/
export function HelpOverlay({ visible, tuiOnly }: HelpOverlayProps): ReactElement | null {
  if (!visible) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="cyan">⌨  mm-crypto-bot TUI — BILLENTYŰZET-SÚGÓ</Text>
      <Box marginTop={1} flexDirection="column">
        <Text><Text color="green" bold>[q]</Text> <Text dimColor>·</Text> Kilépés a TUI-ból (graceful teardown)</Text>
        <Text><Text color="green" bold>[Ctrl+C]</Text> <Text dimColor>·</Text> Ugyanaz, mint a [q]</Text>
        <Text><Text color="green" bold>[s]</Text> <Text dimColor>·</Text> {tuiOnly ? "— (nem elérhető TUI-only módban)" : "Bot indítása / leállítása"}</Text>
        <Text><Text color="green" bold>[p]</Text> <Text dimColor>·</Text> {tuiOnly ? "— (nem elérhető TUI-only módban)" : "Pause / resume (nincs új pozíció)"}</Text>
        <Text><Text color="green" bold>[k]</Text> <Text dimColor>·</Text> Kill-switch (megerősítő prompt: [i] igen, [n] nem)</Text>
        <Text><Text color="green" bold>[r]</Text> <Text dimColor>·</Text> Manuális frissítés / re-snapshot kérése</Text>
        <Text><Text color="green" bold>[t]</Text> <Text dimColor>·</Text> History rendezési kulcs váltása (idő / PNL / symbol)</Text>
        <Text><Text color="green" bold>[Tab] / [←→]</Text> <Text dimColor>·</Text> Panel fókusz váltása (statisztika / live / history)</Text>
        <Text><Text color="green" bold>[?]</Text> <Text dimColor>·</Text> Ezen help overlay megjelenítése / elrejtése</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Nyomj [?] vagy [Esc] a súgó bezárásához.</Text>
      </Box>
    </Box>
  );
}

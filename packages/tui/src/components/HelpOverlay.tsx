// packages/tui/src/components/HelpOverlay.tsx — billentyűzet-súgó overlay
//
// A `?` billentyű megnyomására megjelenő modal overlay. Kilistázza
// az összes elérhető billentyű-kombinációt és azok hatását.
//
// Phase 34 Track B: a spec kéri, hogy `?` → keybinding help overlay.
// A panel a `visible` prop alapján jelenik meg (true esetén a teljes
// képernyőt elfoglalja, false esetén null-t ad vissza).
//
// Phase 41: a súgó kibővül az új keybinde­kkel (`[o]` settings),
// a grid layout móddal (`LayoutMode`), és a fontosabb empty-state
// üzenetekre vonatkozó tippekkel (hogy a user tudja, mit kell tennie
// egy üres panel láttán).

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import type { LayoutMode } from "../hooks/useTerminalSize.js";

/**
 A `HelpOverlay` props-a.
 `tuiOnly`: ha true, a `s` (stop) és `p` (pause) billentyűk
            nem elérhetők (nincs bot a TUI-only módban).
 `layoutMode` (Phase 41): az aktuális grid elrendezés — a
            súgó kiírja, hogy a user lássa, éppen milyen
            elrendezésben dolgozik a TUI.
 `settingsAvailable` (Phase 41): ha true, a `[o]` settings
            billentyű elérhető — a súgó kiírja.
*/
export interface HelpOverlayProps {
  readonly visible: boolean;
  readonly tuiOnly: boolean;
  readonly layoutMode?: LayoutMode;
  readonly settingsAvailable?: boolean;
}

/**
 * `layoutModeLabel` — a `LayoutMode` magyar nyelvű címkéje a
 * súgó számára. A user így látja, hogy a TUI éppen milyen
 * elrendezésben dolgozik.
 */
function layoutModeLabel(mode: LayoutMode): string {
  if (mode === "2x2") return "2×2 GRID (széles, ≥120 col)";
  if (mode === "2x1") return "2×1 GRID (közepes, 80-119 col)";
  return "1×4 STACKED (keskeny, <80 col)";
}

/**
 `HelpOverlay` — a `?` billentyűvel megnyíló súgó-overlay.
 A `visible=false` esetén nem renderel semmit.
*/
export function HelpOverlay({
  visible,
  tuiOnly,
  layoutMode,
  settingsAvailable = false,
}: HelpOverlayProps): ReactElement | null {
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
        <Text><Text color="green" bold>[Tab] / [←→]</Text> <Text dimColor>·</Text> Panel fókusz váltása (statisztika / live / history / charts)</Text>
        {/*
          Phase 41: a `[c]` shortcut explicit kiemelése (korábban a
          Tab-ciklus kiegészítője volt, de a súgóban nem volt
          dokumentálva). A Charts panelre ugrik közvetlenül.
        */}
        <Text><Text color="green" bold>[c]</Text> <Text dimColor>·</Text> Ugrás a Charts panelre (4. panel)</Text>
        {/*
          Phase 41: a `[o]` settings billentyű CSAK akkor jelenik meg,
          ha a consumer átadta a settings prop-okat. A TUI-only módban
          a settings panel nem elérhető (nincs config-fájl, amit
          szerkeszteni lehetne — a TUI-only üzemmód csak szimuláció).
        */}
        {settingsAvailable && (
          <Text><Text color="green" bold>[o]</Text> <Text dimColor>·</Text> Settings panel megnyitása (config TOML szerkesztése)</Text>
        )}
        <Text><Text color="green" bold>[?]</Text> <Text dimColor>·</Text> Ezen help overlay megjelenítése / elrejtése</Text>
        <Text><Text color="green" bold>[Esc]</Text> <Text dimColor>·</Text> Help overlay / settings panel bezárása</Text>
      </Box>
      {/*
        Phase 41: a layout módról szóló információ — a user lássa,
        hogy a TUI milyen grid elrendezést használ épp, és hogy
        a terminál szélessége alapján automatikusan vált.
      */}
      {layoutMode !== undefined && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>── LAYOUT (Phase 41) ──</Text>
          <Text>
            <Text dimColor>Aktuális elrendezés: </Text>
            <Text bold color="cyan">{layoutModeLabel(layoutMode)}</Text>
          </Text>
          <Text dimColor>
            A grid automatikusan vált a terminál szélessége alapján:
            2×2 ≥120 col, 2×1 80-119 col, 1×4 &lt;80 col.
          </Text>
        </Box>
      )}
      {/*
        Phase 41: a fontosabb empty-state tippek — a user tudja,
        hogy egy üres panel láttán mit kell tennie.
      */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>── EMPTY STATE TIPPEK ──</Text>
        <Text dimColor>• Charts üres → indítsd el a botot a [s] billentyűvel</Text>
        <Text dimColor>• History üres → a pozíciók zárásakor fog feltöltődni</Text>
        <Text dimColor>• Live Trading üres → a feed indulásáig várj, vagy [s] a bot indításához</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Nyomj [?] vagy [Esc] a súgó bezárásához.</Text>
      </Box>
    </Box>
  );
}

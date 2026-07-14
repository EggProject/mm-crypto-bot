// packages/tui/src/components/StatusBar.tsx — billentyűzet-súgó és státuszsor
//
// A TUI legalján megjelenő sor. Megmutatja az elérhető billentyű-
// kombinációkat és a bot aktuális státuszát (fut / leállítva).
// A `killSwitch` állapottól függően a billentyűk más kontextusban
// működnek (pl. megerősítő promptban az `i` = igen, `n` = nem).
//
// Phase 34 Track B: kibővítettük a billentyű-listát — `p` (pause),
// `Tab` (panel-fókusz), `?` (help overlay), `t` (history rendezés).
// A `tuiOnly` flag határozza meg, hogy a `s` / `p` billentyűk
// elérhetők-e (TUI-only módban nem — nincs mit vezérelni).

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import type { KillSwitchState } from "../types.js";

/**
 `StatusBar` — a billentyűzet-súgó és a státuszsor.
 A `killSwitch` prop határozza meg, hogy a normál vagy a
 megerősítő üzemmód billentyűi jelennek-e meg.
 A `tuiOnly` flag (default false) a TUI-only módot jelzi —
 ilyenkor a `s` / `p` nem jelennek meg (nincs bot).
 A `running` flag (Phase 36 Track A1) a bot aktuális állapotát jelzi —
 stopped állapotban a `[s]` indító-billentyű kiemelten jelenik meg.
*/
export function StatusBar({
  killSwitch,
  tuiOnly = false,
  running = true,
}: {
  readonly killSwitch: KillSwitchState;
  readonly tuiOnly?: boolean;
  readonly running?: boolean;
}): ReactElement {
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
        {!tuiOnly && (
          <>
            <Text dimColor>[</Text>
            <Text color="green" bold>s</Text>
            {/*
              Phase 36 Track A1: amikor a bot `stopped` (a user a TUI-t
              `mm-bot start` indította `--no-auto-start` móddal vagy a
              default `bot.auto_start = false` configgal), a footer
              kiemeli a `[s]` indító-billentyűt: `[s] ▶ Start` (zöld
              + bold + ▶ nyíl). Amikor a bot fut, a régi "start/stop"
              felirat marad, mert a `[s]` most stop-ként funkcionál.
              Az App.tsx `useInput` kezelője már megfelelően toggle-eli
              a `provider.start()` / `provider.stop()` hívásokat.
            */}
            {running ? (
              <Text dimColor>] start/stop</Text>
            ) : (
              <Text color="green" bold>] ▶ Start</Text>
            )}
            <Text dimColor>  ·  </Text>
            <Text dimColor>[</Text>
            <Text color="yellow" bold>p</Text>
            <Text dimColor>] pause</Text>
            <Text dimColor>  ·  </Text>
            <Text dimColor>[</Text>
            <Text color="red" bold>k</Text>
            <Text dimColor>] kill</Text>
            <Text dimColor>  ·  </Text>
          </>
        )}
        <Text dimColor>[</Text>
        <Text color="cyan" bold>Tab</Text>
        <Text dimColor>] panel</Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>[</Text>
        <Text color="cyan" bold>t</Text>
        <Text dimColor>] rendezés</Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>[</Text>
        <Text color="cyan" bold>r</Text>
        <Text dimColor>] frissít</Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>[</Text>
        <Text color="cyan" bold>?</Text>
        <Text dimColor>] help</Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>[</Text>
        <Text color="yellow" bold>q</Text>
        <Text dimColor>] kilép</Text>
      </Box>
      <Text dimColor>mm-crypto-bot · v0.1.0</Text>
    </Box>
  );
}

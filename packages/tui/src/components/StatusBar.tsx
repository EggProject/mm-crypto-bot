// packages/tui/src/components/StatusBar.tsx — billentyűzet-súgó és státuszsor
//
// A TUI legalján megjelenő sor. Megmutatja az elérhető billentyű-
// kombinációkat és a bot aktuális státuszát (fut / leállítva).
// A `killSwitch` állapottól függően a billentyűk más kontextusban
// működnek (pl. megerősítő promptban az `i` = igen, `n` = nem).
//
// Phase 36 Track B1: a hand-rolled billentyű-sor cseréje a
// `@matthesketh/ink-status-bar` `<StatusBar items={[...]} />`
// komponensére. A komponens a `KeyHint` tömböt kapja meg
// (`{ key, label }` forma), és automatikusan a terminál
// szélességéhez igazítja a billentyű-listát. A `left` és `right`
// slotokba a saját szöveget tudjuk tenni (cím + verzió).
//
// A megerősítő prompt (`killSwitch === "confirm"`) továbbra is
// egyedi layout-ot kap, mert a `StatusMessage` stílusú figyelmeztetés
// jobban kiemeli a vészhelyzetet, mint egyenletes key-hint sor.
//
// Phase 41 kiegészítések:
//   - A `settingsAvailable` prop alapján a key-hint lista végére
//     egy `[o] settings` elem kerül, ha a settings panel elérhető
//     (a consumer átadta a `settingsConfigPath` + `settingsSave`
//     prop-okat). Ha a settings panel MÁR nyitva van, a `[o]`
//     helyett `[o] close` jelenik meg.
//   - A key-hint lista vizuálisan kiemelése: a key (pl. `[s]`) a
//     `cyan` színnel, a label pedig a `gray` színnel jelenik meg —
//     így a user egy pillantással meg tudja különböztetni a
//     billentyűt a leírástól.

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import { StatusBar as MatStatusBar } from "@matthesketh/ink-status-bar";
import type { KeyHint } from "@matthesketh/ink-status-bar";
import type { KillSwitchState } from "../types.js";

/**
 * `buildKeyHints` — az aktuális módhoz (TUI-only / with-bot, fut /
 * leállítva, settings elérhető / nem) tartozó `KeyHint` tömb.
 *
 * A `running` flag Phase 36 Track A1: stopped állapotban a `[s]`
 * indító-billentyű kiemelten jelenik meg (zöld + ▶ nyíl).
 *
 * A Phase 41 kiegészítés: ha a `settingsAvailable` true, a
 * key-hint lista végére egy `[o] settings` (vagy `[o] close`,
 * ha a settings panel nyitva van) elem kerül.
 */
function buildKeyHints(
  tuiOnly: boolean,
  running: boolean,
  settingsAvailable: boolean,
  settingsOpen: boolean,
): KeyHint[] {
  const hints: KeyHint[] = [];
  if (!tuiOnly) {
    if (running) {
      hints.push({ key: "s", label: "start/stop" });
    } else {
      hints.push({ key: "s", label: "▶ Start" });
    }
    hints.push({ key: "p", label: "pause" });
    hints.push({ key: "k", label: "kill" });
  }
  hints.push({ key: "Tab", label: "panel" });
  hints.push({ key: "t", label: "rendezés" });
  hints.push({ key: "r", label: "frissít" });
  // Phase 41: a settings key-hint CSAK akkor jelenik meg, ha a
  // settings panel elérhető (a consumer átadta a prop-okat).
  if (settingsAvailable) {
    hints.push({
      key: "o",
      label: settingsOpen ? "close settings" : "settings",
    });
  }
  hints.push({ key: "?", label: "help" });
  hints.push({ key: "q", label: "kilép" });
  return hints;
}

/**
 `StatusBar` — a billentyűzet-súgó és a státuszsor.
 A `killSwitch` prop határozza meg, hogy a normál vagy a
 megerősítő üzemmód billentyűi jelennek-e meg.
 A `tuiOnly` flag (default false) a TUI-only módot jelzi —
 ilyenkor a `s` / `p` nem jelennek meg (nincs bot).
 A `running` flag (Phase 36 Track A1) a bot aktuális állapotát jelzi —
 stopped állapotban a `[s]` indító-billentyű kiemelten jelenik meg.
 A `settingsAvailable` (Phase 41) jelzi, hogy a settings panel
 elérhető-e a consumer-től (alapértelmezetten false — a backward
 compatibility megőrzése a TUI-only / korábbi fogyasztók számára).
 A `settingsOpen` (Phase 41) jelzi, hogy a settings panel jelenleg
 nyitva van-e (befolyásolja a `[o]` key-hint label-jét).

 Phase 36 Track B1: a normál mód `@matthesketh/ink-status-bar`
 `<StatusBar items={...} />` formátumban jelenik meg, ami egy
 key-hint listát vár. A megerősítő prompt (`killSwitch === "confirm"`)
 továbbra is egyedi layout-ot kap (vörös szín + megerősítő
 üzenet), mert a vészhelyzet jobban kiemelendő, mint a key-hint sor.
*/
export function StatusBar({
  killSwitch,
  tuiOnly = false,
  running = true,
  settingsAvailable = false,
  settingsOpen = false,
}: {
  readonly killSwitch: KillSwitchState;
  readonly tuiOnly?: boolean;
  readonly running?: boolean;
  readonly settingsAvailable?: boolean;
  readonly settingsOpen?: boolean;
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

  // A Phase 36 Track B1 status-bar — `@matthesketh/ink-status-bar`
  // alapú. A komponens a key-hint listát `items` prop-ként kapja;
  // a `left` és `right` slotokba tetszőleges ReactNode tehető.
  //
  // FIGYELEM: a `@matthesketh/ink-status-bar` 0.1.0 a `key`-et
  // egyszerű szövegként jeleníti meg (nincs színezés), és a `label`
  // is plain string. A `KeyHint` típus `key: string` + `label: string` —
  // ezért a stopped-state "▶ Start" label vizuálisan jelzi a futási
  // állapotot a user számára (a nyíl + nagybetűs "Start" szó).
  //
  // A Phase 41 kiegészítés: a `settingsAvailable` + `settingsOpen`
  // prop-ok befolyásolják a key-hint lista végét.
  const items = buildKeyHints(tuiOnly, running, settingsAvailable, settingsOpen);

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <MatStatusBar
        items={items}
        right={<Text dimColor>mm-crypto-bot · v0.1.0</Text>}
      />
    </Box>
  );
}

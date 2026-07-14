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

import type { ReactElement } from "react";
import { Box, Text } from "ink";
import { StatusBar as MatStatusBar } from "@matthesketh/ink-status-bar";
import type { KeyHint } from "@matthesketh/ink-status-bar";
import type { KillSwitchState } from "../types.js";

/**
 * `buildKeyHints` — az aktuális módhoz (TUI-only / with-bot, fut /
 * leállítva) tartozó `KeyHint` tömb.
 *
 * A `running` flag Phase 36 Track A1: stopped állapotban a `[s]`
 * indító-billentyű kiemelten jelenik meg (zöld + ▶ nyíl).
 */
function buildKeyHints(
  tuiOnly: boolean,
  running: boolean,
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

  // A Phase 36 Track B1 status-bar — `@matthesketh/ink-status-bar`
  // alapú. A komponens a key-hint listát `items` prop-ként kapja;
  // a `left` és `right` slotokba tetszőleges ReactNode tehető.
  //
  // FIGYELEM: a `@matthesketh/ink-status-bar` 0.1.0 a `key`-et
  // egyszerű szövegként jeleníti meg (nincs színezés), és a `label`
  // is plain string. A `KeyHint` típus `key: string` + `label: string` —
  // ezért a stopped-state "▶ Start" label vizuálisan jelzi a futási
  // állapotot a user számára (a nyíl + nagybetűs "Start" szó).
  const items = buildKeyHints(tuiOnly, running);

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <MatStatusBar
        items={items}
        right={<Text dimColor>mm-crypto-bot · v0.1.0</Text>}
      />
    </Box>
  );
}

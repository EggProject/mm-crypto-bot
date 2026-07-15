/**
 * packages/tui/src/components/LiveConfirm.tsx
 *
 * Phase 36 Track C2 — a `<LiveConfirm>` modal.
 *
 * ===========================================================================
 * MI EZ?
 * ===========================================================================
 * A user a settings panel `bot.mode` mezőjét "paper"-ről "live"-ra
 * állítja. Ez egy IRREVERZIBILIS MŰVELET — a "live" módban a bot
 * VALÓDI pénzzel kereskedik. A standard `y/N` megerősítés NEM
 * elég (véletlen Enter is megnyomható). A kubectl `delete --all`
 * RFC-jéhez hasonlóan (lásd phase36-research-findings.md §3), a
 * megerősítés: a user begépeli a "LIVE" string-et (case-sensitive,
 * 4 karakter, uppercase).
 *
 * A modál:
 *   1. Figyelmeztető üzenetet mutat ("REAL ORDERS / REAL MONEY").
 *   2. A user egy `<TextInput>`-ba írja a megerősítő stringet.
 *   3. A submit (Enter) CSAK akkor hívja az `onConfirm`-t, ha a
 *      string === "LIVE".
 *   4. Az Esc (vagy bármely más input) az `onCancel`-t hívja.
 *
 * ===========================================================================
 * USAGE
 * ===========================================================================
 *
 *   const [showLiveConfirm, setShowLiveConfirm] = useState(false);
 *   if (showLiveConfirm) {
 *     return <LiveConfirm
 *       onConfirm={async () => {
 *         await configStore.writeAfterTypedLive(next, "LIVE", "paper");
 *         setShowLiveConfirm(false);
 *       }}
 *       onCancel={() => setShowLiveConfirm(false)}
 *     />;
 *   }
 *
 * ===========================================================================
 */

import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "@inkjs/ui";

// ============================================================================
// Constants
// ============================================================================

/**
 * `LIVE_CONFIRM_TEXT` — a case-sensitive megerősítő string.
 *
 * A usernek PONTOSAN ezt a stringet kell begépelnie (4 karakter,
 * uppercase). Bármilyen eltérés (lowercase, extra space, typo) → az
 * Enter-re az `onConfirm` NEM hívódik meg.
 */
export const LIVE_CONFIRM_TEXT = "LIVE";

// ============================================================================
// Types
// ============================================================================

/**
 * `LiveConfirmProps` — a `LiveConfirm` modal propjai.
 */
export interface LiveConfirmProps {
  /**
   * `onConfirm` — hívódik, ha a user begépelte a `LIVE_CONFIRM_TEXT`-et
   * ÉS megnyomta az Entert. A callback-ben a consumer a tényleges
   * `ConfigStore.writeAfterTypedLive`-ot hívja.
   */
  readonly onConfirm: () => void | Promise<void>;
  /**
   * `onCancel` — hívódik az Esc-re vagy a submit nélküli Enter-re
   * (vagy ha a user a confirm szövegen kívül mást ír be).
   */
  readonly onCancel: () => void;
  /**
   * `pending` — opcionális flag: ha true, a submit gomb "..."-ot
   * mutat (az onConfirm még nem fejeződött be). A consumer a save
   * során ideiglenesen true-ra állíthatja.
   */
  readonly pending?: boolean;
}

// ============================================================================
// Main component
// ============================================================================

/**
 * `LiveConfirm` — a "type LIVE to confirm" modal.
 *
 * A modál `<TextInput>`-ot használ a user input elfogadására.
 * A belső `useInput` hook csak a Cancel (`Esc`) billentyűt kezeli —
 * a TextInput a maga Enter handlerjén keresztül adja vissza az
 * input értékét az `onSubmit`-ban.
 */
export function LiveConfirm({
  onConfirm,
  onCancel,
  pending = false,
}: LiveConfirmProps): ReactElement {
  // A TextInput default értéke üres — a user a nulláról indul.
  const [value, setValue] = useState<string>("");

  useInput((_input, key) => {
    // Az Esc a cancel — a TextInput nem fogja meg (a TextInput
    // saját useInput hook-ja az Esc-re nem reagál, de a mi külső
    // hook-unk igen).
    if (key.escape) {
      onCancel();
      return;
    }
  });

  /**
   * `handleSubmit` — a TextInput Enter handlerje. CSAK akkor hívja
   * az `onConfirm`-ot, ha a begépelt string PONTOSAN `LIVE`.
   */
  const handleSubmit = (submitted: string): void => {
    if (submitted === LIVE_CONFIRM_TEXT) {
      void onConfirm();
    } else {
      // A user nem a helyes stringet írta be — cancel.
      onCancel();
    }
  };

  // A submit gomb státusza:
  //   - "✓ Submit" — a user begépelte a "LIVE"-ot
  //   - "  Submit" — a user még nem írta be (vagy rosszat írt)
  //   - "..." — a save folyamatban van (pending)
  const submitLabel = pending
    ? "..."
    : value === LIVE_CONFIRM_TEXT
      ? "▶ Submit"
      : "  Submit";

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="red"
      paddingX={2}
      paddingY={1}
    >
      {/* Header — figyelmeztetés */}
      <Box>
        <Text color="red" bold>
          ⚠ LIVE MODE
        </Text>
      </Box>

      {/* Body — mi fog történni */}
      <Box marginTop={1} flexDirection="column">
        <Text>
          Switching to <Text color="red" bold>LIVE</Text> will place{" "}
          <Text color="red" bold>REAL ORDERS</Text> with{" "}
          <Text color="red" bold>REAL MONEY</Text>.
        </Text>
        <Box marginTop={1}>
          <Text>This action is logged to: </Text>
          <Text color="cyan">logs/bot/bot-audit.log</Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Type <Text color="red" bold>{LIVE_CONFIRM_TEXT}</Text> (uppercase) below
            to confirm.
          </Text>
        </Box>
      </Box>

      {/* Input — a user itt gépel */}
      <Box marginTop={1} flexDirection="row">
        <Text color="yellow">▌ </Text>
        <TextInput
          defaultValue=""
          placeholder="Type LIVE to confirm..."
          onChange={(v: string) => {
            setValue(v);
          }}
          onSubmit={handleSubmit}
        />
      </Box>

      {/* Footer — gombok */}
      <Box marginTop={1} flexDirection="row" justifyContent="space-between">
        <Text dimColor>[Esc Cancel]</Text>
        <Text color={value === LIVE_CONFIRM_TEXT ? "green" : "gray"}>
          [{submitLabel}]
        </Text>
      </Box>
    </Box>
  );
}

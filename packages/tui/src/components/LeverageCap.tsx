/**
 * packages/tui/src/components/LeverageCap.tsx
 *
 * Phase 36 Track C2 — a 1:10 leverage hard-cap UI enforcement.
 *
 * ===========================================================================
 * MI EZ?
 * ===========================================================================
 * A projekt mandate: a `risk.max_leverage` és a per-strategy `leverage`
 * mezők értéke SOHA nem haladhatja meg a 10-et. A Zod séma a write
 * előtt elutasítja a 10-nél nagyobb értéket (`z.number().max(10)`),
 * de a UI-ban is alkalmazzuk a guard-ot — a user ne tudjon 10-nél
 * nagyobb számot bevinni a TextInput-ba.
 *
 * A `<LeverageCap>` egy `TextInput` wrapper, ami:
 *   1. A `value` prop-ot ellenőrzi a `max` (alapértelmezetten 10)
 *      küszöb ellen.
 *   2. Ha a user 10-nél nagyobb értéket próbál beírni, a wrapper
 *      NEM hívja a `setValue`-t — az input szintjén a `defaultValue`
 *      marad.
 *   3. Inline warning-ot mutat: "HARD-CAPPED at 10".
 *
 * A komponens a SettingsPanel `max_leverage` mezője köré van csomagolva.
 *
 * ===========================================================================
 */

import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text } from "ink";
import { TextInput } from "@inkjs/ui";

// ============================================================================
// Constants
// ============================================================================

/**
 * `MAX_LEVERAGE` — a Phase 14B user mandate. A Zod séma a write
 * előtt ezt alkalmazza, a UI pedig a user input szintjén.
 */
export const MAX_LEVERAGE = 10;

// ============================================================================
// Types
// ============================================================================

/**
 * `LeverageCapProps` — a `LeverageCap` komponens propjai.
 */
export interface LeverageCapProps {
  /**
   * `value` — a jelenlegi érték (a `risk.max_leverage` a settings
   * panel-ből).
   */
  readonly value: number;
  /**
   * `onChange` — hívódik, ha a user érvényes (1..max) értéket ír be.
   * A `number` az új érték.
   */
  readonly onChange: (value: number) => void;
  /**
   * `max` — opcionális küszöb (alapértelmezetten `MAX_LEVERAGE` = 10).
   * A per-strategy override-oknál ugyanazt a küszöböt használjuk.
   */
  readonly max?: number;
  /**
   * `disabled` — ha true, a TextInput read-only (a user nem írhat be).
   */
  readonly disabled?: boolean;
}

// ============================================================================
// Main component
// ============================================================================

/**
 * `LeverageCap` — a TextInput wrapper, ami a 1:10 leverage MANDATE-et
 * alkalmazza user-input szinten.
 *
 * A wrapper a `defaultValue`-t használja (a kontrollált `value` helyett),
 * mert a `defaultValue` csak a mount-kor érvényes — ha a user 10-nél
 * nagyobb értéket ír be, a `defaultValue` nem frissül, így a TextInput
 * mindig az érvényes értéket mutatja.
 */
export function LeverageCap({
  value,
  onChange,
  max = MAX_LEVERAGE,
  disabled = false,
}: LeverageCapProps): ReactElement {
  // Az "érvénytelen input" figyelmeztetés flagje — true, ha a user
  // 10-nél nagyobb vagy 1-nél kisebb értéket próbált beírni.
  const [warning, setWarning] = useState<boolean>(false);

  /**
   * `handleChange` — a TextInput onChange callback-je. CSAK akkor
   * hívja az `onChange`-t (a consumer-t), ha a begépelt érték
   * érvényes (1..max).
   */
  const handleChange = (v: string): void => {
    const num = Number.parseInt(v, 10);
    if (Number.isFinite(num) && num >= 1 && num <= max) {
      onChange(num);
      setWarning(false);
    } else {
      // Érvénytelen input — a figyelmeztetés megjelenik, a consumer
      // `onChange` NEM hívódik.
      setWarning(true);
    }
  };

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <TextInput
          defaultValue={String(value)}
          placeholder="1..10"
          isDisabled={disabled}
          onChange={handleChange}
        />
        <Text color="red">  (HARD-CAPPED at {String(max)})</Text>
      </Box>
      {/* Inline warning — ha a user 10-nél nagyobb vagy 1-nél kisebb
          értéket próbált beírni. */}
      {warning && (
        <Box marginTop={0} marginLeft={2}>
          <Text color="red" bold>
            ⚠ value out of range [1..{String(max)}] — not applied
          </Text>
        </Box>
      )}
    </Box>
  );
}

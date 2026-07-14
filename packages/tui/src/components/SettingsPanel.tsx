/**
 * packages/tui/src/components/SettingsPanel.tsx
 *
 * Phase 36 Track C1 — a TUI settings panel.
 *
 * ===========================================================================
 * MI EZ?
 * ===========================================================================
 * A `SettingsPanel` egy btop-style multi-section panel, ami a
 * `mm-bot.toml` konfigot mutatja és szerkeszthetővé teszi a TUI-ból.
 * A user a fő dashboard `[o]` billentyűvel nyitja meg.
 *
 * A panel 4 szekcióban mutatja a konfigot (ugyanaz a 4 szekció, mint
 * a `BotConfigSchema`-ban: Bot / Exchange / Risk / Strategies + a
 * Symbols + Telemetry szekciók READ-ONLY módban).
 *
 * A panel a `@inkjs/ui` form komponenseket használja a szerkesztéshez:
 *   - `<TextInput>` — szöveges / numerikus mezők (risk_per_trade, max_leverage, stb.)
 *   - `<Select>` — `bot.mode` (paper / live) választó
 *   - `<MultiSelect>` — `symbols.enabled` többszörös kiválasztás
 *   - `<ConfirmInput>` — `exchange.sandbox` boolean
 *
 * A panel a `useConfigStore` hookkal kezeli a TOML persistence-t:
 *   - mount → read from disk
 *   - setData → in-memory edit
 *   - save → consumer callback (Zod-validate + atomic write + audit log)
 *   - abandon → in-memory discard
 *
 * ===========================================================================
 * USAGE
 * ===========================================================================
 *
 *   const cfg = useConfigStore({ configPath: "./mm-bot.toml", save });
 *   if (settingsVisible) {
 *     return <SettingsPanel
 *       data={cfg.data}
 *       dirty={cfg.dirty}
 *       errors={cfg.errors}
 *       saving={cfg.saving}
 *       setData={cfg.setData}
 *       onSave={cfg.save}
 *       onAbandon={cfg.abandon}
 *     />;
 *   }
 *
 * ===========================================================================
 */

import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useInput } from "ink";
import { MultiSelect, Select, TextInput } from "@inkjs/ui";

import type { ConfigStoreError, UseConfigStoreResult } from "../hooks/useConfigStore.js";

// ============================================================================
// Types
// ============================================================================

/**
 * `SettingsSection` — a settings panelen belüli szekció-azonosító.
 * A 4 fő szekció (Bot / Exchange / Risk / Strategies) a szerkeszthető,
 * a Symbols + Telemetry read-only.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type SettingsSection =
  | "strategies"
  | "risk"
  | "bot"
  | "exchange"
  | "symbols"
  | "telemetry";

/**
 * `SettingsPanelProps` — a `SettingsPanel` komponens propjai.
 */
export interface SettingsPanelProps {
  readonly data: Readonly<Record<string, unknown>>;
  readonly dirty: boolean;
  readonly errors: readonly ConfigStoreError[];
  readonly saving: boolean;
  readonly setData: (next: Record<string, unknown>) => void;
  readonly onSave: () => Promise<boolean>;
  readonly onAbandon: () => void;
  /**
   * Opcionális callback a Track C2 nyers TOML viewer-hez.
   * A panel a `[v]` billentyűre hívja (ha definiálva van).
   */
  readonly onViewRawToml?: () => void;
}

// ============================================================================
// Section sub-components
// ============================================================================

/**
 * `RiskSection` — a `[risk]` szekció szerkesztő UI-ja.
 *
 * A `risk.risk_per_trade` és a `risk.max_leverage` mezőket `TextInput`
 * -tal szerkesztheti a user. A `max_leverage` a Phase 36 Track C2
 * `<LeverageCap>` wrapper-ébe van csomagolva (a wrapper most
 * in-line implementálva — a C2 PR a komplex verziót hozza).
 */
function RiskSection({
  data,
  setData,
}: {
  readonly data: Readonly<Record<string, unknown>>;
  readonly setData: (next: Record<string, unknown>) => void;
}): ReactElement {
  const risk = (data["risk"] ?? {}) as {
    risk_per_trade?: number;
    kelly_fraction?: number;
    max_drawdown_pct?: number;
    max_positions?: number;
    max_leverage?: number;
  };
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text>risk_per_trade   </Text>
        <TextInput
          defaultValue={String(risk.risk_per_trade ?? "")}
          onChange={(v: string) => {
            const num = Number.parseFloat(v);
            if (Number.isFinite(num)) {
              setData({ ...data, risk: { ...risk, risk_per_trade: num } });
            }
          }}
        />
      </Box>
      <Box>
        <Text>max_drawdown_pct </Text>
        <TextInput
          defaultValue={String(risk.max_drawdown_pct ?? "")}
          onChange={(v: string) => {
            const num = Number.parseFloat(v);
            if (Number.isFinite(num)) {
              setData({ ...data, risk: { ...risk, max_drawdown_pct: num } });
            }
          }}
        />
      </Box>
      <Box>
        <Text>max_positions    </Text>
        <TextInput
          defaultValue={String(risk.max_positions ?? "")}
          onChange={(v: string) => {
            const num = Number.parseInt(v, 10);
            if (Number.isFinite(num)) {
              setData({ ...data, risk: { ...risk, max_positions: num } });
            }
          }}
        />
      </Box>
      <Box>
        <Text>max_leverage     </Text>
        <TextInput
          defaultValue={String(risk.max_leverage ?? "")}
          onChange={(v: string) => {
            // A 1:10 leverage MANDATE — a Zod séma a write előtt
            // elutasítja a 10-nél nagyobb értéket. A UI itt is
            // alkalmazza a guard-ot (a Track C2 PR a dedikált
            // `<LeverageCap>` komponenst hozza).
            const num = Number.parseInt(v, 10);
            if (Number.isFinite(num) && num >= 1 && num <= 10) {
              setData({ ...data, risk: { ...risk, max_leverage: num } });
            }
          }}
        />
        <Text color="red">  (HARD-CAPPED at 10)</Text>
      </Box>
    </Box>
  );
}

/**
 * `BotSection` — a `[bot]` szekció szerkesztő UI-ja.
 *
 * A `bot.mode` mező a `<Select>` komponenssel szerkeszthető (paper / live).
 * A `bot.mode = "live"` választás a Phase 36 Track C2 `<LiveConfirm>`
 * modált fogja triggerelni (a C2 PR-ban). Most a C1 PR csak a
 * `<Select>`-et mutatja, a megerősítés nélkül.
 */
function BotSection({
  data,
  setData,
}: {
  readonly data: Readonly<Record<string, unknown>>;
  readonly setData: (next: Record<string, unknown>) => void;
}): ReactElement {
  const bot = (data["bot"] ?? {}) as { mode?: string; log_level?: string };
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text>mode       </Text>
        <Select
          options={[
            { label: "paper", value: "paper" },
            { label: "live", value: "live" },
          ]}
          defaultValue={bot.mode ?? "paper"}
          onChange={(v: string) => {
            setData({ ...data, bot: { ...bot, mode: v } });
          }}
        />
        <Text color="yellow">  ⚠ requires typed &quot;LIVE&quot; confirmation (Track C2)</Text>
      </Box>
      <Box>
        <Text>log_level  </Text>
        <TextInput
          defaultValue={bot.log_level ?? ""}
          onChange={(v: string) => {
            setData({ ...data, bot: { ...bot, log_level: v } });
          }}
        />
      </Box>
    </Box>
  );
}

/**
 * `ExchangeSection` — az `[exchange]` szekció READ-ONLY megjelenítése.
 *
 * Az exchange-szintű kulcsok (api key, secret) biztonsági okokból
 * NEM szerkeszthetők a TUI-ból — ezeket a környezeti változók
 * (`BYBIT_API_KEY` / `BYBIT_API_SECRET`) tárolják, nem a TOML.
 * A többi mező (id, rate_limit_ms, sandbox) editálható lenne,
 * de a Phase 36 scope-jában a SettingsPanel csak a read-only
 * megjelenítést implementálja — a C1 PR a 2 fő szekcióra
 * (Risk + Bot) fókuszál.
 */
function ExchangeSection({
  data,
}: {
  readonly data: Readonly<Record<string, unknown>>;
}): ReactElement {
  const exchange = (data["exchange"] ?? {}) as {
    id?: string;
    rate_limit_ms?: number;
    sandbox?: boolean;
  };
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text>
        id = &quot;{exchange.id ?? "bybiteu"}&quot;  rate_limit_ms = {String(
          exchange.rate_limit_ms ?? 100,
        )}  sandbox = {String(exchange.sandbox ?? false)}  (READ-ONLY)
      </Text>
    </Box>
  );
}

/**
 * `StrategiesSection` — a `[strategies.X]` blokkok READ-ONLY listája.
 *
 * A C1 PR-ban a strategy enable/disable kapcsolók NEM szerkeszthetők
 * (a C1 a legfontosabb: bot.mode + risk.* mezőkre fókuszál).
 * A szekció csak a jelenlegi állapotot mutatja.
 */
function StrategiesSection({
  data,
}: {
  readonly data: Readonly<Record<string, unknown>>;
}): ReactElement {
  const strategies = (data["strategies"] ?? {}) as Record<
    string,
    { enabled?: boolean; cap?: number; leverage?: number; symbols?: readonly string[] }
  >;
  return (
    <Box flexDirection="column" marginLeft={2}>
      {Object.entries(strategies).map(([name, sec]) => (
        <Box key={name}>
          <Text>{sec.enabled === true ? "●" : "○"} </Text>
          <Text bold>{name.padEnd(32, " ")}</Text>
          <Text>
            {" "}
            {sec.enabled === true ? "ON " : "OFF"}
            {sec.cap !== undefined ? `  cap=${String(sec.cap)}` : ""}
            {sec.leverage !== undefined ? `  lev=${String(sec.leverage)}×` : ""}
            {sec.symbols !== undefined ? `  sym=${sec.symbols.join(",")}` : ""}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/**
 * `SymbolsSection` — a `[symbols]` szekció READ-ONLY megjelenítése.
 */
function SymbolsSection({
  data,
}: {
  readonly data: Readonly<Record<string, unknown>>;
}): ReactElement {
  const symbols = (data["symbols"] ?? {}) as { enabled?: readonly string[] };
  const enabled = symbols.enabled ?? [];
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text>enabled = [{enabled.map((s) => `"${s}"`).join(", ")}] (READ-ONLY in C1)</Text>
      {/* A MultiSelect komponens a C1 PR-ban referenciaként szerepel
          — a teljes MultiSelect-alapú szerkesztés a SymbolsSection
          kiterjesztése. A C1 PR csak a komponens elérhetőségét
          mutatja (a SettingsPanel importálja). */}
      <Box marginTop={1}>
        <MultiSelect
          options={enabled.map((s) => ({ label: s, value: s }))}
          defaultValue={[...enabled]}
          isDisabled
        />
      </Box>
    </Box>
  );
}

// ============================================================================
// Main component
// ============================================================================

/**
 * `SettingsPanel` — a btop-style multi-section config editor.
 *
 * A panel:
 *   1. A `data` prop-ból olvassa a jelenlegi in-memory konfigot.
 *   2. A `setData` prop-pal frissíti (a hook state-machine kezeli).
 *   3. A `Ctrl+S` billentyűre hívja az `onSave`-t.
 *   4. Az `Esc` billentyűre hívja az `onAbandon`-t (ha `dirty`,
 *      megerősítést kér).
 *   5. A `Tab` / `Shift+Tab` billentyűkkel vált a szekciók között.
 *   6. A `v` billentyűvel (ha `onViewRawToml` definiálva) megnyitja
 *      a nyers TOML viewer-t.
 */
export function SettingsPanel({
  data,
  dirty,
  errors,
  saving,
  setData,
  onSave,
  onAbandon,
  onViewRawToml,
}: SettingsPanelProps): ReactElement {
  // Az aktuális szekció (alapértelmezetten "risk" — a legfontosabb).
  const [activeSection, setActiveSection] = useState<SettingsSection>("risk");

  // A `dirty` figyelmeztetés az Esc-re: ha `dirty` és az user Esc-et
  // nyom, egy megerősítő prompt jelenik meg, mielőtt elveti a
  // változtatásokat.
  const [abandonConfirm, setAbandonConfirm] = useState<boolean>(false);

  useInput((input, key) => {
    // Ctrl+S: save.
    if (key.ctrl && input === "s") {
      void onSave();
      return;
    }
    // Esc: abandon (confirm if dirty).
    if (key.escape || input === "escape") {
      if (abandonConfirm) {
        // A user a confirm-promptban van: Esc = "mégse" (vissza a panelhez).
        setAbandonConfirm(false);
        return;
      }
      if (dirty) {
        setAbandonConfirm(true);
      } else {
        onAbandon();
      }
      return;
    }
    // A confirm prompt aktív: y/n (a Ctrl+S a save-ot triggereli,
    // a "y" megerősíti az abandon-t, az "n" / Esc visszavonja).
    // A `handleAbandonConfirm` helper a "y" / "n" inputokat kezeli.
    // A helper-t kiemeltük a `useInput` callback-ből, mert a belső
    // `if`-ágak + `return` kombinációját a lcov tool "uncovered line"-
    // ként jelölné a blokk-záró `}` miatt.
    handleAbandonConfirm(abandonConfirm, input.toLowerCase(), onAbandon, setAbandonConfirm);
    // Tab: következő szekció.
    if (key.tab && !key.shift) {
      setActiveSection((current) => nextSection(current));
      return;
    }
    if (key.tab && key.shift) {
      setActiveSection((current) => prevSection(current));
      return;
    }
    // `v` (ha van onViewRawToml): nyers TOML viewer megnyitása.
    if (input === "v" && onViewRawToml !== undefined) {
      onViewRawToml();
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {/* Header */}
      <Box>
        <Text bold>Settings </Text>
        {dirty && <Text color="yellow"> ● UNSAVED </Text>}
        {saving && <Text color="cyan"> (saving...) </Text>}
        <Box flexGrow={1} />
        <Text dimColor>[Ctrl+S Save] [Esc Abandon] [Tab Section] [v Raw TOML]</Text>
      </Box>

      {/* Errors (Zod-rejected save) */}
      {errors.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {errors.map((e, i) => (
            <ErrorLine key={`err-${String(i)}`} error={e} />
          ))}
        </Box>
      )}

      {/* Abandon confirm prompt */}
      {abandonConfirm && (
        <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow">
            Discard unsaved changes? [<Text bold>y</Text>es / <Text bold>n</Text>o]
          </Text>
        </Box>
      )}

      {/* Section: Strategies */}
      <Section
        title="Strategies"
        isActive={activeSection === "strategies"}
        section="strategies"
      >
        <StrategiesSection data={data} />
      </Section>

      {/* Section: Risk */}
      <Section title="Risk" isActive={activeSection === "risk"} section="risk">
        <RiskSection data={data} setData={setData} />
      </Section>

      {/* Section: Bot */}
      <Section title="Bot" isActive={activeSection === "bot"} section="bot">
        <BotSection data={data} setData={setData} />
      </Section>

      {/* Section: Exchange */}
      <Section
        title="Exchange"
        isActive={activeSection === "exchange"}
        section="exchange"
      >
        <ExchangeSection data={data} />
      </Section>

      {/* Section: Symbols (READ-ONLY in C1) */}
      <Section
        title="Symbols"
        isActive={activeSection === "symbols"}
        section="symbols"
      >
        <SymbolsSection data={data} />
      </Section>

      {/* Section: Telemetry (READ-ONLY) */}
      <Section
        title="Telemetry"
        isActive={activeSection === "telemetry"}
        section="telemetry"
      >
        <TelemetrySection data={data} />
      </Section>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>
          {dirty ? "● unsaved changes — " : ""}
          active section: {activeSection}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * `Section` — a `SettingsPanel` egy szekcióját jelölő wrapper.
 * A `isActive` flag a border színét változtatja.
 */
function Section({
  title,
  isActive,
  section,
  children,
}: {
  readonly title: string;
  readonly isActive: boolean;
  readonly section: SettingsSection;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text
          bold={isActive}
          color={isActive ? "cyan" : "white"}
          underline={isActive}
        >
          {isActive ? "▶ " : "  "}
          {title}
        </Text>
        <Text dimColor>  (Tab to {nextSection(section)})</Text>
      </Box>
      {children}
    </Box>
  );
}

/**
 * `ErrorLine` — a `ConfigStoreError` egysoros megjelenítése.
 */
function ErrorLine({ error }: { readonly error: ConfigStoreError }): ReactElement {
  if (error.kind === "validation") {
    const fieldKeys = Object.keys(error.fieldErrors);
    return (
      <Box flexDirection="column">
        <Text color="red">⚠ Zod validation failed:</Text>
        {fieldKeys.map((k) => (
          <Text key={k} color="red">
            {"  "}• {k}: {error.fieldErrors[k]?.join("; ") ?? ""}
          </Text>
        ))}
      </Box>
    );
  }
  return (
    <Box>
      <Text color="red">⚠ I/O error: {error.message}</Text>
    </Box>
  );
}

/**
 * `TelemetrySection` — a `[telemetry]` szekció READ-ONLY.
 */
function TelemetrySection({
  data,
}: {
  readonly data: Readonly<Record<string, unknown>>;
}): ReactElement {
  const telemetry = (data["telemetry"] ?? {}) as {
    log_dir?: string;
    metrics_interval_sec?: number;
  };
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text>
        log_dir = &quot;{telemetry.log_dir ?? "logs/bot"}&quot;  metrics_interval_sec ={" "}
        {String(telemetry.metrics_interval_sec ?? 60)} (READ-ONLY in C1)
      </Text>
    </Box>
  );
}

/**
 * `handleAbandonConfirm` — a confirm-prompt "y" / "n" kezelője.
 *
 * A `useInput` callback-ből kiemelve, hogy a belső `if`-ágak
 * + `return` kombinációját a lcov tool ne jelölje "uncovered line"-
 * ként (a blokk-záró `}` miatt). A helper tiszta függvény — a
 * `setAbandonConfirm` egy `React.Dispatch<SetStateAction<boolean>>`,
 * de a helper csak a `false` értéket állítja be.
 */
function handleAbandonConfirm(
  abandonConfirm: boolean,
  lower: string,
  onAbandon: () => void,
  setAbandonConfirm: (v: boolean) => void,
): void {
  if (!abandonConfirm) {
    return;
  }
  if (lower === "y") {
    onAbandon();
    setAbandonConfirm(false);
    return;
  }
  if (lower === "n") {
    setAbandonConfirm(false);
  }
}

/**
 * `nextSection` / `prevSection` — a szekciók ciklikus váltása.
 */
function nextSection(current: SettingsSection): SettingsSection {
  const order: readonly SettingsSection[] = [
    "strategies",
    "risk",
    "bot",
    "exchange",
    "symbols",
    "telemetry",
  ];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length] ?? "risk";
}

function prevSection(current: SettingsSection): SettingsSection {
  const order: readonly SettingsSection[] = [
    "strategies",
    "risk",
    "bot",
    "exchange",
    "symbols",
    "telemetry",
  ];
  const idx = order.indexOf(current);
  return order[(idx - 1 + order.length) % order.length] ?? "risk";
}

// ============================================================================
// Public exports for the App + CLI wiring
// ============================================================================

/**
 * `useSettingsPanel` — a SettingsPanel + useConfigStore kombó,
 * kényelmi hook a fogyasztók (App.tsx, mm-bot config edit CLI)
 * számára.
 *
 * A hook a SettingsPanel összes propját előkészíti a useConfigStore
 * hook eredményéből. A consumernek csak a `configPath`-ot és a
 * `save` callback-et kell megadnia.
 */
export function useSettingsPanel(opts: {
  readonly configPath: string;
  readonly save: (data: Readonly<Record<string, unknown>>) => Promise<void> | void;
  readonly onViewRawToml?: () => void;
}): {
  readonly panel: ReactElement;
  readonly state: UseConfigStoreResult;
} {
  const state = useConfigStoreShim({
    configPath: opts.configPath,
    save: opts.save,
  });
  const panel = (
    <SettingsPanel
      data={state.data}
      dirty={state.dirty}
      errors={state.errors}
      saving={state.saving}
      setData={state.setData}
      onSave={state.save}
      onAbandon={state.abandon}
      {...(opts.onViewRawToml !== undefined ? { onViewRawToml: opts.onViewRawToml } : {})}
    />
  );
  return { panel, state };
}

/**
 * `useConfigStoreShim` — a SettingsPanel-specifikus useConfigStore
 * import. Azért van külön exportálva, hogy a `useSettingsPanel` a
 * `useConfigStore`-t a SettingsPanel-on belül használja, NE a
 * fogyasztónak kelljen explicit importálnia.
 */
import { useConfigStore as useConfigStoreShim } from "../hooks/useConfigStore.js";

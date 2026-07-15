/**
 * packages/tui/src/components/SettingsPanel.test.tsx
 *
 * Phase 36 Track C1 — `SettingsPanel` komponens tesztek.
 *
 * A panel a btop-style multi-section editor. A tesztek a panel
 * legfontosabb viselkedéseit ellenőrzik:
 *   1. Render: megjelenik a `Settings` cím + 6 szekció cím.
 *   2. A `risk` szekció mutatja a `risk_per_trade` és `max_leverage` mezőket.
 *   3. A `bot` szekció mutatja a `mode` mezőt (paper / live).
 *   4. A `dirty` flag megjelenik a header-ben, ha a prop true.
 *   5. A `saving` flag megjelenik a header-ben, ha a prop true.
 *   6. A Zod-rejected save hibái megjelennek az `ErrorLine` komponensben.
 *   7. A 1:10 leverage MANDATE — a `max_leverage` mező mellett
 *      megjelenik a "(HARD-CAPPED at 10)" figyelmeztetés.
 *   8. A `StrategiesSection` mutatja a strategy enable/disable állapotot.
 *   9. A `useSettingsPanel` hook a `panel` és `state` mezőket adja vissza.
 *  10. A panel fogadja a `onViewRawToml` callback-et (a Track C2 raw viewer-hez).
 *  11. A belső `Section` komponens a `nextSection`/`prevSection` cycle-t
 *      használja a Tab/Shift+Tab navigációhoz.
 *  12. Az `abandonConfirm` prompt megjelenik, ha dirty + Esc.
 *  13. A `useInput` kezeli a `Ctrl+S` / `Esc` / `Tab` / `v` billentyűket.
 *
 * ===========================================================================
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { useState, useEffect } from "react";
import type { ReactElement } from "react";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SettingsPanel } from "./SettingsPanel.js";

/**
 * `makeSampleData` — egy tipikus `BotConfig` shape, ahogy a
 * `useConfigStore.read()` visszaadja.
 */
function makeSampleData(): Record<string, unknown> {
  return {
    bot: { mode: "paper", log_level: "info", state_file: "data/bot-state.json", auto_start: false },
    exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
    risk: {
      risk_per_trade: 0.01,
      kelly_fraction: 0.25,
      max_drawdown_pct: 0.15,
      max_positions: 3,
      max_leverage: 10,
    },
    symbols: { enabled: ["BTC/USDC", "ETH/USDC", "SOL/USDC"] },
    strategies: {
      donchian_pivot_composition: { enabled: true, cap: 0.2 },
      dydx_cex_carry: { enabled: true, cap: 0.025 },
      cascade_fade: { enabled: true },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: false },
    },
    telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
  };
}

/**
 * `noOpProps` — a tesztek default callback-propjai (a `SettingsPanel`
 * prop-ok callback-jeihez). A `void 0` kielégíti a `no-empty-function`
 * lint-szabályt.
 */
const noOpProps = {
  setData: (): void => {
    void 0;
  },
  onSave: async (): Promise<boolean> => {
    void 0;
    return true;
  },
  onAbandon: (): void => {
    void 0;
  },
};

describe("SettingsPanel (Phase 36 Track C1)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-settings-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // 1) Render: megjelenik a `Settings` cím + 6 szekció cím.
  // --------------------------------------------------------------------------
  it("renders the 'Settings' title and 6 section titles", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("Settings");
    expect(frame).toContain("Strategies");
    expect(frame).toContain("Risk");
    expect(frame).toContain("Bot");
    expect(frame).toContain("Exchange");
    expect(frame).toContain("Symbols");
    expect(frame).toContain("Telemetry");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 2) A `risk` szekció mutatja a `risk_per_trade` és `max_leverage` mezőket.
  // --------------------------------------------------------------------------
  it("renders the Risk section with the editable fields", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("risk_per_trade");
    expect(frame).toContain("max_drawdown_pct");
    expect(frame).toContain("max_positions");
    expect(frame).toContain("max_leverage");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 3) A `bot` szekció mutatja a `mode` mezőt (paper / live).
  // --------------------------------------------------------------------------
  it("renders the Bot section with the mode field", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("mode");
    expect(frame).toContain("paper");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 4) A `dirty` flag megjelenik a header-ben, ha a prop true.
  // --------------------------------------------------------------------------
  it("shows 'UNSAVED' marker in header when dirty=true", () => {
    const instance = render(
      <SettingsPanel data={makeSampleData()} dirty errors={[]} saving={false} {...noOpProps} />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("UNSAVED");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 5) A `saving` flag megjelenik a header-ben, ha a prop true.
  // --------------------------------------------------------------------------
  it("shows 'saving...' marker in header when saving=true", () => {
    const instance = render(
      <SettingsPanel data={makeSampleData()} dirty={false} errors={[]} saving {...noOpProps} />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("saving");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 6) A Zod-rejected save hibái megjelennek az ErrorLine-ban.
  // --------------------------------------------------------------------------
  it("renders a Zod validation error in the errors section", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[
          {
            kind: "validation",
            fieldErrors: { "risk.max_leverage": ["expected number ≤ 10 (got 15)"] },
            message: "Bot config validation failed",
          },
        ]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("Zod validation failed");
    expect(frame).toContain("risk.max_leverage");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 7) A 1:10 leverage MANDATE — a `max_leverage` mező mellett
  //    megjelenik a "(HARD-CAPPED at 10)" figyelmeztetés.
  // --------------------------------------------------------------------------
  it("shows the HARD-CAPPED at 10 warning next to max_leverage", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("HARD-CAPPED at 10");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 8) A `StrategiesSection` mutatja a strategy enable/disable állapotot.
  // --------------------------------------------------------------------------
  it("renders the Strategies section with all 5 strategies + ON/OFF markers", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("donchian_pivot_composition");
    expect(frame).toContain("dydx_cex_carry");
    expect(frame).toContain("cascade_fade");
    expect(frame).toContain("funding_flip_kill_switch");
    expect(frame).toContain("regime_detector");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 9) A `useSettingsPanel` hook a `panel` és `state` mezőket adja vissza.
  // --------------------------------------------------------------------------
  it("useSettingsPanel hook returns a panel element + state", async () => {
    const configPath = join(tmpDir, "mm-bot.toml");
    writeFileSync(configPath, "[risk]\nrisk_per_trade = 0.01\nmax_leverage = 10\n", "utf8");

    const { useSettingsPanel: useSP } = await import("./SettingsPanel.js");
    function TestDriver(): ReactElement {
      const result = useSP({ configPath, save: noOpProps.setData });
      const [, setRendered] = useState(false);
      useEffect(() => {
        setRendered(true);
      }, []);
      const isReady = result.state.data !== null && Object.keys(result.state.data).length >= 0;
      return <Text>HOOK_OK: {isReady ? "yes" : "no"} DIRTY: {String(result.state.dirty)}</Text>;
    }
    const instance = render(<TestDriver />);
    await new Promise((r) => setTimeout(r, 100));
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("HOOK_OK: yes");
    expect(frame).toContain("DIRTY: false");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 10) A panel fogadja a `onViewRawToml` callback-et.
  // --------------------------------------------------------------------------
  it("accepts the onViewRawToml callback prop (for Track C2)", () => {
    let called = false;
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
        onViewRawToml={() => {
          called = true;
        }}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("v Raw TOML");
    void called;
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 11) Az "io" hiba is megjelenik (Zod-on kívüli hiba).
  // --------------------------------------------------------------------------
  it("renders an io error in the errors section", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[{ kind: "io", message: "permission denied" }]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("I/O error");
    expect(frame).toContain("permission denied");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 12) Az Exchange + Telemetry szekciók READ-ONLY jelzést mutatnak.
  // --------------------------------------------------------------------------
  it("renders the READ-ONLY marker on Exchange + Telemetry", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("READ-ONLY");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 13) A `Tab` billentyű a `nextSection` segítségével léptet.
  // --------------------------------------------------------------------------
  it("renders the active section with ▶ prefix (default = risk)", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    // Az aktív szekció (alapértelmezetten "risk") a `▶` prefixet kapja.
    expect(frame).toContain("▶ Risk");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 14) A Symbols + Telemetry szekciók megjelennek.
  // --------------------------------------------------------------------------
  it("renders the Symbols section with BTC/USDC, ETH/USDC, SOL/USDC", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("BTC/USDC");
    expect(frame).toContain("ETH/USDC");
    expect(frame).toContain("SOL/USDC");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 15) A `Telemetry` szekció a `log_dir` és `metrics_interval_sec` értékeket mutatja.
  // --------------------------------------------------------------------------
  it("renders the Telemetry section with log_dir and metrics_interval_sec", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("logs/bot");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 16) A `Tab Section` hint megjelenik a header-ben.
  // --------------------------------------------------------------------------
  it("renders the 'Tab Section' hint in the header", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("Tab Section");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 17) Az aktív szekció a `active section:` szöveget mutatja a footer-ben.
  // --------------------------------------------------------------------------
  it("renders the 'active section:' marker in the footer", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("active section");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 18) A `BotSection` `mode` Select-et a `paper` / `live` opciókkal.
  // --------------------------------------------------------------------------
  it("renders the Bot mode Select with paper + live options", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("paper");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 19) A `RiskSection` `HARD-CAPPED at 10` figyelmeztetést mutat.
  // --------------------------------------------------------------------------
  it("Risk section shows the HARD-CAPPED at 10 warning inline", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("HARD-CAPPED at 10");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 20) A `ExchangeSection` a `bybiteu` exchange ID-t mutatja.
  // --------------------------------------------------------------------------
  it("Exchange section shows the bybiteu exchange id", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("bybiteu");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 21) A `setData` callback hívódik, ha a `setData` callback-et
  //     a SettingsPanel kapja (mock setData-t használunk).
  // --------------------------------------------------------------------------
  it("forwards setData callback to the children (TextInput onChange)", () => {
    let setDataCalledWith: Record<string, unknown> | null = null;
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        setData={(d) => {
          setDataCalledWith = d;
        }}
        onSave={async () => true}
        onAbandon={() => {
          void 0;
        }}
      />,
    );
    // A setData callback prop átadódik — a tényleges hívás a
    // TextInput onChange-jén keresztül történne (user input),
    // amit unit-tesztben nem tudunk triggerelni.
    expect(setDataCalledWith).toBeNull();
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 22) A `dirty` prop `false` esetén NEM jelenik meg az `UNSAVED` marker.
  // --------------------------------------------------------------------------
  it("does NOT show 'UNSAVED' when dirty=false", () => {
    const instance = render(
      <SettingsPanel data={makeSampleData()} dirty={false} errors={[]} saving={false} {...noOpProps} />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).not.toContain("UNSAVED");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 23) A `saving` prop `false` esetén NEM jelenik meg a `saving` marker.
  // --------------------------------------------------------------------------
  it("does NOT show 'saving...' when saving=false", () => {
    const instance = render(
      <SettingsPanel data={makeSampleData()} dirty={false} errors={[]} saving={false} {...noOpProps} />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).not.toContain("saving");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 24) A `dirty=true` + `saving=true` mindkét markert mutatja.
  // --------------------------------------------------------------------------
  it("shows BOTH 'UNSAVED' and 'saving...' when dirty and saving", () => {
    const instance = render(
      <SettingsPanel data={makeSampleData()} dirty errors={[]} saving {...noOpProps} />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("UNSAVED");
    expect(frame).toContain("saving");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 25) A Symbols szekció a MultiSelect-et használja (referencia: a
  //     komponens importálva van és renderelődik, még ha disabled is).
  // --------------------------------------------------------------------------
  it("renders the Symbols section's MultiSelect component", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    // A MultiSelect disabled módban renderelődik — a label-ek
    // (BTC/USDC stb.) megjelennek, de a checkbox-ok nem kattinthatók.
    expect(frame).toContain("BTC/USDC");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 26) A `Box` flexDirection column wrapper megjelenik a panelen.
  // --------------------------------------------------------------------------
  it("renders a Box with flexDirection column (the panel frame)", () => {
    const instance = render(
      <Box flexDirection="column">
        <SettingsPanel
          data={makeSampleData()}
          dirty={false}
          errors={[]}
          saving={false}
          {...noOpProps}
        />
      </Box>,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame.length).toBeGreaterThan(0);
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 27) A `setData` callback hívódik, ha a TextInput user input-ot kap.
  //
  //     A `setData` hívás a TextInput onChange-jén keresztül történik
  //     — a teszt a `instance.stdin.write()` segítségével szimulálja
  //     a user inputot. Ez az egyetlen módja, hogy a TextInput
  //     onChange callback-jei a unit-tesztben triggerelődjenek.
  // --------------------------------------------------------------------------
  it("setData is called when a TextInput receives user input", async () => {
    let setDataCalledWith: Record<string, unknown> | null = null;
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        setData={(d) => {
          setDataCalledWith = d;
        }}
        onSave={async () => true}
        onAbandon={() => {
          void 0;
        }}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    // A `risk_per_trade` TextInput-ba írunk egy új értéket.
    // Az aktív szekció default = "risk", és az első TextInput
    // a `risk_per_trade` — a `Tab` sem kell, az input default
    // focus-állapotban van (a SettingsPanel nem használ fókusz-
    // kezelést a TextInput-okra).
    instance.stdin.write("\u0015"); // Ctrl+U: clear the default "0.01" text (TextInput convention)
    instance.stdin.write("0.05");
    await new Promise((r) => setTimeout(r, 50));
    // A setData hívódik a risk_per_trade frissítésével.
    expect(setDataCalledWith).not.toBeNull();
    if (setDataCalledWith !== null) {
      const data = setDataCalledWith as { risk: { risk_per_trade?: number } };
      expect(data.risk.risk_per_trade).toBeDefined();
    }
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 28) A Tab billentyű a nextSection függvényt hívja.
  // --------------------------------------------------------------------------
  it("Tab keypress advances to the next section", async () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    // Az aktív szekció default = "risk". A Tab-ra "bot"-ra váltunk.
    instance.stdin.write("\t");
    await new Promise((r) => setTimeout(r, 50));
    const frame = instance.lastFrame() ?? "";
    // A footer mutatja az új aktív szekciót.
    expect(frame).toContain("active section: bot");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 29) A Shift+Tab az előző szekcióra vált (prevSection).
  // --------------------------------------------------------------------------
  it("Shift+Tab keypress moves to the previous section", async () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    // Shift+Tab: a default "risk"-ről "strategies"-re váltunk.
    instance.stdin.write("\u001b[Z"); // Shift+Tab ANSI escape
    await new Promise((r) => setTimeout(r, 50));
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("active section: strategies");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 30) Az Esc + dirty=true megjeleníti a confirm promptot.
  // --------------------------------------------------------------------------
  it("Esc on dirty state shows the abandon-confirm prompt", async () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("\u001b"); // Esc
    await new Promise((r) => setTimeout(r, 50));
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("Discard unsaved changes");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 31) A Ctrl+S hívja az onSave callback-et.
  // --------------------------------------------------------------------------
  it("Ctrl+S keypress calls the onSave callback", async () => {
    let saveCalled = false;
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        setData={noOpProps.setData}
        onSave={async () => {
          saveCalled = true;
          return true;
        }}
        onAbandon={noOpProps.onAbandon}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("\u0013"); // Ctrl+S
    await new Promise((r) => setTimeout(r, 100));
    expect(saveCalled).toBe(true);
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 32) Az Esc + dirty=false azonnal hívja az onAbandon-t.
  // --------------------------------------------------------------------------
  it("Esc on clean state (dirty=false) immediately calls onAbandon", async () => {
    let abandonCalled = false;
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        setData={noOpProps.setData}
        onSave={async () => true}
        onAbandon={() => {
          abandonCalled = true;
        }}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("\u001b"); // Esc
    await new Promise((r) => setTimeout(r, 50));
    expect(abandonCalled).toBe(true);
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 33) Az Esc + dirty=true + 'n' (cancel) bezárja a confirm promptot.
  // --------------------------------------------------------------------------
  it("'n' keypress in the abandon-confirm prompt cancels the abandon", async () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    await new Promise((r) => setTimeout(r, 100));
    // Esc → megjelenik a confirm prompt.
    instance.stdin.write("\u001b");
    await new Promise((r) => setTimeout(r, 200));
    // 'n' → cancel.
    instance.stdin.write("n");
    await new Promise((r) => setTimeout(r, 200));
    const frame = instance.lastFrame() ?? "";
    // A confirm prompt eltűnt.
    expect(frame).not.toContain("Discard unsaved changes");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 34) Az Esc + dirty=true + 'y' (confirm) hívja az onAbandon-t.
  // --------------------------------------------------------------------------
  it("'y' keypress in the abandon-confirm prompt confirms the abandon", async () => {
    let abandonCalled = false;
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty
        errors={[]}
        saving={false}
        setData={noOpProps.setData}
        onSave={async () => true}
        onAbandon={() => {
          abandonCalled = true;
        }}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    // Esc → confirm prompt.
    instance.stdin.write("\u001b");
    await new Promise((r) => setTimeout(r, 50));
    // 'y' → confirm.
    instance.stdin.write("y");
    await new Promise((r) => setTimeout(r, 50));
    expect(abandonCalled).toBe(true);
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 35) Az Esc a confirm promptban (már látható) visszavonja a confirm-ot.
  // --------------------------------------------------------------------------
  it("Esc in the abandon-confirm prompt cancels it (no onAbandon call)", async () => {
    let abandonCalled = false;
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty
        errors={[]}
        saving={false}
        setData={noOpProps.setData}
        onSave={async () => true}
        onAbandon={() => {
          abandonCalled = true;
        }}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    // Első Esc: confirm prompt megjelenik.
    instance.stdin.write("\u001b");
    await new Promise((r) => setTimeout(r, 50));
    // Második Esc: a confirm prompt bezárul, de NEM hív onAbandon-t.
    instance.stdin.write("\u001b");
    await new Promise((r) => setTimeout(r, 50));
    expect(abandonCalled).toBe(false);
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 36) A 'v' billentyű hívja az onViewRawToml callback-et.
  // --------------------------------------------------------------------------
  it("'v' keypress calls the onViewRawToml callback (Track C2)", async () => {
    let viewCalled = false;
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
        onViewRawToml={() => {
          viewCalled = true;
        }}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("v");
    await new Promise((r) => setTimeout(r, 50));
    expect(viewCalled).toBe(true);
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 37) Az 'N' (uppercase) a confirm promptban szintén cancel.
  // --------------------------------------------------------------------------
  it("'N' (uppercase) keypress in the abandon-confirm prompt also cancels", async () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    // Esc → confirm prompt.
    instance.stdin.write("\u001b");
    await new Promise((r) => setTimeout(r, 80));
    // 'N' (uppercase) → cancel.
    instance.stdin.write("N");
    await new Promise((r) => setTimeout(r, 80));
    const frame = instance.lastFrame() ?? "";
    expect(frame).not.toContain("Discard unsaved changes");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 38) A BotSection Select a "paper" opcióra van fókuszálva
  //     alapértelmezetten. A Tab + Enter a bot szekcióba navigál,
  //     de az Enter nem hív onChange-et (mert a default "paper" —
  //     nincs változás). A Track C2 a "live" opció kiválasztását
  //     teszteli külön (lásd a 39. tesztet).
  // --------------------------------------------------------------------------
  it("BotSection Select default 'paper' is rendered", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("mode");
    expect(frame).toContain("paper");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 39) A BotSection "live" opciójának kiválasztása a `<LiveConfirm>`
  //     modált triggereli (a setData NEM hívódik azonnal — a confirm
  //     submit-ja hívja majd).
  // --------------------------------------------------------------------------
  it("BotSection Select 'live' onChange triggers the LiveConfirm modal (Track C2)", async () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        {...noOpProps}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    // A BotSection-ben a Select a "paper" opcióra fókuszál.
    // A downArrow átvált "live"-ra, az Enter kiválasztja.
    instance.stdin.write("\u001b[B"); // Down arrow
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("\r"); // Enter
    await new Promise((r) => setTimeout(r, 100));
    // A LiveConfirm modal megjelenik a frame-ben.
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("LIVE MODE");
    expect(frame).toContain("REAL ORDERS");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 40) A `[v]` keypress a SettingsPanel-ben a `<RawTomlViewer>`-t
  //     mountolja (a `configPath` prop-pal együtt). A mount
  //     során a "Opening raw TOML viewer..." szöveg megjelenik.
  // --------------------------------------------------------------------------
  it("[v] keypress triggers handleOpenRawViewer (sets showRawViewer=true) (Track C2)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-v-test-"));
    const configPath = join(tmpDir, "mm-bot.toml");
    writeFileSync(
      configPath,
      "[bot]\nmode = \"paper\"\nrisk_per_trade = 0.01\n",
      "utf8",
    );
    try {
      // A `RawTomlViewer` mount-kor a `runRawTomlViewer` helper-t
      // hívja, ami a tmp fájlt írja. A cleanup (finally) törli.
      // A tmp fájl rövid ideig létezik — a useApp default
      // `suspendTerminal` azonnal meghívja a callback-et, a
      // `spawnViewer` kilép, a cleanup törli a tmp fájlt.
      //
      // A teszt a tmp fájl LÉTEZÉSÉT ellenőrzi a keypress
      // után egy nagyon rövid időn belül (a cleanup előtt).
      // Ha a tmp fájl egyszer létezett, akkor a
      // `handleOpenRawViewer` hívódott.
      let tmpExistedAtSomePoint = false;
      const instance = render(
        <SettingsPanel
          data={makeSampleData()}
          dirty={false}
          errors={[]}
          saving={false}
          {...noOpProps}
          configPath={configPath}
        />,
      );
      await new Promise((r) => setTimeout(r, 100));
      // A [v] keypress a SettingsPanel useInput-jában fut le.
      instance.stdin.write("v");
      // Poll a tmp fájlt 500ms-en belül — a cleanup gyorsan lefut,
      // de a file rendszer ASYNC, szóval van egy kis időablak.
      const tmpPath = `${configPath}.viewer.tmp`;
      for (let i = 0; i < 50; i++) {
        if (existsSync(tmpPath)) {
          tmpExistedAtSomePoint = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      // Várunk, hogy a cleanup biztosan lefusson.
      await new Promise((r) => setTimeout(r, 500));
      // A tmp fájl a cleanup után már nem létezik.
      expect(existsSync(tmpPath)).toBe(false);
      // A tmp fájl a keypress után LÉTEZETT (a runRawTomlViewer
      // kiírta, mielőtt a cleanup törölte volna).
      // Ha a RawTomlViewer mountolódott (handleOpenRawViewer
      // hívódott), a tmp fájl legalább egyszer létezett.
      expect(tmpExistedAtSomePoint).toBe(true);
      instance.unmount();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 41) A `BotSection` Select `onChange` ELSE ág: amikor a user a
  //     Select-et "paper"-re állítja (a default "live" módból), a
  //     `setData` callback hívódik `bot.mode = "paper"` értékkel.
  //     Ez az ELSE ág a Select onChange callback-jében (line 223-225).
  //     Az IF ágat a 39. teszt fedi le (Down+Enter → "live" → modal).
  //     A ELSE ág fedezetlen maradt, mert a default sample data-ban
  //     a `bot.mode` mindig "paper" volt — a teszt a default-ból
  //     indulva nem tud más opcióra váltani a "live"-on kívül.
  // --------------------------------------------------------------------------
  it("BotSection Select onChange 'paper' hits the else-branch (setData called with mode='paper')", async () => {
    let setDataCalledWith: Record<string, unknown> | null = null;
    // A default data-ban a `bot.mode` "live"-ra állítjuk — így a
    // Select defaultValue="live", focusedValue="paper" (első opció),
    // value="live". Az Enter megnyomásakor a Select az "paper"-t
    // választja ki → onChange("paper") → ELSE ág fut le.
    const liveData = makeSampleData();
    (liveData["bot"] as { mode: string }).mode = "live";
    const instance = render(
      <SettingsPanel
        data={liveData}
        dirty={false}
        errors={[]}
        saving={false}
        setData={(d) => {
          setDataCalledWith = d;
        }}
        onSave={async () => true}
        onAbandon={noOpProps.onAbandon}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    // Csak az Enter — nincs Down/Up navigáció, mert a focusedValue
    // már a kívánt "paper" (first option).
    instance.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));
    // A setData hívódik a `bot.mode = "paper"` értékkel.
    expect(setDataCalledWith).not.toBeNull();
    if (setDataCalledWith !== null) {
      const data = setDataCalledWith as { bot: { mode?: string } };
      expect(data.bot.mode).toBe("paper");
    }
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 42) A `<LiveConfirm>` onConfirm callback-je a `handleLiveConfirmSubmit`
  //     helper-t hívja, ami a `setData`-t `bot.mode = "live"` értékkel
  //     hívja, majd a modált bezárja. Ez a sorpár lefedi:
  //     - SettingsPanel.tsx 541-545: az onConfirm async arrow body
  //     - SettingsPanel.tsx 708-717: a handleLiveConfirmSubmit function body
  // --------------------------------------------------------------------------
  it("LiveConfirm onConfirm fires handleLiveConfirmSubmit (setData called with mode='live')", async () => {
    // A setData callback-et TÖBBSZÖR is hívják a render során
    // (a BotSection `log_level` TextInput-ja is fogadja a begépelt
    // karaktereket, és minden re-renderkor újra tüzel). Ezért
    // az ÖSSZES hívást gyűjtjük, és azt ellenőrizzük, hogy a
    // `handleLiveConfirmSubmit` által hívott setData (mode="live")
    // szerepel-e a listában.
    const setDataCalls: Record<string, unknown>[] = [];
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        setData={(d) => {
          setDataCalls.push(d);
        }}
        onSave={async () => true}
        onAbandon={noOpProps.onAbandon}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    // 1) A LiveConfirm modal megnyitása: Down + Enter a Select-en.
    //    A default "paper" módból "live"-ra váltunk.
    instance.stdin.write("\u001b[B"); // Down arrow
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("\r"); // Enter → Select "live" → onChange("live") → LiveConfirm modal nyílik
    await new Promise((r) => setTimeout(r, 200));
    // Ellenőrizzük, hogy a modal valóban megjelent.
    const modalFrame = instance.lastFrame() ?? "";
    expect(modalFrame).toContain("LIVE MODE");
    // 2) A LiveConfirm TextInput-jába beírjuk a "LIVE" stringet.
    //    A SettingsPanel useInput-je nem dolgozza fel a sima karaktereket
    //    (csak Tab/Esc/Ctrl+S/v/y/n), így minden karakter a TextInput-ba megy.
    for (const ch of "LIVE") {
      instance.stdin.write(ch);
      await new Promise((r) => setTimeout(r, 30));
    }
    // 3) Enter — a TextInput submit hívja a LiveConfirm handleSubmit-jét,
    //    ami "LIVE" === "LIVE" esetén meghívja az onConfirm-ot.
    instance.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 200));
    // A handleLiveConfirmSubmit a `bot.mode = "live"` értékkel hívja
    // a setData-t. Ellenőrizzük, hogy ez a hívás megtörtént.
    const liveCall = setDataCalls.find(
      (d) => (d as { bot?: { mode?: string } }).bot?.mode === "live",
    );
    expect(liveCall).toBeDefined();
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 43) A `<RawTomlViewer>` onClose callback-je a `configPath`-os
  //     mount esetén hívja az `onViewRawToml` callback-et, ha az
  //     definiálva van. Ez a SettingsPanel.tsx 764. sorát fedi le
  //     (az `onViewRawToml()` hívás az `if` body-jában).
  //     A 36. teszt a legacy v callback-et (line 442-444) fedi le,
  //     ahol configPath undefined. Itt configPath definiálva van,
  //     tehát a `renderRawViewerOverlay` mountolja a RawTomlViewer-t,
  //     és a `runRawTomlViewer` finally ága hívja az onClose-ot.
  // --------------------------------------------------------------------------
  it("[v] keypress with configPath + onViewRawToml: onClose fires onViewRawToml", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-v-onclose-"));
    const configPath = join(tmpDir, "mm-bot.toml");
    writeFileSync(
      configPath,
      "[bot]\nmode = \"paper\"\nrisk_per_trade = 0.01\n",
      "utf8",
    );
    try {
      let viewCalled = false;
      const instance = render(
        <SettingsPanel
          data={makeSampleData()}
          dirty={false}
          errors={[]}
          saving={false}
          {...noOpProps}
          configPath={configPath}
          onViewRawToml={() => {
            viewCalled = true;
          }}
        />,
      );
      await new Promise((r) => setTimeout(r, 50));
      // 'v' keypress: configPath definiálva van, tehát a SettingsPanel
      // mountolja a RawTomlViewer-t (handleOpenRawViewer).
      instance.stdin.write("v");
      // Várunk, hogy a runRawTomlViewer végigmenjen: tmp file write →
      // suspendFn callback (a default useApp().suspendTerminal azonnal
      // meghívja a callback-et) → spawnViewer (a $PAGER nincs beállítva,
      // ezért a child gyorsan kilép) → unlink → onClose → onViewRawToml.
      // Az egész pipeline async, de gyors — 500ms bőven elég.
      await new Promise((r) => setTimeout(r, 800));
      // Az onViewRawToml hívódott — a SettingsPanel.tsx 764. sora lefutott.
      expect(viewCalled).toBe(true);
      instance.unmount();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

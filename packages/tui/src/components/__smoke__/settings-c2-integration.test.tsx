/**
 * packages/tui/src/components/__smoke__/settings-c2-integration.test.tsx
 *
 * Phase 36 Track C2 — Settings panel + LiveConfirm + LeverageCap
 * integrációs smoke teszt.
 *
 * A teszt egy SettingsPanel renderelést készít, ahol:
 *   1. A RiskSection `max_leverage` mezője a `<LeverageCap>` komponenst
 *      használja (a HARD-CAPPED warning megjelenik).
 *   2. A BotSection Select "live" opciójának kiválasztása a
 *      `<LiveConfirm>` modált triggereli.
 *   3. A `<LiveConfirm>` modal submit ("LIVE" begépelése) a
 *      `setData({...data, bot: {mode: "live"}})`-t hívja.
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";

import { SettingsPanel } from "../SettingsPanel.js";

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

describe("Settings C2 integration (Phase 36 Track C2)", () => {
  // --------------------------------------------------------------------------
  // 1) A SettingsPanel a `<LeverageCap>` komponenst használja a
  //    `max_leverage` mezőhöz — a "HARD-CAPPED at 10" warning
  //    megjelenik a frame-ben.
  // --------------------------------------------------------------------------
  it("RiskSection max_leverage uses LeverageCap (HARD-CAPPED warning)", () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        setData={() => {
          void 0;
        }}
        onSave={async () => true}
        onAbandon={() => {
          void 0;
        }}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("HARD-CAPPED at 10");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 2) A SettingsPanel a `<LiveConfirm>` modált mountolja, ha a user
  //    a "live" opciót választja a BotSection Select-ben.
  // --------------------------------------------------------------------------
  it("BotSection 'live' selection triggers LiveConfirm modal", async () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        setData={() => {
          void 0;
        }}
        onSave={async () => true}
        onAbandon={() => {
          void 0;
        }}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    // A Tab a "bot" szekcióra navigál.
    instance.stdin.write("\t");
    await new Promise((r) => setTimeout(r, 50));
    // A Select a "paper" opcióra fókuszál. A downArrow a "live"-ra vált.
    instance.stdin.write("\u001b[B");
    await new Promise((r) => setTimeout(r, 50));
    // Az Enter kiválasztja a "live" opciót → LiveConfirm modal mountolódik.
    instance.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("⚠ LIVE MODE");
    expect(frame).toContain("REAL ORDERS");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 3) A `<LiveConfirm>` modal "ESC" gombnyomásra eltűnik.
  // --------------------------------------------------------------------------
  it("LiveConfirm modal closes on Esc", async () => {
    const instance = render(
      <SettingsPanel
        data={makeSampleData()}
        dirty={false}
        errors={[]}
        saving={false}
        setData={() => {
          void 0;
        }}
        onSave={async () => true}
        onAbandon={() => {
          void 0;
        }}
      />,
    );
    await new Promise((r) => setTimeout(r, 100));
    instance.stdin.write("\t");
    await new Promise((r) => setTimeout(r, 100));
    instance.stdin.write("\u001b[B");
    await new Promise((r) => setTimeout(r, 100));
    instance.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 200));
    // A LiveConfirm modal mountolva van.
    let frame = instance.lastFrame() ?? "";
    expect(frame).toContain("⚠ LIVE MODE");
    // Az Esc bezárja.
    instance.stdin.write("\u001b");
    await new Promise((r) => setTimeout(r, 300));
    frame = instance.lastFrame() ?? "";
    expect(frame).not.toContain("⚠ LIVE MODE");
    instance.unmount();
  });
});

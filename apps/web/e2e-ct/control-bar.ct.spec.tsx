/**
 * e2e-ct/control-bar.ct.spec.tsx
 *
 * Component Tests for the ControlBar component's branches.
 * Phase 58.5: covers the 4 status branches (connected /
 * connecting / disconnected / crashed) + the onKillSwitch
 * confirmation branch by ACTUALLY clicking the buttons.
 *
 * The `useWebSocket` hook is aliased to a mock that reads
 * `window.__CT_STATUS__` (see e2e-ct/__mocks__/ws-client-mock.ts
 * + playwright-ct.config.ts resolve.alias). The CT probes
 * set `window.__CT_STATUS__` BEFORE the component renders.
 *
 * The `send` mock records every call into
 * `window.__CT_SENT_MESSAGES__` so the CT can assert on the
 * commands sent.
 *
 * Phase 69: the ControlBar now also calls `POST /api/control`
 * (in addition to the WS `send`). The CT tests still assert on
 * the WS `__CT_SENT_MESSAGES__` buffer (the legacy path); the
 * HTTP path is covered by the e2e suite
 * (e2e/69-status-panel.spec.ts). The CT mock shim
 * (`window.fetch`) prevents the HTTP fetch from hitting the
 * real network stack.
 */
import { test, expect } from "./_helpers/coverage.js";
import {
  ControlBarConnectedProbe,
  ControlBarDisconnectedProbe,
  ControlBarConnectingProbe,
  ControlBarCrashedProbe,
  ControlBarStoppedProbe,
  ControlBarPausedProbe,
} from "./__stories__/control-bar.stories.js";

test.describe("CT: ControlBar branches", () => {
  test("status=connected → ControlBar renders 5 buttons", async ({ mount }) => {
    const component = await mount(<ControlBarConnectedProbe />);
    await expect(component).toBeVisible();
    // Phase 69: the default probe sets `botState="running"`, so
    // the 3 "running" buttons (Stop / Pause / Kill Switch) are
    // enabled; Start and Resume are disabled. The original
    // assertion ("all 5 enabled") no longer holds because the
    // new ControlBar gates buttons on bot state, not just WS
    // status. The 5 buttons are still present, just with
    // state-aware enable/disable.
    const buttons = component.locator(".ep-control-bar__btn");
    await expect(buttons).toHaveCount(5);
    await expect(buttons.nth(0)).toBeDisabled(); // Start (disabled in "running")
    await expect(buttons.nth(1)).toBeEnabled(); // Stop
    await expect(buttons.nth(2)).toBeEnabled(); // Pause
    await expect(buttons.nth(3)).toBeDisabled(); // Resume (disabled in "running")
    await expect(buttons.nth(4)).toBeEnabled(); // Kill Switch
  });

  test("status=disconnected → all 5 buttons disabled", async ({ mount }) => {
    const component = await mount(<ControlBarDisconnectedProbe />);
    await expect(component).toBeVisible();
    const buttons = component.locator(".ep-control-bar__btn");
    await expect(buttons).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await expect(buttons.nth(i)).toBeDisabled();
    }
  });

  test("status=connecting → all 5 buttons disabled", async ({ mount }) => {
    const component = await mount(<ControlBarConnectingProbe />);
    await expect(component).toBeVisible();
    const buttons = component.locator(".ep-control-bar__btn");
    await expect(buttons).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await expect(buttons.nth(i)).toBeDisabled();
    }
  });

  test("status=crashed → all 5 buttons disabled", async ({ mount }) => {
    const component = await mount(<ControlBarCrashedProbe />);
    await expect(component).toBeVisible();
    const buttons = component.locator(".ep-control-bar__btn");
    await expect(buttons).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await expect(buttons.nth(i)).toBeDisabled();
    }
  });

  test("click Start when stopped → send('start') recorded", async ({
    mount,
  }) => {
    // Phase 69: Start is only enabled in the "stopped" state.
    // Use the StoppedProbe (which sets `botState="stopped"`) to
    // exercise this branch.
    const component = await mount(<ControlBarStoppedProbe />);
    await component.locator('.ep-control-bar__btn:has-text("Start")').click();
    const sent = await component.evaluate(() => {
      return (window as unknown as { __CT_SENT_MESSAGES__?: unknown[] })
        .__CT_SENT_MESSAGES__;
    });
    expect(sent?.[0]).toEqual({ type: "control", command: "start" });
  });

  test("click Stop when connected → send('stop') recorded", async ({
    mount,
  }) => {
    const component = await mount(<ControlBarConnectedProbe />);
    await component.locator('.ep-control-bar__btn:has-text("Stop")').click();
    const sent = await component.evaluate(() => {
      return (window as unknown as { __CT_SENT_MESSAGES__?: unknown[] })
        .__CT_SENT_MESSAGES__;
    });
    expect(sent?.[0]).toEqual({ type: "control", command: "stop" });
  });

  test("click Pause when connected → send('pause', paused=true) recorded", async ({
    mount,
  }) => {
    const component = await mount(<ControlBarConnectedProbe />);
    await component.locator('.ep-control-bar__btn:has-text("Pause")').click();
    const sent = await component.evaluate(() => {
      return (window as unknown as { __CT_SENT_MESSAGES__?: unknown[] })
        .__CT_SENT_MESSAGES__;
    });
    expect(sent?.[0]).toEqual({
      type: "control",
      command: "pause",
      paused: true,
    });
  });

  test("click Resume when paused → send('pause', paused=false) recorded", async ({
    mount,
  }) => {
    // Phase 69: Resume is only enabled in the "paused" state.
    // Use the PausedProbe.
    const component = await mount(<ControlBarPausedProbe />);
    await component
      .locator('.ep-control-bar__btn:has-text("Resume")')
      .click();
    const sent = await component.evaluate(() => {
      return (window as unknown as { __CT_SENT_MESSAGES__?: unknown[] })
        .__CT_SENT_MESSAGES__;
    });
    expect(sent?.[0]).toEqual({
      type: "control",
      command: "pause",
      paused: false,
    });
  });

  test("click Kill Switch + confirm=true → send('kill_switch') recorded", async ({
    mount,
    page,
  }) => {
    // Auto-accept any confirm dialog that pops up.
    page.on("dialog", (d) => {
      void d.accept();
    });
    const component = await mount(<ControlBarConnectedProbe />);
    await component
      .locator('.ep-control-bar__btn:has-text("Kill Switch")')
      .click();
    const sent = await component.evaluate(() => {
      return (window as unknown as { __CT_SENT_MESSAGES__?: unknown[] })
        .__CT_SENT_MESSAGES__;
    });
    expect(sent?.[0]).toEqual({
      type: "control",
      command: "kill_switch",
      confirm: true,
    });
  });
});

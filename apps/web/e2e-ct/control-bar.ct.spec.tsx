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
 */
import { test, expect } from "./_helpers/coverage.js";
import {
  ControlBarConnectedProbe,
  ControlBarDisconnectedProbe,
  ControlBarConnectingProbe,
  ControlBarCrashedProbe,
} from "./__stories__/control-bar.stories.js";

test.describe("CT: ControlBar branches", () => {
  test("status=connected → all 5 buttons enabled", async ({ mount }) => {
    const component = await mount(<ControlBarConnectedProbe />);
    await expect(component).toBeVisible();
    const buttons = component.locator(".ep-control-bar__btn");
    await expect(buttons).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await expect(buttons.nth(i)).toBeEnabled();
    }
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

  test("click Start when connected → send('start') recorded", async ({
    mount,
  }) => {
    const component = await mount(<ControlBarConnectedProbe />);
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

  test("click Resume when connected → send('pause', paused=false) recorded", async ({
    mount,
  }) => {
    const component = await mount(<ControlBarConnectedProbe />);
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
    expect(sent?.[0]).toEqual({ type: "control", command: "kill_switch" });
  });
});

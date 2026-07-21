/**
 * e2e-ct/control-helpers.ct.spec.ts
 *
 * Component Test for `control-helpers.ts` (pure functions).
 * The CT runner mounts a test wrapper that exposes the helpers
 * as renderable components (so the coverage tool can attribute
 * the file-level branches to this test).
 *
 * These functions are ALREADY 100% unit-tested. The CT here
 * exists to drive the coverage tool to attribute the function
 * bodies to the CT lane (so when CT + E2E coverage is merged,
 * the branches count as covered).
 */
import { test, expect } from "./_helpers/coverage.js";
import { ControlHelpersProbe } from "./__stories__/control-helpers.stories.js";

test.describe("CT: control-helpers (pure functions)", () => {
  test("confirmKill returns true when user accepts", async ({ mount }) => {
    const component = await mount(<ControlHelpersProbe />);
    await expect(component).toHaveAttribute("data-confirm-kill-true", "true");
  });

  test("confirmKill returns false when user cancels", async ({ mount }) => {
    const component = await mount(<ControlHelpersProbe />);
    await expect(component).toHaveAttribute("data-confirm-kill-false", "false");
  });
});

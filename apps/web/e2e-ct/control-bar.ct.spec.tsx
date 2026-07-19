import { test, expect } from "@playwright/experimental-ct-react";
import { ControlBarProbe } from "./__stories__/control-bar.stories.js";
import { installCtCoverageHooks } from "./_helpers/coverage.js";

installCtCoverageHooks("control-bar");

test.describe("CT: ControlBar", () => {
  test("renders without crash", async ({ mount }) => {
    const component = await mount(<ControlBarProbe />);
    await expect(component).toBeVisible();
  });
});

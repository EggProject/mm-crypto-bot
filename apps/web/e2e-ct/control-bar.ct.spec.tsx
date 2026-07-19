import { test, expect } from "./_helpers/coverage.js";
import { ControlBarProbe } from "./__stories__/control-bar.stories.js";

test.describe("CT: ControlBar", () => {
  test("renders without crash", async ({ mount }) => {
    const component = await mount(<ControlBarProbe />);
    await expect(component).toBeVisible();
  });
});

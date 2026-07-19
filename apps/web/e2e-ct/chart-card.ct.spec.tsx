import { test, expect } from "./_helpers/coverage.js";
import {
  ChartCardProbe,
  ChartCardCrashed,
  ChartCardNotLive,
} from "./__stories__/chart-card.stories.js";

test.describe("CT: ChartCard", () => {
  test("renders with empty bars (live state)", async ({ mount }) => {
    const component = await mount(<ChartCardProbe />);
    await expect(component).toBeVisible();
  });

  test("renders with crashed state", async ({ mount }) => {
    const component = await mount(<ChartCardCrashed />);
    await expect(component).toBeVisible();
  });

  test("renders with not-live state", async ({ mount }) => {
    const component = await mount(<ChartCardNotLive />);
    await expect(component).toBeVisible();
  });
});

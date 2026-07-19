import { test, expect } from "@playwright/experimental-ct-react";
import {
  ChartCardProbe,
  ChartCardCrashed,
  ChartCardNotLive,
} from "./__stories__/chart-card.stories.js";
import { installCtCoverageHooks } from "./_helpers/coverage.js";

installCtCoverageHooks("chart-card");

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

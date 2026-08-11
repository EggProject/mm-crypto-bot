import { expect, test } from "@playwright/test";

test("Playwright-owned preview serves the built dashboard", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expect(page.locator("#root")).toBeAttached();
});

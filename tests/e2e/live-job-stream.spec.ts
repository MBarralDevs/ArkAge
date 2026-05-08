import { test, expect } from "@playwright/test";

test("home live ticker renders connection indicator", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);
    await expect(
        page
            .locator(
                "[aria-label='connected'], [aria-label='disconnected']",
            )
            .first(),
    ).toBeVisible();
});

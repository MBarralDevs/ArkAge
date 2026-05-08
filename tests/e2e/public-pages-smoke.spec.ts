import { test, expect } from "@playwright/test";

const PAGES = [
    "/",
    "/jobs",
    "/agents",
    "/reputation",
    "/x402",
    "/x402/sellers",
    "/security",
];

for (const path of PAGES) {
    test(`renders ${path} without console errors`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (err) => errors.push(err.message));
        page.on("console", (msg) => {
            if (msg.type() === "error") errors.push(msg.text());
        });

        await page.goto(path);
        await expect(page.locator("body")).toBeVisible();
        expect(errors, `console errors on ${path}`).toEqual([]);
    });
}

test("home shows protocol pulse cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Active jobs/i)).toBeVisible();
});

test("job detail shows lifecycle strip when job exists", async ({ page }) => {
    await page.goto("/jobs");
    const link = page.locator("a[href^='/jobs/']").first();
    if ((await link.count()) === 0) test.skip(true, "no jobs to inspect");
    await link.click();
    await expect(
        page.getByText(/created|funded|submitted/i).first(),
    ).toBeVisible();
});

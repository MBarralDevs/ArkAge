import { test, expect } from "@playwright/test";

test("sign-in page renders + redirects unauth to sign-in", async ({
    page,
}) => {
    await page.goto("/console");
    await expect(page).toHaveURL(/\/console\/sign-in$/);
    await expect(
        page.getByLabel(/Builder wallet address/i),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: /sign in with passkey/i }),
    ).toBeVisible();
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "tests/e2e",
    timeout: 30_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    use: {
        baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
        trace: "retain-on-failure",
    },
    projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

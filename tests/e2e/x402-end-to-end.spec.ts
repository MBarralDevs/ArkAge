import { test, expect } from "@playwright/test";

test.skip(
    !process.env.E2E_X402_LIVE,
    "set E2E_X402_LIVE=1 to run live x402 against testnet",
);

const ARKAGE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Live x402 end-to-end against Arc Testnet.
 *
 * Skipped by default to keep CI fast and Circle Gateway costs out
 * of normal runs. Opt in by setting E2E_X402_LIVE=1 plus the env
 * vars documented in `docs/runbooks/x402-seller-onboarding.md`.
 *
 * Flow:
 *   1. Buyer agent calls `arkage:pay_and_call` against the registered
 *      seller endpoint (the buyer's Tier 2 EOA must already be
 *      Gateway-funded — `bootstrap_user` does this with a non-zero
 *      `ARKAGE_DEFAULT_GATEWAY_DEPOSIT_USDC`).
 *   2. Seller queries `arkage:list_my_x402_receipts` and asserts the
 *      receipt landed.
 *   3. Public `/x402/sessions/<id>` page renders with the new session.
 */
test("buyer agent calls a registered seller endpoint and a receipt appears", async ({
    request,
}) => {
    const payRes = await request.post(`${ARKAGE}/api/mcp`, {
        headers: {
            Authorization: `Bearer ${process.env.E2E_BUYER_MCP_TOKEN}`,
            "Content-Type": "application/json",
        },
        data: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
                name: "arkage:pay_and_call",
                arguments: {
                    asAgent: process.env.E2E_BUYER_AGENT_ID,
                    url: process.env.E2E_SELLER_URL,
                    maxPrice: "10000",
                    idempotencyKey: `e2e-${Date.now()}`,
                },
            },
        },
    });
    expect(payRes.ok()).toBe(true);
    const payJson = await payRes.json();
    const inner = JSON.parse(payJson.result.content[0].text);
    expect(inner.ok).toBe(true);
    const sessionId = inner.data.sessionId;

    const receiptsRes = await request.post(`${ARKAGE}/api/mcp`, {
        headers: {
            Authorization: `Bearer ${process.env.E2E_SELLER_MCP_TOKEN}`,
            "Content-Type": "application/json",
        },
        data: {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
                name: "arkage:list_my_x402_receipts",
                arguments: {
                    asAgent: process.env.E2E_SELLER_AGENT_ID,
                    role: "seller",
                    limit: 5,
                },
            },
        },
    });
    const recJson = await receiptsRes.json();
    const recInner = JSON.parse(recJson.result.content[0].text);
    expect(recInner.ok).toBe(true);
    expect(recInner.data.receipts.length).toBeGreaterThan(0);

    const page = await request.get(
        `${ARKAGE}/x402/sessions/${sessionId}`,
    );
    expect(page.ok()).toBe(true);
    const html = await page.text();
    expect(html).toContain(`Session #${sessionId}`);
});

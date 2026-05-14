/**
 * Quick survey for the upcoming end-to-end smoke. Prints which agents
 * exist, who they're operated by, what their custody is, whether they're
 * anchored on-chain, and which of them have env-staged signing keys.
 *
 * Never prints actual private keys — just whether they're present.
 */

import { db } from "../src/lib/db";

async function main() {
    const builders = await db.builder.findMany();
    console.log(`\n=== BUILDERS (${builders.length}) ===`);
    for (const b of builders) {
        const addr = "0x" + Buffer.from(b.primaryWallet).toString("hex");
        console.log(
            `  id=${b.id}  ${addr}  ${b.displayName ?? "(no name)"}`,
        );
    }

    const agents = await db.agent.findMany({
        include: { currentOperatorWallet: true },
        orderBy: { id: "asc" },
    });
    console.log(`\n=== AGENTS (${agents.length}) ===`);
    for (const a of agents) {
        const opAddr =
            "0x" +
            Buffer.from(a.currentOperatorWallet.address).toString("hex");
        const tier2KeyPresent =
            process.env[`ARKAGE_TIER2_KEY_${a.currentOperatorWallet.id}`] !==
            undefined;
        console.log(
            `  dbId=${a.id}  agentId=${a.agentId}  custody=${a.currentOperatorWallet.custody}  ` +
                `active=${a.active}  anchored=${a.chainAgentId !== null ? `#${a.chainAgentId}` : "no"}  ` +
                `op=${opAddr}  ` +
                `signing_key=${tier2KeyPresent ? "yes" : "no"}`,
        );
    }

    const endpoints = await db.x402Endpoint.findMany({
        include: { sellerAgent: true },
    });
    console.log(`\n=== X402 ENDPOINTS (${endpoints.length}) ===`);
    for (const e of endpoints) {
        console.log(
            `  id=${e.id}  active=${e.active}  hosting=${e.hosting}  ` +
                `price=${e.pricePerCall.toString()}  seller_agent=${e.sellerAgent.id}  url=${e.effectiveUrl}`,
        );
    }

    const wallets = await db.wallet.findMany({
        where: { tier: 2 },
        orderBy: { id: "asc" },
    });
    console.log(`\n=== TIER 2 WALLETS (${wallets.length}) ===`);
    for (const w of wallets) {
        const addr = "0x" + Buffer.from(w.address).toString("hex");
        const keyPresent =
            process.env[`ARKAGE_TIER2_KEY_${w.id}`] !== undefined;
        console.log(
            `  id=${w.id}  ${addr}  custody=${w.custody}  account=${w.accountType}  ` +
                `signing_key=${keyPresent ? "yes" : "no"}  ` +
                `builder=${w.builderId}`,
        );
    }

    const tier1KeyAddrs = Object.keys(process.env)
        .filter((k) => k.startsWith("ARKAGE_TIER1_KEY_"))
        .map((k) => k.replace("ARKAGE_TIER1_KEY_", ""));
    if (tier1KeyAddrs.length > 0) {
        console.log(`\n=== TIER 1 KEYS staged ===`);
        for (const a of tier1KeyAddrs) console.log(`  ${a}`);
    }

    await db.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

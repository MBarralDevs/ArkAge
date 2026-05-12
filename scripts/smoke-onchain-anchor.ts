/**
 * Plan E2 Phase 4 smoke — anchor an existing ArkAge agent on-chain.
 *
 * Drives the three MCP handlers end-to-end against the live Arc Testnet
 * deployment:
 *   1. arkage:register_agent_onchain      → encodes Tx 1 envelope
 *   2. [smoke broadcasts Tx 1 with the staged Tier 1 key]
 *   3. arkage:complete_onchain_registration → parses token id, encodes Tx 2
 *   4. [smoke broadcasts Tx 2]
 *   5. arkage:finalize_onchain_registration → stamps onChainRegisteredAt
 *
 * Usage:
 *   ARKAGE_TIER1_KEY_<lowercase-addr>=0x... \
 *     npm run smoke:onchain-anchor -- 0xBuilderTier1Wallet <agentDbId>
 *
 * Idempotent: re-running for an already-anchored agent short-circuits
 * with the existing chainAgentId. Re-running mid-flow picks up wherever
 * the previous run left off (e.g. if Tx 1 already landed but Tx 2 hadn't
 * been signed).
 *
 * **Private key handling**: the script reads from an env var matching
 * the lowercased builder address, e.g.
 *   ARKAGE_TIER1_KEY_0x172b7952b0f711b8b372410e81d51dcba7d4bb02
 * It never writes the key anywhere and never echoes it to stdout. Same
 * pattern as `smoke-register-external-tier2.ts`.
 *
 * Output: prints both tx hashes, the freshly-minted chain agent id, and
 * Arcscan links so you can verify on the explorer.
 */

import { db } from "../src/lib/db";
import {
    createWalletClient,
    http,
    type Address,
    type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, publicClient } from "../src/lib/chain";
import { handleRegisterAgentOnchain } from "../src/mcp/tools/identity/register-agent-onchain";
import { handleCompleteOnchainRegistration } from "../src/mcp/tools/identity/complete-onchain-registration";
import { handleFinalizeOnchainRegistration } from "../src/mcp/tools/identity/finalize-onchain-registration";
import type { McpAuthContext } from "../src/mcp/auth";

const RECEIPT_POLL_INTERVAL_MS = 4_000;
const RECEIPT_POLL_TIMEOUT_MS = 120_000;

async function main() {
    const builderArg = process.argv[2];
    const agentDbIdArg = process.argv[3];

    if (
        !builderArg ||
        !agentDbIdArg ||
        !/^0x[a-fA-F0-9]{40}$/.test(builderArg) ||
        !/^[0-9]+$/.test(agentDbIdArg)
    ) {
        console.error(
            "Usage: npm run smoke:onchain-anchor -- 0xBuilderTier1Wallet <agentDbId>",
        );
        process.exit(1);
    }

    const builderWallet = builderArg.toLowerCase() as Address;
    const agentDbId = BigInt(agentDbIdArg);
    const builderBytes = Buffer.from(builderWallet.slice(2), "hex");

    const builder = await db.builder.findUnique({
        where: { primaryWallet: builderBytes },
    });
    if (!builder) {
        console.error(`No builder row for ${builderWallet}.`);
        process.exit(1);
    }

    const agent = await db.agent.findUnique({
        where: { id: agentDbId },
        include: { currentOperatorWallet: true },
    });
    if (!agent) {
        console.error(`No agent row with dbId=${agentDbId}.`);
        process.exit(1);
    }
    if (agent.currentOperatorWallet.builderId !== builder.id) {
        console.error(
            `Agent ${agentDbId} is owned by a different builder (id=${agent.currentOperatorWallet.builderId}, expected ${builder.id}).`,
        );
        process.exit(1);
    }

    const envKeyName = `ARKAGE_TIER1_KEY_${builderWallet}`;
    const tier1Key = process.env[envKeyName] as `0x${string}` | undefined;
    if (!tier1Key) {
        console.error(
            `Missing env var ${envKeyName}. Stage your Tier 1 private key as:\n  export ${envKeyName}=0x...`,
        );
        process.exit(1);
    }

    const account = privateKeyToAccount(tier1Key);
    if (account.address.toLowerCase() !== builderWallet) {
        console.error(
            `Staged key derives to ${account.address}, not ${builderWallet}. Aborting.`,
        );
        process.exit(1);
    }

    const walletClient = createWalletClient({
        account,
        chain: arcTestnet,
        transport: http(),
    });

    const ctx: McpAuthContext = {
        token: "smoke",
        builderId: builder.id,
        actingAgentId: agent.id,
        actingWalletAddress: builderWallet,
    };

    console.log(`Builder: ${builderWallet}`);
    console.log(`Agent dbId: ${agentDbId}`);
    console.log(`Tier 1 derived address: ${account.address}\n`);

    if (agent.chainAgentId !== null && agent.onChainRegisteredAt !== null) {
        console.log(
            `Already on-chain anchored at chain id ${agent.chainAgentId}. Nothing to do.`,
        );
        console.log(arcscanLink(agent.identityRegisterTxHash, "Identity tx"));
        console.log(arcscanLink(agent.agentRegistryTxHash, "AgentRegistry tx"));
        return;
    }

    // ------------------------------------------------------------------
    // Tx 1 — IdentityRegistry.register
    // ------------------------------------------------------------------
    let identityTxHash: Hex;
    if (agent.identityRegisterTxHash !== null) {
        identityTxHash = `0x${Buffer.from(agent.identityRegisterTxHash).toString("hex")}` as Hex;
        console.log(
            `[1/3] Tx 1 already broadcast (${identityTxHash}); skipping mint.`,
        );
    } else {
        console.log(`[1/3] Encoding Tx 1 (IdentityRegistry.register)...`);
        const registerResult = await handleRegisterAgentOnchain(
            {
                agentDbId: agentDbIdArg,
                idempotencyKey: `smoke-onchain-anchor-${agentDbIdArg}-tx1`,
            },
            ctx,
        );
        if (!registerResult.ok) {
            console.error(
                `register_agent_onchain failed: ${registerResult.code} — ${registerResult.message}`,
            );
            process.exit(1);
        }
        const tx1 = registerResult.data.pendingActions[0]!.unsignedTx;
        console.log(`      target: ${tx1.to}`);
        console.log(`      calldata: ${tx1.data.slice(0, 50)}...`);
        console.log(`      metadataURI: ${registerResult.data.metadataURI}\n`);

        console.log(`      Broadcasting Tx 1...`);
        identityTxHash = await broadcastWithBuffer(walletClient, {
            to: tx1.to,
            data: tx1.data,
            value: BigInt(tx1.value),
        });
        console.log(`      Tx 1 hash: ${identityTxHash}`);
        console.log(`      ${arcscanLink(identityTxHash, "")}\n`);
    }

    console.log(`      Waiting for Tx 1 receipt...`);
    await waitForReceipt(identityTxHash);

    // ------------------------------------------------------------------
    // Tx 2 — AgentRegistry.registerAgent
    // ------------------------------------------------------------------
    console.log(`\n[2/3] Resolving minted token id + encoding Tx 2...`);
    const completeResult = await handleCompleteOnchainRegistration(
        {
            agentDbId: agentDbIdArg,
            identityRegisterTxHash: identityTxHash,
            idempotencyKey: `smoke-onchain-anchor-${agentDbIdArg}-tx2`,
        },
        ctx,
    );
    if (!completeResult.ok) {
        console.error(
            `complete_onchain_registration failed: ${completeResult.code} — ${completeResult.message}`,
        );
        process.exit(1);
    }
    if (completeResult.data.state !== "awaiting_tx2") {
        console.error(
            `Expected state=awaiting_tx2, got ${completeResult.data.state}.`,
        );
        if ("reason" in completeResult.data) {
            console.error(`Reason: ${completeResult.data.reason}`);
        }
        process.exit(1);
    }
    const chainAgentId = completeResult.data.chainAgentId;
    console.log(`      Chain agent id: ${chainAgentId}`);

    let agentRegistryTxHash: Hex;
    const agentRow = await db.agent.findUniqueOrThrow({
        where: { id: agentDbId },
    });
    if (agentRow.agentRegistryTxHash !== null) {
        agentRegistryTxHash =
            `0x${Buffer.from(agentRow.agentRegistryTxHash).toString("hex")}` as Hex;
        console.log(
            `      Tx 2 already broadcast (${agentRegistryTxHash}); skipping registerAgent.`,
        );
    } else {
        const tx2 = completeResult.data.pendingActions[0]!.unsignedTx;
        console.log(`      target: ${tx2.to}`);
        console.log(`      calldata: ${tx2.data.slice(0, 50)}...\n`);

        console.log(`      Broadcasting Tx 2...`);
        agentRegistryTxHash = await broadcastWithBuffer(walletClient, {
            to: tx2.to,
            data: tx2.data,
            value: BigInt(tx2.value),
        });
        console.log(`      Tx 2 hash: ${agentRegistryTxHash}`);
        console.log(`      ${arcscanLink(agentRegistryTxHash, "")}\n`);
    }

    console.log(`      Waiting for Tx 2 receipt...`);
    await waitForReceipt(agentRegistryTxHash);

    // ------------------------------------------------------------------
    // Finalize
    // ------------------------------------------------------------------
    console.log(`\n[3/3] Finalizing on-chain anchoring...`);
    const finalizeResult = await handleFinalizeOnchainRegistration(
        {
            agentDbId: agentDbIdArg,
            agentRegistryTxHash,
            idempotencyKey: `smoke-onchain-anchor-${agentDbIdArg}-finalize`,
        },
        ctx,
    );
    if (!finalizeResult.ok) {
        console.error(
            `finalize_onchain_registration failed: ${finalizeResult.code} — ${finalizeResult.message}`,
        );
        process.exit(1);
    }
    if (finalizeResult.data.state !== "complete") {
        console.error(
            `Expected state=complete, got ${finalizeResult.data.state}.`,
        );
        process.exit(1);
    }

    console.log(`\nDone. Agent ${agentDbId} is on-chain anchored.\n`);
    console.log(`  - chain agent id: ${chainAgentId}`);
    console.log(`  - identity tx:    ${identityTxHash}`);
    console.log(`  - registry tx:    ${agentRegistryTxHash}`);
    console.log(`  - identity link:  ${arcscanLink(identityTxHash, "")}`);
    console.log(`  - registry link:  ${arcscanLink(agentRegistryTxHash, "")}`);
}

function arcscanLink(
    hash: Hex | Uint8Array | null,
    label: string,
): string {
    if (!hash) return `${label} (not recorded)`;
    const h =
        typeof hash === "string"
            ? hash
            : `0x${Buffer.from(hash).toString("hex")}`;
    return `${label ? label + ": " : ""}https://testnet.arcscan.app/tx/${h}`;
}

/**
 * Send a transaction with explicit EIP-1559 gas params bumped 50% over the
 * chain's current `eth_gasPrice`. viem's auto-pricing can underprice txs
 * on Arc's fast-block (sub-second) cadence and they get evicted from the
 * mempool before mining. Explicit prices avoid the silent drop.
 */
async function broadcastWithBuffer(
    client: ReturnType<typeof createWalletClient>,
    args: { to: Address; data: Hex; value: bigint },
): Promise<Hex> {
    const baseGasPrice = await publicClient.getGasPrice();
    const bumped = (baseGasPrice * 150n) / 100n;
    // EIP-1559 split: most of the bumped price goes to priority (tip) so
    // validators are motivated to include immediately, baseFee tracks the
    // chain. For Arc Testnet's lightly-loaded mempool this is overkill but
    // cheap (USDC-as-gas with sub-cent total fees).
    const maxPriorityFeePerGas = bumped / 2n;
    const maxFeePerGas = bumped;
    // viem expects exact account/chain; pass them via the client.
    return client.sendTransaction({
        to: args.to,
        data: args.data,
        value: args.value,
        maxFeePerGas,
        maxPriorityFeePerGas,
    } as Parameters<typeof client.sendTransaction>[0]);
}

async function waitForReceipt(hash: Hex): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < RECEIPT_POLL_TIMEOUT_MS) {
        try {
            const receipt = await publicClient.getTransactionReceipt({ hash });
            if (receipt.status !== "success") {
                console.error(`Tx ${hash} reverted (status=${receipt.status})`);
                process.exit(1);
            }
            return;
        } catch {
            await new Promise((r) => setTimeout(r, RECEIPT_POLL_INTERVAL_MS));
        }
    }
    console.error(
        `Timed out waiting for receipt of ${hash} after ${RECEIPT_POLL_TIMEOUT_MS / 1000}s.`,
    );
    process.exit(1);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });

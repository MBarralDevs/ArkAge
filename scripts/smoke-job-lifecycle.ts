/**
 * End-to-end ArkAge job-lifecycle smoke.
 *
 * Buyer/client: agent 14 (wallet 69, external-eoa). Signs ERC-8183 calls
 *   with `ARKAGE_TIER2_KEY_69` via the new tier2-external-eoa path.
 * Provider:    agent 18 (wallet 68, circle-dcw-eoa). Signs via Circle DCW.
 * Evaluator:   ArkAge built-in (ARKAGE_VALIDATOR_WALLET_ADDRESS).
 *
 * The script invokes the MCP handlers directly (skipping the HTTP MCP
 * transport) so failures surface as native exceptions instead of MCP
 * envelopes. Each tool's deterministic on-chain effect is asserted by
 * reading state back from Postgres (populated by Goldsky/webhook) plus
 * confirming the tx hash with viem.
 *
 * Preflight bails out early if:
 *   - ARKAGE_TIER2_KEY_69 isn't staged in env
 *   - Wallet 69 has < (budget + fee + gas-buffer) USDC
 *   - Wallet 69 hasn't approved USDC to the ERC-8183 contract
 */

import {
    createPublicClient,
    createWalletClient,
    encodeFunctionData,
    formatUnits,
    http,
    keccak256,
    parseAbi,
    toBytes,
    type Address,
    type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { db } from "../src/lib/db";
import { arcTestnet } from "../src/lib/chain";
import { env } from "../src/lib/env";
import {
    ARC_TESTNET_ADDRESSES,
    ARKAGE_ADDRESSES,
} from "../src/lib/addresses";
import { handlePostJob } from "../src/mcp/tools/jobs/post-job";
import { handleAcceptJob } from "../src/mcp/tools/jobs/accept-job";
import { handleSetBudget } from "../src/mcp/tools/jobs/set-budget";
import { handleFundJob } from "../src/mcp/tools/jobs/fund-job";
import { handleSubmitWork } from "../src/mcp/tools/jobs/submit-work";
import type { McpAuthContext } from "../src/mcp/auth";

const CLIENT_AGENT_DBID = "14";
const PROVIDER_AGENT_DBID = "18";

const BUDGET_RAW = "500000"; // 0.50 USDC (6 decimals)
const EVALUATOR_TIER = "standard" as const;

const USDC_ABI = parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
]);

// handlePostJob takes a ctx for parity with the MCP transport but never reads
// it (signed by `_ctx`). The other job handlers don't take ctx at all.
const NULL_AUTH = {} as unknown as McpAuthContext;

function header(label: string): void {
    console.log("");
    console.log("==== " + label + " ".repeat(Math.max(0, 60 - label.length)));
}

async function preflight(): Promise<{
    clientAddress: Address;
    clientPk: Hex;
}> {
    header("PREFLIGHT");

    const pk = process.env.ARKAGE_TIER2_KEY_69 as Hex | undefined;
    if (!pk) {
        throw new Error(
            "ARKAGE_TIER2_KEY_69 not staged. Add it to .env.local:\n" +
                "  ARKAGE_TIER2_KEY_69=0x<64-hex private key for 0x172b…bb02>",
        );
    }
    const account = privateKeyToAccount(pk);
    if (
        account.address.toLowerCase() !==
        "0x172b7952b0f711b8b372410e81d51dcba7d4bb02"
    ) {
        throw new Error(
            `Staged key derives 0x${account.address.slice(2)}, expected 0x172b…bb02`,
        );
    }
    console.log("  signer derived:", account.address);

    const pub = createPublicClient({
        chain: arcTestnet,
        transport: http(env.ARC_TESTNET_RPC_HTTP),
    });

    const usdc = ARC_TESTNET_ADDRESSES.USDC;
    const erc8183 = ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE;

    const [balance, allowance, nativeBal] = await Promise.all([
        pub.readContract({
            address: usdc,
            abi: USDC_ABI,
            functionName: "balanceOf",
            args: [account.address],
        }),
        pub.readContract({
            address: usdc,
            abi: USDC_ABI,
            functionName: "allowance",
            args: [account.address, erc8183],
        }),
        pub.getBalance({ address: account.address }),
    ]);
    console.log(
        "  USDC balance (6dec) :",
        formatUnits(balance, 6),
        "USDC",
    );
    console.log(
        "  USDC allowance→8183 :",
        formatUnits(allowance, 6),
        "USDC",
    );
    console.log(
        "  native gas balance  :",
        formatUnits(nativeBal, 18),
        "USDC",
    );

    const budget = BigInt(BUDGET_RAW);
    const feeMax = budget / 50n; // 2% standard tier
    const need = budget + feeMax;
    if (balance < need) {
        throw new Error(
            `wallet has ${balance} but needs ≥ ${need} USDC (budget + fee). Top up from https://faucet.circle.com`,
        );
    }

    if (allowance < need) {
        console.log(
            `  → approving max USDC to ERC-8183 (current allowance ${allowance} < need ${need})`,
        );
        const wallet = createWalletClient({
            account,
            chain: arcTestnet,
            transport: http(env.ARC_TESTNET_RPC_HTTP),
        });
        const approveData = encodeFunctionData({
            abi: USDC_ABI,
            functionName: "approve",
            args: [erc8183, 2n ** 256n - 1n],
        });
        const approveHash = await wallet.sendTransaction({
            to: usdc,
            data: approveData,
        });
        console.log("    approve tx:", approveHash);
        const receipt = await pub.waitForTransactionReceipt({
            hash: approveHash,
        });
        if (receipt.status !== "success")
            throw new Error("USDC approve reverted");
        console.log("    approve confirmed in block", receipt.blockNumber);
    } else {
        console.log("  ✓ allowance is sufficient");
    }

    return { clientAddress: account.address, clientPk: pk };
}

async function getProviderAddress(): Promise<Address> {
    const a = await db.agent.findUniqueOrThrow({
        where: { id: BigInt(PROVIDER_AGENT_DBID) },
        include: { currentOperatorWallet: true },
    });
    return ("0x" +
        Buffer.from(a.currentOperatorWallet.address).toString(
            "hex",
        )) as Address;
}

async function waitForOnchainJobId(
    txHash: Hex,
): Promise<{ jobId: bigint; blockNumber: bigint }> {
    const pub = createPublicClient({
        chain: arcTestnet,
        transport: http(env.ARC_TESTNET_RPC_HTTP),
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success")
        throw new Error(`tx ${txHash} reverted`);

    // ERC-8183 canonical event on Arc Testnet (verified against a live
    // log on 2026-05-14): client + provider are both indexed; description
    // is NOT in the event.
    // event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook);
    const jobCreatedTopic = keccak256(
        toBytes(
            "JobCreated(uint256,address,address,address,uint256,address)",
        ),
    );
    const log = receipt.logs.find(
        (l) =>
            l.address.toLowerCase() ===
                ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE.toLowerCase() &&
            l.topics[0] === jobCreatedTopic,
    );
    if (!log || !log.topics[1])
        throw new Error(
            `JobCreated event not found in tx ${txHash} (looked for topic ${jobCreatedTopic})`,
        );
    const jobId = BigInt(log.topics[1]);
    return { jobId, blockNumber: receipt.blockNumber };
}

async function waitForCircleTxHash(
    transactionId: string,
    label: string,
): Promise<Hex> {
    const { waitForTxHash } = await import("../src/lib/tier2-dcw");
    console.log(`  ${label} circle tx id: ${transactionId} — polling for hash`);
    const hash = await waitForTxHash(transactionId, { timeoutMs: 120_000 });
    console.log(`  ${label} confirmed:`, hash);
    return hash;
}

async function main() {
    const { clientAddress } = await preflight();
    const providerAddress = await getProviderAddress();
    const evaluator = env.ARKAGE_VALIDATOR_WALLET_ADDRESS as Address;
    if (!evaluator)
        throw new Error("ARKAGE_VALIDATOR_WALLET_ADDRESS not set");

    // ArkAge HookComposer (0xd1F9…59b) is deployed but NOT yet on the
    // ERC-8183 hook whitelist (Circle controls `setHookWhitelist`, gated
    // by OZ AccessControl). Until Circle adds us, the smoke uses
    // hook=address(0) to bypass the chain. We still record evaluator fees
    // atomically via Multicall3 in fund_job, so the activity surfaces in
    // the dashboard — but ReputationHook's ERC-8004 reason-field thread
    // is dark until the whitelist lands.
    const ZERO_HOOK = "0x0000000000000000000000000000000000000000" as Address;
    const hook = ZERO_HOOK;

    console.log("");
    console.log("  client agent dbId   :", CLIENT_AGENT_DBID);
    console.log("  client wallet       :", clientAddress);
    console.log("  provider agent dbId :", PROVIDER_AGENT_DBID);
    console.log("  provider wallet     :", providerAddress);
    console.log("  evaluator           :", evaluator);
    console.log("  hook                :", hook, "(bypassing HookComposer — not whitelisted yet)");

    const runStamp = Math.floor(Date.now() / 1000);

    // ─────────────────────────────────────────────────────────────
    header("STEP 1 — client posts job");
    const expiresIn = 60 * 30; // 30min
    const postRes = await handlePostJob(
        {
            asAgent: CLIENT_AGENT_DBID,
            provider: providerAddress,
            evaluator,
            expiredAtSec: runStamp + expiresIn,
            description: `Smoke job @ ${new Date(runStamp * 1000).toISOString()} — write a one-paragraph haiku about Arc Testnet`,
            hook,
            idempotencyKey: `smoke-post-${runStamp}`,
        },
        NULL_AUTH,
    );
    if (!postRes.ok)
        throw new Error(
            `post_job failed: ${postRes.code} — ${postRes.message}`,
        );
    console.log("  tx (external-eoa direct):", postRes.data.createTransactionId);
    const postTxHash = postRes.data.createTransactionId as Hex;
    const { jobId, blockNumber } = await waitForOnchainJobId(postTxHash);
    console.log("  JobCreated → jobId =", jobId.toString(), "block", blockNumber);

    // ─────────────────────────────────────────────────────────────
    header("STEP 2 — provider acknowledges (off-chain) + sets budget");
    const ackRes = await handleAcceptJob({
        asAgent: PROVIDER_AGENT_DBID,
        jobId: jobId.toString(),
        idempotencyKey: `smoke-ack-${jobId}-${runStamp}`,
    });
    if (!ackRes.ok)
        throw new Error(`accept_job failed: ${ackRes.code} — ${ackRes.message}`);
    console.log("  ack:", ackRes.data);

    const setBudgetRes = await handleSetBudget({
        asAgent: PROVIDER_AGENT_DBID,
        jobId: jobId.toString(),
        amount: BUDGET_RAW,
        idempotencyKey: `smoke-budget-${jobId}-${runStamp}`,
    });
    if (!setBudgetRes.ok)
        throw new Error(
            `set_budget failed: ${setBudgetRes.code} — ${setBudgetRes.message}`,
        );
    await waitForCircleTxHash(
        setBudgetRes.data.transactionId,
        "setBudget",
    );

    // ─────────────────────────────────────────────────────────────
    header("STEP 3 — client funds job");
    const fundRes = await handleFundJob({
        asAgent: CLIENT_AGENT_DBID,
        jobId: jobId.toString(),
        budget: BUDGET_RAW,
        evaluatorTier: EVALUATOR_TIER,
        idempotencyKey: `smoke-fund-${jobId}-${runStamp}`,
    });
    if (!fundRes.ok)
        throw new Error(`fund_job failed: ${fundRes.code} — ${fundRes.message}`);
    console.log("  fund tx:", fundRes.data.transactionId, "fee:", fundRes.data.fee);

    // The external-EOA path broadcasts and returns immediately; Circle DCW
    // simulates submit() against its own RPC and races us. Wait for the
    // fund receipt to be visible network-wide before proceeding.
    {
        const pub = createPublicClient({
            chain: arcTestnet,
            transport: http(env.ARC_TESTNET_RPC_HTTP),
        });
        const r = await pub.waitForTransactionReceipt({
            hash: fundRes.data.transactionId as Hex,
        });
        if (r.status !== "success")
            throw new Error(`fund tx ${fundRes.data.transactionId} reverted`);
        console.log("  fund confirmed in block", r.blockNumber);
    }

    // ─────────────────────────────────────────────────────────────
    header("STEP 4 — provider submits work");
    // A genuine on-topic haiku — submit_work hosts this content and
    // commits its hash, so the evaluator fetches the real deliverable
    // (not a parking page) and can judge it on merit.
    const deliverable =
        `Stablecoin daylight —\n` +
        `Arc seals each block in a breath,\n` +
        `gas paid in dollars.\n\n` +
        `— deliverable for ArkAge job #${jobId}`;
    const submitRes = await handleSubmitWork({
        asAgent: PROVIDER_AGENT_DBID,
        jobId: jobId.toString(),
        deliverable,
        idempotencyKey: `smoke-submit-${jobId}-${runStamp}`,
    });
    if (!submitRes.ok)
        throw new Error(
            `submit_work failed: ${submitRes.code} — ${submitRes.message}`,
        );
    console.log(
        "  deliverable hosted:",
        submitRes.data.deliverableUri,
        "\n  hash:",
        submitRes.data.deliverableHash,
    );
    await waitForCircleTxHash(submitRes.data.transactionId, "submit");

    // ─────────────────────────────────────────────────────────────
    header("STEP 5 — observe evaluator workflow + completion");
    console.log(
        "  jobLifecycle + llmEvaluatorAgent workflows fire on the deployed " +
            "Vercel project via the Goldsky → /api/webhooks/circle pipeline. " +
            "Poll DB for the Job row reaching status=completed (or rejected)…",
    );
    const deadline = Date.now() + 240_000; // 4min ceiling
    let finalStatus = "unknown";
    while (Date.now() < deadline) {
        const job = await db.job.findUnique({
            where: { jobId: jobId.toString() },
        });
        if (job && job.status && job.status !== "open" && job.status !== "submitted") {
            finalStatus = job.status;
            break;
        }
        const dot = job?.status ?? "(no row yet)";
        process.stdout.write(`  …status=${dot}\r`);
        await new Promise((r) => setTimeout(r, 4000));
    }
    console.log("");
    console.log("  final status:", finalStatus);

    header("DONE");
    console.log("  jobId:", jobId.toString());
    console.log("  client:", clientAddress);
    console.log("  provider:", providerAddress);
    console.log("");

    await db.$disconnect();
}

main().catch(async (e) => {
    console.error("");
    console.error("✗ smoke aborted:", e instanceof Error ? e.message : e);
    await db.$disconnect().catch(() => {});
    process.exit(1);
});

import type { Address, Hex } from "viem";
import { db } from "./db";
import type { LoadedAgent } from "./agent-loader";
import { signWithTier2 } from "./tier2-dcw";
import { signWithTier2ExternalEoa } from "./tier2-external-eoa";

/**
 * Unified Tier 2 signing facade — dispatches by `agent.tier2Kind`:
 *  - `circle-dcw-eoa` / null → Circle DCW (`signWithTier2`)
 *  - `external-eoa` → raw EOA via env-staged key (`signWithTier2ExternalEoa`)
 *  - `circle-agent-wallet` → returns a structured envelope instructing the
 *    caller to run `circle wallet execute` locally. ArkAge can't sign for
 *    these from a Vercel function because the session lives in the
 *    builder's local `circle` CLI keyring.
 *
 * Returns a discriminated result so handlers can surface the envelope as
 * an `err()` Result without needing to know about each signing backend.
 */
export type Tier2DispatchResult =
    | { ok: true; transactionId: string; state: string }
    | { ok: false; code: string; message: string };

export async function executeTier2Call(args: {
    agent: LoadedAgent;
    to: Address;
    data: Hex;
}): Promise<Tier2DispatchResult> {
    const wallet = await db.wallet.findUniqueOrThrow({
        where: {
            address: Buffer.from(
                args.agent.operatorWallet
                    .toLowerCase()
                    .replace(/^0x/, ""),
                "hex",
            ),
        },
    });

    if (args.agent.tier2Kind === "circle-agent-wallet") {
        return {
            ok: false,
            code: "circle_agent_wallet_run_locally",
            message:
                `This agent is backed by a Circle Agent Wallet. Sign on the host where you ran \`circle wallet login\`: ` +
                `circle wallet execute --address ${args.agent.operatorWallet} --chain ARC-TESTNET --to ${args.to} --data ${args.data}`,
        };
    }

    if (args.agent.tier2Kind === "external-eoa") {
        const queued = await signWithTier2ExternalEoa({
            walletDbId: wallet.id,
            to: args.to,
            data: args.data,
        });
        return {
            ok: true,
            transactionId: queued.transactionId,
            state: queued.state,
        };
    }

    if (!wallet.circleWalletId) {
        return {
            ok: false,
            code: "config_error",
            message: "Tier 2 wallet missing circleWalletId",
        };
    }
    const queued = await signWithTier2(
        wallet.circleWalletId,
        args.to,
        args.data,
    );
    return {
        ok: true,
        transactionId: queued.transactionId,
        state: queued.state,
    };
}

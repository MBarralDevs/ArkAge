import type { Address } from "viem";
import { publicClient } from "./chain";
import { ARC_TESTNET_ADDRESSES } from "./addresses";
import { ERC8004_IDENTITY_ABI } from "./abis";

/**
 * Read the current owner of an ERC-8004 identity NFT.
 *
 * Used to verify that a builder controls the agent identity they claim.
 * Reverts if the agentId has not been minted.
 */
export async function ownerOfAgent(agentId: bigint): Promise<Address> {
    return publicClient.readContract({
        address: ARC_TESTNET_ADDRESSES.ERC_8004_IDENTITY_REGISTRY,
        abi: ERC8004_IDENTITY_ABI,
        functionName: "ownerOf",
        args: [agentId],
    });
}

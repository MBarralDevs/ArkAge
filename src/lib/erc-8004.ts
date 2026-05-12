import { encodeFunctionData, type Address, type Hex, type Log } from "viem";
import { identityRegistryAbi, agentRegistryAbi } from "./abis/erc-8004";

/**
 * Plan E2 helpers for on-chain anchoring (ERC-8004 IdentityRegistry +
 * ArkAge AgentRegistry).
 *
 * Pure functions — no I/O. RPC calls live in the MCP tool handlers that
 * import these helpers, not here. Keep this module fast and test-friendly.
 */

/** Build the calldata for IdentityRegistry.register(metadataURI). */
export function encodeIdentityRegister(metadataURI: string): Hex {
    return encodeFunctionData({
        abi: identityRegistryAbi,
        functionName: "register",
        args: [metadataURI],
    });
}

/** Build the calldata for ArkAge AgentRegistry.registerAgent(...). */
export function encodeAgentRegistryRegister(params: {
    chainAgentId: bigint;
    operator: Address;
    policyHash: Hex;
    perTxCap: bigint;
    evaluatorFeeMax: bigint;
}): Hex {
    return encodeFunctionData({
        abi: agentRegistryAbi,
        functionName: "registerAgent",
        args: [
            params.chainAgentId,
            params.operator,
            params.policyHash,
            params.perTxCap,
            params.evaluatorFeeMax,
        ],
    });
}

/**
 * Parse the freshly-minted ERC-721 token id from a tx's receipt logs.
 *
 * Looks for the canonical `Transfer(address indexed from, address indexed
 * to, uint256 indexed tokenId)` where `from == 0x0` (mint, not transfer).
 *
 * Returns `null` when:
 *  - no matching log is found (tx didn't mint, or wasn't an IdentityRegistry call)
 *  - the third indexed topic is missing or unparseable
 *
 * Callers should treat `null` as "Tx 1 not landed yet, retry later" rather
 * than "broken" — receipts may briefly lack the log during reorgs.
 *
 * `registryAddress` filters logs by `address` to avoid picking up Transfer
 * events from other ERC-721s in the same block.
 */
export function parseTokenIdFromTransferLogs(
    logs: ReadonlyArray<Pick<Log, "address" | "topics">>,
    registryAddress: Address,
): bigint | null {
    const TRANSFER_TOPIC =
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const ZERO_TOPIC =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
    const registry = registryAddress.toLowerCase();

    for (const log of logs) {
        if (log.address.toLowerCase() !== registry) continue;
        if (log.topics[0] !== TRANSFER_TOPIC) continue;
        if (log.topics[1] !== ZERO_TOPIC) continue;
        const tokenIdTopic = log.topics[3];
        if (!tokenIdTopic) continue;
        try {
            return BigInt(tokenIdTopic);
        } catch {
            return null;
        }
    }
    return null;
}

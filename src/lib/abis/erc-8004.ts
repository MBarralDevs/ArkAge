/**
 * Minimal viem-style ABIs for the on-chain contracts ArkAge interacts with
 * directly (as opposed to via the existing ERC-8183 + hook chain).
 *
 * Kept narrow on purpose — only the functions and events Plan E2 needs.
 * Expand cautiously: every additional entry widens the surface area we
 * commit to type-checking against the upstream deployment.
 */

/**
 * ERC-8004 IdentityRegistry on Arc Testnet (`0x8004A818...4BD9e`).
 *
 * Surface needed by Plan E2:
 *  - `register(string)` — Tx 1 of the on-chain anchoring flow. Mints a
 *    new sequential token id to `msg.sender`. Returns nothing; read the
 *    token id from the Transfer event.
 *  - `ownerOf(uint256)` — used by `arkage:verify_evidence` and post-mint
 *    sanity checks.
 *  - `Transfer` event — emitted on every mint. We parse the third indexed
 *    topic to extract the new token id.
 */
export const identityRegistryAbi = [
    {
        type: "function",
        name: "register",
        stateMutability: "nonpayable",
        inputs: [{ name: "metadataURI", type: "string" }],
        outputs: [],
    },
    {
        type: "function",
        name: "ownerOf",
        stateMutability: "view",
        inputs: [{ name: "tokenId", type: "uint256" }],
        outputs: [{ name: "owner", type: "address" }],
    },
    {
        type: "event",
        name: "Transfer",
        inputs: [
            { name: "from", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
            { name: "tokenId", type: "uint256", indexed: true },
        ],
        anonymous: false,
    },
] as const;

/**
 * ArkAge's AgentRegistry contract. Address is pulled from env at runtime
 * (`ARKAGE_AGENT_REGISTRY_ADDRESS`) — see `src/lib/addresses.ts`.
 *
 * Surface needed by Plan E2:
 *  - `registerAgent` — Tx 2 of the on-chain anchoring flow. Reverts unless
 *    `msg.sender` owns the corresponding IdentityRegistry token (via
 *    `onlyIdentityOwner(agentId)` modifier).
 *  - `agents` — read-after-register sanity check.
 */
export const agentRegistryAbi = [
    {
        type: "function",
        name: "registerAgent",
        stateMutability: "nonpayable",
        inputs: [
            { name: "agentId", type: "uint256" },
            { name: "op", type: "address" },
            { name: "policy", type: "bytes32" },
            { name: "perTx", type: "uint128" },
            { name: "evalFeeMax", type: "uint64" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "agents",
        stateMutability: "view",
        inputs: [{ name: "agentId", type: "uint256" }],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "operatorWallet", type: "address" },
                    { name: "currentPolicyHash", type: "bytes32" },
                    { name: "perTxCap", type: "uint128" },
                    { name: "evaluatorFeeMax", type: "uint64" },
                    { name: "active", type: "bool" },
                ],
            },
        ],
    },
] as const;

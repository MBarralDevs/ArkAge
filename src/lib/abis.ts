/**
 * Contract ABIs for everything ArkAge talks to on Arc Testnet.
 *
 * `as const` is required so viem can derive precise return types from
 * `readContract` / `writeContract`. Don't drop the assertion when adding
 * functions/events — the entire `state.ts` helpers depend on it.
 */

export const ERC20_ABI = [
    {
        type: "function",
        name: "balanceOf",
        inputs: [{ type: "address", name: "owner" }],
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "approve",
        inputs: [
            { type: "address", name: "spender" },
            { type: "uint256", name: "amount" },
        ],
        outputs: [{ type: "bool" }],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "transfer",
        inputs: [
            { type: "address", name: "to" },
            { type: "uint256", name: "amount" },
        ],
        outputs: [{ type: "bool" }],
        stateMutability: "nonpayable",
    },
] as const;

export const ERC8183_ABI = [
    {
        type: "function",
        name: "createJob",
        inputs: [
            { type: "address", name: "provider" },
            { type: "address", name: "evaluator" },
            { type: "uint256", name: "expiredAt" },
            { type: "string", name: "description" },
            { type: "address", name: "hook" },
        ],
        outputs: [{ type: "uint256" }],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "setBudget",
        inputs: [
            { type: "uint256", name: "jobId" },
            { type: "uint256", name: "amount" },
            { type: "bytes", name: "data" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "fund",
        inputs: [
            { type: "uint256", name: "jobId" },
            { type: "bytes", name: "data" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "submit",
        inputs: [
            { type: "uint256", name: "jobId" },
            { type: "bytes32", name: "deliverable" },
            { type: "bytes", name: "data" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "complete",
        inputs: [
            { type: "uint256", name: "jobId" },
            { type: "bytes32", name: "reason" },
            { type: "bytes", name: "data" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "reject",
        inputs: [
            { type: "uint256", name: "jobId" },
            { type: "bytes32", name: "reason" },
            { type: "bytes", name: "data" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "claimRefund",
        inputs: [{ type: "uint256", name: "jobId" }],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "getJob",
        inputs: [{ type: "uint256", name: "jobId" }],
        outputs: [
            {
                type: "tuple",
                components: [
                    { type: "uint256", name: "id" },
                    { type: "address", name: "client" },
                    { type: "address", name: "provider" },
                    { type: "address", name: "evaluator" },
                    { type: "string", name: "description" },
                    { type: "uint256", name: "budget" },
                    { type: "uint256", name: "expiredAt" },
                    { type: "uint8", name: "status" },
                    { type: "address", name: "hook" },
                ],
            },
        ],
        stateMutability: "view",
    },
    {
        type: "event",
        name: "JobCreated",
        inputs: [
            { type: "uint256", name: "jobId", indexed: true },
            { type: "address", name: "client", indexed: true },
            { type: "address", name: "provider", indexed: true },
            { type: "address", name: "evaluator", indexed: false },
            { type: "uint256", name: "expiredAt", indexed: false },
            { type: "address", name: "hook", indexed: false },
        ],
    },
    {
        type: "event",
        name: "JobFunded",
        inputs: [{ type: "uint256", name: "jobId", indexed: true }],
    },
    {
        type: "event",
        name: "JobSubmitted",
        inputs: [
            { type: "uint256", name: "jobId", indexed: true },
            { type: "bytes32", name: "deliverable", indexed: false },
        ],
    },
    {
        type: "event",
        name: "JobCompleted",
        inputs: [
            { type: "uint256", name: "jobId", indexed: true },
            { type: "bytes32", name: "reason", indexed: false },
        ],
    },
    {
        type: "event",
        name: "JobRejected",
        inputs: [
            { type: "uint256", name: "jobId", indexed: true },
            { type: "bytes32", name: "reason", indexed: false },
        ],
    },
] as const;

export const ERC8004_IDENTITY_ABI = [
    {
        type: "function",
        name: "ownerOf",
        inputs: [{ type: "uint256", name: "agentId" }],
        outputs: [{ type: "address" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "register",
        inputs: [{ type: "string", name: "metadataURI" }],
        outputs: [{ type: "uint256" }],
        stateMutability: "nonpayable",
    },
] as const;

export const ERC8004_REPUTATION_ABI = [
    {
        type: "function",
        name: "giveFeedback",
        inputs: [
            { type: "uint256", name: "agentId" },
            { type: "int128", name: "value" },
            { type: "uint8", name: "valueDecimals" },
            { type: "string", name: "tag1" },
            { type: "string", name: "tag2" },
            { type: "string", name: "endpoint" },
            { type: "string", name: "feedbackURI" },
            { type: "bytes32", name: "feedbackHash" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
] as const;

export const AGENT_REGISTRY_ABI = [
    {
        type: "function",
        name: "registerAgent",
        inputs: [
            { type: "uint256", name: "agentId" },
            { type: "address", name: "op" },
            { type: "bytes32", name: "policy" },
            { type: "uint128", name: "perTx" },
            { type: "uint64", name: "evalFeeMax" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "updateOperator",
        inputs: [
            { type: "uint256", name: "agentId" },
            { type: "address", name: "op" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "updatePolicy",
        inputs: [
            { type: "uint256", name: "agentId" },
            { type: "bytes32", name: "policy" },
            { type: "uint128", name: "perTx" },
            { type: "uint64", name: "evalFeeMax" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "deactivate",
        inputs: [{ type: "uint256", name: "agentId" }],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "recordJobFee",
        inputs: [
            { type: "uint256", name: "jobId" },
            { type: "uint256", name: "fee" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "evaluatorFeeFor",
        inputs: [{ type: "uint256", name: "jobId" }],
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "agentByOperator",
        inputs: [{ type: "address", name: "op" }],
        outputs: [
            {
                type: "tuple",
                components: [
                    { type: "address", name: "operatorWallet" },
                    { type: "bytes32", name: "currentPolicyHash" },
                    { type: "uint128", name: "perTxCap" },
                    { type: "uint64", name: "evaluatorFeeMax" },
                    { type: "bool", name: "active" },
                ],
            },
        ],
        stateMutability: "view",
    },
] as const;

export const MULTICALL3_ABI = [
    {
        type: "function",
        name: "aggregate3",
        inputs: [
            {
                type: "tuple[]",
                name: "calls",
                components: [
                    { type: "address", name: "target" },
                    { type: "bool", name: "allowFailure" },
                    { type: "bytes", name: "callData" },
                ],
            },
        ],
        outputs: [
            {
                type: "tuple[]",
                components: [
                    { type: "bool", name: "success" },
                    { type: "bytes", name: "returnData" },
                ],
            },
        ],
        stateMutability: "payable",
    },
] as const;

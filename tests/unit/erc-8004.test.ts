import { describe, it, expect } from "vitest";
import { decodeFunctionData, type Hex } from "viem";
import {
    encodeIdentityRegister,
    encodeAgentRegistryRegister,
    parseTokenIdFromTransferLogs,
} from "@/lib/erc-8004";
import {
    identityRegistryAbi,
    agentRegistryAbi,
} from "@/lib/abis/erc-8004";

const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const OPERATOR = "0x1111111111111111111111111111111111111111" as const;
const TRANSFER_TOPIC =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
const ZERO_TOPIC =
    "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

function topicForUint(n: bigint): Hex {
    return ("0x" + n.toString(16).padStart(64, "0")) as Hex;
}

function topicForAddress(a: string): Hex {
    return ("0x" + a.replace(/^0x/, "").toLowerCase().padStart(64, "0")) as Hex;
}

describe("encodeIdentityRegister", () => {
    it("produces calldata that round-trips through viem decodeFunctionData", () => {
        const data = encodeIdentityRegister("ipfs://Qm...");
        const decoded = decodeFunctionData({
            abi: identityRegistryAbi,
            data,
        });
        expect(decoded.functionName).toBe("register");
        expect(decoded.args).toEqual(["ipfs://Qm..."]);
    });

    it("starts with the register(string) selector", () => {
        const data = encodeIdentityRegister("anything");
        // selector for register(string)
        expect(data.slice(0, 10)).toBe("0xf2c298be");
    });
});

describe("encodeAgentRegistryRegister", () => {
    it("round-trips through viem decodeFunctionData", () => {
        const data = encodeAgentRegistryRegister({
            chainAgentId: 42n,
            operator: OPERATOR,
            policyHash: ("0x" + "11".repeat(32)) as Hex,
            perTxCap: 1_000_000n,
            evaluatorFeeMax: 50_000n,
        });
        const decoded = decodeFunctionData({
            abi: agentRegistryAbi,
            data,
        });
        expect(decoded.functionName).toBe("registerAgent");
        expect(decoded.args).toEqual([
            42n,
            OPERATOR,
            "0x" + "11".repeat(32),
            1_000_000n,
            50_000n,
        ]);
    });
});

describe("parseTokenIdFromTransferLogs", () => {
    function mintLog(
        tokenId: bigint,
        address: `0x${string}` = REGISTRY,
    ): { address: `0x${string}`; topics: Hex[] } {
        return {
            address,
            topics: [
                TRANSFER_TOPIC,
                ZERO_TOPIC,
                topicForAddress(OPERATOR),
                topicForUint(tokenId),
            ],
        };
    }

    it("extracts tokenId from a mint Transfer event", () => {
        const tokenId = parseTokenIdFromTransferLogs([mintLog(123n)], REGISTRY);
        expect(tokenId).toBe(123n);
    });

    it("returns null when no Transfer event is present", () => {
        const tokenId = parseTokenIdFromTransferLogs(
            [
                {
                    address: REGISTRY,
                    topics: [
                        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hex,
                    ],
                },
            ],
            REGISTRY,
        );
        expect(tokenId).toBeNull();
    });

    it("ignores Transfer events from other contracts", () => {
        const otherAddress: `0x${string}` =
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        const tokenId = parseTokenIdFromTransferLogs(
            [mintLog(99n, otherAddress)],
            REGISTRY,
        );
        expect(tokenId).toBeNull();
    });

    it("ignores non-mint Transfers (from != 0)", () => {
        const tokenId = parseTokenIdFromTransferLogs(
            [
                {
                    address: REGISTRY,
                    topics: [
                        TRANSFER_TOPIC,
                        topicForAddress(OPERATOR), // from non-zero — not a mint
                        topicForAddress(
                            "0x2222222222222222222222222222222222222222",
                        ),
                        topicForUint(123n),
                    ],
                },
            ],
            REGISTRY,
        );
        expect(tokenId).toBeNull();
    });

    it("returns the FIRST mint when multiple are present (deterministic)", () => {
        const tokenId = parseTokenIdFromTransferLogs(
            [mintLog(7n), mintLog(8n)],
            REGISTRY,
        );
        expect(tokenId).toBe(7n);
    });

    it("is case-insensitive on the registry address comparison", () => {
        const tokenId = parseTokenIdFromTransferLogs(
            [mintLog(42n, REGISTRY.toLowerCase() as `0x${string}`)],
            REGISTRY,
        );
        expect(tokenId).toBe(42n);
    });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const circleCliMock = vi.fn();

vi.mock("@/lib/circle-cli", () => ({
    circleCli: (...args: unknown[]) => circleCliMock(...args),
    CircleCliError: class extends Error {},
}));

const { verifyCircleAgentWallet } = await import("@/lib/circle-agent-wallet");

const SCA = "0x86f97b7afc0b580d342e824084b79ae89993ee77" as const;
const BACKING_EOA = "0x3d6341f4af5ac687e4acb392bbe4745876ad6231" as const;

function stubListHasWallet(address: string = SCA) {
    return {
        wallets: [
            {
                type: "agent",
                address,
                blockchain: "ARC-TESTNET",
                createDate: "2026-05-12T10:11:49Z",
            },
        ],
    };
}

describe("verifyCircleAgentWallet", () => {
    beforeEach(() => circleCliMock.mockReset());

    it("returns exists+metadata when wallet is found on the chain", async () => {
        circleCliMock
            .mockResolvedValueOnce(stubListHasWallet())
            .mockResolvedValueOnce({
                type: "agent",
                email: "dev@example.com",
                testnet: { tokenStatus: "VALID", expiresIn: "6d" },
            })
            .mockResolvedValueOnce({
                message: "Gateway balance: 0 USDC",
                address: SCA,
                backingEOA: BACKING_EOA,
                total: "0",
                token: "USDC",
                balances: [],
            })
            .mockResolvedValueOnce({
                balances: [
                    {
                        amount: "20",
                        token: {
                            name: "USDC",
                            symbol: "USDC",
                            blockchain: "ARC-TESTNET",
                            decimals: 18,
                            isNative: true,
                        },
                    },
                ],
            });

        const result = await verifyCircleAgentWallet(SCA);

        expect(result).toEqual({
            exists: true,
            address: SCA,
            backingEoa: BACKING_EOA,
            email: "dev@example.com",
            balanceUsdcRaw: "20",
            createdAt: "2026-05-12T10:11:49Z",
        });
    });

    it("returns exists:false when address is not in the list", async () => {
        circleCliMock.mockResolvedValueOnce({ wallets: [] });

        const result = await verifyCircleAgentWallet(SCA);

        expect(result).toEqual({
            exists: false,
            reason: expect.stringContaining("not found"),
        });
        expect(circleCliMock).toHaveBeenCalledTimes(1);
    });

    it("is case-insensitive on the address comparison", async () => {
        circleCliMock
            .mockResolvedValueOnce(stubListHasWallet(SCA.toUpperCase()))
            .mockResolvedValueOnce({
                type: "agent",
                email: "dev@example.com",
            })
            .mockResolvedValueOnce({
                message: "",
                address: SCA,
                backingEOA: BACKING_EOA,
                total: "0",
                token: "USDC",
                balances: [],
            })
            .mockResolvedValueOnce({ balances: [] });

        const result = await verifyCircleAgentWallet(SCA);
        expect(result.exists).toBe(true);
    });

    it("returns exists:false with reason when CLI throws", async () => {
        circleCliMock.mockRejectedValueOnce(new Error("AUTH_REQUIRED: Not logged in"));

        const result = await verifyCircleAgentWallet(SCA);

        expect(result).toEqual({
            exists: false,
            reason: expect.stringContaining("AUTH_REQUIRED"),
        });
    });

    it("reports balance 0 when no USDC entry is present", async () => {
        circleCliMock
            .mockResolvedValueOnce(stubListHasWallet())
            .mockResolvedValueOnce({ type: "agent", email: "dev@example.com" })
            .mockResolvedValueOnce({
                message: "",
                address: SCA,
                backingEOA: BACKING_EOA,
                total: "0",
                token: "USDC",
                balances: [],
            })
            .mockResolvedValueOnce({ balances: [] });

        const result = await verifyCircleAgentWallet(SCA);
        expect(result.exists && result.balanceUsdcRaw).toBe("0");
    });
});

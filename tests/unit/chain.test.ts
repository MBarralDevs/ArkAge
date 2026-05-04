import { describe, it, expect } from "vitest";
import { arcTestnet, publicClient } from "@/lib/chain";

describe("chain client", () => {
  it("defines Arc Testnet with chain ID 5042002", () => {
    expect(arcTestnet.id).toBe(5042002);
  });

  it("uses USDC native gas (18 decimals)", () => {
    expect(arcTestnet.nativeCurrency.decimals).toBe(18);
    expect(arcTestnet.nativeCurrency.symbol).toBe("USDC");
  });

  it("can fetch the latest block number", async () => {
    const block = await publicClient.getBlockNumber();
    expect(block).toBeGreaterThan(0n);
  }, 30_000);
});

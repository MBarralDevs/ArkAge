import { createPublicClient, http, parseAbi } from "viem";
import { arcTestnet } from "../src/lib/chain";
import { ARKAGE_ADDRESSES } from "../src/lib/addresses";
import { env } from "../src/lib/env";
const pub = createPublicClient({ chain: arcTestnet, transport: http(env.ARC_TESTNET_RPC_HTTP) });
async function main() {
  if (!ARKAGE_ADDRESSES.AGENT_REGISTRY) throw new Error("no AGENT_REGISTRY");
  const abi = parseAbi(["function recordJobFee(uint256,uint256)"]);
  const client = "0x172B7952b0F711b8B372410E81d51Dcba7D4BB02" as const;
  try {
    await pub.simulateContract({
      address: ARKAGE_ADDRESSES.AGENT_REGISTRY,
      abi,
      functionName: "recordJobFee",
      args: [12542n, 10000n],
      account: client,
    });
    console.log("OK");
  } catch (e: any) {
    console.log("revert:", e.shortMessage ?? e.message);
    if (e.cause?.data) console.log("  data:", e.cause.data);
  }
}
main().then(() => process.exit(0));

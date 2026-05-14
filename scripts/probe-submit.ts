import { createPublicClient, http, parseAbi } from "viem";
import { arcTestnet } from "../src/lib/chain";
import { ARC_TESTNET_ADDRESSES } from "../src/lib/addresses";
import { env } from "../src/lib/env";
const pub = createPublicClient({ chain: arcTestnet, transport: http(env.ARC_TESTNET_RPC_HTTP) });
async function main() {
  const abi = parseAbi([
    "function submit(uint256 jobId, bytes32 deliverable, bytes data)",
    "function getJob(uint256) view returns (address client, address provider, address evaluator, uint256 budget, uint256 expiredAt, uint8 status, bytes32 reason, address hook)",
  ]);
  // read job
  try {
    const j = await pub.readContract({
      address: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
      abi,
      functionName: "getJob",
      args: [12550n],
    });
    console.log("job 12550:", j);
  } catch (e: any) {
    console.log("getJob revert:", e.shortMessage ?? e.message);
  }
  // simulate submit
  try {
    await pub.simulateContract({
      address: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
      abi,
      functionName: "submit",
      args: [12550n, "0x090354b03a1e64550ca0878e97985ef1a6163da53ed2ff9321e10d7db752e88f", "0x"],
      account: "0x61f13440e56d155c69557344432933a70bc0a7b0",
    });
    console.log("submit OK");
  } catch (e: any) {
    console.log("submit revert:", e.shortMessage ?? e.message);
    if (e.cause?.data) console.log("  data:", e.cause.data);
  }
}
main().then(() => process.exit(0));

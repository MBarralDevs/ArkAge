import { createPublicClient, http } from "viem";
import { arcTestnet } from "../src/lib/chain";
import { env } from "../src/lib/env";
const pub = createPublicClient({ chain: arcTestnet, transport: http(env.ARC_TESTNET_RPC_HTTP) });
async function main() {
  const r = await pub.getTransactionReceipt({ hash: "0x15e5cb06a37278e21b94e689591a77d0561b32148506c6a3c33fb34c41ae7dc2" });
  console.log("status:", r.status, "block:", r.blockNumber, "logs:", r.logs.length);
  for (const l of r.logs) {
    console.log(`  log @${l.address}`);
    for (const t of l.topics) console.log(`    topic: ${t}`);
    console.log(`    data : ${l.data.slice(0, 200)}${l.data.length > 200 ? "..." : ""}`);
  }
}
main().then(() => process.exit(0));

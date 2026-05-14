import { createPublicClient, http, parseAbi } from "viem";
import { arcTestnet } from "../src/lib/chain";
import { ARC_TESTNET_ADDRESSES, ARKAGE_ADDRESSES } from "../src/lib/addresses";
import { env } from "../src/lib/env";

const pub = createPublicClient({ chain: arcTestnet, transport: http(env.ARC_TESTNET_RPC_HTTP) });

const erc8183Abi = parseAbi([
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256 jobId)",
]);

async function main() {
  const client = "0x172B7952b0F711b8B372410E81d51Dcba7D4BB02" as const;
  const provider = "0x61f13440e56d155c69557344432933a70bc0a7b0" as const;
  const evaluator = "0x07db1e1256920fc41995bcfca15cb6dd38a47bb1" as const;
  const hook = ARKAGE_ADDRESSES.HOOK_COMPOSER ?? "0x0000000000000000000000000000000000000000";
  const expired = BigInt(Math.floor(Date.now() / 1000) + 1800);

  console.log("hook composer addr:", hook);

  for (const [label, hk] of [
    ["with HookComposer", hook as `0x${string}`],
    ["with zero hook", "0x0000000000000000000000000000000000000000" as `0x${string}`],
  ] as const) {
    try {
      const sim = await pub.simulateContract({
        address: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        abi: erc8183Abi,
        functionName: "createJob",
        args: [provider, evaluator, expired, "smoke probe", hk],
        account: client,
      });
      console.log(`OK ${label}: jobId=${sim.result}`);
    } catch (e: any) {
      console.log(`REVERT ${label}:`, e.shortMessage ?? e.message);
      if (e.cause?.data) console.log("  data:", e.cause.data);
      if (e.metaMessages?.length) console.log("  meta:", e.metaMessages.join("\n        "));
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

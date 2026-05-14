import { createPublicClient, http, parseAbi } from "viem";
import { arcTestnet } from "../src/lib/chain";
import { ARC_TESTNET_ADDRESSES, ARKAGE_ADDRESSES } from "../src/lib/addresses";
import { env } from "../src/lib/env";

const pub = createPublicClient({ chain: arcTestnet, transport: http(env.ARC_TESTNET_RPC_HTTP) });

async function main() {
  const abi = parseAbi([
    "function whitelistHook(address)",
    "function registerHook(address)",
    "function approveHook(address)",
    "function addHookToWhitelist(address)",
    "function setHookWhitelist(address,bool)",
  ]);
  // simulateContract with a random sender — to learn if these even exist
  const me = "0x172B7952b0F711b8B372410E81d51Dcba7D4BB02" as const;
  for (const fn of ["whitelistHook","registerHook","approveHook","addHookToWhitelist"] as const) {
    try {
      await pub.simulateContract({
        address: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        abi,
        functionName: fn as any,
        args: [ARKAGE_ADDRESSES.HOOK_COMPOSER!] as any,
        account: me,
      });
      console.log(`${fn}: simulated OK (callable)`);
    } catch (e: any) {
      const sel = e.cause?.data?.slice?.(0, 10);
      console.log(`${fn}: ✗ ${e.shortMessage ?? "fail"} ${sel ?? ""}`);
    }
  }
  try {
    await pub.simulateContract({
      address: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
      abi,
      functionName: "setHookWhitelist",
      args: [ARKAGE_ADDRESSES.HOOK_COMPOSER!, true],
      account: me,
    });
    console.log("setHookWhitelist: simulated OK (callable)");
  } catch (e: any) {
    const sel = e.cause?.data?.slice?.(0, 10);
    console.log(`setHookWhitelist: ✗ ${e.shortMessage ?? "fail"} ${sel ?? ""}`);
  }
}
main().then(() => process.exit(0));

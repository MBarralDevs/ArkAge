import { createPublicClient, http, parseAbi } from "viem";
import { arcTestnet } from "../src/lib/chain";
import { ARC_TESTNET_ADDRESSES, ARKAGE_ADDRESSES } from "../src/lib/addresses";
import { env } from "../src/lib/env";

const pub = createPublicClient({ chain: arcTestnet, transport: http(env.ARC_TESTNET_RPC_HTTP) });

async function main() {
  const abi = parseAbi([
    "function isHookWhitelisted(address) view returns (bool)",
    "function hookWhitelist(address) view returns (bool)",
    "function whitelistedHooks(address) view returns (bool)",
    "function owner() view returns (address)",
    "function admin() view returns (address)",
    "function getOwner() view returns (address)",
    "function hookRegistry() view returns (address)",
    "function registry() view returns (address)",
  ]);

  for (const fn of [
    "isHookWhitelisted",
    "hookWhitelist",
    "whitelistedHooks",
    "owner",
    "admin",
    "getOwner",
    "hookRegistry",
    "registry",
  ] as const) {
    try {
      const args = fn.startsWith("is") || fn === "hookWhitelist" || fn === "whitelistedHooks"
        ? [ARKAGE_ADDRESSES.HOOK_COMPOSER!]
        : [];
      const r = await pub.readContract({
        address: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        abi,
        functionName: fn as any,
        args: args as any,
      });
      console.log(`${fn}:`, r);
    } catch (e: any) {
      console.log(`${fn}: ✗ (${e.shortMessage ?? e.message.split("\n")[0]})`);
    }
  }
}
main().then(() => process.exit(0));

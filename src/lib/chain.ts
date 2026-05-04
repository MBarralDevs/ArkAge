import { createPublicClient, defineChain, http } from "viem";
import { env } from "./env";

// Arc Testnet — chain ID 5042002 (hex 0x4CEF52).
// Native gas token is USDC represented in 18 decimals (gas accounting).
// App-level USDC amounts use the ERC-20 contract at 0x3600…0000 with 6 decimals.
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [env.ARC_TESTNET_RPC_HTTP],
      webSocket: [env.ARC_TESTNET_RPC_WS],
    },
  },
  blockExplorers: {
    default: {
      name: "Arcscan",
      url: "https://testnet.arcscan.app",
    },
  },
  testnet: true,
});

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

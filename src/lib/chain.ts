import { createPublicClient, defineChain, http } from "viem";
import { env } from "./env";

/**
 * Single source of truth for chain identity, CAIP-2, explorer URLs.
 *
 * Plan F mainnet-prep audit (2026-05-14): every chain-id, hex form,
 * CAIP-2 string, and explorer URL across the repo derives from this
 * module. Switching to mainnet later is a localized edit: change
 * `arcTestnet` to `arcMainnet` (or add a second chain object selected by
 * env) and every consumer follows.
 *
 * Arc Testnet — chain ID 5042002 (hex 0x4CEF52). Native gas token is USDC
 * represented in 18 decimals (gas accounting only). App-level USDC
 * amounts use the ERC-20 contract at 0x3600…0000 with 6 decimals.
 */
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

/** Active chain. Today: Arc Testnet. Mainnet swap is a one-line change. */
export const activeChain = arcTestnet;

/** Decimal chain id (5042002). */
export const CHAIN_ID = activeChain.id;

/** Hex chain id with 0x prefix ("0x4cef52"), lowercase — the form
 *  EIP-3326 wallet_switchEthereumChain expects. */
export const CHAIN_ID_HEX = `0x${activeChain.id.toString(16)}`;

/** CAIP-2 chain identifier ("eip155:5042002"). Used by x402-batching's
 *  facilitator and any cross-chain settlement payload. */
export const CAIP2 = `eip155:${activeChain.id}`;

/** Base URL for the block explorer (no trailing slash). */
export const EXPLORER_BASE =
  activeChain.blockExplorers?.default.url ?? "";

/** Build an Arcscan link for a transaction hash. */
export function txLink(hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

/** Build an Arcscan link for an address. */
export function addressLink(address: string): string {
  return `${EXPLORER_BASE}/address/${address}`;
}

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(),
});

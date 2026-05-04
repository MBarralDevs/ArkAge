import { type Address } from "viem";
import { env } from "./env";

// Pinned canonical addresses on Arc Testnet.
// Primary source: https://docs.arc.network/arc/references/contract-addresses
export const ARC_TESTNET_ADDRESSES = {
  USDC: "0x3600000000000000000000000000000000000000" as Address,
  CIRCLE_GATEWAY_WALLET: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as Address,
  CIRCLE_GATEWAY_MINTER: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as Address,
  CCTP_TOKEN_MESSENGER: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as Address,
  CCTP_MESSAGE_TRANSMITTER: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as Address,
  PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
  MULTICALL3: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address,
  CREATE2_FACTORY: "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address,

  // From Arc tutorials — bytecode verified non-empty 2026-05-04 via eth_getCode,
  // but per spec §11 these came from tutorial pages and may be redeployed.
  // Re-verify before locking in production paths.
  ERC_8183_AGENTIC_COMMERCE: "0x0747EEf0706327138c69792bF28Cd525089e4583" as Address,
  ERC_8004_IDENTITY_REGISTRY: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
  ERC_8004_REPUTATION_REGISTRY: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address,
  ERC_8004_VALIDATION_REGISTRY: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272" as Address,
} as const;

// Set after Plan A Task 26 deploys the 5 ArkAge contracts.
// All optional until then; consumers must check undefined.
export const ARKAGE_ADDRESSES = {
  HOOK_COMPOSER: env.ARKAGE_HOOK_COMPOSER_ADDRESS as Address | undefined,
  REPUTATION_HOOK: env.ARKAGE_REPUTATION_HOOK_ADDRESS as Address | undefined,
  POLICY_HOOK: env.ARKAGE_POLICY_HOOK_ADDRESS as Address | undefined,
  EVALUATOR_FEE_HOOK: env.ARKAGE_EVALUATOR_FEE_HOOK_ADDRESS as Address | undefined,
  AGENT_REGISTRY: env.ARKAGE_AGENT_REGISTRY_ADDRESS as Address | undefined,
} as const;

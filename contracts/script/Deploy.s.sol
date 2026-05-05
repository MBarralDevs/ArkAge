// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {PolicyHook} from "../src/PolicyHook.sol";
import {ReputationHook} from "../src/ReputationHook.sol";
import {EvaluatorFeeHook} from "../src/EvaluatorFeeHook.sol";
import {HookComposer} from "../src/HookComposer.sol";

/// @title Deploy
/// @notice Deterministic CREATE2 deployer for the 5 ArkAge contracts on
///         Arc Testnet (chain id 5042002).
///
///         Deployment order is dependency-driven:
///           1. AgentRegistry        (no ArkAge deps)
///           2. PolicyHook           (depends on AgentRegistry)
///           3. ReputationHook       (depends on AgentRegistry)
///           4. EvaluatorFeeHook     (depends on AgentRegistry)
///           5. HookComposer         (depends on the 3 hooks)
///
///         After step 5, the deployer (== INITIALIZER) calls setTrustedCaller
///         on each of the 3 hooks so they trust the composer as their msg.sender
///         going forward. This is the architectural fix documented in the
///         hook contracts: trustedCaller separates "who calls me" (composer)
///         from "where I read job state" (AGENTIC_COMMERCE).
///
///         Determinism: every contract uses the same SALT and the same
///         immutable args, so the addresses are reproducible across re-runs
///         on a fresh chain. Re-deploying with different args produces
///         different addresses (CREATE2 hashes initcode), which is what we
///         want — it's loud failure rather than silent address shadowing.
contract Deploy is Script {
    /// @dev Stable salt for v1 — pinning a specific date so future
    ///      iterations (v1.5, v2) get distinct CREATE2 addresses.
    bytes32 internal constant SALT = keccak256("arkage-v1-2026-05-02");

    // ---- Canonical Arc Testnet addresses (per CLAUDE.md "Pinned addresses") ----
    // ⚠ Tutorial-sourced — verify with `cast code` before broadcast (see
    //   "Pre-implementation verification checklist" in CLAUDE.md).
    address internal constant AGENTIC_COMMERCE = 0x0747EEf0706327138c69792bF28Cd525089e4583; // ERC-8183
    address internal constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e; // ERC-8004
    address internal constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713; // ERC-8004
    address internal constant USDC = 0x3600000000000000000000000000000000000000; // USDC ERC-20 (6 decimals)

    function run() external {
        address treasury = vm.envAddress("ARKAGE_TREASURY_WALLET_ADDRESS");
        require(treasury != address(0), "treasury wallet not set");

        console2.log("=== ArkAge v1 deploy ===");
        console2.log("chainId             ", block.chainid);
        console2.log("deployer            ", msg.sender);
        console2.log("treasury            ", treasury);
        console2.log("AGENTIC_COMMERCE    ", AGENTIC_COMMERCE);
        console2.log("IDENTITY_REGISTRY   ", IDENTITY_REGISTRY);
        console2.log("REPUTATION_REGISTRY ", REPUTATION_REGISTRY);
        console2.log("USDC                ", USDC);
        console2.log("SALT                ", vm.toString(SALT));

        vm.startBroadcast();

        // --- 1. AgentRegistry ---
        AgentRegistry registry = new AgentRegistry{salt: SALT}(IDENTITY_REGISTRY, AGENTIC_COMMERCE);
        console2.log("AgentRegistry       ", address(registry));

        // The deployer EOA is the initializer for all 3 hooks — necessary
        // because CREATE2 broadcast routes msg.sender through the canonical
        // factory, so each hook's INITIALIZER must be passed explicitly to
        // retain the post-deploy authority needed for setTrustedCaller.
        address initializer = msg.sender;

        // --- 2. PolicyHook ---
        PolicyHook policyHook = new PolicyHook{salt: SALT}(AGENTIC_COMMERCE, address(registry), initializer);
        console2.log("PolicyHook          ", address(policyHook));

        // --- 3. ReputationHook ---
        ReputationHook reputationHook = new ReputationHook{salt: SALT}(
            AGENTIC_COMMERCE, REPUTATION_REGISTRY, address(registry), initializer
        );
        console2.log("ReputationHook      ", address(reputationHook));

        // --- 4. EvaluatorFeeHook ---
        EvaluatorFeeHook feeHook = new EvaluatorFeeHook{salt: SALT}(
            AGENTIC_COMMERCE, USDC, treasury, address(registry), initializer
        );
        console2.log("EvaluatorFeeHook    ", address(feeHook));

        // --- 5. HookComposer ---
        // ORDERING IS LOAD-BEARING: feeHook MUST come before reputationHook in
        // afterHooks so a fee-collection failure halts the chain BEFORE
        // ReputationHook writes positive feedback for an unpaid job.
        address[] memory beforeHooks = new address[](1);
        beforeHooks[0] = address(policyHook);

        address[] memory afterHooks = new address[](2);
        afterHooks[0] = address(feeHook);
        afterHooks[1] = address(reputationHook);

        HookComposer composer = new HookComposer{salt: SALT}(AGENTIC_COMMERCE, beforeHooks, afterHooks);
        console2.log("HookComposer        ", address(composer));

        // --- 6. Wire trustedCaller (settable-once) on the 3 hooks ---
        // Until set, each hook's _authorizedCaller() falls back to
        // AGENTIC_COMMERCE — but in production the composer is the actual
        // msg.sender, so this MUST be set before any real ERC-8183 jobs flow
        // through the system. INITIALIZER == msg.sender of each hook's
        // constructor == this script's broadcaster, so this call is authorized.
        policyHook.setTrustedCaller(address(composer));
        reputationHook.setTrustedCaller(address(composer));
        feeHook.setTrustedCaller(address(composer));
        console2.log("trustedCaller wired on policyHook / reputationHook / feeHook");

        vm.stopBroadcast();

        // --- 7. Persist deployment artifact ---
        // Foundry's dryrun broadcast already writes broadcast/<id>/run-latest.json,
        // but we additionally pin a stable, human-readable JSON consumed by
        // src/lib/addresses.ts at runtime.
        _writeDeployment(
            DeploymentRecord({
                chainId: block.chainid,
                deployer: msg.sender,
                registry: address(registry),
                policyHook: address(policyHook),
                reputationHook: address(reputationHook),
                feeHook: address(feeHook),
                composer: address(composer),
                treasury: treasury
            })
        );
    }

    struct DeploymentRecord {
        uint256 chainId;
        address deployer;
        address registry;
        address policyHook;
        address reputationHook;
        address feeHook;
        address composer;
        address treasury;
    }

    function _writeDeployment(DeploymentRecord memory r) internal {
        // Schema matches Plan A Task 26 Step 2 exactly: top-level chainId,
        // deployedAt, deployer, salt, contracts, canonical (+ treasury).
        // Split into 3 chunks because string.concat over all fields hits
        // EVM stack-depth limits.
        string memory header = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(r.chainId), ",\n",
            '  "deployedAt": "', vm.toString(vm.unixTime()), '",\n',
            '  "deployer": "', vm.toString(r.deployer), '",\n',
            '  "salt": "', vm.toString(SALT), '",\n'
        );
        string memory contractsBlock = string.concat(
            '  "contracts": {\n',
            '    "AgentRegistry": "', vm.toString(r.registry), '",\n',
            '    "PolicyHook": "', vm.toString(r.policyHook), '",\n',
            '    "ReputationHook": "', vm.toString(r.reputationHook), '",\n',
            '    "EvaluatorFeeHook": "', vm.toString(r.feeHook), '",\n',
            '    "HookComposer": "', vm.toString(r.composer), '"\n',
            "  },\n"
        );
        string memory canonicalBlock = string.concat(
            '  "canonical": {\n',
            '    "ERC_8183_AgenticCommerce": "', vm.toString(AGENTIC_COMMERCE), '",\n',
            '    "ERC_8004_IdentityRegistry": "', vm.toString(IDENTITY_REGISTRY), '",\n',
            '    "ERC_8004_ReputationRegistry": "', vm.toString(REPUTATION_REGISTRY), '",\n',
            '    "USDC": "', vm.toString(USDC), '"\n',
            "  },\n",
            '  "treasury": "', vm.toString(r.treasury), '"\n',
            "}\n"
        );
        string memory json = string.concat(header, contractsBlock, canonicalBlock);

        string memory path = string.concat("deployments/arc-testnet.json");
        vm.writeFile(path, json);
        console2.log("Wrote deployment artifact:", path);
    }
}

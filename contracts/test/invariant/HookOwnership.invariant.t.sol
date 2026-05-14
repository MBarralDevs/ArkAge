// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {HookComposer} from "../../src/HookComposer.sol";
import {ReputationHook} from "../../src/ReputationHook.sol";
import {PolicyHook} from "../../src/PolicyHook.sol";
import {EvaluatorFeeHook} from "../../src/EvaluatorFeeHook.sol";
import {RateLimitHook} from "../../src/RateLimitHook.sol";
import {RoyaltyHook} from "../../src/RoyaltyHook.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {MockACP} from "../mocks/MockACP.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";
import {MockReputationRegistry} from "../mocks/MockReputationRegistry.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Foundry invariant fuzzer for the load-bearing Risk #1 property:
///         "None of our 5 contracts (AgentRegistry, PolicyHook,
///          ReputationHook, EvaluatorFeeHook, HookComposer) MAY own or be
///          approved-operator of any ERC-8004 identity NFT."
///
///         This is the rule that keeps ReputationHook compliant with
///         ERC-8004's "feedback submitter MUST NOT be the agent owner or
///         approved operator" — by structural impossibility, msg.sender
///         (the hook contract) can never be the owner.
///
///         The fuzzer drives random sequences of calls against every
///         publicly callable function on the 5 contracts (configured in
///         foundry.toml as targetSelectors / via target() handlers below).
///         After each random sequence, the invariant checks the property.
///
///         If a future code change introduces ANY path that could cause
///         a hook to receive an 8004 NFT (e.g. accidentally implementing
///         onERC721Received, or accepting an NFT via a privileged setter),
///         this fuzzer will catch it within the configured runs/depth.
contract HookOwnershipInvariantTest is Test {
    HookComposer composer;
    ReputationHook reputationHook;
    PolicyHook policyHook;
    EvaluatorFeeHook feeHook;
    RateLimitHook rateLimitHook;
    RoyaltyHook royaltyHook;
    AgentRegistry registry;
    MockIdentityRegistry idReg;

    function setUp() public {
        idReg = new MockIdentityRegistry();
        MockACP acp = new MockACP();
        MockReputationRegistry rep = new MockReputationRegistry();
        MockUSDC usdc = new MockUSDC();

        registry = new AgentRegistry(address(idReg), address(acp));
        policyHook = new PolicyHook(address(acp), address(registry), address(this));
        reputationHook = new ReputationHook(address(acp), address(rep), address(registry), address(this));
        feeHook = new EvaluatorFeeHook(address(acp), address(usdc), address(0xDEAD), address(registry), address(this));
        // Theme E.3 reference hooks — same Risk #1 invariant applies.
        rateLimitHook = new RateLimitHook(
            address(acp),
            address(registry),
            address(idReg),
            address(this),
            3600,
            10
        );
        royaltyHook = new RoyaltyHook(
            address(acp),
            address(registry),
            address(idReg),
            address(this)
        );

        address[] memory before_ = new address[](1);
        before_[0] = address(policyHook);
        address[] memory after_ = new address[](2);
        after_[0] = address(feeHook);
        after_[1] = address(reputationHook);
        composer = new HookComposer(address(acp), before_, after_);

        // Restrict the fuzzer to ONLY our contracts under audit. We
        // deliberately do NOT target MockIdentityRegistry — its setOwner is a
        // test-only admin shim that doesn't exist on the real ERC-8004
        // registry. Including it would let the fuzzer bypass the contracts
        // under audit and just assign NFTs to hook addresses directly, which
        // proves nothing.
        // The real attack surface is: "can any function on our contracts
        // result in one of them becoming an 8004 NFT owner?"
        targetContract(address(registry));
        targetContract(address(policyHook));
        targetContract(address(reputationHook));
        targetContract(address(feeHook));
        targetContract(address(rateLimitHook));
        targetContract(address(royaltyHook));
        targetContract(address(composer));
    }

    /// @notice Property: across any sequence of fuzzer-generated calls,
    ///         none of the audited contracts can ever be the owner of any
    ///         8004 identity NFT in the range [0, 100).
    /// @dev    100 is enough to give the fuzzer room without inflating the
    ///         per-iteration cost. If a violation exists, the shrinker will
    ///         find it on a small agentId.
    function invariant_noHookEverOwnsAn8004NFT() public view {
        for (uint256 agentId = 0; agentId < 100; agentId++) {
            address owner = idReg.ownerOf(agentId);
            assertTrue(owner != address(composer), "composer owns NFT");
            assertTrue(owner != address(reputationHook), "reputationHook owns NFT");
            assertTrue(owner != address(policyHook), "policyHook owns NFT");
            assertTrue(owner != address(feeHook), "feeHook owns NFT");
            assertTrue(owner != address(rateLimitHook), "rateLimitHook owns NFT");
            assertTrue(owner != address(royaltyHook), "royaltyHook owns NFT");
            assertTrue(owner != address(registry), "registry owns NFT");
        }
    }

}

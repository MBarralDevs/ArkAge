// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {PolicyHook} from "../../src/PolicyHook.sol";
import {ReputationHook} from "../../src/ReputationHook.sol";
import {EvaluatorFeeHook} from "../../src/EvaluatorFeeHook.sol";
import {HookComposer} from "../../src/HookComposer.sol";
import {IACP} from "../../src/interfaces/IACP.sol";
import {MockACP} from "../mocks/MockACP.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";
import {MockReputationRegistry} from "../mocks/MockReputationRegistry.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice End-to-end integration: wires all 5 contracts together through
///         the HookComposer and exercises full Job lifecycle (fund + complete
///         and the reject path) with real state changes across all hooks.
///         Verifies the load-bearing properties:
///          - PolicyHook gates fund correctly using job.budget
///          - EvaluatorFeeHook pulls fee on complete (not reject)
///          - ReputationHook writes +100 on complete, -50 on reject
///          - HookComposer ordering ensures fee runs BEFORE reputation
///            so a fee-collection failure rolls back the reputation write
contract HookChainTest is Test {
    AgentRegistry registry;
    PolicyHook policyHook;
    ReputationHook reputationHook;
    EvaluatorFeeHook feeHook;
    HookComposer composer;

    MockACP acp;
    MockIdentityRegistry idReg;
    MockReputationRegistry repReg;
    MockUSDC usdc;

    address clientOwner = address(0x1111);
    address clientOp = address(0x2222);
    address providerOwner = address(0x3333);
    address providerOp = address(0x4444);
    address treasury = address(0x9999);
    uint256 constant CLIENT_AGENT_ID = 1;
    uint256 constant PROVIDER_AGENT_ID = 2;
    uint256 constant JOB_ID = 7;
    uint256 constant BUDGET = 1_000_000;
    uint256 constant FEE = 20_000;

    function setUp() public {
        // ---- Mock infrastructure ----
        idReg = new MockIdentityRegistry();
        acp = new MockACP();
        repReg = new MockReputationRegistry();
        usdc = new MockUSDC();

        // ---- All 5 ArkAge contracts ----
        registry = new AgentRegistry(address(idReg), address(acp));
        policyHook = new PolicyHook(address(acp), address(registry));
        reputationHook = new ReputationHook(address(acp), address(repReg), address(registry));
        feeHook = new EvaluatorFeeHook(address(acp), address(usdc), treasury, address(registry));

        address[] memory before_ = new address[](1);
        before_[0] = address(policyHook);
        // ORDERING IS LOAD-BEARING: feeHook MUST come before reputationHook so
        // a fee-collection failure halts the chain before reputation is written.
        address[] memory after_ = new address[](2);
        after_[0] = address(feeHook);
        after_[1] = address(reputationHook);

        composer = new HookComposer(address(acp), before_, after_);

        // ---- Lock each hook to trust the composer (settable-once) ----
        // In production this is done by the deploy script after composer
        // deployment. Until set, hooks fall back to AGENTIC_COMMERCE which
        // keeps unit tests working without this extra step.
        policyHook.setTrustedCaller(address(composer));
        feeHook.setTrustedCaller(address(composer));
        reputationHook.setTrustedCaller(address(composer));

        // ---- Identity ownership ----
        idReg.setOwner(CLIENT_AGENT_ID, clientOwner);
        idReg.setOwner(PROVIDER_AGENT_ID, providerOwner);

        // ---- Register both agents in AgentRegistry ----
        vm.prank(clientOwner);
        registry.registerAgent(CLIENT_AGENT_ID, clientOp, keccak256("c"), uint128(BUDGET), uint64(FEE));
        vm.prank(providerOwner);
        registry.registerAgent(PROVIDER_AGENT_ID, providerOp, keccak256("p"), uint128(BUDGET), uint64(FEE));

        // ---- Set up job in ACP ----
        IACP.Job memory j = IACP.Job({
            client: clientOp,
            provider: providerOp,
            evaluator: address(0),
            budget: BUDGET,
            expiredAt: 0,
            status: IACP.JobStatus.Funded,
            reason: bytes32(uint256(0xC0FFEE)),
            hook: address(composer)
        });
        acp.setJob(JOB_ID, j);

        // ---- Client records the evaluator fee at fund time ----
        vm.prank(clientOp);
        registry.recordJobFee(JOB_ID, FEE);

        // ---- Provider has been credited the budget by ACP and approves
        //      the fee hook to pull the fee at complete time ----
        usdc.mint(providerOp, BUDGET);
        vm.prank(providerOp);
        usdc.approve(address(feeHook), FEE);
    }

    // ============================================================
    // End-to-end happy path: fund → complete
    // ============================================================
    function test_endToEnd_fundThenComplete() public {
        // 1. Hookable fund call passes through PolicyHook (budget within cap)
        bytes memory fundData = abi.encode(BUDGET);
        acp.callBeforeAction(address(composer), JOB_ID, IACP.fund.selector, fundData);

        // 2. After complete: fee + reputation in one composer.afterAction call
        acp.callAfterAction(address(composer), JOB_ID, IACP.complete.selector, "");

        // ---- Treasury received the fee, provider was charged ----
        assertEq(usdc.balanceOf(treasury), FEE, "treasury did not receive fee");
        assertEq(usdc.balanceOf(providerOp), BUDGET - FEE, "provider did not net out fee");

        // ---- Reputation was written for the provider ----
        assertEq(repReg.callsLength(), 1, "reputation not written");
        (uint256 aId, int128 v,,,,,,,) = repReg.calls(0);
        assertEq(aId, PROVIDER_AGENT_ID, "wrong provider agent in feedback");
        assertEq(v, int128(100), "wrong reputation score for complete");
    }

    // ============================================================
    // Reject path: no fee pulled, negative reputation written
    // ============================================================
    function test_endToEnd_rejectPath() public {
        acp.callAfterAction(address(composer), JOB_ID, IACP.reject.selector, "");

        // Reject does NOT pull fee
        assertEq(usdc.balanceOf(treasury), 0, "treasury should not receive fee on reject");
        assertEq(usdc.balanceOf(providerOp), BUDGET, "provider should retain budget on reject");

        // Reject DOES write negative reputation
        assertEq(repReg.callsLength(), 1, "reputation not written on reject");
        (, int128 v,,,,,,,) = repReg.calls(0);
        assertEq(v, int128(-50), "wrong reputation score for reject");
    }

    // ============================================================
    // Ordering safety: fee failure halts chain BEFORE reputation
    // ============================================================
    function test_feeFailure_haltsChainBeforeReputation() public {
        // Provider has not approved the fee hook → transferFrom will revert.
        // Crucially, ReputationHook MUST NOT execute (no positive feedback
        // for an unpaid job).
        vm.prank(providerOp);
        usdc.approve(address(feeHook), 0); // remove approval

        vm.expectRevert(); // mock USDC reverts on insufficient approval
        acp.callAfterAction(address(composer), JOB_ID, IACP.complete.selector, "");

        // No reputation written:
        assertEq(repReg.callsLength(), 0, "reputation written despite fee failure");
        assertEq(usdc.balanceOf(treasury), 0, "treasury received fee despite revert");
    }

    // ============================================================
    // PolicyHook integration: budget over cap halts chain at gate
    // ============================================================
    function test_policyHook_budgetOverCap_blocksFund() public {
        // Bump the job's budget above the client's per-tx cap.
        IACP.Job memory j = IACP.Job({
            client: clientOp,
            provider: providerOp,
            evaluator: address(0),
            budget: BUDGET * 10, // 10M > cap of 1M
            expiredAt: 0,
            status: IACP.JobStatus.Funded,
            reason: bytes32(0),
            hook: address(composer)
        });
        acp.setJob(JOB_ID, j);

        vm.expectRevert(PolicyHook.PerTxCapExceeded.selector);
        acp.callBeforeAction(address(composer), JOB_ID, IACP.fund.selector, "");
    }
}

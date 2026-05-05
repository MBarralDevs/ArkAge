// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {EvaluatorFeeHook} from "../../src/EvaluatorFeeHook.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {IACP} from "../../src/interfaces/IACP.sol";
import {MockACP} from "../mocks/MockACP.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

contract EvaluatorFeeHookTest is Test {
    EvaluatorFeeHook hook;
    AgentRegistry registry;
    MockACP acp;
    MockUSDC usdc;
    MockIdentityRegistry idReg;

    address owner = address(0xAAAA);
    address client = address(0xCCCC);
    address provider = address(0xDDDD);
    address treasury = address(0xEEEE);
    uint256 constant CLIENT_AGENT_ID = 1;
    uint256 constant JOB_ID = 7;

    function setUp() public {
        idReg = new MockIdentityRegistry();
        acp = new MockACP();
        usdc = new MockUSDC();
        registry = new AgentRegistry(address(idReg), address(acp));
        hook = new EvaluatorFeeHook(address(acp), address(usdc), treasury, address(registry));

        // Register client agent
        idReg.setOwner(CLIENT_AGENT_ID, owner);
        vm.prank(owner);
        registry.registerAgent(CLIENT_AGENT_ID, client, keccak256("p"), 1_000_000, 100_000);

        // Set up the job (client = client wallet, provider has been credited budget by ACP)
        IACP.Job memory j = IACP.Job({
            client: client,
            provider: provider,
            evaluator: address(0),
            budget: 1_000_000,
            expiredAt: 0,
            status: IACP.JobStatus.Submitted,
            reason: bytes32(0),
            hook: address(0)
        });
        acp.setJob(JOB_ID, j);

        // Client records the fee
        vm.prank(client);
        registry.recordJobFee(JOB_ID, 50_000);

        // Provider received the budget from ACP and approves the hook to pull the fee
        usdc.mint(provider, 1_000_000);
        vm.prank(provider);
        usdc.approve(address(hook), 50_000);
    }

    // ---- Plan A's 5 specified tests ----

    function test_afterAction_complete_pullsFeeToTreasury() public {
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 providerBefore = usdc.balanceOf(provider);

        acp.callAfterAction(address(hook), JOB_ID, IACP.complete.selector, "");

        assertEq(usdc.balanceOf(treasury), treasuryBefore + 50_000);
        assertEq(usdc.balanceOf(provider), providerBefore - 50_000);
    }

    function test_afterAction_reject_doesNotPullFee() public {
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        acp.callAfterAction(address(hook), JOB_ID, IACP.reject.selector, "");
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
    }

    function test_afterAction_revertsIfNotACP() public {
        vm.expectRevert(bytes("only ACP"));
        hook.afterAction(JOB_ID, IACP.complete.selector, "");
    }

    function test_afterAction_skipsIfFeeZero() public {
        // Different job with no fee recorded → fee = 0 → return
        IACP.Job memory j = IACP.Job({
            client: client,
            provider: provider,
            evaluator: address(0),
            budget: 1_000_000,
            expiredAt: 0,
            status: IACP.JobStatus.Submitted,
            reason: bytes32(0),
            hook: address(0)
        });
        uint256 byoJobId = 99;
        acp.setJob(byoJobId, j);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        acp.callAfterAction(address(hook), byoJobId, IACP.complete.selector, "");
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
    }

    function test_beforeAction_isNoOp() public {
        acp.callBeforeAction(address(hook), JOB_ID, IACP.fund.selector, "");
        // no revert, no state change
    }

    // ---- security-focused additions ----

    function test_afterAction_idempotency_secondCompleteIsNoOp() public {
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        acp.callAfterAction(address(hook), JOB_ID, IACP.complete.selector, "");
        assertEq(usdc.balanceOf(treasury), treasuryBefore + 50_000);

        // Provider can't be charged twice on a retry — even if approval still
        // exists. (Re-approval handled here just to ensure the only barrier
        // is the contract's idempotency, not external approval state.)
        vm.prank(provider);
        usdc.approve(address(hook), 50_000);

        acp.callAfterAction(address(hook), JOB_ID, IACP.complete.selector, "");
        assertEq(usdc.balanceOf(treasury), treasuryBefore + 50_000, "fee charged twice");
    }

    function test_afterAction_revertsIfProviderInsufficientApproval() public {
        // Provider didn't approve enough — transferFrom must revert,
        // bubbling up through afterAction so ACP's complete() reverts too
        // (ensuring the fee is always collected when due, per spec §2.6).
        vm.prank(provider);
        usdc.approve(address(hook), 49_999); // 1 short

        vm.expectRevert(); // mock USDC reverts with "not approved"
        acp.callAfterAction(address(hook), JOB_ID, IACP.complete.selector, "");
    }

    function test_afterAction_skipsForNonTerminalSelector() public {
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        // submit/setBudget/etc. should NOT pull fee — only complete does.
        acp.callAfterAction(address(hook), JOB_ID, IACP.submit.selector, "");
        acp.callAfterAction(address(hook), JOB_ID, IACP.fund.selector, "");
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
    }
}

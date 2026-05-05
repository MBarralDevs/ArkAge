// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PolicyHook} from "../../src/PolicyHook.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {IACP} from "../../src/interfaces/IACP.sol";
import {MockACP} from "../mocks/MockACP.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";

contract PolicyHookTest is Test {
    PolicyHook hook;
    AgentRegistry registry;
    MockACP acp;
    MockIdentityRegistry idReg;

    address owner = address(0xAAAA);
    address operator = address(0xBBBB);
    uint256 constant AGENT_ID = 42;

    function setUp() public {
        idReg = new MockIdentityRegistry();
        acp = new MockACP();
        registry = new AgentRegistry(address(idReg), address(acp));
        hook = new PolicyHook(address(acp), address(registry), address(this));

        idReg.setOwner(AGENT_ID, owner);
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, keccak256("p"), 5_000_000, 100_000);
    }

    function _job(address provider, uint256 budget) internal pure returns (IACP.Job memory) {
        return IACP.Job({
            client: address(0),
            provider: provider,
            evaluator: address(0),
            budget: budget,
            expiredAt: 0,
            status: IACP.JobStatus.Funded,
            reason: bytes32(0),
            hook: address(0)
        });
    }

    // ---- Plan A's 5 specified tests ----

    function test_beforeAction_revertsIfCallerNotACP() public {
        vm.expectRevert(PolicyHook.OnlyACP.selector);
        hook.beforeAction(1, IACP.fund.selector, "");
    }

    function test_beforeAction_revertsIfAgentInactive() public {
        vm.prank(owner);
        registry.deactivate(AGENT_ID);

        // setBudget resolves actor → job.provider; put `operator` there so the
        // PolicyHook lookup finds a registered (but inactive) agent.
        acp.setJob(1, _job(operator, 0));

        vm.expectRevert(PolicyHook.AgentInactive.selector);
        acp.callBeforeAction(address(hook), 1, IACP.setBudget.selector, "");
    }

    function test_beforeAction_revertsOnFundExceedingPerTxCap() public {
        // SECURITY-AUDIT FIX: cap is sourced from job.budget (canonical),
        // not from caller-supplied `data`. Set budget > cap to trigger.
        IACP.Job memory j = _job(address(0), 10_000_000); // > 5_000_000 cap
        j.client = operator;
        acp.setJob(1, j);

        vm.expectRevert(PolicyHook.PerTxCapExceeded.selector);
        acp.callBeforeAction(address(hook), 1, IACP.fund.selector, "");
    }

    function test_beforeAction_passesWhenWithinPolicy() public {
        IACP.Job memory j = _job(address(0), 1_000_000); // <= 5_000_000 cap
        j.client = operator;
        acp.setJob(1, j);

        acp.callBeforeAction(address(hook), 1, IACP.fund.selector, "");
        // should not revert
    }

    // ---- security regression: cap CANNOT be bypassed via crafted data ----

    function test_beforeAction_capUsesJobBudgetNotCallerData() public {
        // Job budget exceeds cap → must revert no matter what `data` claims.
        IACP.Job memory j = _job(address(0), 10_000_000);
        j.client = operator;
        acp.setJob(1, j);

        // Attacker tries to bypass by passing data = abi.encode(uint256(1)).
        // Pre-fix this would have allowed; post-fix the cap check looks at
        // job.budget (10M > 5M cap) and reverts regardless of data contents.
        bytes memory maliciousData = abi.encode(uint256(1));
        vm.expectRevert(PolicyHook.PerTxCapExceeded.selector);
        acp.callBeforeAction(address(hook), 1, IACP.fund.selector, maliciousData);
    }

    function test_afterAction_isNoOp() public {
        acp.setJob(1, _job(operator, 0));
        acp.callAfterAction(address(hook), 1, IACP.complete.selector, "");
        // no revert, no state change to verify — pure no-op
    }

    // ---- additional coverage: BYO flows + every _resolveActor branch ----

    function test_beforeAction_skipsIfActorNotRegistered() public {
        // Job's client is some random wallet that's NOT a registered ArkAge operator.
        // PolicyHook should silently allow (BYO evaluator / non-ArkAge agent flow).
        IACP.Job memory j = _job(address(0), 99_999_999_999); // huge budget
        j.client = address(0xDEAD);
        acp.setJob(1, j);

        // Even with a huge budget exceeding any reasonable cap, an unregistered
        // actor bypasses the gate entirely — that's by design for BYO flows.
        acp.callBeforeAction(address(hook), 1, IACP.fund.selector, "");
    }

    function test_beforeAction_setBudget_resolvesProviderActor() public {
        acp.setJob(1, _job(operator, 0)); // operator at job.provider
        acp.callBeforeAction(address(hook), 1, IACP.setBudget.selector, "");
    }

    function test_beforeAction_submit_resolvesProviderActor() public {
        acp.setJob(1, _job(operator, 0));
        acp.callBeforeAction(address(hook), 1, IACP.submit.selector, "");
    }

    function test_beforeAction_complete_resolvesEvaluatorActor() public {
        IACP.Job memory j = _job(address(0), 0);
        j.evaluator = operator;
        acp.setJob(1, j);
        acp.callBeforeAction(address(hook), 1, IACP.complete.selector, "");
    }

    function test_beforeAction_reject_resolvesEvaluatorActor() public {
        IACP.Job memory j = _job(address(0), 0);
        j.evaluator = operator;
        acp.setJob(1, j);
        acp.callBeforeAction(address(hook), 1, IACP.reject.selector, "");
    }

    function test_beforeAction_setProvider_resolvesClientActor() public {
        IACP.Job memory j = _job(address(0), 0);
        j.client = operator;
        acp.setJob(1, j);
        acp.callBeforeAction(address(hook), 1, IACP.setProvider.selector, "");
    }

    function test_beforeAction_unknownSelector_fallsBackToClientActor() public {
        IACP.Job memory j = _job(address(0), 0);
        j.client = operator;
        acp.setJob(1, j);
        // bytes4(0) is an unknown selector — should hit the fallback `return job.client`
        acp.callBeforeAction(address(hook), 1, bytes4(0), "");
    }

    // ---- trusted-caller bootstrap error paths ----

    function test_setTrustedCaller_revertsIfNotInitializer() public {
        vm.expectRevert(PolicyHook.OnlyInitializer.selector);
        vm.prank(address(0xBAD));
        hook.setTrustedCaller(address(0x1234));
    }

    function test_setTrustedCaller_revertsIfAlreadySet() public {
        // setUp didn't set trustedCaller — first call locks it.
        hook.setTrustedCaller(address(0x1234));
        vm.expectRevert(PolicyHook.TrustedCallerAlreadySet.selector);
        hook.setTrustedCaller(address(0x5678));
    }
}

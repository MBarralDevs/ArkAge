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
        hook = new PolicyHook(address(acp), address(registry));

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
        vm.expectRevert(bytes("only ACP"));
        hook.beforeAction(1, IACP.fund.selector, "");
    }

    function test_beforeAction_revertsIfAgentInactive() public {
        vm.prank(owner);
        registry.deactivate(AGENT_ID);

        // setBudget resolves actor → job.provider; put `operator` there so the
        // PolicyHook lookup finds a registered (but inactive) agent.
        acp.setJob(1, _job(operator, 0));

        vm.expectRevert(bytes("policy: agent inactive"));
        acp.callBeforeAction(address(hook), 1, IACP.setBudget.selector, "");
    }

    function test_beforeAction_revertsOnFundExceedingPerTxCap() public {
        // fund resolves actor → job.client; register operator under client field.
        IACP.Job memory j = _job(address(0), 0);
        j.client = operator;
        acp.setJob(1, j);

        bytes memory data = abi.encode(uint256(10_000_000)); // > 5_000_000 cap
        vm.expectRevert(bytes("policy: per-tx cap"));
        acp.callBeforeAction(address(hook), 1, IACP.fund.selector, data);
    }

    function test_beforeAction_passesWhenWithinPolicy() public {
        IACP.Job memory j = _job(address(0), 0);
        j.client = operator;
        acp.setJob(1, j);

        bytes memory data = abi.encode(uint256(1_000_000));
        acp.callBeforeAction(address(hook), 1, IACP.fund.selector, data);
        // should not revert
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
        IACP.Job memory j = _job(address(0), 0);
        j.client = address(0xDEAD);
        acp.setJob(1, j);

        bytes memory data = abi.encode(uint256(99_999_999_999)); // huge — would fail cap if registered
        acp.callBeforeAction(address(hook), 1, IACP.fund.selector, data);
        // no revert: unregistered actor bypasses gate entirely
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
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReputationHook} from "../../src/ReputationHook.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {IACP} from "../../src/interfaces/IACP.sol";
import {MockACP} from "../mocks/MockACP.sol";
import {MockReputationRegistry} from "../mocks/MockReputationRegistry.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";

contract ReputationHookTest is Test {
    ReputationHook hook;
    AgentRegistry registry;
    MockACP acp;
    MockReputationRegistry repReg;
    MockIdentityRegistry idReg;

    address owner = address(0xAAAA);
    address providerOperator = address(0xBBBB);
    uint256 constant PROVIDER_AGENT_ID = 100;

    bytes32 constant REASON = bytes32(uint256(0xDEADBEEF));

    function setUp() public {
        idReg = new MockIdentityRegistry();
        acp = new MockACP();
        repReg = new MockReputationRegistry();
        registry = new AgentRegistry(address(idReg), address(acp));
        hook = new ReputationHook(address(acp), address(repReg), address(registry), address(this));

        idReg.setOwner(PROVIDER_AGENT_ID, owner);
        vm.prank(owner);
        registry.registerAgent(PROVIDER_AGENT_ID, providerOperator, keccak256("p"), 1, 1);
    }

    function _job() internal view returns (IACP.Job memory) {
        return IACP.Job({
            client: address(0),
            provider: providerOperator,
            evaluator: address(0),
            budget: 0,
            expiredAt: 0,
            status: IACP.JobStatus.Completed,
            reason: REASON,
            hook: address(0)
        });
    }

    // ---- Plan A's 6 specified tests ----

    function test_afterAction_complete_writesPositiveFeedback() public {
        acp.setJob(1, _job());
        acp.callAfterAction(address(hook), 1, IACP.complete.selector, "");

        assertEq(repReg.callsLength(), 1);
        (uint256 agentId, int128 value,,,,,,, address sender) = repReg.calls(0);
        assertEq(agentId, PROVIDER_AGENT_ID);
        assertEq(value, int128(100));
        assertEq(sender, address(hook));
    }

    function test_afterAction_reject_writesNegativeFeedback() public {
        acp.setJob(1, _job());
        acp.callAfterAction(address(hook), 1, IACP.reject.selector, "");

        assertEq(repReg.callsLength(), 1);
        (, int128 value,,,,,,,) = repReg.calls(0);
        assertEq(value, int128(-50));
    }

    function test_afterAction_passesReasonAsFeedbackHash() public {
        acp.setJob(1, _job());
        acp.callAfterAction(address(hook), 1, IACP.complete.selector, "");

        (,,,,,,, bytes32 fbHash,) = repReg.calls(0);
        assertEq(fbHash, REASON);
    }

    function test_afterAction_skipsIfProviderUnknown() public {
        IACP.Job memory j = _job();
        j.provider = address(0xDEAD); // not registered
        acp.setJob(1, j);

        acp.callAfterAction(address(hook), 1, IACP.complete.selector, "");
        assertEq(repReg.callsLength(), 0);
    }

    function test_afterAction_revertsIfCallerNotACP() public {
        vm.expectRevert(ReputationHook.OnlyACP.selector);
        hook.afterAction(1, IACP.complete.selector, "");
    }

    function test_beforeAction_isNoOp() public {
        acp.callBeforeAction(address(hook), 1, IACP.fund.selector, "");
        // no revert, no state change
    }

    // ---- additional coverage: non-terminal selectors + reject hash threading ----

    function test_afterAction_skipsForNonTerminalSelector() public {
        // submit/setBudget/etc. should NOT write reputation — only complete + reject do.
        acp.setJob(1, _job());
        acp.callAfterAction(address(hook), 1, IACP.submit.selector, "");
        assertEq(repReg.callsLength(), 0);
    }

    function test_afterAction_reject_threadsReasonHash() public {
        acp.setJob(1, _job());
        acp.callAfterAction(address(hook), 1, IACP.reject.selector, "");

        (,,,,,,, bytes32 fbHash,) = repReg.calls(0);
        assertEq(fbHash, REASON);
    }

    function test_afterAction_handlesJobIdZero() public {
        // Ensures the _toString(0) → "0" early-return branch is exercised.
        // Edge case: jobId 0 is unusual but valid in the contract path.
        acp.setJob(0, _job());
        acp.callAfterAction(address(hook), 0, IACP.complete.selector, "");
        assertEq(repReg.callsLength(), 1);
    }

    // ---- security regression: idempotency on double-complete/reject ----

    function test_afterAction_idempotency_secondCompleteIsNoOp() public {
        acp.setJob(1, _job());
        acp.callAfterAction(address(hook), 1, IACP.complete.selector, "");
        assertEq(repReg.callsLength(), 1);

        // Second call (e.g. ACP retry) must not double-write reputation.
        acp.callAfterAction(address(hook), 1, IACP.complete.selector, "");
        assertEq(repReg.callsLength(), 1, "idempotency violated");
    }

    function test_afterAction_idempotency_rejectAfterCompleteIsNoOp() public {
        // If a job somehow received both complete and reject (defensive),
        // the second write must not occur.
        acp.setJob(1, _job());
        acp.callAfterAction(address(hook), 1, IACP.complete.selector, "");
        assertEq(repReg.callsLength(), 1);

        acp.callAfterAction(address(hook), 1, IACP.reject.selector, "");
        assertEq(repReg.callsLength(), 1, "idempotency violated");
    }

    // ---- trusted-caller bootstrap error paths ----

    function test_setTrustedCaller_revertsIfNotInitializer() public {
        vm.expectRevert(ReputationHook.OnlyInitializer.selector);
        vm.prank(address(0xBAD));
        hook.setTrustedCaller(address(0x1234));
    }

    function test_setTrustedCaller_revertsIfAlreadySet() public {
        hook.setTrustedCaller(address(0x1234));
        vm.expectRevert(ReputationHook.TrustedCallerAlreadySet.selector);
        hook.setTrustedCaller(address(0x5678));
    }
}

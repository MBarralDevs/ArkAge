// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RateLimitHook} from "../../src/RateLimitHook.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {IACP} from "../../src/interfaces/IACP.sol";
import {MockACP} from "../mocks/MockACP.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";

contract RateLimitHookTest is Test {
    RateLimitHook hook;
    AgentRegistry registry;
    MockACP acp;
    MockIdentityRegistry idReg;

    address owner = address(0xAAAA);
    address operator = address(0xBBBB);
    address otherOwner = address(0xCCCC);
    uint256 constant AGENT_ID = 42;

    uint256 constant EPOCH_SECONDS = 3600; // 1 hour
    uint256 constant DEFAULT_LIMIT = 3;

    function setUp() public {
        idReg = new MockIdentityRegistry();
        acp = new MockACP();
        registry = new AgentRegistry(address(idReg), address(acp));
        hook = new RateLimitHook(
            address(acp),
            address(registry),
            address(idReg),
            address(this),
            EPOCH_SECONDS,
            DEFAULT_LIMIT
        );

        idReg.setOwner(AGENT_ID, owner);
        vm.prank(owner);
        registry.registerAgent(
            AGENT_ID,
            operator,
            keccak256("p"),
            5_000_000,
            100_000
        );

        // Pin block timestamp inside epoch 100 for predictable math.
        vm.warp(EPOCH_SECONDS * 100 + 1);
    }

    function _job(
        address client,
        address provider,
        uint256 budget
    ) internal pure returns (IACP.Job memory) {
        return
            IACP.Job({
                client: client,
                provider: provider,
                evaluator: address(0),
                budget: budget,
                expiredAt: 0,
                status: IACP.JobStatus.Funded,
                reason: bytes32(0),
                hook: address(0)
            });
    }

    // ---- guard: only ACP can call ----

    function test_beforeAction_revertsIfCallerNotACP() public {
        vm.expectRevert(RateLimitHook.OnlyACP.selector);
        hook.beforeAction(1, IACP.fund.selector, "");
    }

    // ---- BYO: unknown actor is not rate-limited ----

    function test_beforeAction_byo_unknownActor_passesSilently() public {
        // client field has the operator address but it's NOT registered to
        // any agent — agentIdByOperator returns 0 → early return.
        address randomEoa = address(0xDEAD);
        acp.setJob(1, _job(randomEoa, address(0), 1));

        // Should not revert and should not increment any counter.
        vm.prank(address(acp));
        hook.beforeAction(1, IACP.fund.selector, "");

        assertEq(hook.callsInEpoch(AGENT_ID, hook.currentEpoch()), 0);
    }

    // ---- default-limit path ----

    function test_beforeAction_default_allowsUpToCap() public {
        // operator is the client (so actor for `fund`).
        acp.setJob(1, _job(operator, address(0), 0));

        for (uint256 i = 0; i < DEFAULT_LIMIT; i++) {
            vm.prank(address(acp));
            hook.beforeAction(1, IACP.fund.selector, "");
        }

        assertEq(
            hook.callsInEpoch(AGENT_ID, hook.currentEpoch()),
            DEFAULT_LIMIT
        );
    }

    function test_beforeAction_default_revertsAtCapPlusOne() public {
        acp.setJob(1, _job(operator, address(0), 0));
        for (uint256 i = 0; i < DEFAULT_LIMIT; i++) {
            vm.prank(address(acp));
            hook.beforeAction(1, IACP.fund.selector, "");
        }
        vm.prank(address(acp));
        vm.expectRevert(
            abi.encodeWithSelector(
                RateLimitHook.RateLimitExceeded.selector,
                AGENT_ID,
                DEFAULT_LIMIT + 1,
                DEFAULT_LIMIT
            )
        );
        hook.beforeAction(1, IACP.fund.selector, "");
    }

    // ---- per-agent override path ----

    function test_setLimit_onlyIdentityOwnerCanSet() public {
        vm.prank(otherOwner);
        vm.expectRevert(RateLimitHook.OnlyIdentityOwner.selector);
        hook.setLimit(AGENT_ID, 10);
    }

    function test_setLimit_override_takesEffect() public {
        vm.prank(owner);
        hook.setLimit(AGENT_ID, 1);

        assertEq(hook.effectiveLimit(AGENT_ID), 1);

        acp.setJob(1, _job(operator, address(0), 0));
        vm.prank(address(acp));
        hook.beforeAction(1, IACP.fund.selector, "");

        // Second call now exceeds the tightened cap.
        vm.prank(address(acp));
        vm.expectRevert(
            abi.encodeWithSelector(
                RateLimitHook.RateLimitExceeded.selector,
                AGENT_ID,
                2,
                1
            )
        );
        hook.beforeAction(1, IACP.fund.selector, "");
    }

    function test_setLimit_zeroFallsBackToDefault() public {
        vm.prank(owner);
        hook.setLimit(AGENT_ID, 9999);
        vm.prank(owner);
        hook.setLimit(AGENT_ID, 0);
        assertEq(hook.effectiveLimit(AGENT_ID), DEFAULT_LIMIT);
    }

    // ---- epoch rollover resets counter ----

    function test_epoch_rolloverResetsCounter() public {
        acp.setJob(1, _job(operator, address(0), 0));

        for (uint256 i = 0; i < DEFAULT_LIMIT; i++) {
            vm.prank(address(acp));
            hook.beforeAction(1, IACP.fund.selector, "");
        }
        uint256 epochBefore = hook.currentEpoch();

        // Advance into the next epoch.
        vm.warp(block.timestamp + EPOCH_SECONDS);
        assertEq(hook.currentEpoch(), epochBefore + 1);

        // Old epoch is full but new epoch starts at 0.
        assertEq(hook.callsInEpoch(AGENT_ID, epochBefore), DEFAULT_LIMIT);
        assertEq(hook.callsInEpoch(AGENT_ID, epochBefore + 1), 0);

        // Calls in the new epoch succeed up to the cap again.
        for (uint256 i = 0; i < DEFAULT_LIMIT; i++) {
            vm.prank(address(acp));
            hook.beforeAction(1, IACP.fund.selector, "");
        }
        assertEq(
            hook.callsInEpoch(AGENT_ID, epochBefore + 1),
            DEFAULT_LIMIT
        );
    }

    // ---- afterAction is a no-op ----

    function test_afterAction_isNoop() public view {
        hook.afterAction(1, IACP.complete.selector, "");
    }

    // ---- trusted-caller wiring ----

    function test_setTrustedCaller_onlyInitializer() public {
        // initializer is `address(this)` per setUp; calling from a foreign
        // address should revert.
        vm.prank(otherOwner);
        vm.expectRevert(RateLimitHook.OnlyInitializer.selector);
        hook.setTrustedCaller(address(0xBEEF));
    }

    function test_setTrustedCaller_settableOnce() public {
        hook.setTrustedCaller(address(0xBEEF));
        vm.expectRevert(RateLimitHook.TrustedCallerAlreadySet.selector);
        hook.setTrustedCaller(address(0xCAFE));
    }

    function test_setTrustedCaller_changesAuthorizedCaller() public {
        address composer = address(0xBEEF);
        hook.setTrustedCaller(composer);

        // ACP can no longer call directly — only the composer.
        acp.setJob(1, _job(operator, address(0), 0));
        vm.prank(address(acp));
        vm.expectRevert(RateLimitHook.OnlyACP.selector);
        hook.beforeAction(1, IACP.fund.selector, "");

        vm.prank(composer);
        hook.beforeAction(1, IACP.fund.selector, "");
        assertEq(hook.callsInEpoch(AGENT_ID, hook.currentEpoch()), 1);
    }

    // ---- selector-actor resolution table coverage ----

    function test_actorResolution_setBudget_usesProvider() public {
        // Register a second agent whose operator is the job.provider.
        uint256 OTHER_AGENT = 43;
        address otherOperator = address(0xEEEE);
        idReg.setOwner(OTHER_AGENT, owner);
        vm.prank(owner);
        registry.registerAgent(
            OTHER_AGENT,
            otherOperator,
            keccak256("p2"),
            5_000_000,
            100_000
        );

        acp.setJob(1, _job(address(0), otherOperator, 0));
        vm.prank(address(acp));
        hook.beforeAction(1, IACP.setBudget.selector, "");

        assertEq(
            hook.callsInEpoch(OTHER_AGENT, hook.currentEpoch()),
            1
        );
        assertEq(hook.callsInEpoch(AGENT_ID, hook.currentEpoch()), 0);
    }
}

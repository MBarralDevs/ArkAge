// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {RoyaltyHook} from "../../src/RoyaltyHook.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {IACP} from "../../src/interfaces/IACP.sol";
import {MockACP} from "../mocks/MockACP.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";

contract RoyaltyHookTest is Test {
    RoyaltyHook hook;
    AgentRegistry registry;
    MockACP acp;
    MockIdentityRegistry idReg;

    address owner = address(0xAAAA);
    address operator = address(0xBBBB);
    address recipient = address(0xDDDD);
    address otherOwner = address(0xCCCC);

    uint256 constant AGENT_ID = 77;

    event RoyaltyOwed(
        uint256 indexed jobId,
        uint256 indexed providerAgentId,
        address indexed recipient,
        uint256 amount,
        uint16 bps,
        uint256 budget
    );

    event RoyaltyConfigured(
        uint256 indexed agentId,
        address indexed recipient,
        uint16 bps,
        address indexed by
    );

    function setUp() public {
        idReg = new MockIdentityRegistry();
        acp = new MockACP();
        registry = new AgentRegistry(address(idReg), address(acp));
        hook = new RoyaltyHook(
            address(acp),
            address(registry),
            address(idReg),
            address(this)
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
    }

    function _job(
        address provider,
        uint256 budget
    ) internal pure returns (IACP.Job memory) {
        return
            IACP.Job({
                client: address(0),
                provider: provider,
                evaluator: address(0),
                budget: budget,
                expiredAt: 0,
                status: IACP.JobStatus.Completed,
                reason: bytes32(0),
                hook: address(0)
            });
    }

    // ---- guard: only ACP can call ----

    function test_afterAction_revertsIfCallerNotACP() public {
        vm.expectRevert(RoyaltyHook.OnlyACP.selector);
        hook.afterAction(1, IACP.complete.selector, "");
    }

    // ---- setRoyalty access control ----

    function test_setRoyalty_onlyIdentityOwner() public {
        vm.prank(otherOwner);
        vm.expectRevert(RoyaltyHook.OnlyIdentityOwner.selector);
        hook.setRoyalty(AGENT_ID, recipient, 500);
    }

    function test_setRoyalty_capsBps() public {
        vm.prank(owner);
        vm.expectRevert(RoyaltyHook.BpsOutOfRange.selector);
        hook.setRoyalty(AGENT_ID, recipient, 5001); // MAX_BPS + 1
    }

    function test_setRoyalty_zeroRecipientWithNonZeroBpsReverts() public {
        vm.prank(owner);
        vm.expectRevert(RoyaltyHook.RecipientZero.selector);
        hook.setRoyalty(AGENT_ID, address(0), 500);
    }

    function test_setRoyalty_zeroRecipientWithZeroBpsClears() public {
        // First set a config.
        vm.prank(owner);
        hook.setRoyalty(AGENT_ID, recipient, 500);

        // Then clear it (address(0), bps=0 is allowed).
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit RoyaltyConfigured(AGENT_ID, address(0), 0, owner);
        hook.setRoyalty(AGENT_ID, address(0), 0);

        (address r, uint16 b) = hook.royaltyOf(AGENT_ID);
        assertEq(r, address(0));
        assertEq(b, 0);
    }

    function test_setRoyalty_persistsConfig() public {
        vm.prank(owner);
        hook.setRoyalty(AGENT_ID, recipient, 750);
        (address r, uint16 b) = hook.royaltyOf(AGENT_ID);
        assertEq(r, recipient);
        assertEq(b, 750);
    }

    // ---- afterAction emission ----

    function test_afterAction_emitsRoyaltyOwed_whenConfigured() public {
        vm.prank(owner);
        hook.setRoyalty(AGENT_ID, recipient, 500); // 5%

        // Provider operator is the registered agent; budget = 1_000_000 raw
        // (1 USDC at 6 decimals) → owed = 50_000 (0.05 USDC).
        acp.setJob(1, _job(operator, 1_000_000));

        vm.expectEmit(true, true, true, true);
        emit RoyaltyOwed(1, AGENT_ID, recipient, 50_000, 500, 1_000_000);

        vm.prank(address(acp));
        hook.afterAction(1, IACP.complete.selector, "");
    }

    function test_afterAction_silentForNonCompleteSelector() public {
        vm.prank(owner);
        hook.setRoyalty(AGENT_ID, recipient, 500);
        acp.setJob(1, _job(operator, 1_000_000));

        // Should not emit on reject or any other selector.
        vm.recordLogs();
        vm.prank(address(acp));
        hook.afterAction(1, IACP.reject.selector, "");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 0);
    }

    function test_afterAction_silentWhenProviderUnregistered() public {
        address randomProvider = address(0xBEEF);
        acp.setJob(1, _job(randomProvider, 1_000_000));

        vm.recordLogs();
        vm.prank(address(acp));
        hook.afterAction(1, IACP.complete.selector, "");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 0);
    }

    function test_afterAction_silentWhenNoRoyaltyConfig() public {
        // Provider is registered but no royalty was set.
        acp.setJob(1, _job(operator, 1_000_000));

        vm.recordLogs();
        vm.prank(address(acp));
        hook.afterAction(1, IACP.complete.selector, "");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 0);
    }

    function test_afterAction_silentWhenComputedAmountIsZero() public {
        // 1 bps of a tiny budget rounds to 0 — no point emitting.
        vm.prank(owner);
        hook.setRoyalty(AGENT_ID, recipient, 1); // 0.01%
        acp.setJob(1, _job(operator, 100)); // 100 * 1 / 10000 = 0

        vm.recordLogs();
        vm.prank(address(acp));
        hook.afterAction(1, IACP.complete.selector, "");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 0);
    }

    function test_afterAction_emitsCorrectAmountAtMaxBps() public {
        vm.prank(owner);
        hook.setRoyalty(AGENT_ID, recipient, 5000); // 50% cap
        acp.setJob(1, _job(operator, 2_000_000));

        vm.expectEmit(true, true, true, true);
        emit RoyaltyOwed(1, AGENT_ID, recipient, 1_000_000, 5000, 2_000_000);

        vm.prank(address(acp));
        hook.afterAction(1, IACP.complete.selector, "");
    }

    // ---- beforeAction is a no-op ----

    function test_beforeAction_isNoop() public view {
        hook.beforeAction(1, IACP.fund.selector, "");
    }

    // ---- trusted-caller wiring ----

    function test_setTrustedCaller_onlyInitializer() public {
        vm.prank(otherOwner);
        vm.expectRevert(RoyaltyHook.OnlyInitializer.selector);
        hook.setTrustedCaller(address(0xBEEF));
    }

    function test_setTrustedCaller_settableOnce() public {
        hook.setTrustedCaller(address(0xBEEF));
        vm.expectRevert(RoyaltyHook.TrustedCallerAlreadySet.selector);
        hook.setTrustedCaller(address(0xCAFE));
    }
}

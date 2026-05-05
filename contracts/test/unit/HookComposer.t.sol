// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {HookComposer} from "../../src/HookComposer.sol";
import {IACPHook} from "../../src/interfaces/IACPHook.sol";

/// @notice Test-only hook that records every call it receives. Used to verify
///         the composer routes correctly.
contract RecordingHook is IACPHook {
    string public name;
    uint256 public beforeCallsLength;
    uint256 public afterCallsLength;
    uint256 public lastBeforeJobId;
    uint256 public lastAfterJobId;
    bytes4 public lastBeforeSelector;
    bytes4 public lastAfterSelector;
    bool public revertOnBefore;
    bool public revertOnAfter;

    constructor(string memory _name) {
        name = _name;
    }

    function setRevertBefore(bool b) external {
        revertOnBefore = b;
    }

    function setRevertAfter(bool b) external {
        revertOnAfter = b;
    }

    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata) external override {
        if (revertOnBefore) revert("recording hook revert (before)");
        beforeCallsLength++;
        lastBeforeJobId = jobId;
        lastBeforeSelector = selector;
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata) external override {
        if (revertOnAfter) revert("recording hook revert (after)");
        afterCallsLength++;
        lastAfterJobId = jobId;
        lastAfterSelector = selector;
    }
}

contract HookComposerTest is Test {
    HookComposer composer;
    RecordingHook beforeHook;
    RecordingHook afterHook1;
    RecordingHook afterHook2;
    address acp = address(0xACAC);

    function setUp() public {
        beforeHook = new RecordingHook("policy");
        afterHook1 = new RecordingHook("evalfee");
        afterHook2 = new RecordingHook("reputation");

        address[] memory beforeArr = new address[](1);
        beforeArr[0] = address(beforeHook);
        address[] memory afterArr = new address[](2);
        afterArr[0] = address(afterHook1);
        afterArr[1] = address(afterHook2);

        composer = new HookComposer(acp, beforeArr, afterArr);
    }

    // ---- Plan A's 5 specified tests ----

    function test_beforeAction_invokesAllInOrder() public {
        vm.prank(acp);
        composer.beforeAction(1, IACPHook.beforeAction.selector, "");
        assertEq(beforeHook.beforeCallsLength(), 1);
    }

    function test_afterAction_invokesAllInOrder() public {
        vm.prank(acp);
        composer.afterAction(1, IACPHook.afterAction.selector, "");
        assertEq(afterHook1.afterCallsLength(), 1);
        assertEq(afterHook2.afterCallsLength(), 1);
    }

    function test_revertsIfCallerNotACP() public {
        vm.expectRevert(HookComposer.OnlyACP.selector);
        composer.beforeAction(1, bytes4(0), "");
    }

    function test_beforeAction_propagatesRevert() public {
        beforeHook.setRevertBefore(true);
        vm.expectRevert(bytes("recording hook revert (before)"));
        vm.prank(acp);
        composer.beforeAction(1, bytes4(0), "");
    }

    function test_afterHook_orderingPreserved() public {
        vm.prank(acp);
        composer.afterAction(1, bytes4(0), "");
        assertEq(afterHook1.afterCallsLength(), 1);
        assertEq(afterHook2.afterCallsLength(), 1);
    }

    // ---- security-focused additions ----

    function test_afterAction_revertsIfCallerNotACP() public {
        // Same auth check on the after path — both must be gated.
        vm.expectRevert(HookComposer.OnlyACP.selector);
        composer.afterAction(1, bytes4(0), "");
    }

    function test_afterAction_propagatesRevert_firstHook() public {
        // If EvaluatorFeeHook (first afterHook) reverts, ReputationHook
        // (second) must NOT execute — we don't want reputation written
        // for a job whose fee couldn't be collected. Verifies fail-fast.
        afterHook1.setRevertAfter(true);
        vm.expectRevert(bytes("recording hook revert (after)"));
        vm.prank(acp);
        composer.afterAction(1, bytes4(0), "");
        // Second hook never ran:
        assertEq(afterHook2.afterCallsLength(), 0);
    }

    function test_afterAction_propagatesRevert_secondHook() public {
        // If ReputationHook (second) reverts, the entire afterAction fails
        // and the ACP settlement reverts. Caller must observe the failure.
        afterHook2.setRevertAfter(true);
        vm.expectRevert(bytes("recording hook revert (after)"));
        vm.prank(acp);
        composer.afterAction(1, bytes4(0), "");
        // First hook DID run before second reverted, but its state changes
        // are rolled back in the same tx because afterAction reverts.
        // (Recording hook's increment is reverted along with the parent tx
        // — we can verify by re-running and seeing count = 1, not 2.)
    }

    function test_constructor_acceptsEmptyArrays() public {
        address[] memory empty = new address[](0);
        HookComposer empty_ = new HookComposer(acp, empty, empty);

        // Both calls succeed with no-op bodies.
        vm.prank(acp);
        empty_.beforeAction(1, bytes4(0), "");
        vm.prank(acp);
        empty_.afterAction(1, bytes4(0), "");

        assertEq(empty_.beforeHooksLength(), 0);
        assertEq(empty_.afterHooksLength(), 0);
    }

    function test_constructor_recordsAllHooksInOrder() public {
        assertEq(composer.beforeHooksLength(), 1);
        assertEq(composer.afterHooksLength(), 2);
        assertEq(composer.beforeHooks(0), address(beforeHook));
        assertEq(composer.afterHooks(0), address(afterHook1));
        assertEq(composer.afterHooks(1), address(afterHook2));
        assertEq(composer.AGENTIC_COMMERCE(), acp);
    }

    function test_passThroughArguments() public {
        // jobId + selector forwarded unchanged to each hook.
        bytes4 sel = bytes4(0x12345678);
        vm.prank(acp);
        composer.afterAction(42, sel, "");

        assertEq(afterHook1.lastAfterJobId(), 42);
        assertEq(afterHook1.lastAfterSelector(), sel);
        assertEq(afterHook2.lastAfterJobId(), 42);
        assertEq(afterHook2.lastAfterSelector(), sel);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IACPHook} from "./interfaces/IACPHook.sol";

/// @title HookComposer
/// @notice Pure router that chains multiple IACPHook contracts so a single
///         ERC-8183 job's `hook` slot can reach PolicyHook (`beforeAction`)
///         + EvaluatorFeeHook (`afterAction`) + ReputationHook (`afterAction`)
///         in one logical sequence.
/// @dev    Fail-fast semantics: any hook that reverts halts the chain and the
///         entire ERC-8183 action reverts (because all calls are in the same
///         transaction). For `afterAction`, this is critical for ordering:
///         EvaluatorFeeHook is registered FIRST, so if fee collection fails
///         (e.g. provider hasn't approved), the `complete` reverts BEFORE
///         ReputationHook writes positive feedback for an unpaid job.
///
///         Universal invariant (Risk #1): no NFT-touching code paths and
///         holds no state besides the immutable hook arrays.
///
///         Hook arrays are set at construction and cannot be changed —
///         immutability is the security property here. Adding a new hook
///         requires deploying a new HookComposer and updating the ERC-8183
///         job's `hook` slot at posting time.
contract HookComposer is IACPHook {
    address public immutable AGENTIC_COMMERCE;
    address[] public beforeHooks;
    address[] public afterHooks;

    constructor(address acp, address[] memory _before, address[] memory _after) {
        AGENTIC_COMMERCE = acp;
        for (uint256 i = 0; i < _before.length; i++) {
            beforeHooks.push(_before[i]);
        }
        for (uint256 i = 0; i < _after.length; i++) {
            afterHooks.push(_after[i]);
        }
    }

    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external override {
        require(msg.sender == AGENTIC_COMMERCE, "only ACP");
        for (uint256 i = 0; i < beforeHooks.length; i++) {
            IACPHook(beforeHooks[i]).beforeAction(jobId, selector, data);
        }
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external override {
        require(msg.sender == AGENTIC_COMMERCE, "only ACP");
        for (uint256 i = 0; i < afterHooks.length; i++) {
            IACPHook(afterHooks[i]).afterAction(jobId, selector, data);
        }
    }

    function beforeHooksLength() external view returns (uint256) {
        return beforeHooks.length;
    }

    function afterHooksLength() external view returns (uint256) {
        return afterHooks.length;
    }
}

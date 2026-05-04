// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IACP} from "../../src/interfaces/IACP.sol";
import {IACPHook} from "../../src/interfaces/IACPHook.sol";

contract MockACP is IACP {
    mapping(uint256 => Job) private _jobs;

    function setJob(uint256 jobId, Job memory j) external {
        _jobs[jobId] = j;
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    // Helpers to invoke hooks as if from ACP
    function callBeforeAction(address hook, uint256 jobId, bytes4 selector, bytes calldata data) external {
        IACPHook(hook).beforeAction(jobId, selector, data);
    }

    function callAfterAction(address hook, uint256 jobId, bytes4 selector, bytes calldata data) external {
        IACPHook(hook).afterAction(jobId, selector, data);
    }

    // Stubs to satisfy interface (unused in tests)
    function setProvider(uint256, address, bytes calldata) external pure {}
    function setBudget(uint256, uint256, bytes calldata) external pure {}
    function fund(uint256, bytes calldata) external pure {}
    function submit(uint256, bytes32, bytes calldata) external pure {}
    function complete(uint256, bytes32, bytes calldata) external pure {}
    function reject(uint256, bytes32, bytes calldata) external pure {}
    function claimRefund(uint256) external pure {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IACP {
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        address client;
        address provider;
        address evaluator;
        uint256 budget;
        uint256 expiredAt;
        JobStatus status;
        bytes32 reason;
        address hook;
    }

    function getJob(uint256 jobId) external view returns (Job memory);

    // Selectors we hook into
    function setProvider(uint256 jobId, address provider, bytes calldata data) external;
    function setBudget(uint256 jobId, uint256 amount, bytes calldata data) external;
    function fund(uint256 jobId, bytes calldata data) external;
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata data) external;
    function complete(uint256 jobId, bytes32 reason, bytes calldata data) external;
    function reject(uint256 jobId, bytes32 reason, bytes calldata data) external;
    function claimRefund(uint256 jobId) external;
}

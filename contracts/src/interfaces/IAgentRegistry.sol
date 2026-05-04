// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAgentRegistry {
    struct AgentInfo {
        address operatorWallet;
        bytes32 currentPolicyHash;
        uint128 perTxCap;
        uint64 evaluatorFeeMax;
        bool active;
    }

    function agents(uint256 agentId) external view returns (AgentInfo memory);
    function agentByOperator(address op) external view returns (AgentInfo memory);
    function agentIdByOperator(address op) external view returns (uint256);
    function evaluatorFeeFor(uint256 jobId) external view returns (uint256);
    function jobFeeRecorded(uint256 jobId) external view returns (bool);

    function registerAgent(
        uint256 agentId,
        address op,
        bytes32 policy,
        uint128 perTx,
        uint64 evalFeeMax
    ) external;
    function updateOperator(uint256 agentId, address op) external;
    function updatePolicy(uint256 agentId, bytes32 policy, uint128 perTx, uint64 evalFeeMax) external;
    function deactivate(uint256 agentId) external;
    function reactivate(uint256 agentId) external;
    function recordJobFee(uint256 jobId, uint256 fee) external;
}

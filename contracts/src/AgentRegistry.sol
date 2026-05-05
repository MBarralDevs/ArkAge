// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";
import {IACP} from "./interfaces/IACP.sol";

/// @title AgentRegistry
/// @notice Maps ERC-8004 agent identities to their current Tier 2 operator
///         wallet, current policy hash, evaluator fee config, and active flag.
///         Owned by the ERC-8004 identity owner.
/// @dev    Universal invariant (Risk #1): this contract MUST never own or be
///         approved-operator of any ERC-8004 identity NFT. Verified by
///         test/invariant/HookOwnership.invariant.t.sol.
contract AgentRegistry is IAgentRegistry {
    address public immutable IDENTITY_REGISTRY;
    address public immutable AGENTIC_COMMERCE;

    mapping(uint256 => AgentInfo) private _agents;
    mapping(address => uint256) public override agentIdByOperator;

    /// @notice Per-job evaluator fee. Set once by the job's client during
    ///         fund_job and frozen — see IAgentRegistry.recordJobFee.
    mapping(uint256 => uint256) public override evaluatorFeeFor;
    mapping(uint256 => bool) public override jobFeeRecorded;

    event AgentRegistered(uint256 indexed agentId, address indexed operator, bytes32 policyHash);
    event OperatorUpdated(uint256 indexed agentId, address indexed previous, address indexed next);
    event PolicyUpdated(uint256 indexed agentId, bytes32 policyHash, uint128 perTxCap, uint64 evalFeeMax);
    event AgentDeactivated(uint256 indexed agentId);
    event AgentReactivated(uint256 indexed agentId);
    event JobFeeRecorded(uint256 indexed jobId, uint256 fee);

    modifier onlyIdentityOwner(uint256 agentId) {
        require(IIdentityRegistry(IDENTITY_REGISTRY).ownerOf(agentId) == msg.sender, "not identity owner");
        _;
    }

    constructor(address identityRegistry, address agenticCommerce) {
        IDENTITY_REGISTRY = identityRegistry;
        AGENTIC_COMMERCE = agenticCommerce;
    }

    function agents(uint256 agentId) external view override returns (AgentInfo memory) {
        return _agents[agentId];
    }

    function agentByOperator(address op) external view override returns (AgentInfo memory) {
        uint256 agentId = agentIdByOperator[op];
        return _agents[agentId];
    }

    function registerAgent(uint256 agentId, address op, bytes32 policy, uint128 perTx, uint64 evalFeeMax)
        external
        override
        onlyIdentityOwner(agentId)
    {
        require(_agents[agentId].operatorWallet == address(0), "already registered");
        require(op != address(0), "operator zero");
        _agents[agentId] = AgentInfo({
            operatorWallet: op,
            currentPolicyHash: policy,
            perTxCap: perTx,
            evaluatorFeeMax: evalFeeMax,
            active: true
        });
        agentIdByOperator[op] = agentId;
        emit AgentRegistered(agentId, op, policy);
    }

    function updateOperator(uint256 agentId, address op) external override onlyIdentityOwner(agentId) {
        require(op != address(0), "operator zero");
        address prev = _agents[agentId].operatorWallet;
        require(prev != address(0), "not registered");
        agentIdByOperator[prev] = 0;
        _agents[agentId].operatorWallet = op;
        agentIdByOperator[op] = agentId;
        emit OperatorUpdated(agentId, prev, op);
    }

    function updatePolicy(uint256 agentId, bytes32 policy, uint128 perTx, uint64 evalFeeMax)
        external
        override
        onlyIdentityOwner(agentId)
    {
        require(_agents[agentId].operatorWallet != address(0), "not registered");
        _agents[agentId].currentPolicyHash = policy;
        _agents[agentId].perTxCap = perTx;
        _agents[agentId].evaluatorFeeMax = evalFeeMax;
        emit PolicyUpdated(agentId, policy, perTx, evalFeeMax);
    }

    function deactivate(uint256 agentId) external override onlyIdentityOwner(agentId) {
        _agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }

    function reactivate(uint256 agentId) external override onlyIdentityOwner(agentId) {
        require(_agents[agentId].operatorWallet != address(0), "not registered");
        _agents[agentId].active = true;
        emit AgentReactivated(agentId);
    }

    /// @notice Record the agreed evaluator fee for a job. Set-and-freeze:
    ///         - MUST be called by the job's client (verified via IACP.getJob)
    ///         - MUST NOT be already recorded
    ///         - fee MUST be <= the caller's registered evaluatorFeeMax
    function recordJobFee(uint256 jobId, uint256 fee) external override {
        require(!jobFeeRecorded[jobId], "fee already recorded");

        IACP.Job memory j = IACP(AGENTIC_COMMERCE).getJob(jobId);
        require(j.client == msg.sender, "not job client");

        uint256 clientAgentId = agentIdByOperator[msg.sender];
        require(clientAgentId != 0, "client not registered");
        require(fee <= _agents[clientAgentId].evaluatorFeeMax, "fee exceeds max");

        evaluatorFeeFor[jobId] = fee;
        jobFeeRecorded[jobId] = true;
        emit JobFeeRecorded(jobId, fee);
    }
}

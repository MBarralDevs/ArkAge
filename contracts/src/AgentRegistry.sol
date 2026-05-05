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
    // ---- Custom errors (gas-efficient: 4-byte selectors vs string messages) ----
    error NotIdentityOwner();
    error AlreadyRegistered();
    error OperatorZero();
    error OperatorAlreadyClaimed();
    error NotRegistered();
    error FeeAlreadyRecorded();
    error NotJobClient();
    error ClientNotRegistered();
    error FeeExceedsMax();

    // ---- Immutable trust addresses ----
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
        if (IIdentityRegistry(IDENTITY_REGISTRY).ownerOf(agentId) != msg.sender) revert NotIdentityOwner();
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
        if (_agents[agentId].operatorWallet != address(0)) revert AlreadyRegistered();
        if (op == address(0)) revert OperatorZero();
        // SECURITY: prevent cross-agent operator hijack. Without this guard, an
        // attacker who owns any cheap 8004 identity could claim another agent's
        // operator address and DoS or reroute their on-chain calls through
        // PolicyHook. The previous identity owner must vacate the slot first
        // via updateOperator before another agent can claim it.
        if (agentIdByOperator[op] != 0) revert OperatorAlreadyClaimed();
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
        if (op == address(0)) revert OperatorZero();
        address prev = _agents[agentId].operatorWallet;
        if (prev == address(0)) revert NotRegistered();
        // SECURITY: same hijack guard as registerAgent — prevents one identity
        // from rotating into another agent's operator slot.
        if (agentIdByOperator[op] != 0) revert OperatorAlreadyClaimed();
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
        if (_agents[agentId].operatorWallet == address(0)) revert NotRegistered();
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
        if (_agents[agentId].operatorWallet == address(0)) revert NotRegistered();
        _agents[agentId].active = true;
        emit AgentReactivated(agentId);
    }

    /// @notice Record the agreed evaluator fee for a job. Set-and-freeze:
    ///         - MUST be called by the job's client (verified via IACP.getJob)
    ///         - MUST NOT be already recorded
    ///         - fee MUST be <= the caller's registered evaluatorFeeMax
    function recordJobFee(uint256 jobId, uint256 fee) external override {
        if (jobFeeRecorded[jobId]) revert FeeAlreadyRecorded();

        IACP.Job memory j = IACP(AGENTIC_COMMERCE).getJob(jobId);
        if (j.client != msg.sender) revert NotJobClient();

        uint256 clientAgentId = agentIdByOperator[msg.sender];
        if (clientAgentId == 0) revert ClientNotRegistered();
        if (fee > _agents[clientAgentId].evaluatorFeeMax) revert FeeExceedsMax();

        evaluatorFeeFor[jobId] = fee;
        jobFeeRecorded[jobId] = true;
        emit JobFeeRecorded(jobId, fee);
    }
}

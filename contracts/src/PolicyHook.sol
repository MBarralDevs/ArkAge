// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IACPHook} from "./interfaces/IACPHook.sol";
import {IACP} from "./interfaces/IACP.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/// @title PolicyHook
/// @notice ERC-8183 `beforeAction` gate that enforces ArkAge per-agent policy
///         on the on-chain side. Pairs with the off-chain MCP server's policy
///         engine (spec §5.3) — both must approve for an action to succeed.
/// @dev    Gated stateless rules only (per-tx cap, active flag); state-heavy
///         rules (rolling daily/weekly caps, rate limits) live off-chain.
///         Universal invariant (Risk #1): never owns or is approved-operator
///         of any ERC-8004 identity NFT — verified by the invariant test.
contract PolicyHook is IACPHook {
    // ---- Custom errors ----
    error OnlyACP();
    error AgentInactive();
    error PerTxCapExceeded();
    error OnlyInitializer();
    error TrustedCallerAlreadySet();

    // ---- Immutable: source of Job state ----
    address public immutable AGENTIC_COMMERCE;
    address public immutable AGENT_REGISTRY;
    address public immutable INITIALIZER;

    /// @notice The address allowed to invoke beforeAction/afterAction. In
    ///         production this is the HookComposer (which the ACP calls
    ///         directly). Settable exactly once by the initializer (the
    ///         deployer of this contract). Until set, falls back to
    ///         AGENTIC_COMMERCE so the hook is usable standalone in tests
    ///         and in BYO scenarios where the ACP calls the hook directly.
    address public trustedCaller;

    constructor(address acp, address agentRegistry, address initializer) {
        AGENTIC_COMMERCE = acp;
        AGENT_REGISTRY = agentRegistry;
        // Explicit initializer rather than msg.sender — necessary for CREATE2
        // deployment paths (e.g. broadcast through the canonical CREATE2
        // factory), where msg.sender at construction is the factory, not the
        // EOA that should retain post-deploy admin authority.
        INITIALIZER = initializer;
    }

    function setTrustedCaller(address caller) external {
        if (msg.sender != INITIALIZER) revert OnlyInitializer();
        if (trustedCaller != address(0)) revert TrustedCallerAlreadySet();
        trustedCaller = caller;
    }

    function _authorizedCaller() internal view returns (address) {
        address t = trustedCaller;
        return t == address(0) ? AGENTIC_COMMERCE : t;
    }

    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata /* data */) external override {
        if (msg.sender != _authorizedCaller()) revert OnlyACP();

        IACP.Job memory job = IACP(AGENTIC_COMMERCE).getJob(jobId);
        address actor = _resolveActor(selector, job);

        IAgentRegistry.AgentInfo memory info = IAgentRegistry(AGENT_REGISTRY).agentByOperator(actor);

        // BYO flows allowed: if the actor is not a registered ArkAge operator,
        // PolicyHook does not gate the action. The ArkAge MCP server's
        // off-chain policy engine never sees those calls in the first place.
        if (info.operatorWallet == address(0)) return;

        if (!info.active) revert AgentInactive();

        // SECURITY: source the funded amount from the canonical Job state
        // rather than the caller-supplied `data` blob. The previous version
        // decoded `data` as the amount, which the caller could trivially
        // zero-out to bypass the cap. job.budget is set by the provider via
        // setBudget and is the actual amount being funded.
        if (selector == IACP.fund.selector) {
            if (job.budget > info.perTxCap) revert PerTxCapExceeded();
        }
        // Additional selector-specific stateless gates can be added here.
    }

    function afterAction(uint256, bytes4, bytes calldata) external pure override {
        // no-op — PolicyHook only gates pre-action; reputation/fee writes are
        // handled by other hooks in the HookComposer chain.
    }

    /// @dev Maps an ERC-8183 hookable selector to the wallet performing it.
    function _resolveActor(bytes4 selector, IACP.Job memory job) internal pure returns (address) {
        if (selector == IACP.fund.selector) return job.client;
        if (selector == IACP.setBudget.selector) return job.provider;
        if (selector == IACP.submit.selector) return job.provider;
        if (selector == IACP.complete.selector) return job.evaluator;
        if (selector == IACP.reject.selector) return job.evaluator;
        if (selector == IACP.setProvider.selector) return job.client;
        // Fallback for any unknown / future selector — credit the client by default.
        return job.client;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IACPHook} from "./interfaces/IACPHook.sol";
import {IACP} from "./interfaces/IACP.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title  RateLimitHook
/// @notice Theme E.3 reference hook. On-chain rate limiter that runs in the
///         HookComposer chain as a `beforeAction` gate, independent of
///         PolicyHook. Caps actions per agent per epoch.
/// @dev    Purpose is to demonstrate the HookComposer composition pattern
///         beyond PolicyHook + EvaluatorFeeHook + ReputationHook, and to
///         give builders an off-the-shelf way to throttle their own agents
///         (or to operate alongside a stricter HookComposer in higher-risk
///         deployments).
///
///         Counter is bucketed by epoch (`block.timestamp / EPOCH_SECONDS`),
///         so the storage cost is bounded — old epochs naturally drop out
///         of the active read path.
///
///         Risk #1 invariant: this contract holds no ERC-8004 NFTs and
///         makes no calls into IdentityRegistry that could approve it as
///         operator. The IDENTITY_REGISTRY immutable is only used in
///         `setLimit` to verify the caller owns the agent id; reads only.
///         Covered by HookOwnership.invariant.t.sol.
contract RateLimitHook is IACPHook {
    // ---- Custom errors ----
    error OnlyACP();
    error OnlyInitializer();
    error TrustedCallerAlreadySet();
    error OnlyIdentityOwner();
    error RateLimitExceeded(uint256 agentId, uint256 currentCount, uint256 cap);

    // ---- Immutable: source of Job state + agent registry + access ----
    address public immutable AGENTIC_COMMERCE;
    address public immutable AGENT_REGISTRY;
    address public immutable IDENTITY_REGISTRY;
    address public immutable INITIALIZER;

    /// @notice Seconds per epoch. Setting this at deploy time means each
    ///         deployment has a fixed window size; builders who want a
    ///         different window deploy a separate instance.
    uint256 public immutable EPOCH_SECONDS;

    /// @notice Cap applied when an agent has no explicit override. Setting
    ///         this to `type(uint256).max` effectively disables the hook
    ///         for unconfigured agents while still letting individual
    ///         agents tighten themselves via setLimit.
    uint256 public immutable DEFAULT_LIMIT_PER_EPOCH;

    address public trustedCaller;

    /// @notice Per-agent override of DEFAULT_LIMIT_PER_EPOCH. Zero means
    ///         "use the default" — agents wanting an explicit zero cap
    ///         should set 1 + revoke the agent off-chain instead.
    mapping(uint256 agentId => uint256) public limitOverride;

    /// @notice Counter per agent per epoch. Increments on every gated
    ///         `beforeAction` for actions where this agent is the actor.
    mapping(uint256 agentId => mapping(uint256 epoch => uint256))
        public callsInEpoch;

    event RateLimitConfigured(
        uint256 indexed agentId,
        uint256 limit,
        address indexed by
    );
    event RateLimitConsumed(
        uint256 indexed agentId,
        uint256 indexed epoch,
        uint256 newCount,
        uint256 cap
    );

    constructor(
        address acp,
        address agentRegistry,
        address identityRegistry,
        address initializer,
        uint256 epochSeconds,
        uint256 defaultLimitPerEpoch
    ) {
        AGENTIC_COMMERCE = acp;
        AGENT_REGISTRY = agentRegistry;
        IDENTITY_REGISTRY = identityRegistry;
        INITIALIZER = initializer;
        EPOCH_SECONDS = epochSeconds;
        DEFAULT_LIMIT_PER_EPOCH = defaultLimitPerEpoch;
    }

    function setTrustedCaller(address caller) external {
        if (msg.sender != INITIALIZER) revert OnlyInitializer();
        if (trustedCaller != address(0)) revert TrustedCallerAlreadySet();
        trustedCaller = caller;
    }

    /// @notice Override the rate limit for an agent. Only callable by the
    ///         agent's ERC-8004 identity owner (i.e. the builder's Tier 1
    ///         wallet that minted the NFT). Setting to 0 reverts to default.
    function setLimit(uint256 agentId, uint256 limit) external {
        address owner = IIdentityRegistry(IDENTITY_REGISTRY).ownerOf(agentId);
        if (msg.sender != owner) revert OnlyIdentityOwner();
        limitOverride[agentId] = limit;
        emit RateLimitConfigured(agentId, limit, msg.sender);
    }

    function currentEpoch() public view returns (uint256) {
        return block.timestamp / EPOCH_SECONDS;
    }

    function effectiveLimit(uint256 agentId) public view returns (uint256) {
        uint256 override_ = limitOverride[agentId];
        return override_ == 0 ? DEFAULT_LIMIT_PER_EPOCH : override_;
    }

    function beforeAction(
        uint256 jobId,
        bytes4 selector,
        bytes calldata /* data */
    ) external override {
        if (msg.sender != _authorizedCaller()) revert OnlyACP();

        // Identify the actor's agent via the registry. BYO actors (no
        // registered ArkAge identity) are not rate-limited — mirrors
        // PolicyHook's BYO-friendly default.
        IACP.Job memory job = IACP(AGENTIC_COMMERCE).getJob(jobId);
        address actor = _resolveActor(selector, job);

        uint256 agentId = IAgentRegistry(AGENT_REGISTRY).agentIdByOperator(
            actor
        );
        if (agentId == 0) return;

        uint256 epoch = currentEpoch();
        uint256 cap = effectiveLimit(agentId);
        uint256 newCount = callsInEpoch[agentId][epoch] + 1;

        if (newCount > cap) {
            revert RateLimitExceeded(agentId, newCount, cap);
        }

        callsInEpoch[agentId][epoch] = newCount;
        emit RateLimitConsumed(agentId, epoch, newCount, cap);
    }

    function afterAction(
        uint256,
        bytes4,
        bytes calldata
    ) external pure override {
        // no-op — rate limiting is a pre-action concern.
    }

    function _authorizedCaller() internal view returns (address) {
        address t = trustedCaller;
        return t == address(0) ? AGENTIC_COMMERCE : t;
    }

    /// @dev Mirrors PolicyHook._resolveActor — same selector → actor mapping
    ///      keeps both hooks consistent on who gets rate-limited.
    function _resolveActor(
        bytes4 selector,
        IACP.Job memory job
    ) internal pure returns (address) {
        if (selector == IACP.fund.selector) return job.client;
        if (selector == IACP.setBudget.selector) return job.provider;
        if (selector == IACP.submit.selector) return job.provider;
        if (selector == IACP.complete.selector) return job.evaluator;
        if (selector == IACP.reject.selector) return job.evaluator;
        if (selector == IACP.setProvider.selector) return job.client;
        return job.client;
    }
}

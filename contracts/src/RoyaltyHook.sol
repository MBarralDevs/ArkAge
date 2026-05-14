// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IACPHook} from "./interfaces/IACPHook.sol";
import {IACP} from "./interfaces/IACP.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title  RoyaltyHook
/// @notice Theme E.3 reference hook. Declarative royalty layer: when a job
///         `complete`s, if the provider's agent has a royalty config, emit
///         a `RoyaltyOwed` event that off-chain settlement can pay out.
/// @dev    Why declarative-only:
///
///         ArkAge contracts never custody x402 / ERC-8183 payments — Circle
///         Gateway holds escrow during the batched flow. The hook cannot
///         redirect funds at `complete` time without taking custody, which
///         would (a) break Risk #1's "no escrow custody" implicit corollary
///         and (b) require every provider to approve unlimited spend on this
///         hook. Both are non-starters.
///
///         The reference pattern: emit a structured event that downstream
///         consumers (settlement workflows, marketplace UIs, the agent
///         operator themselves) act on. Adoption beats enforcement here —
///         the value is establishing the convention, not policing it.
///
///         Risk #1: never owns or is approved-operator of any ERC-8004 NFT.
///         Reads IdentityRegistry only for ownerOf in setRoyalty (auth).
contract RoyaltyHook is IACPHook {
    // ---- Custom errors ----
    error OnlyACP();
    error OnlyInitializer();
    error TrustedCallerAlreadySet();
    error OnlyIdentityOwner();
    error BpsOutOfRange();
    error RecipientZero();

    // ---- Immutable: source of Job state + agent + identity registries ----
    address public immutable AGENTIC_COMMERCE;
    address public immutable AGENT_REGISTRY;
    address public immutable IDENTITY_REGISTRY;
    address public immutable INITIALIZER;

    /// @notice Cap on royalty rate in basis points. 5000 = 50%. Anything
    ///         above this is rejected at setRoyalty time so accidentally
    ///         passing 50000 (5x meant 5%) doesn't silently set a half-the-
    ///         job royalty.
    uint256 public constant MAX_BPS = 5_000;

    address public trustedCaller;

    struct RoyaltyConfig {
        address recipient;
        uint16 bps;
    }

    /// @notice Per-agent royalty configuration. Zero recipient = no royalty.
    ///         Settable only by the agent's ERC-8004 identity owner.
    mapping(uint256 agentId => RoyaltyConfig) public royaltyOf;

    event RoyaltyConfigured(
        uint256 indexed agentId,
        address indexed recipient,
        uint16 bps,
        address indexed by
    );

    /// @notice Emitted on every `complete`d job whose provider has a
    ///         royalty config. Indexer/UI/settlement-bot consumes this and
    ///         credits `recipient` with `amount`.
    event RoyaltyOwed(
        uint256 indexed jobId,
        uint256 indexed providerAgentId,
        address indexed recipient,
        uint256 amount,
        uint16 bps,
        uint256 budget
    );

    constructor(
        address acp,
        address agentRegistry,
        address identityRegistry,
        address initializer
    ) {
        AGENTIC_COMMERCE = acp;
        AGENT_REGISTRY = agentRegistry;
        IDENTITY_REGISTRY = identityRegistry;
        INITIALIZER = initializer;
    }

    function setTrustedCaller(address caller) external {
        if (msg.sender != INITIALIZER) revert OnlyInitializer();
        if (trustedCaller != address(0)) revert TrustedCallerAlreadySet();
        trustedCaller = caller;
    }

    /// @notice Configure royalty for an agent. Only callable by the agent's
    ///         ERC-8004 identity owner (the builder's Tier 1 wallet that
    ///         minted the NFT).
    /// @param agentId    ERC-8004 IdentityRegistry token id
    /// @param recipient  who receives the royalty (address(0) clears the
    ///                   config — opt-out from emitting events)
    /// @param bps        basis points (10000 = 100%). Capped at MAX_BPS.
    function setRoyalty(
        uint256 agentId,
        address recipient,
        uint16 bps
    ) external {
        address owner = IIdentityRegistry(IDENTITY_REGISTRY).ownerOf(agentId);
        if (msg.sender != owner) revert OnlyIdentityOwner();
        if (bps > MAX_BPS) revert BpsOutOfRange();
        if (recipient == address(0) && bps != 0) revert RecipientZero();

        royaltyOf[agentId] = RoyaltyConfig({recipient: recipient, bps: bps});
        emit RoyaltyConfigured(agentId, recipient, bps, msg.sender);
    }

    function beforeAction(
        uint256,
        bytes4,
        bytes calldata
    ) external pure override {
        // no-op — royalty signaling is a settlement-time concern.
    }

    function afterAction(
        uint256 jobId,
        bytes4 selector,
        bytes calldata /* data */
    ) external override {
        if (msg.sender != _authorizedCaller()) revert OnlyACP();

        // Only fire on completion. Rejection paths don't trigger royalty
        // owings — no settlement happened, nothing to share.
        if (selector != IACP.complete.selector) return;

        IACP.Job memory job = IACP(AGENTIC_COMMERCE).getJob(jobId);

        // Resolve the provider's ArkAge agent id. BYO providers (no
        // registered ArkAge identity) emit nothing — they didn't opt into
        // the royalty registry.
        uint256 providerAgentId = IAgentRegistry(AGENT_REGISTRY)
            .agentIdByOperator(job.provider);
        if (providerAgentId == 0) return;

        RoyaltyConfig memory cfg = royaltyOf[providerAgentId];
        if (cfg.recipient == address(0) || cfg.bps == 0) return;

        // Compute the owed amount from the canonical Job budget. Using
        // job.budget instead of `data` mirrors PolicyHook's safety
        // pattern — caller-supplied data is not trusted for value math.
        uint256 amount = (uint256(job.budget) * uint256(cfg.bps)) / 10_000;
        if (amount == 0) return;

        emit RoyaltyOwed(
            jobId,
            providerAgentId,
            cfg.recipient,
            amount,
            cfg.bps,
            uint256(job.budget)
        );
    }

    function _authorizedCaller() internal view returns (address) {
        address t = trustedCaller;
        return t == address(0) ? AGENTIC_COMMERCE : t;
    }
}

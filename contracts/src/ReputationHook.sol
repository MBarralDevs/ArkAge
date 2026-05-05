// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IACPHook} from "./interfaces/IACPHook.sol";
import {IACP} from "./interfaces/IACP.sol";
import {IReputationRegistry} from "./interfaces/IReputationRegistry.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/// @title ReputationHook
/// @notice ERC-8183 `afterAction` hook that writes ERC-8004 feedback on
///         job settlement (complete → +100, reject → -50). The on-chain
///         `bytes32 reason` from complete/reject is threaded into the 8004
///         feedbackHash, creating one cryptographic link from the off-chain
///         evaluator output (stored in Vercel Blob) → on-chain settlement →
///         on-chain reputation. Anyone can verify-by-hash via the public
///         `arkage:verify_evidence` MCP tool.
/// @dev    ERC-8004 compliance (Risk #1 resolution): the spec says "feedback
///         submitter MUST NOT be the agent owner or approved-operator for
///         _agentId_". From 8004's perspective msg.sender == this contract,
///         so the universal invariant (this contract never owns or is
///         approved-operator of any 8004 NFT) trivially satisfies the rule.
///         Verified by test/invariant/HookOwnership.invariant.t.sol.
contract ReputationHook is IACPHook {
    address public immutable AGENTIC_COMMERCE;
    address public immutable REPUTATION_REGISTRY;
    address public immutable AGENT_REGISTRY;

    string private constant TAG_SRC = "src:acp";
    string private constant TAG_COMPLETE = "outcome:complete";
    string private constant TAG_REJECT = "outcome:reject";

    /// @notice Defense-in-depth idempotency: prevents double-write of reputation
    ///         if ACP ever calls complete/reject twice for the same job (or a
    ///         future ACP version supports retries).
    mapping(uint256 => bool) private _processed;

    constructor(address acp, address reputationRegistry, address agentRegistry) {
        AGENTIC_COMMERCE = acp;
        REPUTATION_REGISTRY = reputationRegistry;
        AGENT_REGISTRY = agentRegistry;
    }

    function beforeAction(uint256, bytes4, bytes calldata) external pure override {
        // no-op — reputation is only written after settlement.
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata) external override {
        require(msg.sender == AGENTIC_COMMERCE, "only ACP");

        // Only complete/reject can write reputation; bail early on other selectors
        // BEFORE checking idempotency so non-terminal hookable actions don't
        // accidentally lock the jobId.
        if (selector != IACP.complete.selector && selector != IACP.reject.selector) {
            return;
        }

        // Idempotency: refuse to write reputation more than once per job.
        if (_processed[jobId]) return;

        IACP.Job memory job = IACP(AGENTIC_COMMERCE).getJob(jobId);
        uint256 providerAgentId = IAgentRegistry(AGENT_REGISTRY).agentIdByOperator(job.provider);
        if (providerAgentId == 0) return; // unknown provider — silent skip (BYO flows)

        // Mark as processed BEFORE the external call (CEI pattern).
        _processed[jobId] = true;

        if (selector == IACP.complete.selector) {
            IReputationRegistry(REPUTATION_REGISTRY).giveFeedback(
                providerAgentId,
                int128(100),
                uint8(0),
                TAG_SRC,
                TAG_COMPLETE,
                _jobEndpoint(jobId),
                _evidenceURI(job.reason),
                job.reason
            );
        } else if (selector == IACP.reject.selector) {
            IReputationRegistry(REPUTATION_REGISTRY).giveFeedback(
                providerAgentId,
                int128(-50),
                uint8(0),
                TAG_SRC,
                TAG_REJECT,
                _jobEndpoint(jobId),
                _evidenceURI(job.reason),
                job.reason
            );
        }
        // Other selectors (submit, fund, etc.) are silently ignored — only
        // terminal settlement events trigger reputation writes.
    }

    function _jobEndpoint(uint256 jobId) internal pure returns (string memory) {
        return string(abi.encodePacked("arkage://job/", _toString(jobId)));
    }

    function _evidenceURI(bytes32 reason) internal pure returns (string memory) {
        return string(abi.encodePacked("arkage://evidence/", _toHexString(reason)));
    }

    function _toString(uint256 n) internal pure returns (string memory) {
        if (n == 0) return "0";
        uint256 j = n;
        uint256 len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory b = new bytes(len);
        while (n != 0) {
            len--;
            b[len] = bytes1(uint8(48 + (n % 10)));
            n /= 10;
        }
        return string(b);
    }

    function _toHexString(bytes32 v) internal pure returns (string memory) {
        bytes memory chars = "0123456789abcdef";
        bytes memory s = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            s[i * 2] = chars[uint8(v[i] >> 4)];
            s[i * 2 + 1] = chars[uint8(v[i] & 0x0f)];
        }
        return string(s);
    }
}

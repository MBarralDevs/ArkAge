// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IACPHook} from "./interfaces/IACPHook.sol";
import {IACP} from "./interfaces/IACP.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/// @notice Minimal ERC-20 surface — we only need transferFrom for pulling the
///         evaluator fee. USDC at 0x3600...0000 reverts on failure, but we
///         defensively `require(ok)` so this contract works correctly with
///         non-standard ERC-20 implementations too.
interface IERC20Min {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title EvaluatorFeeHook
/// @notice ERC-8183 `afterAction` hook that pulls the evaluator fee from the
///         provider's wallet to ArkAge's treasury at job settlement
///         (`complete` only — `reject` does not pull a fee per spec §2.6).
/// @dev    The provider must approve this contract for at least the per-job
///         fee BEFORE calling `complete`. Without that approval, the
///         transferFrom reverts and the entire `complete` reverts —
///         ensuring fees are always collected when due (spec §2.6).
///
///         Universal invariant (Risk #1): no NFT-touching code paths.
contract EvaluatorFeeHook is IACPHook {
    // ---- Custom errors ----
    error OnlyACP();
    error FeeTransferFailed();

    // ---- Immutable trust addresses ----
    address public immutable AGENTIC_COMMERCE;
    address public immutable USDC;
    address public immutable TREASURY;
    address public immutable AGENT_REGISTRY;

    /// @notice Defense-in-depth idempotency: prevents double-charging if ACP
    ///         ever calls complete twice for the same job.
    mapping(uint256 => bool) private _processed;

    event FeeCollected(uint256 indexed jobId, address indexed provider, uint256 amount);

    constructor(address acp, address usdc, address treasury, address agentRegistry) {
        AGENTIC_COMMERCE = acp;
        USDC = usdc;
        TREASURY = treasury;
        AGENT_REGISTRY = agentRegistry;
    }

    function beforeAction(uint256, bytes4, bytes calldata) external pure override {
        // no-op — fee is only pulled at settlement.
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata) external override {
        if (msg.sender != AGENTIC_COMMERCE) revert OnlyACP();

        // Only complete pulls a fee. reject and other selectors return early
        // BEFORE the idempotency lock so they don't accidentally seal the jobId.
        if (selector != IACP.complete.selector) return;

        // Idempotency guard.
        if (_processed[jobId]) return;

        uint256 fee = IAgentRegistry(AGENT_REGISTRY).evaluatorFeeFor(jobId);
        if (fee == 0) return; // BYO evaluator — no ArkAge fee

        IACP.Job memory job = IACP(AGENTIC_COMMERCE).getJob(jobId);

        // CEI: mark as processed BEFORE the external token call, so a
        // hypothetical reentrancy via a non-standard token can't re-enter
        // the unprocessed branch. (USDC is non-reentrant but defense in
        // depth is cheap.)
        _processed[jobId] = true;

        bool ok = IERC20Min(USDC).transferFrom(job.provider, TREASURY, fee);
        if (!ok) revert FeeTransferFailed();

        emit FeeCollected(jobId, job.provider, fee);
    }
}

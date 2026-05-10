/**
 * Aggregate import barrel for the MCP tool registry.
 *
 * Every tool module triggers a `registerTool()` side-effect at import
 * time. This file pulls them all in once so the route handler doesn't
 * have to. Adding a new tool = one new line here.
 */

// --- Identity domain (5 tools) ---
import "./tools/identity/bootstrap-user";
import "./tools/identity/get-agent-info";
import "./tools/identity/get-my-agents";
import "./tools/identity/update-agent-metadata";
import "./tools/identity/revoke-agent";

// --- Jobs domain (9 tools) ---
import "./tools/jobs/post-job";
import "./tools/jobs/accept-job";
import "./tools/jobs/set-budget";
import "./tools/jobs/fund-job";
import "./tools/jobs/submit-work";
import "./tools/jobs/claim-refund";
import "./tools/jobs/get-job";
import "./tools/jobs/list-jobs";
import "./tools/jobs/query-jobs";

// --- Reputation domain (3 tools) ---
import "./tools/reputation/get-reputation";
import "./tools/reputation/query-reputation-history";
import "./tools/reputation/compare-agents";

// --- Treasury domain (2 tools) ---
import "./tools/treasury/get-treasury-position";
import "./tools/treasury/withdraw-treasury";

// --- Admin domain (3 tools) ---
import "./tools/admin/get-protocol-health";
import "./tools/admin/force-advance-workflow";
import "./tools/admin/verify-evidence";

// --- x402 domain (5 tools, Plan D) ---
import "./tools/x402/pay-and-call";
import "./tools/x402/register-x402-endpoint";
import "./tools/x402/list-my-x402-endpoints";
import "./tools/x402/list-my-x402-receipts";
import "./tools/x402/dispute-receipt";
import "./tools/x402/gateway-deposit";

export {};

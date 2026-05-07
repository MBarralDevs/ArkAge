/**
 * Aggregate import barrel for the MCP tool registry.
 *
 * Every tool module triggers a `registerTool()` side-effect at import
 * time. This file pulls them all in once so the route handler doesn't
 * have to. Adding a new tool = one new line here.
 */

// --- Identity domain (5 tools) ---
import "./tools/identity/bootstrap-user.js";
import "./tools/identity/get-agent-info.js";
import "./tools/identity/get-my-agents.js";
import "./tools/identity/update-agent-metadata.js";
import "./tools/identity/revoke-agent.js";

// --- Jobs domain (9 tools) ---
import "./tools/jobs/post-job.js";
import "./tools/jobs/accept-job.js";
import "./tools/jobs/set-budget.js";
import "./tools/jobs/fund-job.js";
import "./tools/jobs/submit-work.js";
import "./tools/jobs/claim-refund.js";
import "./tools/jobs/get-job.js";
import "./tools/jobs/list-jobs.js";
import "./tools/jobs/query-jobs.js";

// --- Reputation domain (3 tools) ---
import "./tools/reputation/get-reputation.js";
import "./tools/reputation/query-reputation-history.js";
import "./tools/reputation/compare-agents.js";

// --- Treasury domain (2 tools) ---
import "./tools/treasury/get-treasury-position.js";
import "./tools/treasury/withdraw-treasury.js";

// --- Admin domain (3 tools) ---
import "./tools/admin/get-protocol-health.js";
import "./tools/admin/force-advance-workflow.js";
import "./tools/admin/verify-evidence.js";

export {};

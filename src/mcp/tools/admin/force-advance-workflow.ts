import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

/**
 * arkage:force_advance_workflow — manually fire a resumeHook to
 * unstick a workflow that the stuck-workflow reconciler couldn't
 * progress automatically.
 *
 * The actual resumeHook call lives in the workflow runtime (Phase 8+).
 * Until that lands, this tool records the intent in audit_log so an
 * operator can manually intervene; once the runtime is wired, swap
 * the stub for a real resumeHook(token, payload) call.
 */

const Input = z.object({
    hookToken: z.string().min(1),
    payloadJson: z.string().optional(),
});

interface ForceAdvanceOutput {
    resumed: boolean;
    note?: string;
}

export async function handleForceAdvanceWorkflow(
    rawInput: unknown,
): Promise<Result<ForceAdvanceOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const payload = parse.data.payloadJson ? JSON.parse(parse.data.payloadJson) : {};

    await db.auditLog.create({
        data: {
            actorKind: "admin",
            action: "force_advance_workflow",
            targetKind: "hook_token",
            targetId: parse.data.hookToken,
            payloadJsonb: { token: parse.data.hookToken, payload } as object,
        },
    });

    // TODO(Plan B Phase 8): wire `resumeHook` from the workflow runtime
    // once it's mounted. For now we record the intent so an operator
    // can verify the action was logged. Returning resumed=false signals
    // to the caller that the runtime hasn't dispatched yet.
    return ok({
        resumed: false,
        note: "logged in audit_log; workflow runtime not yet mounted (Plan B Phase 8)",
    });
}

registerTool({
    name: "arkage:force_advance_workflow",
    description:
        "Admin-only: manually fire resumeHook for a stuck workflow. Logs intent in audit_log; runtime dispatch lands in Plan B Phase 8.",
    inputSchema: {
        type: "object",
        properties: {
            hookToken: { type: "string" },
            payloadJson: { type: "string" },
        },
        required: ["hookToken"],
    },
    handler: handleForceAdvanceWorkflow,
});

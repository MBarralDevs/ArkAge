import { z } from "zod";
import { resumeHook } from "workflow/api";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

/**
 * arkage:force_advance_workflow — manually fire a resumeHook to
 * unstick a workflow that the stuck-workflow reconciler couldn't
 * progress automatically.
 *
 * Records the intent in audit_log AND dispatches resumeHook via the
 * workflow runtime. resumeHook is idempotent on the (token, payload)
 * pair, so re-firing a token whose hook already received a payload is
 * a no-op.
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

    try {
        await resumeHook(parse.data.hookToken, payload);
        return ok({ resumed: true });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return ok({
            resumed: false,
            note: `resumeHook failed: ${message} (intent logged in audit_log)`,
        });
    }
}

registerTool({
    name: "arkage:force_advance_workflow",
    description:
        "Admin-only: manually fire resumeHook for a stuck workflow. Logs intent in audit_log and dispatches via the workflow runtime.",
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

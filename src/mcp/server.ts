import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpAuthContext } from "./auth.js";

export interface McpToolDefinition<TInput = unknown, TOutput = unknown> {
    name: string;
    description: string;
    inputSchema: {
        $schema?: string;
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
    handler: (input: TInput, ctx: McpAuthContext) => Promise<TOutput>;
}

const TOOL_REGISTRY: McpToolDefinition[] = [];

export function registerTool<I, O>(tool: McpToolDefinition<I, O>): void {
    if (TOOL_REGISTRY.find((t) => t.name === tool.name)) {
        throw new Error(`Tool ${tool.name} already registered`);
    }
    TOOL_REGISTRY.push(tool as McpToolDefinition);
}

export function listRegisteredTools(): readonly McpToolDefinition[] {
    return TOOL_REGISTRY;
}

/**
 * Test-only: drop every registered tool. Lets integration tests start
 * from a blank registry without dragging shared module state across cases.
 */
export function _resetRegistryForTesting(): void {
    TOOL_REGISTRY.length = 0;
}

export function createMcpServer(ctx: McpAuthContext): Server {
    const server = new Server(
        { name: "arkage-mcp", version: "0.1.0" },
        { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: TOOL_REGISTRY.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const tool = TOOL_REGISTRY.find((t) => t.name === req.params.name);
        if (!tool) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify({
                            ok: false,
                            code: "unknown_tool",
                            message: `Tool ${req.params.name} not found`,
                        }),
                    },
                ],
                isError: true,
            };
        }
        try {
            const result = await tool.handler(req.params.arguments ?? {}, ctx);
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result) }],
            };
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify({
                            ok: false,
                            code: "internal_error",
                            message,
                        }),
                    },
                ],
                isError: true,
            };
        }
    });

    return server;
}

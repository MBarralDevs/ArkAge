import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
    _resetRegistryForTesting,
    createMcpServer,
    listRegisteredTools,
    registerTool,
} from "@/mcp/server";
import { ok } from "@/mcp/result";
import type { McpAuthContext } from "@/mcp/auth";

const TEST_CTX: McpAuthContext = {
    token: "arkage_" + "0".repeat(64),
    builderId: 1n,
    actingAgentId: null,
    actingWalletAddress: "0x0000000000000000000000000000000000000001",
};

beforeEach(() => {
    _resetRegistryForTesting();
});

afterEach(() => {
    _resetRegistryForTesting();
});

describe("MCP tool registry — direct registry contract", () => {
    it("includes registered tools in listRegisteredTools()", () => {
        registerTool({
            name: "test:alpha",
            description: "Test alpha",
            inputSchema: { type: "object", properties: {}, required: [] },
            handler: async () => ok({ kind: "alpha" }),
        });
        registerTool({
            name: "test:beta",
            description: "Test beta",
            inputSchema: { type: "object", properties: {}, required: [] },
            handler: async () => ok({ kind: "beta" }),
        });

        const names = listRegisteredTools().map((t) => t.name);
        expect(names).toContain("test:alpha");
        expect(names).toContain("test:beta");
    });

    it("rejects duplicate registration of the same tool name", () => {
        registerTool({
            name: "test:dup",
            description: "Test",
            inputSchema: { type: "object", properties: {}, required: [] },
            handler: async () => ok({}),
        });
        expect(() =>
            registerTool({
                name: "test:dup",
                description: "Test",
                inputSchema: { type: "object", properties: {}, required: [] },
                handler: async () => ok({}),
            }),
        ).toThrow(/already registered/);
    });
});

describe("MCP tool registry — full SDK round-trip via in-memory transport", () => {
    it("lists tools through the SDK client", async () => {
        registerTool({
            name: "test:echo",
            description: "Echo input back",
            inputSchema: {
                type: "object",
                properties: { msg: { type: "string" } },
                required: ["msg"],
            },
            handler: async (input: unknown) => {
                const i = input as { msg: string };
                return ok({ echoed: i.msg });
            },
        });

        const server = createMcpServer(TEST_CTX);
        const [serverT, clientT] = InMemoryTransport.createLinkedPair();
        const client = new Client(
            { name: "arkage-test-client", version: "0.0.0" },
            { capabilities: {} },
        );
        await Promise.all([server.connect(serverT), client.connect(clientT)]);

        const list = await client.listTools();
        expect(list.tools.some((t) => t.name === "test:echo")).toBe(true);

        await client.close();
        await server.close();
    });

    it("dispatches tools/call and returns the handler's Result envelope", async () => {
        registerTool({
            name: "test:echo",
            description: "Echo input back",
            inputSchema: {
                type: "object",
                properties: { msg: { type: "string" } },
                required: ["msg"],
            },
            handler: async (input: unknown) => {
                const i = input as { msg: string };
                return ok({ echoed: i.msg });
            },
        });

        const server = createMcpServer(TEST_CTX);
        const [serverT, clientT] = InMemoryTransport.createLinkedPair();
        const client = new Client(
            { name: "arkage-test-client", version: "0.0.0" },
            { capabilities: {} },
        );
        await Promise.all([server.connect(serverT), client.connect(clientT)]);

        const response = await client.callTool({
            name: "test:echo",
            arguments: { msg: "hello" },
        });
        const content = response.content as Array<{ type: string; text: string }>;
        expect(content[0]?.type).toBe("text");
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.ok).toBe(true);
        expect(parsed.data.echoed).toBe("hello");

        await client.close();
        await server.close();
    });

    it("returns an isError envelope when an unknown tool is called", async () => {
        const server = createMcpServer(TEST_CTX);
        const [serverT, clientT] = InMemoryTransport.createLinkedPair();
        const client = new Client(
            { name: "arkage-test-client", version: "0.0.0" },
            { capabilities: {} },
        );
        await Promise.all([server.connect(serverT), client.connect(clientT)]);

        const response = await client.callTool({ name: "test:does-not-exist", arguments: {} });
        expect(response.isError).toBe(true);
        const content = response.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(content[0]!.text);
        expect(parsed.ok).toBe(false);
        expect(parsed.code).toBe("unknown_tool");

        await client.close();
        await server.close();
    });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
    spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Import AFTER the mock is registered so circle-cli picks up the mocked spawn.
const { circleCli, CircleCliError } = await import("@/lib/circle-cli");

interface FakeChild extends EventEmitter {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
}

function fakeChild(): FakeChild {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    return child;
}

function emit(
    child: FakeChild,
    {
        stdout = "",
        stderr = "",
        exitCode = 0,
    }: { stdout?: string; stderr?: string; exitCode?: number | null },
) {
    // Defer so the awaiting promise has time to attach listeners.
    queueMicrotask(() => {
        if (stdout) child.stdout.emit("data", Buffer.from(stdout));
        if (stderr) child.stderr.emit("data", Buffer.from(stderr));
        child.emit("close", exitCode);
    });
}

describe("circleCli wrapper", () => {
    beforeEach(() => {
        spawnMock.mockReset();
    });

    it("appends --output json when missing and parses the data field", async () => {
        const child = fakeChild();
        spawnMock.mockReturnValueOnce(child);
        emit(child, {
            stdout: JSON.stringify({ data: { wallets: ["0xabc"] } }),
        });

        const result = await circleCli<{ wallets: string[] }>({
            args: ["wallet", "list", "--chain", "ARC-TESTNET"],
        });

        expect(result).toEqual({ wallets: ["0xabc"] });
        const [binary, args, options] = spawnMock.mock.calls[0]!;
        expect(binary).toBe("circle");
        expect(args).toEqual([
            "wallet",
            "list",
            "--chain",
            "ARC-TESTNET",
            "--output",
            "json",
        ]);
        expect(options.env.CIRCLE_ACCEPT_TERMS).toBe("1");
    });

    it("does not duplicate --output when already present in args", async () => {
        const child = fakeChild();
        spawnMock.mockReturnValueOnce(child);
        emit(child, { stdout: JSON.stringify({ data: {} }) });

        await circleCli({
            args: ["wallet", "status", "--output", "json"],
        });

        const args = spawnMock.mock.calls[0]![1];
        const outputCount = (args as string[]).filter(
            (a) => a === "--output",
        ).length;
        expect(outputCount).toBe(1);
    });

    it("throws CircleCliError on non-zero exit code, surfacing stderr", async () => {
        const child = fakeChild();
        spawnMock.mockReturnValueOnce(child);
        emit(child, {
            stderr: '{"error":{"code":"AUTH_REQUIRED","message":"Not logged in"}}',
            exitCode: 1,
        });

        await expect(
            circleCli({ args: ["wallet", "status"] }),
        ).rejects.toThrow(/Not logged in/);
    });

    it("throws CircleCliError when stdout contains an error envelope", async () => {
        const child = fakeChild();
        spawnMock.mockReturnValueOnce(child);
        emit(child, {
            stdout: JSON.stringify({
                error: { code: "INVALID_ARGUMENT", message: "balance is 0" },
            }),
            exitCode: 0,
        });

        await expect(
            circleCli({
                args: ["gateway", "deposit", "--amount", "1"],
            }),
        ).rejects.toThrow(CircleCliError);
    });

    it("throws CircleCliError when stdout is not valid JSON", async () => {
        const child = fakeChild();
        spawnMock.mockReturnValueOnce(child);
        emit(child, { stdout: "not json at all" });

        await expect(circleCli({ args: ["wallet", "status"] })).rejects.toThrow(
            /Failed to parse/,
        );
    });

    it("kills the child after the configured timeout", async () => {
        vi.useFakeTimers();
        const child = fakeChild();
        spawnMock.mockReturnValueOnce(child);

        const promise = circleCli({
            args: ["wallet", "status"],
            timeoutMs: 100,
        });

        // Trigger timeout, then resolve the close handler so the promise settles.
        vi.advanceTimersByTime(150);
        queueMicrotask(() => child.emit("close", null));

        await expect(promise).rejects.toThrow(CircleCliError);
        expect(child.kill).toHaveBeenCalledWith("SIGKILL");
        vi.useRealTimers();
    });

    it("honours a custom binary path", async () => {
        const child = fakeChild();
        spawnMock.mockReturnValueOnce(child);
        emit(child, { stdout: JSON.stringify({ data: {} }) });

        await circleCli({
            args: ["wallet", "status"],
            binary: "/custom/path/circle",
        });

        expect(spawnMock.mock.calls[0]![0]).toBe("/custom/path/circle");
    });
});

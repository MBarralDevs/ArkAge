import { spawn } from "node:child_process";

/**
 * Thin subprocess wrapper around the `@circle-fin/cli` binary (Plan E1).
 *
 * **Where this runs:** smoke scripts (`scripts/smoke-*.ts`) and local agent
 * runtimes — i.e. environments where the `circle` binary is installed and a
 * `circle wallet login` session lives in `~/.circle-cli/`.
 *
 * **Where this MUST NOT run:** any Vercel Function / serverless handler.
 * Circle's CLI is not packaged into the Vercel build and the session
 * directory is filesystem-local to the builder's environment. Calling this
 * from a request handler would either fail (no binary) or leak session state
 * across builders (if it somehow did find one). For the buyer-side x402
 * path, ArkAge returns a "run this on your machine" envelope to the agent
 * instead of spawning `circle` server-side.
 *
 * All calls inject `CIRCLE_ACCEPT_TERMS=1` and `--output json` so the
 * wrapper is non-interactive and machine-readable by default.
 *
 * Pre-flight findings (2026-05-12, captured in
 * docs/runbooks/circle-agent-wallet-onboarding.md):
 *  - CLI v0.0.1; expect API drift.
 *  - `circle gateway deposit` on `ARC-TESTNET` is currently broken (claims
 *    balance is 0 regardless of on-chain state). Plan E1 Task 12 is gated
 *    on Circle's patch; everything else works.
 */

const DEFAULT_TIMEOUT_MS = 60_000;

export class CircleCliError extends Error {
    constructor(
        readonly exitCode: number | null,
        readonly stderr: string,
        readonly stdout: string,
        readonly args: readonly string[],
    ) {
        const shortCmd = `circle ${args.join(" ")}`;
        const detail = stderr.trim() || stdout.trim() || "no output";
        super(`${shortCmd} failed (exit ${exitCode ?? "killed"}): ${detail}`);
        this.name = "CircleCliError";
    }
}

export interface CircleCliOptions {
    args: readonly string[];
    env?: Record<string, string | undefined>;
    cwd?: string;
    timeoutMs?: number;
    /**
     * Override the binary path for testing. Defaults to `circle` on PATH.
     */
    binary?: string;
}

/**
 * Spawns `circle` with the supplied args and returns the parsed JSON
 * response on success. Throws `CircleCliError` on non-zero exit or timeout.
 *
 * Always appends `--output json` if not already present, and always exports
 * `CIRCLE_ACCEPT_TERMS=1` into the child env (overridable by caller).
 *
 * Generic param `T` is the expected shape of the `data` field in Circle's
 * standard response envelope (`{ data: T }` or `{ error: ... }`).
 */
export async function circleCli<T = unknown>(
    opts: CircleCliOptions,
): Promise<T> {
    const args = opts.args.includes("--output")
        ? [...opts.args]
        : [...opts.args, "--output", "json"];
    const binary = opts.binary ?? "circle";
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        CIRCLE_ACCEPT_TERMS: "1",
        ...(opts.env as NodeJS.ProcessEnv | undefined),
    };

    const child = spawn(binary, args, {
        env: childEnv,
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
    });

    const timeoutHandle = setTimeout(() => {
        child.kill("SIGKILL");
    }, timeoutMs);

    const exitCode: number | null = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code));
    }).finally(() => clearTimeout(timeoutHandle));

    if (exitCode !== 0) {
        throw new CircleCliError(exitCode, stderr, stdout, args);
    }

    try {
        const parsed = JSON.parse(stdout) as { data?: T; error?: unknown };
        if (parsed.error !== undefined) {
            throw new CircleCliError(
                exitCode,
                JSON.stringify(parsed.error),
                stdout,
                args,
            );
        }
        return parsed.data as T;
    } catch (e) {
        if (e instanceof CircleCliError) throw e;
        throw new CircleCliError(
            exitCode,
            `Failed to parse Circle CLI output as JSON: ${
                e instanceof Error ? e.message : String(e)
            }`,
            stdout,
            args,
        );
    }
}

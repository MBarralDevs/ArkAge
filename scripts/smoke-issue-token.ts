/**
 * Smoke-test bootstrap: create a `builders` row for the given primary
 * wallet (or upsert if it already exists) and issue an MCP bearer
 * token mapped to it. Prints the token to stdout — capture it once,
 * use it for every subsequent MCP HTTP call against the deployed
 * Vercel app.
 *
 * Usage:
 *   npm run smoke:issue-token -- 0xYourMetamaskAddress
 *
 * The token is shown ONCE. Store it somewhere safe (1Password, env file
 * outside git, etc.). Re-running the script issues a NEW token (existing
 * tokens stay valid until you revoke them by deleting the audit_log row).
 */

import { db } from "../src/lib/db";
import { issueToken, hashToken } from "../src/lib/tokens";

async function main() {
    const arg = process.argv[2];
    if (!arg || !/^0x[a-fA-F0-9]{40}$/.test(arg)) {
        console.error(
            "Usage: npm run smoke:issue-token -- 0x<40-hex>",
        );
        process.exit(1);
    }
    const wallet = arg.toLowerCase();
    const walletBytes = Buffer.from(wallet.slice(2), "hex");

    const builder = await db.builder.upsert({
        where: { primaryWallet: walletBytes },
        update: {},
        create: { primaryWallet: walletBytes },
    });

    const token = issueToken();
    const tokenHash = hashToken(token);

    await db.auditLog.create({
        data: {
            actorKind: "token",
            actorId: tokenHash,
            action: "token.issued",
            payloadJsonb: {
                builderId: builder.id.toString(),
                walletAddress: wallet,
            } as object,
        },
    });

    console.log("");
    console.log("================================================");
    console.log("  builderId      :", builder.id.toString());
    console.log("  primaryWallet  :", wallet);
    console.log("  MCP token      :", token);
    console.log("================================================");
    console.log("");
    console.log(
        "Use this token as `Authorization: Bearer <token>` for every",
    );
    console.log(
        "MCP HTTP call. Token is shown once — copy it now.",
    );

    await db.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

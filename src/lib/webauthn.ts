import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
    RegistrationResponseJSON,
    AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { db } from "./db";
import { hashToken } from "./tokens";

/**
 * SimpleWebAuthn server wrappers for ArkAge passkey auth.
 *
 * v1 stores challenges + credentials in `audit_log` for simplicity
 * (zero new tables, append-only). v1.5 graduates these to dedicated
 * `passkey_credentials` + `passkey_challenges` tables when we want
 * indexed lookups + per-credential revocation.
 *
 * SDK note: SimpleWebAuthn v13 returns `registrationInfo.credential`
 * (a `WebAuthnCredential` with `id`, `publicKey`, `counter`) — not the
 * pre-v9 split `credentialID/credentialPublicKey/counter` triple. The
 * `verifyAuthenticationResponse` input changed too: pass `credential`,
 * not `authenticator`.
 */

const RP_NAME = "ArkAge";

/**
 * WebAuthn rpID resolution order:
 *  1. `ARKAGE_RP_ID` env var (explicit override; set this in Vercel for a
 *     custom domain like `arkage.network`).
 *  2. `VERCEL_PROJECT_PRODUCTION_URL` (Vercel's stable production hostname;
 *     auto-set on every deploy, e.g. `arkage-zeta.vercel.app`). Picking the
 *     production URL — NOT `VERCEL_URL` — means a passkey registered on
 *     the stable alias survives across deployment commits.
 *  3. `localhost` fallback for `npm run dev`.
 *
 * Same logic mirrored for ORIGIN. The `https://` prefix is required by
 * WebAuthn except on localhost; Vercel preview / production are always
 * served over HTTPS.
 */
function resolveRpId(): string {
    if (process.env.ARKAGE_RP_ID) return process.env.ARKAGE_RP_ID;
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
        return process.env.VERCEL_PROJECT_PRODUCTION_URL;
    }
    return "localhost";
}

function resolveOrigin(): string {
    if (process.env.ARKAGE_RP_ORIGIN) return process.env.ARKAGE_RP_ORIGIN;
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
        return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    }
    return "http://localhost:3000";
}

const RP_ID = resolveRpId();
const ORIGIN = resolveOrigin();

export interface StoredCredential {
    id: string; // base64url
    publicKey: Uint8Array;
    counter: number;
    walletAddress: string;
}

export async function startRegistration(builderWallet: string) {
    const challenge = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userName: builderWallet,
        userID: new TextEncoder().encode(builderWallet),
        attestationType: "none",
        authenticatorSelection: {
            residentKey: "preferred",
            userVerification: "preferred",
        },
        timeout: 60_000,
    });
    await stashChallenge(builderWallet, challenge.challenge);
    return challenge;
}

export async function finishRegistration(
    builderWallet: string,
    response: RegistrationResponseJSON,
) {
    const expected = await readChallenge(builderWallet);
    if (!expected) throw new Error("no challenge for this wallet");

    const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: expected,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
        throw new Error("passkey registration verification failed");
    }
    const { credential } = verification.registrationInfo;

    await db.auditLog.create({
        data: {
            actorKind: "builder",
            actorId: builderWallet,
            action: "passkey.registered",
            payloadJsonb: {
                credentialId: credential.id,
                publicKey: Buffer.from(credential.publicKey).toString(
                    "base64url",
                ),
                counter: credential.counter,
            } as object,
        },
    });
    return { credentialId: credential.id };
}

export async function startAuthentication(builderWallet: string) {
    const credentials = await loadCredentialsFor(builderWallet);
    const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        allowCredentials: credentials.map((c) => ({
            id: c.id,
            type: "public-key" as const,
        })),
        userVerification: "preferred",
        timeout: 60_000,
    });
    await stashChallenge(builderWallet, options.challenge);
    return options;
}

export async function finishAuthentication(
    builderWallet: string,
    response: AuthenticationResponseJSON,
) {
    const expected = await readChallenge(builderWallet);
    if (!expected) throw new Error("no challenge for this wallet");

    const credentials = await loadCredentialsFor(builderWallet);
    const cred = credentials.find((c) => c.id === response.id);
    if (!cred) throw new Error("unknown credential");

    const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: expected,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: {
            id: cred.id,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            publicKey: cred.publicKey as any,
            counter: cred.counter,
        },
    });

    if (!verification.verified) throw new Error("passkey authentication failed");

    await bumpCounter(
        builderWallet,
        cred.id,
        verification.authenticationInfo.newCounter,
    );
    return { ok: true as const };
}

// ---- challenge stash + credential store backed by audit_log for v1 ----

async function stashChallenge(
    builderWallet: string,
    challenge: string,
): Promise<void> {
    await db.auditLog.create({
        data: {
            actorKind: "builder",
            actorId: builderWallet,
            action: "passkey.challenge",
            payloadJsonb: { challenge, exp: Date.now() + 60_000 } as object,
        },
    });
}

async function readChallenge(builderWallet: string): Promise<string | null> {
    const row = await db.auditLog.findFirst({
        where: {
            actorKind: "builder",
            actorId: builderWallet,
            action: "passkey.challenge",
        },
        orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    const data = row.payloadJsonb as
        | { challenge: string; exp: number }
        | null;
    if (!data || data.exp < Date.now()) return null;
    return data.challenge;
}

async function loadCredentialsFor(
    builderWallet: string,
): Promise<StoredCredential[]> {
    const rows = await db.auditLog.findMany({
        where: {
            actorKind: "builder",
            actorId: builderWallet,
            action: "passkey.registered",
        },
        orderBy: { createdAt: "asc" },
    });
    return rows
        .map(
            (r) =>
                r.payloadJsonb as {
                    credentialId: string;
                    publicKey: string;
                    counter: number;
                } | null,
        )
        .filter(
            (
                p,
            ): p is {
                credentialId: string;
                publicKey: string;
                counter: number;
            } => p !== null,
        )
        .map((p) => {
            const buf = Buffer.from(p.publicKey, "base64url");
            const ab = new ArrayBuffer(buf.length);
            const view = new Uint8Array(ab);
            view.set(buf);
            return {
                id: p.credentialId,
                publicKey: view,
                counter: p.counter,
                walletAddress: builderWallet,
            };
        });
}

async function bumpCounter(
    builderWallet: string,
    credentialId: string,
    newCounter: number,
): Promise<void> {
    await db.auditLog.create({
        data: {
            actorKind: "builder",
            actorId: builderWallet,
            action: "passkey.auth",
            payloadJsonb: {
                credentialId,
                counter: newCounter,
                tokenHash: hashToken(builderWallet + ":" + Date.now()),
            } as object,
        },
    });
}

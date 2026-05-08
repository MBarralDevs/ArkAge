import {
    getIronSession,
    type IronSession,
    type SessionOptions,
} from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
    builderWallet?: string;
    builderId?: string;
    signedInAt?: number;
}

export const SESSION_OPTIONS: SessionOptions = {
    cookieName: "arkage_session",
    password:
        process.env.SESSION_PASSWORD ??
        "fallback-password-please-set-SESSION_PASSWORD-32-chars-min",
    cookieOptions: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
    },
};

export async function getSession(): Promise<IronSession<SessionData>> {
    const c = await cookies();
    // iron-session's `CookieStore.set` returns void; Next.js 16's
    // `ReadonlyRequestCookies.set` returns the cookie store itself.
    // Functionally compatible — only the return-type variance differs —
    // but our strict tsconfig refuses the implicit cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return getIronSession<SessionData>(c as any, SESSION_OPTIONS);
}

export async function destroySession(): Promise<void> {
    const session = await getSession();
    session.destroy();
}

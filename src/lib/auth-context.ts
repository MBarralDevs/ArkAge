import { db } from "./db";
import { getSession } from "./session";

export interface AuthenticatedBuilder {
    builderId: bigint;
    primaryWallet: string;
    displayName: string | null;
    signedInAt: Date;
}

export async function currentBuilder(): Promise<AuthenticatedBuilder | null> {
    const session = await getSession();
    if (!session.builderId || !session.builderWallet || !session.signedInAt) {
        return null;
    }

    const builder = await db.builder.findUnique({
        where: { id: BigInt(session.builderId) },
    });
    if (!builder) return null;

    return {
        builderId: builder.id,
        primaryWallet:
            "0x" + Buffer.from(builder.primaryWallet).toString("hex"),
        displayName: builder.displayName,
        signedInAt: new Date(session.signedInAt),
    };
}

export async function isAdmin(): Promise<boolean> {
    const builder = await currentBuilder();
    if (!builder) return false;
    const admins = (process.env.ARKAGE_ADMIN_BUILDERS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return admins.includes(builder.builderId.toString());
}

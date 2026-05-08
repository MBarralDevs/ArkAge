import Link from "next/link";
import { currentBuilder } from "@/lib/auth-context";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Address } from "@/components/primitives/address";

export const dynamic = "force-dynamic";

/**
 * Console shell — renders for all `/console/*` routes including the
 * unauthenticated `/console/sign-in` page (so the sign-in card shares
 * the chrome). Per-page guarding lives in each protected page calling
 * `requireBuilder()` from `@/lib/auth-guard`, not the layout, since
 * we want the sign-in page to render without a redirect loop.
 */
export default async function ConsoleLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const builder = await currentBuilder();

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col p-4 md:p-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold">Builder console</h1>
                    {builder && (
                        <p className="text-xs text-muted-foreground">
                            Signed in as{" "}
                            <Address value={builder.primaryWallet} /> · since{" "}
                            {builder.signedInAt.toLocaleString()}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-3 text-sm">
                    {builder && (
                        <>
                            <Link
                                href="/console"
                                className="hover:underline"
                            >
                                Overview
                            </Link>
                            <Link
                                href="/console/agents"
                                className="hover:underline"
                            >
                                Agents
                            </Link>
                            <Link
                                href="/console/policies"
                                className="hover:underline"
                            >
                                Policies
                            </Link>
                            <SignOutButton />
                        </>
                    )}
                </div>
            </div>
            {children}
        </div>
    );
}

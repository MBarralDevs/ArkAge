import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AdminHome() {
    return (
        <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
                Internal-only views for ArkAge operators.
            </p>
            <ul className="space-y-1">
                <li>
                    ·{" "}
                    <Link
                        href="/admin/evaluator-queue"
                        className="underline-offset-4 hover:underline"
                    >
                        Evaluator queue
                    </Link>
                </li>
                <li>
                    ·{" "}
                    <Link
                        href="/admin/disputes"
                        className="underline-offset-4 hover:underline"
                    >
                        x402 disputes
                    </Link>
                </li>
                <li>
                    ·{" "}
                    <Link
                        href="/admin/system-health"
                        className="underline-offset-4 hover:underline"
                    >
                        System health
                    </Link>
                </li>
            </ul>
        </div>
    );
}

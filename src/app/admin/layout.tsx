import Link from "next/link";
import { requireAdmin } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    await requireAdmin();
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col p-4 md:p-8">
            <div className="mb-6 flex items-center justify-between">
                <h1 className="text-xl font-semibold">Admin</h1>
                <nav className="flex items-center gap-3 text-sm">
                    <Link
                        href="/admin/evaluator-queue"
                        className="hover:underline"
                    >
                        Evaluator queue
                    </Link>
                    <Link
                        href="/admin/disputes"
                        className="hover:underline"
                    >
                        Disputes
                    </Link>
                    <Link
                        href="/admin/system-health"
                        className="hover:underline"
                    >
                        System health
                    </Link>
                </nav>
            </div>
            {children}
        </div>
    );
}

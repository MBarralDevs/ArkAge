import { redirect } from "next/navigation";
import { currentBuilder, isAdmin } from "./auth-context";

export async function requireBuilder() {
    const builder = await currentBuilder();
    if (!builder) redirect("/console/sign-in");
    return builder;
}

export async function requireAdmin() {
    const ok = await isAdmin();
    if (!ok) redirect("/");
}

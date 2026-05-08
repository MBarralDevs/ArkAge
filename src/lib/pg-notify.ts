import createSubscriber from "pg-listen";
import { env } from "./env";

/**
 * Long-lived LISTEN connection wrapper around `pg-listen`.
 *
 * Used by SSE routes (`src/app/api/stream/*`) to subscribe to the
 * triggers installed in `pg_notify_triggers` migration.
 *
 * Critical: must use the DIRECT (non-pooled) Postgres URL. Neon's
 * pgbouncer pooler runs in transaction mode and silently drops
 * LISTEN/NOTIFY because the session-scoped subscription doesn't
 * survive across pooled-connection checkout boundaries.
 *
 * Returns a disposer the SSE route calls on `request.signal` abort.
 */
export async function listenToChannel<T = unknown>(
    channel: string,
    handler: (payload: T) => void | Promise<void>,
): Promise<() => Promise<void>> {
    const connectionString = env.DIRECT_DATABASE_URL ?? env.DATABASE_URL;
    const subscriber = createSubscriber({ connectionString });
    await subscriber.connect();
    await subscriber.listenTo(channel);

    subscriber.notifications.on(channel, async (raw: unknown) => {
        try {
            const parsed = (typeof raw === "string"
                ? JSON.parse(raw)
                : raw) as T;
            await handler(parsed);
        } catch (e) {
            console.error(
                `[pg-notify] channel=${channel} handler error`,
                e,
            );
        }
    });

    subscriber.events.on("error", (err: Error) => {
        console.error(
            `[pg-notify] channel=${channel} subscriber error`,
            err,
        );
    });

    return async () => {
        await subscriber.unlistenAll();
        await subscriber.close();
    };
}

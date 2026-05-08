import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { env } from "./env";

/**
 * Cached singleton Circle DCW client.
 *
 * The DCW client wraps Circle's HTTP API and signs every outbound
 * request with the entity secret. Both creds come from env (set up by
 * `npm run bootstrap:tier3` and pushed to Vercel during deploy gate).
 *
 * Don't instantiate via `new` elsewhere — go through this factory so
 * the entity secret is read from env consistently and the client is
 * reused across requests on a warm Fluid Compute instance.
 */
export type CircleDcwClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

let cachedDcwClient: CircleDcwClient | null = null;

export function getCircleDcwClient(): CircleDcwClient {
    if (!cachedDcwClient) {
        cachedDcwClient = initiateDeveloperControlledWalletsClient({
            apiKey: env.CIRCLE_API_KEY,
            entitySecret: env.CIRCLE_ENTITY_SECRET,
        });
    }
    return cachedDcwClient;
}

/** Test-only: drop the cached client so a freshly stubbed env is picked up. */
export function _resetCircleClientCacheForTesting(): void {
    cachedDcwClient = null;
}

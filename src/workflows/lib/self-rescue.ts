import { sleep, createHook } from "workflow";
import type { JobStatusEnum } from "@/lib/erc8183-state";

/**
 * Self-rescue race per spec §0 Risk #2.
 *
 * Every workflow chain-event await goes through this helper. It races
 * three independent advance mechanisms:
 *
 *   1. The deterministic createHook<T> token (resumed by indexer push
 *      OR stuck-workflow reconciler — same token, same outcome)
 *   2. A periodic sleep that wakes up to poll chain state directly via
 *      the rpc public client (catches missed indexer events)
 *   3. The job's expiredAt deadline (final escape hatch — workflows
 *      can never block forever)
 *
 * If the chain has already advanced past the awaited state when we
 * wake up to poll, we synthesize a "rescued" outcome so the workflow
 * proceeds without waiting for an event that already happened.
 */

export type SelfRescueOutcome<T> =
    | { kind: "event"; payload: T }
    | { kind: "rescued"; chainState: JobStatusEnum }
    | { kind: "expired" };

export interface SelfRescueOptions<T> {
    hookToken: string;
    pollChainState: () => Promise<JobStatusEnum>;
    isAdvancedPredicate: (state: JobStatusEnum) => boolean;
    expiredAtSec: number;
    rescueIntervalSec?: number;
}

export async function awaitChainEventWithRescue<T>(
    opts: SelfRescueOptions<T>,
): Promise<SelfRescueOutcome<T>> {
    "use workflow";

    const interval = opts.rescueIntervalSec ?? 60;
    const hook = createHook<T>({ token: opts.hookToken });
    console.log(`[self-rescue] waiting on token=${opts.hookToken} expiredAtSec=${opts.expiredAtSec}`);

    while (true) {
        const nowSec = Math.floor(Date.now() / 1000);
        const remaining = Math.max(0, opts.expiredAtSec - nowSec);
        if (remaining === 0) {
            console.log(`[self-rescue] expired token=${opts.hookToken}`);
            return { kind: "expired" };
        }

        // Hook<T> is Thenable<T> rather than Promise<T>; wrap in
        // Promise.resolve so Promise.race's type contract is satisfied
        // (the await semantics are identical).
        const racers: Promise<unknown>[] = [
            Promise.resolve(hook),
            sleep(`${interval}s`),
        ];
        if (remaining < interval) racers.push(sleep(`${remaining}s`));

        const winner = await Promise.race(racers);
        if (winner !== undefined) {
            console.log(`[self-rescue] event resolved token=${opts.hookToken}`);
            return { kind: "event", payload: winner as T };
        }

        const state = await opts.pollChainState();
        if (opts.isAdvancedPredicate(state)) {
            console.log(`[self-rescue] rescued via chain poll token=${opts.hookToken} state=${state}`);
            return { kind: "rescued", chainState: state };
        }

        if (Math.floor(Date.now() / 1000) >= opts.expiredAtSec) {
            console.log(`[self-rescue] expired post-poll token=${opts.hookToken}`);
            return { kind: "expired" };
        }
    }
}

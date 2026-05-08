import { encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import { ARC_TESTNET_ADDRESSES } from "./addresses";
import { MULTICALL3_ABI } from "./abis";

/**
 * Build calldata for a Multicall3 `aggregate3` batch.
 *
 * Each step is a {target, abi, functionName, args}; we encode each step
 * into calldata using viem's encodeFunctionData and then wrap them in
 * the aggregate3 envelope. The returned object can be passed directly
 * to a writeContract / sendTransaction-like call.
 */
export interface MulticallStep {
    target: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    allowFailure?: boolean;
}

export function buildMulticall(steps: MulticallStep[]): {
    to: Address;
    data: Hex;
    value: bigint;
} {
    const encoded = steps.map((s) => ({
        target: s.target,
        allowFailure: s.allowFailure ?? false,
        callData: encodeFunctionData({
            abi: s.abi,
            functionName: s.functionName,
            args: s.args,
        }),
    }));

    return {
        to: ARC_TESTNET_ADDRESSES.MULTICALL3,
        data: encodeFunctionData({
            abi: MULTICALL3_ABI,
            functionName: "aggregate3",
            args: [encoded],
        }),
        value: 0n,
    };
}

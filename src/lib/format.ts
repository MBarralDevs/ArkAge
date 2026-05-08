/**
 * Display-formatting helpers shared across the dashboard.
 *
 * Every monetary value flows through `formatUsdc6` — the spec's
 * 6-decimal USDC ERC-20 contract is the single source of truth, and
 * we never want a UI that shows "1000000 USDC" because someone forgot
 * to divide.
 */

export function shortHex(hex: string, head = 6, tail = 4): string {
    if (hex.length <= head + tail + 1) return hex;
    return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

export function formatUsdc6(raw: bigint): string {
    const negative = raw < 0n;
    const abs = negative ? -raw : raw;
    const whole = abs / 1_000_000n;
    const frac = abs % 1_000_000n;
    if (frac === 0n) return `${negative ? "-" : ""}${whole}.00 USDC`;
    const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
    const decimals = fracStr.length < 2 ? fracStr.padEnd(2, "0") : fracStr;
    return `${negative ? "-" : ""}${whole}.${decimals} USDC`;
}

export function relativeTime(d: Date, now: Date = new Date()): string {
    const diffMs = now.getTime() - d.getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 30) return "just now";
    if (sec < 90) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 48) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
}

export function absoluteTime(d: Date): string {
    return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

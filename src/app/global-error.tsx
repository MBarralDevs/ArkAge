"use client";

/**
 * Minimal explicit global-error page.
 *
 * Without this, Next.js 16 generates a default that wraps `app/layout.tsx`
 * — including our async Header (which calls cookies()) and the sonner
 * Toaster (which uses React context). Static prerender of the auto-generated
 * `_global-error` then fails with `useContext is null`.
 *
 * This file replaces the generated route with a self-contained html shell
 * that has no client-context dependencies, so static prerender succeeds
 * and Vercel can build the production bundle.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html>
            <body>
                <div
                    style={{
                        fontFamily: "system-ui, sans-serif",
                        maxWidth: 480,
                        margin: "10vh auto",
                        padding: "2rem",
                        color: "#171717",
                    }}
                >
                    <h1 style={{ fontSize: 20, marginBottom: 8 }}>
                        Something went wrong
                    </h1>
                    <p style={{ fontSize: 14, color: "#525252" }}>
                        ArkAge hit an unexpected error. The team has been
                        notified.
                    </p>
                    {error.digest && (
                        <p
                            style={{
                                fontSize: 12,
                                color: "#737373",
                                marginTop: 12,
                                fontFamily: "ui-monospace, monospace",
                            }}
                        >
                            digest: {error.digest}
                        </p>
                    )}
                    <button
                        onClick={() => reset()}
                        style={{
                            marginTop: 16,
                            padding: "8px 16px",
                            border: "1px solid #d4d4d4",
                            borderRadius: 6,
                            background: "white",
                            cursor: "pointer",
                        }}
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}

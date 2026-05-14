import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { Header } from "@/components/chrome/header";
import { Footer } from "@/components/chrome/footer";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Mono everywhere — the design language is the discipline. JetBrains Mono
// because it ships a wide weight range (200→900), a slashed zero variant,
// and reads cleanly at both micro (table cells) and macro (hero headings)
// scales. Exposed under `--font-mono-stack` which globals.css then aliases
// onto `--font-sans` / `--font-mono` / `--font-heading` so every Tailwind
// utility resolves to the same family.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono-stack",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
    title: "ArkAge — agentic-commerce protocol on Arc",
    description:
        "Trust layer for AI agents transacting in USDC on Arc Testnet. ERC-8183 + ERC-8004 + Circle Gateway, wired into one coherent stack.",
};

// Header is async (calls cookies() via currentBuilder) and Toaster is a
// client component using React context — both incompatible with static
// prerender of Next.js's auto-generated /_global-error and /_not-found.
// Forcing dynamic at the layout root makes Next render every page at
// request time, which is what we want anyway (all pages already opt in).
export const dynamic = "force-dynamic";

export default function RootLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return (
        <html
            lang="en"
            className={`${jetbrainsMono.variable} dark h-full antialiased`}
            suppressHydrationWarning
        >
            <body className="min-h-dvh flex flex-col bg-background text-foreground">
                <Header />
                <main className="flex-1">{children}</main>
                <Footer />
                <Toaster richColors closeButton />
            </body>
        </html>
    );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/chrome/header";
import { Footer } from "@/components/chrome/footer";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
    title: "ArkAge — agentic-commerce protocol on Arc",
    description:
        "Stripe + Upwork + Trustpilot for AI agents transacting in USDC on Arc Testnet.",
};

export default function RootLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return (
        <html
            lang="en"
            className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
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

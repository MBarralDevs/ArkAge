import { PrismaClient } from "@prisma/client";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { env } from "./env";

// Prisma 7 requires a driver adapter. We use Neon's HTTP-based adapter
// because most ArkAge code runs in Vercel Functions (short-lived) where
// HTTP is faster than WebSocket due to no socket overhead per cold start.
//
// For long-running processes (e.g. Plan C SSE listener) consider switching
// to PrismaNeon (WebSocket-based) at the call site if connection overhead
// becomes a measurable cost.
//
// Singleton pattern prevents PrismaClient duplication during Next.js dev
// hot-reload (each module re-evaluation would otherwise spawn a new client).

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function buildClient(): PrismaClient {
  const adapter = new PrismaNeonHttp(env.DATABASE_URL, {});
  return new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? buildClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

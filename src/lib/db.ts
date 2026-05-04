import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { env } from "./env";

// Prisma 7 requires a driver adapter. We use Neon's WebSocket adapter
// (PrismaNeon, not PrismaNeonHttp) because ArkAge relies on transactions
// throughout — Plan B uses $transaction, interactive tx, and upsert
// extensively, none of which work over HTTP (which is stateless).
//
// WebSocket has slightly higher cold-start overhead than HTTP but is
// the standard recommendation for Prisma + Neon on Vercel when
// transactions are required.
//
// Singleton pattern prevents PrismaClient duplication during Next.js dev
// hot-reload (each module re-evaluation would otherwise spawn a new client).

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function buildClient(): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL });
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

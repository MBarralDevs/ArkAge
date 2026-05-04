import { defineConfig, env } from "prisma/config";

// Migrations + introspection use the direct (non-pooled) Neon URL so
// DDL and prepared statements bypass pgbouncer. Runtime queries use
// the pooled DATABASE_URL via PrismaClient + driver adapter (Task 22).
//
// .env.local values are pre-loaded by dotenv-cli wrapping the prisma
// CLI commands (see npm run db:* scripts).

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DIRECT_DATABASE_URL"),
  },
  migrations: {
    // Prisma 7 moved the seed command out of package.json into here.
    // Invoked via `npm run db:seed` (which itself wraps this with dotenv-cli
    // so prisma/seed.ts inherits .env.local at runtime).
    seed: "tsx prisma/seed.ts",
  },
});

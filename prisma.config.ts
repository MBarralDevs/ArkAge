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
});

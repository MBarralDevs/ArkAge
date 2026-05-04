import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";

describe("prisma schema", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("can connect to database", async () => {
    const result = await db.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`;
    expect(result[0]?.now).toBeInstanceOf(Date);
  });

  it("can insert and query a Builder", async () => {
    // 0x22...22 = test sentinel; 0x11...11 is reserved by prisma/seed.ts.
    const wallet = Buffer.from("22".repeat(20), "hex");
    // Defensive cleanup in case a prior failed run left a row behind.
    await db.builder.deleteMany({ where: { primaryWallet: wallet } });

    const created = await db.builder.create({
      data: { primaryWallet: wallet, displayName: "test-builder-schema" },
    });
    expect(created.id).toBeDefined();
    expect(created.displayName).toBe("test-builder-schema");

    await db.builder.delete({ where: { id: created.id } });
  });
});

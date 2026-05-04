import { db } from "../src/lib/db";

async function main(): Promise<void> {
  console.log("Seeding…");

  // Idempotent: a single dev builder using all-0x11 as primary wallet sentinel.
  const builderWallet = Buffer.from("11".repeat(20), "hex");
  const builder = await db.builder.upsert({
    where: { primaryWallet: builderWallet },
    update: {},
    create: {
      primaryWallet: builderWallet,
      displayName: "Dev Builder",
    },
  });

  console.log(`Created builder ${builder.id} (${builder.displayName})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

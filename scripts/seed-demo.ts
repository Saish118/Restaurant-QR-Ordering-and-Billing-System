import { Database } from "../apps/api/src/database/database.module";
import { SuperAdminController } from "../apps/api/src/super-admin/super-admin.module";
import { uuid, requireRole } from "../apps/api/src/common/validation";
async function main() {
  const userId = uuid(process.argv[2] ?? "");
  const db = new Database();
  try {
    await db.onModuleInit();
    const existing = await db.asUser(
      { id: userId },
      undefined,
      async (tx, role) => {
        requireRole(role, ["SUPER_ADMIN"]);
        return tx.$queryRaw<
          { id: string; name: string }[]
        >`SELECT id,name FROM restaurants WHERE slug='demo-restaurant'`;
      },
    );
    const controller = new SuperAdminController(db);
    const restaurant =
      existing[0] ??
      (await controller.create(
        { identity: { id: userId } } as Parameters<
          SuperAdminController["create"]
        >[0],
        {
          name: "Demo Restaurant",
          slug: "demo-restaurant",
          ownerUserId: userId,
          ownerName: "Demo Owner",
          qrOrderingEnabled: false,
        },
      ));
    console.log(
      JSON.stringify({ restaurant, alreadyExisted: existing.length > 0 }),
    );
  } finally {
    await db.onModuleDestroy();
  }
}
main().catch(() => {
  console.error(
    "Demo setup failed. Check database configuration and administrator access.",
  );
  process.exitCode = 1;
});

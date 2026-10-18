import {
  Global,
  Injectable,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../common/env";
export type Transaction = Prisma.TransactionClient;
export type Identity = { id: string };
@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  readonly client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5000,
    }),
  });
  async onModuleInit() {
    const [role] = await this.client.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean; owns: boolean }[]
    >`SELECT r.rolsuper,r.rolbypassrls,EXISTS(SELECT 1 FROM pg_tables t WHERE t.schemaname='public' AND t.tableowner=current_user) AS owns FROM pg_roles r WHERE r.rolname=current_user`;
    if (!role || role.rolsuper || role.rolbypassrls || role.owns)
      throw new Error("API requires a restricted non-owner database role");
  }
  async onModuleDestroy() {
    await this.client.$disconnect();
  }
  // All request data access is transaction-local: pooled connections cannot retain tenant context.
  async asUser<T>(
    user: Identity,
    restaurantId: string | undefined,
    work: (tx: Transaction, role: string) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id',${user.id},true), set_config('app.restaurant_id','',true),set_config('app.role','',true),set_config('app.is_admin','false',true)`;
        const [account] = await tx.$queryRaw<
          { active: boolean }[]
        >`SELECT active FROM users WHERE id=${user.id}::uuid`;
        if (!account?.active)
          throw new ForbiddenException(
            "Account is not provisioned or is disabled",
          );
        const admins = await tx.$queryRaw<
          { active: boolean }[]
        >`SELECT active FROM platform_admins WHERE user_id=${user.id}::uuid AND active`;
        const admin = admins.length > 0;
        await tx.$executeRaw`SELECT set_config('app.is_admin',${String(admin)},true)`;
        let role = admin ? "SUPER_ADMIN" : "";
        if (restaurantId) {
          const [restaurant] = await tx.$queryRaw<
            { status: string }[]
          >`SELECT status FROM restaurants WHERE id=${restaurantId}::uuid`;
          const [member] = await tx.$queryRaw<
            { role: string }[]
          >`SELECT role FROM restaurant_users WHERE restaurant_id=${restaurantId}::uuid AND user_id=${user.id}::uuid AND active`;
          if (
            !restaurant ||
            (!admin &&
              (!member || !["ACTIVE", "TRIAL"].includes(restaurant.status)))
          )
            throw new ForbiddenException("Restaurant access denied");
          role = admin ? "SUPER_ADMIN" : member.role;
          await tx.$executeRaw`SELECT set_config('app.restaurant_id',${restaurantId},true),set_config('app.role',${role},true)`;
        }
        return work(tx, role);
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }
}
@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}

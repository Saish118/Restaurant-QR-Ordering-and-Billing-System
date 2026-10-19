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
export type Identity = { id: string; issuedAt?: number; lastSignInAt?: string };
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
  async recordError(code: string, route: string, requestId: string) {
    await this.client
      .$executeRaw`INSERT INTO error_logs(code,route,request_id) VALUES(${code.slice(0, 80)},${route.split("?")[0].slice(0, 160)},${requestId.slice(0, 100)})`;
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
        await tx.$executeRaw`SELECT set_config('TimeZone','UTC',true),set_config('app.user_id',${user.id},true), set_config('app.restaurant_id','',true),set_config('app.role','',true),set_config('app.is_admin','false',true)`;
        const [account] = await tx.$queryRaw<
          { active: boolean; auth_not_before: Date | null }[]
        >`SELECT active,auth_not_before FROM users WHERE id=${user.id}::uuid`;
        if (!account?.active)
          throw new ForbiddenException(
            "Account is not provisioned or is disabled",
          );
        if (
          account.auth_not_before &&
          (!user.issuedAt ||
            user.issuedAt * 1000 < account.auth_not_before.getTime())
        )
          throw new ForbiddenException(
            "Please sign in again after the password reset",
          );
        const admins = await tx.$queryRaw<
          { active: boolean }[]
        >`SELECT active FROM platform_admins WHERE user_id=${user.id}::uuid AND active`;
        const admin = admins.length > 0;
        await tx.$executeRaw`SELECT set_config('app.is_admin',${String(admin)},true)`;
        let role = admin ? "SUPER_ADMIN" : "";
        if (restaurantId) {
          const [restaurant] = await tx.$queryRaw<
            { status: string; deleted_at: Date | null }[]
          >`SELECT status,deleted_at FROM restaurants WHERE id=${restaurantId}::uuid`;
          const [member] = await tx.$queryRaw<
            { role: string }[]
          >`SELECT role FROM restaurant_users WHERE restaurant_id=${restaurantId}::uuid AND user_id=${user.id}::uuid AND active`;
          if (
            !restaurant ||
            (!admin &&
              (!member ||
                restaurant.deleted_at ||
                !["ACTIVE", "TRIAL"].includes(restaurant.status)))
          )
            throw new ForbiddenException("Restaurant access denied");
          role = admin ? "SUPER_ADMIN" : member.role;
          await tx.$executeRaw`SELECT set_config('app.restaurant_id',${restaurantId},true),set_config('app.role',${role},true)`;
          if (!admin) {
            const [subscription] = await tx.$queryRaw<
              { trial_ends_at: Date | null; expires_at: Date | null }[]
            >`SELECT trial_ends_at,expires_at FROM subscriptions WHERE restaurant_id=${restaurantId}::uuid`;
            const expiry =
              restaurant.status === "TRIAL"
                ? subscription?.trial_ends_at
                : subscription?.expires_at;
            if (expiry && expiry.getTime() <= Date.now())
              throw new ForbiddenException(
                "Restaurant subscription or trial has expired",
              );
            const [settings] = await tx.$queryRaw<
              { feature_flags: Record<string, boolean> }[]
            >`SELECT feature_flags FROM restaurant_settings WHERE restaurant_id=${restaurantId}::uuid`;
            if (
              (role === "WAITER" &&
                settings?.feature_flags.waiter_portal === false) ||
              (role === "CHEF" &&
                settings?.feature_flags.kitchen_portal === false)
            )
              throw new ForbiddenException(
                "This portal is disabled for this restaurant",
              );
            const login = user.lastSignInAt ?? null;
            await tx.$executeRaw`INSERT INTO restaurant_activity(restaurant_id,user_id,last_login_at) VALUES(${restaurantId}::uuid,${user.id}::uuid,${login}::timestamptz) ON CONFLICT(restaurant_id,user_id) DO UPDATE SET last_seen_at=now(),last_login_at=coalesce(EXCLUDED.last_login_at,restaurant_activity.last_login_at) WHERE restaurant_activity.last_seen_at<now()-interval '1 minute'`;
          }
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

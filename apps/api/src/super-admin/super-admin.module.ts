import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, AuthRequest } from "../auth/auth.module";
import { Database } from "../database/database.module";
import { parse, requireRole, uuid } from "../common/validation";
@Controller("admin/restaurants")
@UseGuards(AuthGuard)
export class SuperAdminController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get() list(@Req() req: AuthRequest) {
    return this.db.asUser(req.identity, undefined, async (tx, role) => {
      requireRole(role, ["SUPER_ADMIN"]);
      return tx.$queryRaw`SELECT id,name,slug,status,created_at FROM restaurants ORDER BY created_at DESC LIMIT 100`;
    });
  }
  @Post() create(@Req() req: AuthRequest, @Body() body: unknown) {
    const data = parse(
      z
        .object({
          name: z.string().trim().min(1).max(120),
          slug: z
            .string()
            .max(100)
            .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
          ownerUserId: z.uuid(),
          ownerName: z.string().trim().min(1).max(120),
          qrOrderingEnabled: z.boolean().default(false),
        })
        .strict(),
      body,
    );
    return this.db.asUser(req.identity, undefined, async (tx, role) => {
      requireRole(role, ["SUPER_ADMIN"]);
      const [restaurant] = await tx.$queryRaw<
        { id: string; name: string }[]
      >`INSERT INTO restaurants(name,slug) VALUES(${data.name},${data.slug}) RETURNING id,name`;
      await tx.$executeRaw`INSERT INTO users(id,display_name) VALUES(${data.ownerUserId}::uuid,${data.ownerName}) ON CONFLICT(id) DO NOTHING`;
      await tx.$executeRaw`INSERT INTO restaurant_users(restaurant_id,user_id,role) VALUES(${restaurant.id}::uuid,${data.ownerUserId}::uuid,'OWNER')`;
      await tx.$executeRaw`INSERT INTO restaurant_settings(restaurant_id,qr_ordering_enabled) VALUES(${restaurant.id}::uuid,${data.qrOrderingEnabled})`;
      await tx.$executeRaw`INSERT INTO subscriptions(restaurant_id,trial_ends_at) VALUES(${restaurant.id}::uuid,now()+interval '14 days')`;
      await tx.$executeRaw`INSERT INTO audit_logs(restaurant_id,actor_id,action,target_id) VALUES(${restaurant.id}::uuid,${req.identity.id}::uuid,'RESTAURANT_CREATED',${restaurant.id}::uuid)`;
      return restaurant;
    });
  }
  @Patch(":id") update(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(
      z
        .object({
          status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CLOSED"]),
          qrOrderingEnabled: z.boolean(),
        })
        .strict(),
      body,
    );
    return this.db.asUser(req.identity, uuid(id), async (tx, role) => {
      requireRole(role, ["SUPER_ADMIN"]);
      await tx.$executeRaw`UPDATE restaurants SET status=${data.status}::restaurant_status WHERE id=${id}::uuid`;
      await tx.$executeRaw`UPDATE restaurant_settings SET qr_ordering_enabled=${data.qrOrderingEnabled} WHERE restaurant_id=${id}::uuid`;
      await tx.$executeRaw`INSERT INTO audit_logs(restaurant_id,actor_id,action,target_id,details) VALUES(${id}::uuid,${req.identity.id}::uuid,'RESTAURANT_ACCESS_UPDATED',${id}::uuid,${JSON.stringify(data)}::jsonb)`;
      return { updated: true };
    });
  }
}
@Module({ controllers: [SuperAdminController] })
export class SuperAdminModule {}

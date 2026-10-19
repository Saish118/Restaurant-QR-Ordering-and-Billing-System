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
  Query,
  ConflictException,
} from "@nestjs/common";
import { ManagementController } from "./management.controller";
import { IdentityAdmin } from "./identity-admin";
import { z } from "zod";
import { AuthGuard, AuthRequest } from "../auth/auth.module";
import { Database } from "../database/database.module";
import { parse, requireRole, uuid } from "../common/validation";
@Controller("admin/restaurants")
@UseGuards(AuthGuard)
export class SuperAdminController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(IdentityAdmin)
    private readonly identities: IdentityAdmin = new IdentityAdmin(),
  ) {}
  @Get() list(@Req() req: AuthRequest, @Query() query: unknown) {
    const filters = parse(
      z
        .object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          search: z.string().max(120).default(""),
          includeArchived: z.enum(["true", "false"]).default("false"),
        })
        .strict(),
      query ?? {},
    );
    return this.db.asUser(req.identity, undefined, async (tx, role) => {
      requireRole(role, ["SUPER_ADMIN"]);
      const search = `%${filters.search}%`;
      const offset = (filters.page - 1) * 100;
      return tx.$queryRaw`SELECT r.id,r.name,r.slug,r.status,r.created_at,r.deleted_at,CASE WHEN (r.status='TRIAL' AND s.trial_ends_at<=now()) OR (r.status='ACTIVE' AND s.expires_at<=now()) THEN 'EXPIRED' ELSE r.status::text END AS effective_status FROM restaurants r LEFT JOIN subscriptions s ON s.restaurant_id=r.id WHERE (${filters.includeArchived === "true"} OR r.deleted_at IS NULL) AND (r.name ILIKE ${search} OR r.slug ILIKE ${search}) ORDER BY r.created_at DESC,r.id LIMIT 100 OFFSET ${offset}`;
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
          ownerEmail: z.email().optional(),
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
      await tx.$executeRaw`INSERT INTO users(id,display_name,email) VALUES(${data.ownerUserId}::uuid,${data.ownerName},${data.ownerEmail ?? null}) ON CONFLICT(id) DO NOTHING`;
      await tx.$executeRaw`INSERT INTO restaurant_users(restaurant_id,user_id,role) VALUES(${restaurant.id}::uuid,${data.ownerUserId}::uuid,'OWNER')`;
      await tx.$executeRaw`INSERT INTO restaurant_settings(restaurant_id,qr_ordering_enabled) VALUES(${restaurant.id}::uuid,${data.qrOrderingEnabled})`;
      await tx.$executeRaw`INSERT INTO subscriptions(restaurant_id,trial_ends_at) VALUES(${restaurant.id}::uuid,now()+interval '14 days')`;
      await tx.$executeRaw`INSERT INTO audit_logs(restaurant_id,actor_id,action,target_id) VALUES(${restaurant.id}::uuid,${req.identity.id}::uuid,'RESTAURANT_CREATED',${restaurant.id}::uuid)`;
      return restaurant;
    });
  }
  @Post("onboard") async onboard(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const data = parse(
      z
        .object({
          name: z.string().trim().min(1).max(120),
          slug: z
            .string()
            .max(100)
            .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
          ownerName: z.string().trim().min(1).max(120),
          ownerEmail: z.email(),
          password: z.string().min(12).max(128),
          qrOrderingEnabled: z.boolean().default(false),
        })
        .strict(),
      body,
    );
    await this.db.asUser(req.identity, undefined, async (tx, role) => {
      requireRole(role, ["SUPER_ADMIN"]);
      if (await tx.restaurants.findUnique({ where: { slug: data.slug } }))
        throw new ConflictException("Restaurant URL name already exists");
    });
    const identity = await this.identities.create(
      data.ownerEmail,
      data.password,
      data.ownerName,
    );
    try {
      return await this.create(req, {
        name: data.name,
        slug: data.slug,
        ownerName: data.ownerName,
        ownerUserId: identity.id,
        ownerEmail: identity.email,
        qrOrderingEnabled: data.qrOrderingEnabled,
      });
    } catch (error) {
      try {
        await this.identities.removeNewAccount(identity.id);
      } catch {
        await this.db.recordError(
          "ONBOARDING_CLEANUP_FAILED",
          "admin/restaurants/onboard",
          "operator-action",
        );
      }
      throw error;
    }
  }
  @Patch(":id") update(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(
      z
        .object({
          status: z.enum(["TRIAL", "ACTIVE", "EXPIRED", "SUSPENDED", "CLOSED"]),
          qrOrderingEnabled: z.boolean(),
        })
        .strict(),
      body,
    );
    return this.db.asUser(req.identity, uuid(id), async (tx, role) => {
      requireRole(role, ["SUPER_ADMIN"]);
      const restaurant = await tx.restaurants.findUnique({ where: { id } });
      if (restaurant?.deleted_at)
        throw new ConflictException(
          "Restore the archived restaurant before activating access",
        );
      await tx.$executeRaw`UPDATE restaurants SET status=${data.status}::restaurant_status WHERE id=${id}::uuid`;
      await tx.$executeRaw`UPDATE restaurant_settings SET qr_ordering_enabled=${data.qrOrderingEnabled} WHERE restaurant_id=${id}::uuid`;
      await tx.$executeRaw`INSERT INTO audit_logs(restaurant_id,actor_id,action,target_id,details) VALUES(${id}::uuid,${req.identity.id}::uuid,'RESTAURANT_ACCESS_UPDATED',${id}::uuid,${JSON.stringify(data)}::jsonb)`;
      return { updated: true };
    });
  }
}
@Module({
  controllers: [SuperAdminController, ManagementController],
  providers: [IdentityAdmin],
})
export class SuperAdminModule {}
